import { geocodeEvent } from './geocode';
import { object, string } from './html';
import { dedupeEvents, normalizeEvent } from './normalize';
import type { TechWeekEvent } from './types';
import { sourceOf } from './urls';

export interface EventSnapshot {
  capturedAt: string;
  source: string;
  sourceTotal: number;
  complete: boolean;
  events: TechWeekEvent[];
}
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
export const isVirtualFeedEvent = (venue: string, title: string): boolean => /\b(?:virtual|online)\b/i.test(venue)
  || /(?:\*|\()\s*(?:virtual|online)\s*(?:\*|\))/i.test(title);

/** Public official feed only exposes coarse venues. Never infer a private street address. */
export async function normalizeFeedEvents(values: unknown[]): Promise<TechWeekEvent[]> {
  const events: TechWeekEvent[] = [];
  for (const value of values) {
    const o = object(value);
    const url = string(o.eventUrl);
    if (o.citySlug !== 'sf' || !url || sourceOf(url) !== 'tech-week' || /cancelled|canceled|deleted/i.test(string(o.registration) ?? '')) continue;
    const venue = string(o.venue);
    const neighborhood = strings(o.neighborhoods).join(', ') || venue;
    const virtual = isVirtualFeedEvent(neighborhood ?? '', string(o.name) ?? '');
    const candidate = { title: string(o.name), host: strings(o.hosts).join(', ') || undefined,
      start: string(o.startsAt), end: string(o.endsAt), timeZone: string(o.timeZone),
      url, source: 'tech-week' as const, venue, neighborhood, hidden: true, virtual,
      tags: [...strings(o.themes), ...strings(o.formats)] };
    const event = normalizeEvent(candidate);
    if (event) events.push(await geocodeEvent(event, candidate, async () => null));
  }
  return dedupeEvents(events);
}
