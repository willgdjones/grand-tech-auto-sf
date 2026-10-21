import type { RadarEvent } from '../radar/radar';

export type EventPeriod = 'live' | 'today' | 'tomorrow' | 'week';
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
const when = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
let lastTime = NaN, lastDay = NaN;

/** Calendar-day arithmetic stays in San Francisco across midnight and DST changes. */
export function sfDayNumber(time: number): number {
  if (time === lastTime) return lastDay;
  const parts = day.formatToParts(time);
  const part = (type: string) => Number(parts.find(value => value.type === type)!.value);
  lastTime = time;
  return lastDay = Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000;
}

type EventWindow = { sourceStart: string; sourceEnd: RadarEvent['end']; start: number; end: number; startDay: number | null; lastDay: number };
const windows = new WeakMap<RadarEvent, EventWindow>();

/** Feed records keep their parsed dates; refreshed or edited records get a new window. */
function eventWindow(event: RadarEvent): EventWindow {
  const cached = windows.get(event);
  if (cached?.sourceStart === event.start && cached.sourceEnd === event.end) return cached;
  const start = Date.parse(event.start), end = event.end ? Date.parse(event.end) : NaN;
  const value: EventWindow = { sourceStart: event.start, sourceEnd: event.end, start, end, startDay: null, lastDay: NaN };
  windows.set(event, value);
  return value;
}

export function isLiveEvent(event: RadarEvent, now: number): boolean {
  const { start, end } = eventWindow(event);
  // An unlisted end is not evidence that an event is still running.
  return Number.isFinite(end) && end > start && start <= now && now < end;
}

export function matchesPeriod(event: RadarEvent, period: EventPeriod, now: number): boolean {
  const window = eventWindow(event), { start, end } = window;
  if (!Number.isFinite(start)) return false;
  if (period === 'live') return Number.isFinite(end) && end > start && start <= now && now < end;
  // Closed-view live callouts need only timestamps, not every SF calendar day.
  if (window.startDay === null) {
    window.startDay = sfDayNumber(start);
    window.lastDay = Number.isFinite(end) && end > start ? sfDayNumber(end - 1) : window.startDay;
  }
  const today = period === 'week' ? Date.UTC(2026, 9, 5) / 86_400_000 : sfDayNumber(now);
  const offset = period === 'tomorrow' ? 1 : 0, length = period === 'week' ? 7 : 1;
  return window.startDay < today + offset + length && window.lastDay >= today + offset;
}

export function upcomingEvents(events: readonly RadarEvent[], period: EventPeriod, query: string, now: number,
  displayedLocation?: (event: RadarEvent) => string): RadarEvent[] {
  const search = query.trim().toLocaleLowerCase();
  return events.filter(event => matchesPeriod(event, period, now)
    && (!search || `${event.title} ${event.host ?? ''} ${event.venue ?? ''} ${event.address ?? ''} ${(event.tags ?? []).join(' ')} ${displayedLocation?.(event) ?? ''}`.toLocaleLowerCase().includes(search)))
    .sort((a, b) => eventWindow(a).start - eventWindow(b).start || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export const eventTime = (event: RadarEvent): string => `${when.format(Date.parse(event.start))} PT`;
export const distanceLabel = (metres: number): string => metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;

/** Only physical public destinations can advertise a live funding room. */
export function eventCallout(events: readonly RadarEvent[], now: number): { liveCount: number; event: RadarEvent | null } {
  const located=events.filter(event=>Number.isFinite(event.lat)&&Number.isFinite(event.lon));
  const live=located.filter(event=>isLiveEvent(event,now)).sort((a,b)=>eventWindow(a).end-eventWindow(b).end||a.id.localeCompare(b.id));
  const next=live[0]??located.filter(event=>eventWindow(event).start>now).sort((a,b)=>eventWindow(a).start-eventWindow(b).start||a.id.localeCompare(b.id))[0]??null;
  return {liveCount:live.length,event:next};
}
