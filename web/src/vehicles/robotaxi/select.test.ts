import { expect, test, vi } from 'vitest';
import { selectTaxiDestination } from './select';
import type { RadarDestination, RadarEvent } from '../../radar/radar';

test('accepted event and landmark rides replace selection, rejected hails preserve it', () => {
  const event: RadarEvent = { id: 'luma:event', title: 'Founder meetup', start: '2026-10-05T10:00:00Z', end: null,
    lat: 37.79, lon: -122.4, approx: false, url: 'https://example.com/event' };
  let selected: RadarDestination = { x: 1, y: 0, z: 2, title: 'Old destination' };
  const select = vi.fn((target: RadarDestination) => { selected = target; });
  const target = { x: 100, y: 5, z: 200, title: event.title, event: { id: event.id } };
  expect(selectTaxiDestination(target, { hail: () => false, events: [event], select })).toBe(false);
  expect(selected.title).toBe('Old destination'); expect(select).not.toHaveBeenCalled();
  const hail = vi.fn(() => true);
  expect(selectTaxiDestination(target, { hail, events: [event], select })).toBe(true);
  expect(hail).toHaveBeenCalledWith(target); expect(selected).toEqual({ ...target, event });
  expect(selectTaxiDestination({ x: 300, y: 0, z: 500, title: 'Coit Tower' }, { hail, events: [event], select })).toBe(true);
  expect(selected.title).toBe('Coit Tower'); expect(selected.event).toBeUndefined();
});
