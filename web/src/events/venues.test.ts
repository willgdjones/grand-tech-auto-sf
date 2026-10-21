import { expect, it } from 'vitest';
import type { RadarEvent } from '../radar/radar';
import {
  focusVenues, groupVenues, normalizeVenueName, representativeEvent, venueKey,
} from './venues';

/** Tuesday 2026-10-06, 12:00 PM in San Francisco (PDT). Tech Week is running. */
const NOW = Date.parse('2026-10-06T19:00:00Z');

const event = (over: Partial<RadarEvent> & Pick<RadarEvent, 'id' | 'start'>): RadarEvent => ({
  title: over.id, host: 'Builders', venue: null, address: null, lat: null, lon: null,
  approx: false, url: 'https://luma.com/x', ...over,
});

it('groups events by venue, focuses the next 24h, and counts the rest of the week', () => {
  const events: RadarEvent[] = [
    // Moscone Center: a live round, a later-today round, a Thursday round, and a past one.
    event({ id: 'moscone-past', venue: 'Moscone Center', address: '747 Howard St', lat: 37.784, lon: -122.401, start: '2026-10-05T18:00:00Z', end: '2026-10-05T20:00:00Z' }),
    event({ id: 'moscone-live', venue: 'Moscone Center', address: '747 Howard St', lat: 37.784, lon: -122.401, start: '2026-10-06T18:00:00Z', end: '2026-10-06T20:00:00Z' }),
    // Same venue, jittered geocode (37.7843 still rounds to the 37.784 cell) → one group.
    event({ id: 'moscone-pm', venue: 'Moscone Center', address: '747 Howard St', lat: 37.7843, lon: -122.401, start: '2026-10-06T22:00:00Z', end: '2026-10-06T23:00:00Z' }),
    event({ id: 'moscone-thu', venue: 'Moscone Center', address: '747 Howard St', lat: 37.784, lon: -122.401, start: '2026-10-08T19:00:00Z' }),
    // Chase Center: two focus-window events on different days.
    event({ id: 'chase-today', venue: 'Chase Center', address: '1 Warriors Way', lat: 37.768, lon: -122.387, start: '2026-10-06T23:30:00Z' }),
    event({ id: 'chase-tomorrow', venue: 'Chase Center', address: '1 Warriors Way', lat: 37.768, lon: -122.387, start: '2026-10-07T18:00:00Z' }),
    // Two "Private residence" events share a generic name but sit in different cells → stay separate.
    event({ id: 'res-a', venue: 'Private residence', lat: 37.760, lon: -122.420, approx: true, start: '2026-10-06T21:00:00Z' }),
    event({ id: 'res-b', venue: 'Private residence', lat: 37.750, lon: -122.430, start: '2026-10-06T21:30:00Z' }),
    // Pier 39: only a Thursday event — in the week horizon but not the 24h focus window.
    event({ id: 'pier-thu', venue: 'Pier 39', lat: 37.808, lon: -122.410, start: '2026-10-08T20:00:00Z' }),
    // Oakland: outside the SF bounding box → dropped entirely.
    event({ id: 'oakland', venue: 'Oakland thing', lat: 37.805, lon: -122.272, start: '2026-10-06T22:00:00Z' }),
    // No coordinates (virtual) → never grouped onto the map.
    event({ id: 'virtual', venue: 'Zoom', start: '2026-10-06T22:00:00Z' }),
  ];

  // minFocusEvents:1 keeps the real 24h window (this fixture is deliberately sparse); the preview
  // fallback's forward extension is covered by its own test below.
  const groups = groupVenues(events, { now: NOW, minFocusEvents: 1 });
  // Live venue first, then upcoming by soonest start: res-a 2pm, res-b 2:30pm, Chase 4:30pm, Pier 39 Thu.
  expect(groups.map(g => g.title)).toEqual([
    'Moscone Center', 'Private residence', 'Private residence', 'Chase Center', 'Pier 39',
  ]);

  const moscone = groups[0]!;
  expect(moscone.live).toBe(true);
  expect(moscone.events.map(e => e.event.id)).toEqual(['moscone-past', 'moscone-live', 'moscone-pm', 'moscone-thu']);
  expect(moscone.focus.map(e => e.event.id)).toEqual(['moscone-live', 'moscone-pm']); // past + Thursday excluded
  expect(moscone.week.map(e => e.event.id)).toEqual(['moscone-live', 'moscone-pm', 'moscone-thu']);
  expect(moscone.laterThisWeek).toBe(1); // the Thursday round is the "+1 this week" badge
  expect(moscone.focus[0]!.live).toBe(true);
  expect(moscone.focus[1]!.dayLabel).toBe('Today');
  expect(moscone.focus[1]!.timeLabel).toBe('3:00 PM');
  expect(moscone.week[2]!.dayLabel).toBe('Thu');
  expect(moscone.approx).toBe(false);
  expect(representativeEvent(moscone)!.id).toBe('moscone-live'); // the live round represents the marker

  const chase = groups[3]!;
  expect(chase.live).toBe(false);
  expect(chase.focus.map(e => e.event.id)).toEqual(['chase-today', 'chase-tomorrow']);
  expect(chase.focus[0]!.dayLabel).toBe('Today');
  expect(chase.focus[1]!.dayLabel).toBe('Tomorrow');
  expect(chase.focus[0]!.timeLabel).toBe('4:30 PM');
  expect(chase.laterThisWeek).toBe(0);
  expect(representativeEvent(chase)!.id).toBe('chase-today');

  // Same generic name, different cells → two groups, one approximate, one precise.
  const [resA, resB] = [groups[1]!, groups[2]!];
  expect(resA.key).not.toBe(resB.key);
  expect(resA.approx).toBe(true);
  expect(resB.approx).toBe(false);

  // Pier 39 has no focus-window event, so it is listed by groupVenues but not by focusVenues.
  const pier = groups[4]!;
  expect(pier.focus).toHaveLength(0);
  expect(pier.laterThisWeek).toBe(1);
  expect(representativeEvent(pier)!.id).toBe('pier-thu');

  const onMap = focusVenues(events, { now: NOW, minFocusEvents: 1 });
  expect(onMap.map(g => g.title)).toEqual(['Moscone Center', 'Private residence', 'Private residence', 'Chase Center']);
  // During Tech Week the 24h window is dense, so nothing is flagged preview.
  expect(onMap.every(g => !g.preview)).toBe(true);
});

it('fills an empty next-24h window with a labelled, dimmer preview of the coming event days', () => {
  // Saturday afternoon before Tech Week: nothing in the next 24h (the bug — radar/map/world went blank).
  const saturday = Date.parse('2026-10-03T19:00:00Z');
  const events: RadarEvent[] = [
    event({ id: 'mon', venue: 'Moscone Center', lat: 37.784, lon: -122.401, start: '2026-10-06T18:00:00Z', end: '2026-10-06T20:00:00Z' }),
    event({ id: 'mon-later', venue: 'Moscone Center', lat: 37.784, lon: -122.401, start: '2026-10-06T22:00:00Z' }),
    event({ id: 'thu', venue: 'Moscone Center', lat: 37.784, lon: -122.401, start: '2026-10-08T19:00:00Z' }),
  ];

  // Without the fallback the next-24h window is empty and the map shows nothing (the reported bug).
  expect(focusVenues(events, { now: saturday, minFocusEvents: 0 })).toHaveLength(0);

  // With the preview fallback (default ~30, only 3 exist) the window extends forward to show them all,
  // flagged as preview and labelled by day, so the surfaces stay populated.
  const groups = groupVenues(events, { now: saturday });
  expect(groups).toHaveLength(1);
  const moscone = groups[0]!;
  expect(moscone.focus.map(e => e.event.id)).toEqual(['mon', 'mon-later', 'thu']);
  expect(moscone.focus.every(v => v.preview)).toBe(true); // all shown as preview (days away)
  expect(moscone.preview).toBe(true);                     // marker renders dimmer + "Preview" tag
  expect(moscone.live).toBe(false);                       // nothing actually running on Saturday
  expect(moscone.focus[0]!.dayLabel).toBe('Tue');         // labelled by day ("Mon"/"Tue"…)
  expect(focusVenues(events, { now: saturday })).toHaveLength(1);
});

it('extends the window forward only until it holds ~minFocusEvents, marking the extension preview', () => {
  const saturday = Date.parse('2026-10-03T19:00:00Z');
  // 40 events spread Mon–Fri; with minFocusEvents 5 the window should stop after the first day or two.
  const events: RadarEvent[] = [];
  for (let i = 0; i < 40; i++) {
    const day = 6 + (i % 5); // Oct 6..10
    events.push(event({ id: `e${i}`, venue: `Venue ${i % 8}`, lat: 37.79 + (i % 8) * 0.001, lon: -122.40 - (i % 8) * 0.001,
      start: `2026-10-${String(day).padStart(2, '0')}T${String(16 + (i % 6)).padStart(2, '0')}:00:00Z` }));
  }
  const groups = groupVenues(events, { now: saturday, minFocusEvents: 5 });
  const focusCount = groups.reduce((n, g) => n + g.focus.length, 0);
  expect(focusCount).toBeGreaterThanOrEqual(5);              // enough to populate
  expect(focusCount).toBeLessThan(40);                       // but not the whole week
  expect(groups.every(g => g.focus.every(v => v.preview))).toBe(true); // all days away → preview
});

it('builds stable venue keys and normalises names', () => {
  expect(normalizeVenueName('  The Hub!! ')).toBe('the hub');
  expect(normalizeVenueName('Café Déjà Vu')).toBe('café déjà vu');
  expect(normalizeVenueName(null)).toBe('');
  expect(normalizeVenueName('—')).toBe('');

  const located = event({ id: 'a', venue: 'Moscone Center', lat: 37.784, lon: -122.401, start: '2026-10-06T22:00:00Z' });
  expect(venueKey(located)).toBe('moscone center@37.784,-122.401');
  expect(venueKey({ ...located, venue: null, address: null })).toBe('@37.784,-122.401');

  const virtual = event({ id: 'v1', venue: 'Zoom Room', start: '2026-10-06T22:00:00Z' });
  expect(venueKey(virtual)).toBe('name:zoom room');
  expect(venueKey({ ...virtual, venue: null })).toBe('id:v1');
});
