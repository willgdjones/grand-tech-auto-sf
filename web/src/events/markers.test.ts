import { expect, it, vi } from 'vitest';
import { Group } from 'three';
import { createEventMarkers, markerLabel, markerCollected } from './markers';
import type { MapFrame } from '../radar/projection';
import type { RadarEvent } from '../radar/radar';
import type { VenueGroup, VenueEventView } from './venues';

/** Tuesday 2026-10-06, 12:00 PM in San Francisco (PDT), mid Tech Week. */
const NOW = Date.parse('2026-10-06T19:00:00Z');
const FRAME: MapFrame = { origin: { lat: 37.784, lon: -122.401 }, gridRotationDeg: 0 };

const event = (over: Partial<RadarEvent> & Pick<RadarEvent, 'id' | 'start' | 'lat' | 'lon'>): RadarEvent => ({
  title: over.id, host: 'Builders', venue: null, address: null, end: null,
  approx: false, url: 'https://luma.com/x', ...over,
});

function mount(opts: { groupByVenue: boolean; focusNext24h?: boolean; checkpointPillars?: boolean }) {
  const scene = new Group();
  const onEnter = vi.fn();
  const markers = createEventMarkers({
    scene, frame: FRAME, surfaceHeightAt: () => 0, onEnter,
    now: () => NOW, groupByVenue: opts.groupByVenue, focusNext24h: opts.focusNext24h ?? true,
    showLabels: true, // exercises the label code path; headless render is a safe no-op
    checkpointPillars: opts.checkpointPillars,
  })!;
  return { markers, onEnter };
}

it('draws one marker per venue when grouped, instead of one per geocoded point', () => {
  // Moscone hosts two events ~28 m apart (jittered geocodes); Chase hosts one, ~140 m away.
  const events: RadarEvent[] = [
    event({ id: 'moscone-a', venue: 'Moscone Center', lat: 37.7840, lon: -122.4010, start: '2026-10-06T22:00:00Z' }),
    event({ id: 'moscone-b', venue: 'Moscone Center', lat: 37.7842, lon: -122.4008, start: '2026-10-06T23:00:00Z' }),
    event({ id: 'chase', venue: 'Chase Center', lat: 37.7850, lon: -122.4020, start: '2026-10-06T21:00:00Z' }),
  ];

  const grouped = mount({ groupByVenue: true });
  grouped.markers.setEvents(events);
  grouped.markers.update({ x: 0, y: 0, z: 0 }, 0.1, false);
  expect(grouped.markers.root.children).toHaveLength(2); // Moscone + Chase, not three points
  grouped.markers.destroy();

  // v1 behaviour: Moscone's two points survive the 5 m dedupe as separate markers → three total.
  const flat = mount({ groupByVenue: false });
  flat.markers.setEvents(events);
  flat.markers.update({ x: 0, y: 0, z: 0 }, 0.1, false);
  expect(flat.markers.root.children).toHaveLength(3);
  flat.markers.destroy();
});

it('adds a GTA checkpoint light pillar per marker only when enabled (gtasf-c0kh)', () => {
  const events: RadarEvent[] = [
    event({ id: 'a', venue: 'Moscone Center', lat: 37.7840, lon: -122.4010, start: '2026-10-06T22:00:00Z' }),
    event({ id: 'b', venue: 'Chase Center', lat: 37.7850, lon: -122.4020, start: '2026-10-06T21:00:00Z' }),
  ];
  const countPillars = (markers: { root: Group }) => {
    let n = 0; markers.root.traverse(o => { const g = (o as { geometry?: { type?: string } }).geometry; if (g?.type === 'CylinderGeometry') n++; });
    return n;
  };
  // Enabled: one light column per visible marker.
  const on = mount({ groupByVenue: true, checkpointPillars: true });
  on.markers.setEvents(events);
  on.markers.update({ x: 0, y: 0, z: 0 }, 0.1, false);
  expect(on.markers.root.children).toHaveLength(2);
  expect(countPillars(on.markers)).toBe(2);
  on.markers.destroy();
  // Disabled (default): no pillar geometry is created at all.
  const off = mount({ groupByVenue: true, checkpointPillars: false });
  off.markers.setEvents(events);
  off.markers.update({ x: 0, y: 0, z: 0 }, 0.1, false);
  expect(countPillars(off.markers)).toBe(0);
  off.markers.destroy();
});

it('keeps distinct venues that share a building (no 5 m dedupe when grouped)', () => {
  // Two different venues in the same ~100 m cell, centroids ~1.5 m apart in projection.
  const events: RadarEvent[] = [
    event({ id: 'west', venue: 'Moscone West', lat: 37.784, lon: -122.401, start: '2026-10-06T22:00:00Z' }),
    event({ id: 'south', venue: 'Moscone South', lat: 37.78401, lon: -122.40101, start: '2026-10-06T22:30:00Z' }),
  ];
  const { markers } = mount({ groupByVenue: true });
  markers.setEvents(events);
  markers.update({ x: 0, y: 0, z: 0 }, 0.1, false);
  expect(markers.root.children).toHaveLength(2); // both venues shown, not collapsed to one
  markers.destroy();
});

it('exposes the grouped venues it represents (null when grouping is off)', () => {
  const events: RadarEvent[] = [
    event({ id: 'a', venue: 'Moscone Center', lat: 37.784, lon: -122.401, start: '2026-10-06T22:00:00Z' }),
    event({ id: 'b', venue: 'Moscone Center', lat: 37.784, lon: -122.401, start: '2026-10-06T23:00:00Z' }),
    event({ id: 'c', venue: 'Chase Center', lat: 37.768, lon: -122.387, start: '2026-10-06T21:00:00Z' }),
  ];
  const grouped = mount({ groupByVenue: true });
  grouped.markers.setEvents(events);
  expect(grouped.markers.venues?.map(v => v.title).sort()).toEqual(['Chase Center', 'Moscone Center']);
  grouped.markers.destroy();

  const flat = mount({ groupByVenue: false });
  flat.markers.setEvents(events);
  expect(flat.markers.venues).toBeNull();
  flat.markers.destroy();
});

it('fires the venue representative (live, else soonest) event on drive-through', () => {
  const live = event({ id: 'live-round', venue: 'Moscone Center', lat: 37.784, lon: -122.401, start: '2026-10-06T18:00:00Z', end: '2026-10-06T20:00:00Z' });
  const later = event({ id: 'later-round', venue: 'Moscone Center', lat: 37.784, lon: -122.401, start: '2026-10-06T22:00:00Z' });

  const { markers, onEnter } = mount({ groupByVenue: true });
  markers.setEvents([later, live]); // feed order deliberately puts the live round last
  markers.update({ x: 0, y: 0, z: 0 }, 0.1, true); // player standing on the single Moscone marker
  expect(onEnter).toHaveBeenCalledTimes(1);
  expect(onEnter.mock.calls[0]![0].id).toBe('live-round');
  markers.destroy();
});

it('floats the event name for a one-event venue, else the venue name + badge', () => {
  const view = (title: string) => ({ event: { title } }) as VenueEventView;
  const ignored = { title: 'representative' } as RadarEvent;
  // Several events at the venue → venue name + "+N this week" badge (decision 8).
  expect(markerLabel(ignored, { title: 'Moscone Center', laterThisWeek: 3, focus: [view('A'), view('B')] } as VenueGroup))
    .toEqual({ title: 'Moscone Center', badge: '+3 this week' });
  // A single event at the venue → that event's name floats (decision 1).
  expect(markerLabel(ignored, { title: 'Chase Center', laterThisWeek: 0, focus: [view('AI Founders Mixer')] } as VenueGroup))
    .toEqual({ title: 'AI Founders Mixer', badge: '' });
  // Ungrouped marker → the event title.
  expect(markerLabel({ title: 'Solo Demo Day' } as RadarEvent, null))
    .toEqual({ title: 'Solo Demo Day', badge: '' });
});

it('tags a community event on the marker label (PLAN-v2 decision 9)', () => {
  const ignored = { title: 'representative' } as RadarEvent;
  // Ungrouped community event → the title floats with a "Community" badge.
  expect(markerLabel({ title: 'Indie Hacker Meetup', community: true } as RadarEvent, null))
    .toEqual({ title: 'Indie Hacker Meetup', badge: 'Community' });
  // Grouped: the shown (representative) event being community tags the venue marker, next to the day.
  const cView = (title: string, dayLabel: string) => ({ event: { title, community: true }, dayLabel, live: false }) as VenueEventView;
  expect(markerLabel(ignored, { title: 'Garage', laterThisWeek: 0, focus: [cView('Hack Night', 'Fri')] } as VenueGroup))
    .toEqual({ title: 'Hack Night', badge: 'Fri · Community' });
});

it('labels the marker by day — Live now / weekday / Tomorrow — alongside the badge (decision 8)', () => {
  const dayView = (title: string, dayLabel: string, live = false) => ({ event: { title }, dayLabel, live }) as VenueEventView;
  const ignored = { title: 'representative' } as RadarEvent;
  // Single non-today event → its name + the day.
  expect(markerLabel(ignored, { title: 'Pier 39', laterThisWeek: 0, focus: [dayView('Rooftop Demo', 'Thu')] } as VenueGroup))
    .toEqual({ title: 'Rooftop Demo', badge: 'Thu' });
  // Live venue with more later this week → "Live now · +N this week".
  expect(markerLabel(ignored, { title: 'Moscone', laterThisWeek: 2, focus: [dayView('Keynote', 'Today', true), dayView('After-party', 'Today')] } as VenueGroup))
    .toEqual({ title: 'Moscone', badge: 'Live now · +2 this week' });
  // Tomorrow's events + badge.
  expect(markerLabel(ignored, { title: 'Chase', laterThisWeek: 3, focus: [dayView('A', 'Tomorrow'), dayView('B', 'Tomorrow')] } as VenueGroup))
    .toEqual({ title: 'Chase', badge: 'Tomorrow · +3 this week' });
  // Today with nothing later → no badge clutter (from Monday it's effectively today).
  expect(markerLabel(ignored, { title: 'SoMa Loft', laterThisWeek: 0, focus: [dayView('Pitch Night', 'Today')] } as VenueGroup))
    .toEqual({ title: 'Pitch Night', badge: '' });
});

it('markerCollected: ungrouped by own id; grouped only when every focus event is paid (gtasf-ykbb)', () => {
  const vId = (id: string) => ({ event: { id, title: id } }) as VenueEventView;
  const ev = (id: string) => ({ id } as RadarEvent);
  // Ungrouped marker: its own event id.
  expect(markerCollected(ev('solo'), null, new Set(['solo']))).toBe(true);
  expect(markerCollected(ev('solo'), null, new Set(['other']))).toBe(false);
  // Grouped venue: collected only when EVERY focus event is paid.
  const group = { title: 'Moscone', laterThisWeek: 0, focus: [vId('a'), vId('b')] } as VenueGroup;
  expect(markerCollected({} as RadarEvent, group, new Set(['a', 'b']))).toBe(true);
  expect(markerCollected({} as RadarEvent, group, new Set(['a']))).toBe(false); // one still unpaid → bright
  // Empty focus is never "collected".
  expect(markerCollected({} as RadarEvent, { title: 'x', laterThisWeek: 0, focus: [] as VenueEventView[] } as VenueGroup, new Set(['a']))).toBe(false);
});

it('markerLabel tags a collected marker "Collected" first, leaving uncollected output unchanged (gtasf-ykbb)', () => {
  const vId = (id: string) => ({ event: { id, title: id } }) as VenueEventView;
  // Ungrouped collected → "Collected" badge.
  expect(markerLabel({ title: 'Solo Demo Day' } as RadarEvent, null, true)).toEqual({ title: 'Solo Demo Day', badge: 'Collected' });
  // Grouped collected with more later this week → "Collected · +N this week".
  expect(markerLabel({} as RadarEvent, { title: 'Moscone', laterThisWeek: 3, focus: [vId('a'), vId('b')] } as VenueGroup, true))
    .toEqual({ title: 'Moscone', badge: 'Collected · +3 this week' });
  // collected=false (and the 2-arg call) keep the pre-existing output.
  expect(markerLabel({ title: 'Solo' } as RadarEvent, null, false)).toEqual({ title: 'Solo', badge: '' });
});
