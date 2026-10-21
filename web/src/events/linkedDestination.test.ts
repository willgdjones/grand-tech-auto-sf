import { expect, it, vi } from 'vitest';
import type { RadarEvent } from '../radar/radar';
import { createLinkedDestination } from './linkedDestination';

const event: RadarEvent = { id: 'linked-event', title: 'Linked event', start: '2026-10-05T16:00:00Z', end: null,
  lat: 37.7955, lon: -122.3937, approx: false, url: 'https://events.example/linked-event' };

it.each(['calendar-first', 'routing-first'])('selects a recovered linked event once when ready: %s', order => {
  const select = vi.fn(() => true), link = createLinkedDestination(event.id, select);
  link.setEvents([]); expect(select).not.toHaveBeenCalled();
  if (order === 'calendar-first') { link.setEvents([event]); expect(select).not.toHaveBeenCalled(); link.start(); }
  else { link.start(); expect(select).not.toHaveBeenCalled(); link.setEvents([event]); }
  expect(select).toHaveBeenCalledExactlyOnceWith(event);
  link.start(); link.setEvents([{ ...event, title: 'Later feed' }]); expect(select).toHaveBeenCalledOnce();
});

it('uses the latest canonical entry and retries an unaccepted route after a later calendar', () => {
  const select = vi.fn().mockReturnValueOnce(false).mockReturnValue(true), link = createLinkedDestination(event.id, select);
  link.setEvents([event]);
  const moved = { ...event, lat: 37.8, title: 'Updated before routing' };
  link.setEvents([moved]); link.start(); expect(select).toHaveBeenCalledExactlyOnceWith(moved);
  const recovered = { ...moved, lon: -122.4, title: 'Available route' };
  link.setEvents([recovered]); expect(select).toHaveBeenLastCalledWith(recovered);
  link.setEvents([event]); expect(select).toHaveBeenCalledTimes(2);
});

it.each(['before-ready', 'after-ready', 'after-rejection'])('permanently cancels a superseded link: %s', moment => {
  const select = vi.fn(() => false), link = createLinkedDestination(event.id, select);
  if (moment !== 'before-ready') link.start();
  if (moment === 'after-rejection') link.setEvents([event]);
  const calls = select.mock.calls.length;
  link.cancel(); link.start(); link.setEvents([event]); link.start();
  expect(select).toHaveBeenCalledTimes(calls);
});

it('keeps cancellation inside an unsuccessful callback permanent', () => {
  let link: ReturnType<typeof createLinkedDestination>;
  const select = vi.fn((): boolean => { link.cancel(); return false; });
  link = createLinkedDestination(event.id, select);
  link.start(); link.setEvents([event]); link.setEvents([event]); link.start();
  expect(select).toHaveBeenCalledOnce();
});

it('never navigates without the requested event, including after a later unrelated calendar', () => {
  const select = vi.fn(() => true), absent = createLinkedDestination('absent', select), none = createLinkedDestination(undefined, select);
  absent.start(); none.start(); absent.setEvents([event]); none.setEvents([event]); expect(select).not.toHaveBeenCalled();
  absent.cancel(); none.cancel();
});
