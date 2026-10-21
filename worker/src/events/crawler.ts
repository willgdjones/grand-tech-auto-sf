import { flags } from '@gtasf/shared/flags';
import { createPoliteFetcher } from './fetch';
import type { FetchOptions } from './fetch';
import { cachedGeocoder, geocodeEvent } from './geocode';
import { dedupeEvents, normalizeEvent, normalizeTags } from './normalize';
import { parseEventPage } from './parse';
import type { EventLink } from './parse';
import type { EventExtractor } from './extract/haiku';
import type { CrawlResult, EventCandidate, EventTagger, Geocoder, TechWeekEvent } from './types';
import { canonicalUrl, SF_CALENDAR, sourceOf } from './urls';

export interface CrawlOptions {
  /** Defaults to shared flags.events (off until the caller's integration is ready). */
  enabled?: boolean;
  /** Public venue lookup only. Caller owns provider identity, quotas and persistent cache. */
  geocode: Geocoder;
  tagEvent?: EventTagger;
  extractEvent?: EventExtractor;
  /** Cost ceiling for the optional Haiku fallback; no retries. */
  maxExtractions?: number;
  fetchOptions?: FetchOptions;
  maxPages?: number;
}

/** Standalone ingestion; no D1, cron, secrets, or moderation provider side effects. */
export async function crawlTechWeek(options: CrawlOptions): Promise<CrawlResult> {
  const result: CrawlResult = {
    events: [], issues: [], enabled: options.enabled ?? flags.events,
    truncated: false, pagesFetched: 0, taggingApplied: Boolean(options.tagEvent),
  };
  if (!result.enabled) return result;
  const maxPages = options.maxPages ?? 400;
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error('maxPages must be a positive integer');
  const maxExtractions = options.maxExtractions ?? 25;
  if (!Number.isInteger(maxExtractions) || maxExtractions < 0 || maxExtractions > 400) throw new Error('Invalid maxExtractions');
  const client = createPoliteFetcher(options.fetchOptions);
  const geocode = cachedGeocoder(options.geocode);
  const queue: EventLink[] = [{ url: SF_CALENDAR }];
  const queued = new Set([canonicalUrl(SF_CALENDAR)]);
  const visited = new Set<string>();
  const candidates: EventCandidate[] = [];
  const context = new Map<string, EventCandidate>();
  let attempted = 0;
  let extractions = 0;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const link = queue[cursor]!;
    if (visited.has(canonicalUrl(link.url))) continue;
    if (attempted >= maxPages) { result.truncated = true; break; }
    attempted++;
    visited.add(canonicalUrl(link.url));
    let page;
    try { page = await client.get(link.url); }
    catch (error) {
      result.issues.push({ url: link.url, stage: 'fetch', message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    result.pagesFetched++;
    visited.add(canonicalUrl(page.url));
    const parsed = parseEventPage(page.body, page.url);
    for (const message of parsed.problems) result.issues.push({ url: page.url, stage: 'parse', message });
    const inherited = context.get(canonicalUrl(link.url));
    const inheritedFields = Object.fromEntries(Object.entries(inherited ?? {}).filter(([, value]) => value !== undefined));
    const combined = Object.assign({}, inheritedFields, ...parsed.events.map(event => Object.fromEntries(Object.entries(event).filter(([, v]) => v !== undefined)))) as EventCandidate;
    // A provider's default false must not reopen an official location restriction.
    combined.hidden = inherited?.hidden === true || parsed.events.some(event => event.hidden === true);
    combined.virtual = inherited?.virtual === true || parsed.events.some(event => event.virtual === true);
    if (options.extractEvent && parsed.fallback && !normalizeEvent(combined)) {
      if (extractions >= maxExtractions) result.issues.push({ url: page.url, stage: 'parse', message: 'Event extraction budget exhausted' });
      else {
        extractions++;
        try {
          const hidden = parsed.fallback.hidden || combined.hidden;
          const extracted = await options.extractEvent({ ...parsed.fallback, hidden, url: page.url });
          if (extracted) {
            // Reliable source metadata wins; the model cannot select an outbound URL.
            const event = { ...extracted, ...combined, url: canonicalUrl(page.url), source: sourceOf(page.url)!, hidden };
            if (event.hidden) { event.address = undefined; event.lat = undefined; event.lon = undefined; }
            parsed.events = [event];
          } else result.issues.push({ url: page.url, stage: 'parse', message: 'No grounded event extraction' });
        } catch {
          result.issues.push({ url: page.url, stage: 'parse', message: 'Event extraction failed; incomplete event omitted' });
        }
      }
    }
    for (const event of parsed.events) {
      const candidate = { ...inheritedFields, ...Object.fromEntries(Object.entries(event).filter(([, v]) => v !== undefined)) } as EventCandidate;
      candidate.hidden = inherited?.hidden === true || event.hidden === true;
      candidate.virtual = inherited?.virtual === true || event.virtual === true;
      candidate.neighborhood ??= link.neighborhood;
      candidates.push(candidate);
    }
    for (const next of parsed.links) {
      const url = canonicalUrl(next.url);
      // An official detail page may provide times/host missing from the provider's OG data.
      if (parsed.events.length === 1 && sourceOf(page.url) === 'tech-week' && sourceOf(next.url) !== 'tech-week') context.set(url, parsed.events[0]!);
      if (queued.has(url)) continue;
      if (queue.length >= maxPages * 2) { result.truncated = true; continue; }
      queued.add(url);
      queue.push({ ...next, neighborhood: next.neighborhood ?? link.neighborhood });
    }
    if (!parsed.events.length && !parsed.links.length && !parsed.problems.length) result.issues.push({ url: page.url, stage: 'parse', message: 'No public event metadata or calendar links found' });
  }

  // Merge multiple representations (JSON-LD + hydrated data) BEFORE geocoding.
  const merged = new Map<string, EventCandidate>();
  for (const candidate of candidates) {
    const key = canonicalUrl(candidate.url);
    const old = merged.get(key);
    if (!old) { merged.set(key, { ...candidate }); continue; }
    // JSON-LD is first; hydration/OG only fills missing fields. Privacy flags are monotone.
    for (const [field, value] of Object.entries(candidate)) {
      if ((old as unknown as Record<string, unknown>)[field] === undefined) (old as unknown as Record<string, unknown>)[field] = value;
    }
    old.hidden ||= candidate.hidden;
    old.virtual ||= candidate.virtual;
    old.tags = normalizeTags([...(old.tags ?? []), ...(candidate.tags ?? [])]);
  }
  const located: TechWeekEvent[] = [];
  for (const candidate of merged.values()) {
    const event = normalizeEvent(candidate);
    if (!event) {
      result.issues.push({ url: candidate.url, stage: 'parse', message: 'Missing or invalid title/start/end/URL; event omitted' });
      continue;
    }
    located.push(await geocodeEvent(event, candidate, geocode, message => result.issues.push({ url: event.url, stage: 'geocode', message })));
  }
  for (const event of dedupeEvents(located)) {
    if (!options.tagEvent) { result.events.push(event); continue; }
    try {
      const classification = await options.tagEvent({ ...event, tags: [...event.tags] });
      if (typeof classification.spam !== 'boolean' || !Array.isArray(classification.tags) || !classification.tags.every(t => typeof t === 'string')) throw new Error('Invalid event classification');
      if (!classification.spam) result.events.push({ ...event, tags: normalizeTags([...event.tags, ...classification.tags]) });
    } catch (error) {
      // Do not publish an event that the configured moderation adapter failed to classify.
      result.issues.push({ url: event.url, stage: 'tag', message: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
