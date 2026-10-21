import type { RadarEvent } from '../radar/radar';
import { sfDayNumber } from './schedule';
import { FOCUS_WINDOW_MS, WEEK_WINDOW_MS, MIN_FOCUS_EVENTS, eventFocusEnd, inSanFrancisco, venueCentroid, venueKey as sharedVenueKey } from '@gtasf/shared/eventVisibility';

/**
 * Venue grouping + next-24h focus window (PLAN-v2 decision 8, gtasf-v2-venue-focus-uia7).
 *
 * One physical venue can host many Tech Week events. These helpers fold a flat
 * RadarEvent feed into one group per venue so the radar map, the SA map venue
 * browser and the world drive-through markers each show a single marker per
 * venue that lists all of its events — nothing is hidden behind a 5 m dedupe.
 *
 * The focus window keeps those surfaces readable: it shows the next 24 hours of
 * events (SF time) with per-day labels, and a `+N this week` count for venues
 * hosting more events later in the week. All source text is returned verbatim
 * for the caller to insert with textContent; nothing here touches the DOM.
 */

// Window constants and the focus-window rule live in shared/eventVisibility.ts so the server pays exactly
// for the events this client renders (gtasf event-visibility fix).
export { DAY_MS, FOCUS_WINDOW_MS, WEEK_WINDOW_MS, MIN_FOCUS_EVENTS, SF_BBOX } from '@gtasf/shared/eventVisibility';

const WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' });
const TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });

export interface VenueEventView {
  event: RadarEvent;
  /** Parsed start instant (ms); always finite for a grouped event. */
  start: number;
  /** Parsed end instant (ms), or NaN when the feed gives no real end. */
  end: number;
  /** `Today` | `Tomorrow` | short weekday, relative to the reference `now` in SF. */
  dayLabel: string;
  /** SF wall-clock start time, e.g. `6:30 PM`. */
  timeLabel: string;
  /** Running at the reference `now` (real start and end, start ≤ now < end). */
  live: boolean;
  /** Shown via the preview fallback: not live and starting beyond the real next 24h (render dimmer + a
   *  `Preview` tag; the day label, e.g. `Mon`, says when). False for genuinely current (<=24h) events. */
  preview: boolean;
}

export interface VenueGroup {
  /** Stable grouping key (normalised venue name + coarse cell, or cell alone). */
  key: string;
  /** Display name for the venue, safe to insert as textContent. */
  title: string;
  lat: number;
  lon: number;
  /** True when no event at the venue has a precise (non-approximate) location. */
  approx: boolean;
  /** Every located event at the venue, chronological. */
  events: VenueEventView[];
  /** Events inside the next-24h focus window (live, or starting within it), chronological. */
  focus: VenueEventView[];
  /** Live-or-upcoming events within the week horizon, chronological. `focus` is a prefix subset. */
  week: VenueEventView[];
  /** Count of week events beyond the focus window — the `+N this week` badge value. */
  laterThisWeek: number;
  /** Soonest relevant start (focus, else week, else earliest), for ordering venues. */
  nextStart: number;
  /** Any focus event is live right now. */
  live: boolean;
  /** This marker is showing only preview events (nothing live or within the real next 24h) — render it
   *  dimmer with a `Preview` tag. False once the venue has a genuinely current event. */
  preview: boolean;
}

export interface GroupVenuesOptions {
  /** Reference instant; defaults to Date.now(). */
  now?: number;
  /** Focus window length; defaults to 24 hours. */
  focusWindowMs?: number;
  /** Week horizon for the `+N this week` count; defaults to 7 days. */
  weekWindowMs?: number;
  /** Minimum located events the focus window should hold before it stops extending forward for the
   *  preview fallback; defaults to {@link MIN_FOCUS_EVENTS}. Pass a low value to disable extension. */
  minFocusEvents?: number;
  /** Restrict to the San Francisco bounding box (default true). */
  bbox?: boolean;
}

const located = (event: RadarEvent): event is RadarEvent & { lat: number; lon: number } =>
  typeof event.lat === 'number' && typeof event.lon === 'number'
  && Number.isFinite(event.lat) && Number.isFinite(event.lon);


export { normalizeVenueName } from '@gtasf/shared/eventVisibility';
/** Grouping key (shared with the server payout anchors). */
export const venueKey = (event: RadarEvent): string => sharedVenueKey(event);

/** `Today` / `Tomorrow` / short weekday for a start instant, relative to `now` (SF calendar). */
export function dayLabel(startMs: number, now: number): string {
  if (!Number.isFinite(startMs)) return '';
  const delta = sfDayNumber(startMs) - sfDayNumber(now);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  return WEEKDAY.format(startMs);
}

/** SF wall-clock time for a start instant, e.g. `6:30 PM`. */
export const timeLabel = (startMs: number): string => Number.isFinite(startMs) ? TIME.format(startMs) : '';

const isLive = (start: number, end: number, now: number): boolean =>
  Number.isFinite(end) && end > start && start <= now && now < end;

function view(event: RadarEvent, now: number, previewThreshold: number): VenueEventView {
  const start = Date.parse(event.start);
  const end = event.end ? Date.parse(event.end) : NaN;
  const live = isLive(start, end, now);
  return { event, start, end, dayLabel: dayLabel(start, now), timeLabel: timeLabel(start), live,
    preview: !live && Number.isFinite(start) && start >= previewThreshold };
}

const byStart = (a: VenueEventView, b: VenueEventView): number =>
  a.start - b.start || a.event.title.localeCompare(b.event.title) || a.event.id.localeCompare(b.event.id);

/**
 * Fold a RadarEvent feed into one group per venue with a next-24h focus window.
 * Only located events inside San Francisco are grouped; callers that want the
 * whole feed (e.g. the V panel's own list) keep using the flat events.
 */
export function groupVenues(events: readonly RadarEvent[], options: GroupVenuesOptions = {}): VenueGroup[] {
  const now = options.now ?? Date.now();
  const focusWindowMs = options.focusWindowMs ?? FOCUS_WINDOW_MS;
  const weekWindowMs = options.weekWindowMs ?? WEEK_WINDOW_MS;
  const bbox = options.bbox ?? true;

  const minFocusEvents = options.minFocusEvents ?? MIN_FOCUS_EVENTS;
  const previewThreshold = now + focusWindowMs;
  const views: VenueEventView[] = [];
  const keyFor = new Map<VenueEventView, string>();
  for (const event of events) {
    if (!located(event)) continue;
    if (bbox && !inSanFrancisco(event.lat, event.lon)) continue;
    const v = view(event, now, previewThreshold);
    if (!Number.isFinite(v.start)) continue;
    views.push(v);
    keyFor.set(v, venueKey(event));
  }

  // Window is anchored at `now`. When the next 24h is sparse (fewer than minFocusEvents located events,
  // e.g. the weekend before Tech Week) it extends forward whole days, up to the week horizon, so the
  // surfaces stay populated with a labelled preview of the next event day(s) rather than going blank.
  const windowStart = now;
  const weekEnd = now + weekWindowMs;
  const focusEnd = eventFocusEnd(views.map(v => v.event), now, { focusWindowMs, weekWindowMs, minFocusEvents, bbox });

  const groups = new Map<string, VenueEventView[]>();
  for (const v of views) {
    const key = keyFor.get(v)!;
    const bucket = groups.get(key);
    if (bucket) bucket.push(v); else groups.set(key, [v]);
  }

  const result: VenueGroup[] = [];
  for (const [key, bucket] of groups) {
    bucket.sort(byStart);
    const focus = bucket.filter(v => v.live || (v.start >= windowStart && v.start < focusEnd));
    const week = bucket.filter(v => v.live || (v.start >= now && v.start < weekEnd));
    if (!focus.length && !week.length) continue; // Only past events at this venue; nothing to show.

    const { lat, lon, approx } = venueCentroid(bucket.map(v => v.event)); // shared with the server payout anchor

    result.push({
      key,
      title: venueTitle(bucket),
      lat, lon,
      approx,
      events: bucket,
      focus, week,
      laterThisWeek: week.length - focus.length,
      nextStart: (focus[0] ?? week[0] ?? bucket[0])!.start,
      live: focus.some(v => v.live),
      preview: focus.length > 0 && focus.every(v => v.preview),
    });
  }

  result.sort((a, b) => Number(b.live) - Number(a.live) || a.nextStart - b.nextStart || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
  return result;
}

/** Venues with at least one event in the focus window — the markers/blips to render now. */
export function focusVenues(events: readonly RadarEvent[], options: GroupVenuesOptions = {}): VenueGroup[] {
  return groupVenues(events, options).filter(group => group.focus.length > 0);
}

/** The event a venue marker represents on entry: the live one, else the soonest in focus. */
export function representativeEvent(group: VenueGroup): RadarEvent | null {
  const focus = group.focus;
  return (focus.find(v => v.live) ?? focus[0] ?? group.week[0] ?? group.events[0])?.event ?? null;
}

/** Most common non-empty venue name (longest wins ties), falling back to address. */
function venueTitle(bucket: readonly VenueEventView[]): string {
  const title = mostCommon(bucket.map(v => v.event.venue)) || mostCommon(bucket.map(v => v.event.address));
  return title || 'Public location';
}

function mostCommon(values: readonly (string | null | undefined)[]): string {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw?.trim();
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = '', bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && value.length > best.length)) { best = value; bestCount = count; }
  }
  return best;
}
