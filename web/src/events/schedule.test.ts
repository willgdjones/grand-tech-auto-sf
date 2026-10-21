import { expect, it } from 'vitest';
import type { RadarEvent } from '../radar/radar';
import { eventCallout, isLiveEvent, matchesPeriod, sfDayNumber, upcomingEvents } from './schedule';

it('uses SF dates, real end times, chronological search and the seven-day window', () => {
  const now = Date.parse('2026-10-06T06:30:00Z'); // Monday 23:30 in SF; Tuesday in UTC.
  const event = (id: string, start: string, end: string | null = null): RadarEvent => ({ id, title: id, host: 'Builders', venue: 'North Beach', start, end, lat: 37.8, lon: -122.4, approx: true, url: 'https://luma.com/test' });
  const live = event('Overnight dinner', '2026-10-06T05:00:00Z', '2026-10-06T08:00:00Z');
  const early = event('Breakfast', '2026-10-06T15:00:00Z');
  const late = event('Demo', '2026-10-07T01:00:00Z');
  expect(isLiveEvent(live, now)).toBe(true);
  expect(isLiveEvent({ ...live, end: null }, now)).toBe(false);
  expect(matchesPeriod(live, 'today', now)).toBe(true);
  expect(matchesPeriod(early, 'today', now)).toBe(false);
  expect(upcomingEvents([late, early, live], 'tomorrow', 'builders', now).map(value => value.id)).toEqual(['Overnight dinner', 'Breakfast', 'Demo']);
  const venue={...early,venue:'A public cafe',address:'1 Market Street'};
  expect(upcomingEvents([venue], 'tomorrow', 'financial district', now, () => 'Financial District/South Beach')).toEqual([venue]);
  expect(upcomingEvents([venue], 'today', 'financial district', now, () => 'Financial District/South Beach')).toEqual([]);
  expect(upcomingEvents([venue], 'tomorrow', 'market street', now)).toEqual([venue]);
  expect(matchesPeriod(event('Next Monday', '2026-10-12T15:00:00Z'), 'week', now)).toBe(false);
  expect(matchesPeriod(event('Last Sunday', '2026-10-11T15:00:00Z'), 'week', Date.parse('2026-10-03T12:00:00Z'))).toBe(true);
  expect(eventCallout([early,live,{...live,id:'virtual',lat:null,lon:null}],now)).toEqual({liveCount:1,event:live});
  expect(eventCallout([early,live],Date.parse('2026-10-06T08:00:00Z'))).toEqual({liveCount:0,event:early});
  expect(sfDayNumber(Date.parse('2026-11-02T08:00:00Z')) - sfDayNumber(Date.parse('2026-11-01T07:00:00Z'))).toBe(1);
});

it('keeps repeated searches current across SF midnight, DST and changed calendar dates', () => {
  const event: RadarEvent = { id: 'mutable', title: 'Dinner', start: '2026-10-06T06:00:00Z', end: '2026-10-06T07:00:00Z', lat: 37.8, lon: -122.4, approx: false, url: 'https://luma.com/test' };
  const beforeMidnight = Date.parse('2026-10-06T06:59:59Z'), midnight = beforeMidnight + 1000;
  for (let pass = 0; pass < 2; pass++) {
    expect(upcomingEvents([event], 'today', 'dinner', beforeMidnight)).toEqual([event]);
    expect(isLiveEvent(event, beforeMidnight)).toBe(true);
    expect(upcomingEvents([event], 'today', '', midnight)).toEqual([]);
    expect(isLiveEvent(event, midnight)).toBe(false);
  }
  event.end = '2026-10-06T08:00:00Z';
  expect(upcomingEvents([event], 'today', '', midnight)).toEqual([event]);
  expect(isLiveEvent(event, midnight)).toBe(true);
  for (const end of [null, 'invalid', event.start, '2026-10-06T05:00:00Z']) {
    event.end = end;
    expect(isLiveEvent(event, beforeMidnight)).toBe(false);
    expect(matchesPeriod(event, 'today', midnight)).toBe(false);
  }
  event.start = 'invalid';
  expect(upcomingEvents([event], 'week', '', midnight)).toEqual([]);
  event.start = '2026-10-06T15:00:00Z';
  expect(upcomingEvents([event], 'today', '', midnight)).toEqual([event]);
  const refreshed = { ...event, start: '2026-10-07T15:00:00Z' };
  expect(upcomingEvents([refreshed], 'today', '', midnight)).toEqual([]);
  expect(upcomingEvents([refreshed], 'tomorrow', '', midnight)).toEqual([refreshed]);
  const dst = { ...event, start: '2026-11-01T07:00:00Z', end: '2026-11-02T08:00:00Z' };
  expect(matchesPeriod(dst, 'today', Date.parse('2026-11-02T07:59:59Z'))).toBe(true);
  expect(matchesPeriod(dst, 'today', Date.parse('2026-11-02T08:00:00Z'))).toBe(false);
  expect(sfDayNumber(Date.parse('2026-11-02T08:00:00Z')) - sfDayNumber(Date.parse('2026-11-02T07:59:59Z'))).toBe(1);
});
