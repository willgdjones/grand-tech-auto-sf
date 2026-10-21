import { createPoliteFetcher, CrawlFetchError } from './fetch';
import type { FetchOptions, PageFetcher } from './fetch';
import { cachedGeocoder, geocodeEvent } from './geocode';
import { normalizeEvent, normalizeTags } from './normalize';
import { parseEventPage } from './parse';
import type { EventExtractor } from './extract/haiku';
import type { EventReviewer } from './jev';
import type { Geocoder, TechWeekEvent } from './types';
import { canonicalUrl, sourceOf } from './urls';

export interface SubmitOptions {
  /** Defaults to a fresh polite, robots-respecting single-page fetcher. */
  fetcher?: PageFetcher;
  fetchOptions?: FetchOptions;
  /** Public venue lookup; defaults to coordinates in the page plus a coarse SF neighbourhood fallback. */
  geocode?: Geocoder;
  /** Optional Haiku fallback for provider pages without usable structured data. */
  extractEvent?: EventExtractor;
  /** Jev legitimacy gate. When absent and reviewRequired is false, a parsed public SF event is accepted. */
  review?: EventReviewer;
  /** Production/staging require a passing review before a submission is published. */
  reviewRequired?: boolean;
  now?: () => number;
}

export interface SubmitResult {
  status: 'accepted' | 'rejected';
  /** Present and flagged community when accepted. */
  event?: TechWeekEvent;
  reason?: string;
  issues: string[];
}

const reject = (reason: string, issues: string[] = []): SubmitResult => ({ status: 'rejected', reason, issues });

/**
 * Ingest one pasted public event link (PLAN-v2 decision 9). No D1 side effects: the caller
 * persists the returned community event. Fetching is serial and robots-respecting; extraction
 * uses structured data first and an optional bounded Haiku fallback; location is geocoded to SF.
 */
export async function ingestSubmittedLink(rawUrl: string, options: SubmitOptions = {}): Promise<SubmitResult> {
  const source = sourceOf(rawUrl);
  if (!source) return reject('Paste a public lu.ma, Partiful or Eventbrite event link.');
  if (source === 'tech-week') return reject('Tech Week calendar events are already on the map.');

  const fetcher = options.fetcher ?? createPoliteFetcher(options.fetchOptions);
  let page;
  try { page = await fetcher.get(rawUrl); }
  catch (error) {
    if (error instanceof CrawlFetchError) return reject(`Could not open that link: ${error.message}`, [error.message]);
    return reject('Could not open that link.', [error instanceof Error ? error.message : String(error)]);
  }

  const parsed = parseEventPage(page.body, page.url);
  const issues = [...parsed.problems];

  // Structured data first; fall back to the optional grounded extractor for provider detail pages.
  let candidate = parsed.events.find(event => normalizeEvent(event)) ?? parsed.events[0];
  if ((!candidate || !normalizeEvent(candidate)) && options.extractEvent && parsed.fallback) {
    const hidden = parsed.fallback.hidden || parsed.events.some(event => event.hidden === true);
    try {
      const extracted = await options.extractEvent({ ...parsed.fallback, url: page.url, hidden });
      if (extracted) candidate = { ...extracted, url: canonicalUrl(page.url), source, hidden };
      else issues.push('No grounded event extraction');
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }

  const normalized = candidate && normalizeEvent(candidate);
  if (!candidate || !normalized) return reject('Could not read a public event (a title and start time) from that page.', issues);

  const geocode = cachedGeocoder(options.geocode ?? (async () => null));
  const located = await geocodeEvent(normalized, candidate, geocode, message => issues.push(message));
  if (located.lat === null || located.lon === null)
    return reject('That looks like a virtual event or one outside San Francisco; GTASF maps in-person SF events.', issues);

  if (options.review) {
    const review = await options.review(located);
    if (!review.ok) return reject(review.reason ?? 'This event did not pass the automated check.', issues);
  } else if (options.reviewRequired) {
    return reject('Event review is temporarily unavailable; please try again later.', issues);
  }

  const event: TechWeekEvent = { ...located, community: true, tags: normalizeTags([...located.tags, 'community']) };
  return { status: 'accepted', event, issues };
}
