import { describe, expect, it } from 'vitest';
import { fundingDay } from '@gtasf/shared/funding';
import { ROBBERY_HOLD_MS, ROBBERY_PAYOUT_CENTS, ROBBERY_PAYOUT_MAX_CENTS, robberyCompleteStatus, robberyCredit, robberyPayoutAllowed, robberyPayoutCents, storeById, STORE_ROBBERIES } from './storeRobbery';

const NOW = 1_760_000_000_000;

describe('store robbery specs', () => {
  it('has unique store ids and finite coords', () => {
    const ids = STORE_ROBBERIES.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of STORE_ROBBERIES) {
      expect(Number.isFinite(s.lat) && Number.isFinite(s.lon)).toBe(true);
      expect(s.name.length).toBeGreaterThan(0);
    }
  });
  it('storeById resolves known ids and rejects unknown', () => {
    expect(storeById(STORE_ROBBERIES[0]!.id)).toBe(STORE_ROBBERIES[0]);
    expect(storeById('nope')).toBeUndefined();
  });
});

describe('robberyPayoutCents', () => {
  it('is the flat modest payout', () => {
    expect(robberyPayoutCents(STORE_ROBBERIES[0]!)).toBe(ROBBERY_PAYOUT_CENTS);
  });
});

describe('robberyCredit', () => {
  it('scopes the ref per store per day (celebrity source), so the funding_credits UNIQUE caps it daily', () => {
    const store = STORE_ROBBERIES[0]!;
    const c = robberyCredit(store, NOW);
    expect(c.source).toBe('celebrity');
    expect(c.sourceRef).toBe(`robbery:${store.id}:${fundingDay(NOW)}`);
  });
  it('different stores and different days get different refs', () => {
    const a = STORE_ROBBERIES[0]!, b = STORE_ROBBERIES[1]!;
    const dayMs = 24 * 60 * 60 * 1000;
    expect(robberyCredit(a, NOW).sourceRef).not.toBe(robberyCredit(b, NOW).sourceRef);
    expect(robberyCredit(a, NOW).sourceRef).not.toBe(robberyCredit(a, NOW + dayMs).sourceRef);
  });
});

describe('robberyPayoutAllowed (review fix 1)', () => {
  it('requires combat AND storeRobberies AND wanted — never pays without the police response', () => {
    expect(robberyPayoutAllowed({ combat: true, storeRobberies: true, wanted: true })).toBe(true);
    expect(robberyPayoutAllowed({ combat: true, storeRobberies: true, wanted: false })).toBe(false); // the fix: no wanted → no pay
    expect(robberyPayoutAllowed({ combat: false, storeRobberies: true, wanted: true })).toBe(false);
    expect(robberyPayoutAllowed({ combat: true, storeRobberies: false, wanted: true })).toBe(false);
  });
});

describe('robberyCompleteStatus (review fix 2)', () => {
  const start = 1_000_000;
  it('rejects a complete before the hold elapses (client raced the server timer)', () => {
    expect(robberyCompleteStatus(start, start + ROBBERY_HOLD_MS - 1, true)).toBe('too-soon');
  });
  it('rejects a complete if the player left the store, even after the hold', () => {
    expect(robberyCompleteStatus(start, start + ROBBERY_HOLD_MS + 500, false)).toBe('too-far');
  });
  it('is ready only after >= holdMs AND still inside the store', () => {
    expect(robberyCompleteStatus(start, start + ROBBERY_HOLD_MS, true)).toBe('ready');
  });
});

describe('robberyPayoutCents with riskReward (critique #12)', () => {
  const store = STORE_ROBBERIES[0]!;
  it('pays max($750, min(1% of current valuation, $5,000))', () => {
    expect(robberyPayoutCents(store, 5_000_000n, true)).toBe(ROBBERY_PAYOUT_CENTS); // $50k → 1% = $500 < $750
    expect(robberyPayoutCents(store, 7_500_000n, true)).toBe(75_000n); // $75k → exactly $750
    expect(robberyPayoutCents(store, 8_100_000n, true)).toBe(81_000n); // QA Seed $81k → $810
    expect(robberyPayoutCents(store, 50_000_000n, true)).toBe(500_000n); // $500k → exactly the $5k cap
    expect(robberyPayoutCents(store, 100_000_000n, true)).toBe(ROBBERY_PAYOUT_MAX_CENTS); // $1M → 1% = $10k → capped $5k
    expect(robberyPayoutCents(store, 10n ** 15n, true)).toBe(ROBBERY_PAYOUT_MAX_CENTS); // any wealth: never a wealth engine
    expect(ROBBERY_PAYOUT_MAX_CENTS).toBe(500_000n);
  });
  it('falls back to the flat $750 with no/zero/negative valuation or with the flag off', () => {
    expect(robberyPayoutCents(store, null, true)).toBe(ROBBERY_PAYOUT_CENTS);
    expect(robberyPayoutCents(store, 0n, true)).toBe(ROBBERY_PAYOUT_CENTS);
    expect(robberyPayoutCents(store, -1n, true)).toBe(ROBBERY_PAYOUT_CENTS);
    expect(robberyPayoutCents(store, 100_000_000n, false)).toBe(ROBBERY_PAYOUT_CENTS);
  });
});
