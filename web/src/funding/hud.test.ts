import { describe, expect, it } from 'vitest';
import { boardRowAmounts, drainStep, formatRunway, runwaySeconds, showsBigAwardToast } from './hud';

type Arg = Parameters<typeof showsBigAwardToast>[0];
const mk = (prevRound: string, round: string, source?: string): Arg =>
  ({ previousRound: { id: prevRound }, profile: { round: { id: round } }, source } as unknown as Arg);

describe('showsBigAwardToast', () => {
  it('shows the big centred toast on a stage-up (round changed)', () => {
    expect(showsBigAwardToast(mk('seed', 'series-a'))).toBe(true);
    expect(showsBigAwardToast(mk('series-z', 'unicorn', 'event'))).toBe(true); // promotion still wins
  });

  it('hides it for a routine same-round event cheque (SA toast only — keep driving)', () => {
    expect(showsBigAwardToast(mk('seed', 'seed', 'event'))).toBe(false);
    expect(showsBigAwardToast(mk('seed', 'seed'))).toBe(false);
  });

  it('shows it for the rarer special sources even without a stage-up', () => {
    for (const source of ['vc-drop', 'celebrity', 'warm-intro']) {
      expect(showsBigAwardToast(mk('seed', 'seed', source))).toBe(true);
    }
  });
});

describe('runwaySeconds (economy v3 burn, gtasf-kax8)', () => {
  // burn per second = (threshold_s - threshold_{s-1}) / 86400, so an idle startup loses one round/24h.
  it('is the seconds of funding held above the round threshold at the burn rate', () => {
    // 1,000,000 cents above threshold, burning 10 cents/s -> 100,000 s of runway.
    expect(runwaySeconds('2000000', '1000000', '10')).toBe(100_000);
  });
  it('is 0 at or below the round threshold (down round imminent)', () => {
    expect(runwaySeconds('1000000', '1000000', '10')).toBe(0);
    expect(runwaySeconds('900000', '1000000', '10')).toBe(0);
  });
  it('is 0 when there is no burn', () => {
    expect(runwaySeconds('2000000', '1000000', '0')).toBe(0);
  });
  it('handles big bigint cents without precision loss and bad input safely', () => {
    expect(runwaySeconds('100000000000', '0', '1')).toBe(100_000_000_000);
    expect(runwaySeconds('x', '0', '1')).toBe(0);
  });
});

describe('formatRunway', () => {
  it('formats hours/minutes, minutes/seconds, and seconds', () => {
    expect(formatRunway(66000)).toBe('18h 20m');
    expect(formatRunway(365)).toBe('6m 05s');
    expect(formatRunway(45)).toBe('45s');
    expect(formatRunway(0)).toBe('0s');
    expect(formatRunway(-5)).toBe('0s');
  });
});

describe('drainStep (economy v3 live-ticking drain, gtasf-kax8)', () => {
  it('extrapolates the burned-down funding at whole-second granularity', () => {
    expect(drainStep(1000n, 10n, 5000)).toBe(950n);   // 5s * 10 = 50 drained
    expect(drainStep(1000n, 10n, 1500)).toBe(990n);   // floor(1.5s) = 1s
  });
  it('holds steady within the first whole second (no sub-second jitter)', () => {
    expect(drainStep(1000n, 10n, 500)).toBe(1000n);
  });
  it('clamps at zero (funding never shows negative)', () => {
    expect(drainStep(30n, 10n, 5000)).toBe(0n);
  });
  it('is a no-op without burn or elapsed time', () => {
    expect(drainStep(1000n, 0n, 5000)).toBe(1000n);
    expect(drainStep(1000n, 10n, -5)).toBe(1000n);
    expect(drainStep(1000n, 10n, 0)).toBe(1000n);
  });
});

describe('boardRowAmounts (economy v3 leaderboard row, gtasf-kax8)', () => {
  const v3 = { totalCents: '150000', todayCents: '2000', lifetimeCents: '900000' }; // burned 1.5k, lifetime 9k
  const preV3 = { totalCents: '900000', todayCents: '2000' };                        // no lifetimeCents field
  it('v3 week/live board leads with the lifetime total (rank order) and shows current as "now"', () => {
    expect(boardRowAmounts(v3, 'week')).toEqual({ headlineCents: '900000', nowCents: '150000' });
    expect(boardRowAmounts(v3, 'current')).toEqual({ headlineCents: '150000', nowCents: null }); // current board ranks by now
    expect(boardRowAmounts(v3, 'live')).toEqual({ headlineCents: '900000', nowCents: '150000' });
  });
  it('today always shows today’s raised with no "now" figure', () => {
    expect(boardRowAmounts(v3, 'today')).toEqual({ headlineCents: '2000', nowCents: null });
    expect(boardRowAmounts(preV3, 'today')).toEqual({ headlineCents: '2000', nowCents: null });
  });
  it('pre-v3 rows (no lifetimeCents) keep the single total and never add "now" (inert until flag)', () => {
    expect(boardRowAmounts(preV3, 'week')).toEqual({ headlineCents: '900000', nowCents: null });
    expect(boardRowAmounts(preV3, 'live')).toEqual({ headlineCents: '900000', nowCents: null });
  });
});
