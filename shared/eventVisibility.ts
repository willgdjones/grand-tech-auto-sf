/**
 * Which Tech Week events are VISIBLE right now — the single rule shared by the client (venue markers, radar)
 * and the server (drive-through payouts), so a player is only ever paid for an event they can see.
 * Visible = live now, or starting within the focus window. With focus on (flags.eventFocus24h) the window is
 * the next 24h, extended forward a whole day at a time while it holds fewer than MIN_FOCUS_EVENTS located
 * SF events (the pre-Tech-Week preview fallback, PLAN-v2 decision 8). With focus off it is the next 7 days.
 * Pure; `now` is passed in so both sides agree for the same instant.
 */
export const DAY_MS = 86_400_000;
export const FOCUS_WINDOW_MS = DAY_MS;
export const WEEK_WINDOW_MS = 7 * DAY_MS;
export const MIN_FOCUS_EVENTS = 30;
export const SF_BBOX = Object.freeze({ minLat: 37.68, maxLat: 37.86, minLon: -122.56, maxLon: -122.33 });

export interface VisibilityEvent { start: string; end?: string | null; lat?: number | null; lon?: number | null }
export interface FocusWindowOptions { focusWindowMs?: number; weekWindowMs?: number; minFocusEvents?: number; bbox?: boolean }

export function inSanFrancisco(lat: number, lon: number): boolean {
  return lat > SF_BBOX.minLat && lat < SF_BBOX.maxLat && lon > SF_BBOX.minLon && lon < SF_BBOX.maxLon;
}
const located = (event: VisibilityEvent): event is VisibilityEvent & { lat: number; lon: number } =>
  typeof event.lat === 'number' && typeof event.lon === 'number' && Number.isFinite(event.lat) && Number.isFinite(event.lon);

/** End of the focus window anchored at `now` (see module doc), counting located (and, with bbox, in-SF) events. */
export function eventFocusEnd(events: readonly VisibilityEvent[], now: number, options: FocusWindowOptions = {}): number {
  const focusWindowMs = options.focusWindowMs ?? FOCUS_WINDOW_MS, weekEnd = now + (options.weekWindowMs ?? WEEK_WINDOW_MS);
  const minFocusEvents = options.minFocusEvents ?? MIN_FOCUS_EVENTS, bbox = options.bbox ?? true;
  const futureStarts: number[] = [];
  for (const event of events) {
    if (!located(event) || (bbox && !inSanFrancisco(event.lat, event.lon))) continue;
    const start = Date.parse(event.start);
    if (Number.isFinite(start) && start >= now) futureStarts.push(start);
  }
  futureStarts.sort((a, b) => a - b);
  let focusEnd = now + focusWindowMs;
  const countBefore = (end: number) => { let n = 0; for (const s of futureStarts) { if (s >= end) break; n++; } return n; };
  while (countBefore(focusEnd) < minFocusEvents && focusEnd < weekEnd) focusEnd += DAY_MS;
  return focusEnd;
}

export function eventLive(event: VisibilityEvent, now: number): boolean {
  const start = Date.parse(event.start), end = event.end ? Date.parse(event.end) : NaN;
  return Number.isFinite(start) && Number.isFinite(end) && end > start && start <= now && now < end;
}

/** One event against a precomputed window end: live, or starting in [now, windowEnd). */
export function eventVisibleIn(event: VisibilityEvent, now: number, windowEnd: number): boolean {
  if (eventLive(event, now)) return true;
  const start = Date.parse(event.start);
  return Number.isFinite(start) && start >= now && start < windowEnd;
}

/** The window end both sides use: the (fallback-extended) 24h focus when `focus24h`, else the week. */
export function eventVisibilityWindowEnd(events: readonly VisibilityEvent[], now: number, focus24h: boolean): number {
  return focus24h ? eventFocusEnd(events, now) : now + WEEK_WINDOW_MS;
}

/* ---- Venue rings: one ring per venue, shared by the client markers and the server payout anchors ---- */
export interface VenueEvent extends VisibilityEvent { id: string; venue?: string | null; address?: string | null; approx?: boolean }

/** Normalise a venue/address string for grouping: lower-case, collapse space, strip edge punctuation. */
export function normalizeVenueName(value: string | null | undefined): string {
  if (!value) return '';
  return value.toLowerCase().replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
}
/** Coarse ~100 m cell so one venue's jittered geocodes still share a key. */
const cell = (lat: number, lon: number): string => `${lat.toFixed(3)},${lon.toFixed(3)}`;
/** Grouping key: venue/address name scoped to its cell, or the cell alone; unlocated events key by id. */
export function venueKey(event: VenueEvent): string {
  const name = normalizeVenueName(event.venue) || normalizeVenueName(event.address);
  if (located(event)) return name ? `${name}@${cell(event.lat, event.lon)}` : `@${cell(event.lat, event.lon)}`;
  return name ? `name:${name}` : `id:${event.id}`;
}
/** A venue's ring centre: the mean of its precise (non-approximate) events, else of all its events. */
export function venueCentroid(bucket: readonly VenueEvent[]): { lat: number; lon: number; approx: boolean } {
  const precise = bucket.filter(event => !event.approx);
  const source = (precise.length ? precise : bucket).filter((e): e is VenueEvent & { lat: number; lon: number } => located(e));
  return { lat: source.reduce((sum, e) => sum + e.lat, 0) / source.length, lon: source.reduce((sum, e) => sum + e.lon, 0) / source.length, approx: precise.length === 0 };
}
/** Every located in-SF event with a real start, bucketed by venue key — the client's ring set (before the
 *  time filter). The server snaps each centroid exactly like the client so payout = the ring you see. */
export function venueBuckets<E extends VenueEvent>(events: readonly E[], bbox = true): Map<string, E[]> {
  const groups = new Map<string, E[]>();
  for (const event of events) {
    if (!located(event) || (bbox && !inSanFrancisco(event.lat, event.lon)) || !Number.isFinite(Date.parse(event.start))) continue;
    const key = venueKey(event), bucket = groups.get(key);
    if (bucket) bucket.push(event); else groups.set(key, [event]);
  }
  return groups;
}
