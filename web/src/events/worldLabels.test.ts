import { describe, expect, it } from 'vitest';
import { FUNDING_BASE_CENTS, FUNDING_BASE_CENTS_V3, fundingKind } from '@gtasf/shared/funding';
import { quoteFunding } from '@gtasf/shared/funding';
import { flags } from '@gtasf/shared/flags';
import { labelLimits, selectLabelCandidates, worldLabelText, venuePayout, payoutText, layoutWorldLabels, labelsOverlap, smoothLabelPlacements } from './worldLabels';
import { groupVenues } from './venues';
import type { RadarEvent } from '../radar/radar';
const now = Date.parse('2026-10-06T19:00:00Z');
const event = (title = 'Founders Mixer'): RadarEvent => ({ id: title, title, host: 'Builders', venue: 'Moscone', start: '2026-10-06T18:00:00Z', end: '2026-10-06T20:00:00Z', lat: 37.784, lon: -122.401, url: 'https://luma.com/example', approx: false });
it('shows only title/live far away and adds SF time, payout, host and venue within 80m', () => {
  expect(worldLabelText(event(), null, 81, now)).toEqual({ title: 'Founders Mixer', badge: 'LIVE NOW', detail: '', live: true });
  const future = { ...event(), start: '2026-10-07T01:30:00Z', end: '2026-10-07T03:30:00Z' };
  expect(worldLabelText(future, null, 300, now).badge).toBe('');
  expect(worldLabelText(future, null, 80, now)).toMatchObject({ badge: '6:30 PM', detail: `${payoutText(venuePayout(future, null, now))} · by Builders · Moscone`, live: false });
});
it('label payout = what one pass pays now: sum of each visible event quote at the venue (v3 base, timing)', () => {
  const events = ['VC Demo Day', 'AI Workshop', 'Founders Mixer', 'Launch Party'].map(event);
  const group = groupVenues(events, { now })[0]!;
  const quote = (value: RadarEvent) => BigInt(quoteFunding(value, now, 0, 1).amountCents);
  expect(venuePayout(events[0]!, group, now)).toBe(events.reduce((sum, value) => sum + quote(value), 0n));
  for (const value of events) expect(venuePayout(value, null, now)).toBe(quote(value));
  // A live investor event pays 3× base: never a v2-scale six-figure label under economy v3.
  if (flags.economyV3) expect(venuePayout(events[0]!, null, now)).toBeLessThan(10_000_000n);
  if (flags.economyV3) expect(FUNDING_BASE_CENTS).toEqual(FUNDING_BASE_CENTS_V3);
  expect(payoutText(230000n)).toBe('$2.3k');
  expect(Object.values(FUNDING_BASE_CENTS_V3).map(payoutText)).toEqual(['$4.5k', '$2.3k', '$904']);
});
it('caps Low and phones at 6/250m, HD at 60/500m independently of the ring pool', () => {
  const values = Array.from({ length: 100 }, (_, i) => ({ distance: i * 7 })).reverse();
  expect(labelLimits('low')).toMatchObject({ count: 6, range: 250 });
  expect(selectLabelCandidates(values, 'hd')).toHaveLength(60);
  expect(selectLabelCandidates(values, 'low').map(v => v.distance)).toEqual([0,7,14,21,28,35]);
  expect(selectLabelCandidates(values, 'hd', true)).toHaveLength(6);
  expect(selectLabelCandidates([{distance: 251}], 'low')).toHaveLength(0);
  expect(selectLabelCandidates([{distance: 500}, {distance: 501}], 'hd')).toHaveLength(1);
});
describe('dense placement', () => {
  for (const [width, height, count] of [[1280,800,60], [390,844,6]] as const) it(`keeps all ${count} chosen labels on screen without collisions`, () => {
    let seed = 1729;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let trial = 0; trial < 30; trial++) {
      const anchors = Array.from({ length: count }, (_, i) => ({ id: String(i), distance: i, x: width! / 2 + random() * 10, y: height! / 2 + random() * 10, width: 300, height: 72 }));
      const placed = layoutWorldLabels(anchors, width!, height!);
      expect(placed).toHaveLength(count!);
      for (let i = 0; i < placed.length; i++) {
        const a = placed[i]!;
        expect(a.x - a.width / 2).toBeGreaterThanOrEqual(0);
        expect(a.x + a.width / 2).toBeLessThanOrEqual(width!);
        expect(a.y - a.height / 2).toBeGreaterThanOrEqual(0);
        expect(a.y + a.height / 2).toBeLessThanOrEqual(height!);
        for (let j = 0; j < i; j++) expect(labelsOverlap(a, placed[j]!)).toBe(false);
      }
      const shifted = layoutWorldLabels(anchors.map(a => ({ ...a, x: a.x + 100, y: a.y - 200 })), width!, height!);
      const smooth = smoothLabelPlacements(new Map(placed.map(a => [a.id, a])), shifted, .2, width, height);
      for (let i = 0; i < smooth.length; i++) for (let j = 0; j < i; j++) expect(labelsOverlap(smooth[i]!, smooth[j]!)).toBe(false);
    }
  });
});
