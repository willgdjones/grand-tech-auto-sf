import { expect, it } from 'vitest';
import { eventVisibilityWindowEnd, eventVisibleIn } from './eventVisibility';

const NOW = Date.parse('2026-10-05T17:00:00Z');
const at = (iso: string, hours = 2, lat = 37.79) => ({ start: iso, end: new Date(Date.parse(iso) + hours * 3_600_000).toISOString(), lat, lon: -122.4 });
const fillers = Array.from({ length: 30 }, () => at('2026-10-05T20:00:00Z'));

it('next-24h and live events are visible; a later-in-week event is not (24h focus)', () => {
  const live = at('2026-10-05T16:00:00Z'), soon = at('2026-10-06T10:00:00Z'), thursday = at('2026-10-08T16:00:00Z');
  const end = eventVisibilityWindowEnd([live, soon, thursday, ...fillers], NOW, true);
  expect(eventVisibleIn(live, NOW, end)).toBe(true);
  expect(eventVisibleIn(soon, NOW, end)).toBe(true);
  expect(eventVisibleIn(thursday, NOW, end)).toBe(false);
});

it('sparse next 24h extends the window day by day (preview fallback); focus off shows the whole week', () => {
  const thursday = at('2026-10-08T16:00:00Z');
  expect(eventVisibleIn(thursday, NOW, eventVisibilityWindowEnd([thursday], NOW, true))).toBe(true);
  expect(eventVisibleIn(thursday, NOW, eventVisibilityWindowEnd([thursday, ...fillers], NOW, false))).toBe(true);
  expect(eventVisibleIn(at('2026-10-14T16:00:00Z'), NOW, eventVisibilityWindowEnd([thursday, ...fillers], NOW, false))).toBe(false);
});
