import { describe, expect, it } from 'vitest';
import {
  BUSTED_COST_CAP_CENTS,
  BUSTED_COST_PCT,
  WASTED_COST_CAP_CENTS,
  bustedCostCents,
  deathCostCents,
  WASTED_COST_FLOOR_CENTS,
  WASTED_COST_PCT,
  wastedCostCents,
} from './economy';

describe('wastedCostCents', () => {
  it('is 2% once 2% exceeds the $1,000 floor', () => {
    // 2% of $100,000 = $2,000 > $1,000 floor.
    expect(wastedCostCents(10_000_000n)).toBe(200_000n);
    expect(WASTED_COST_PCT).toBe(2n);
  });

  it('falls back to the $1,000 floor when 2% is below it', () => {
    // 2% of $10,000 = $200 < $1,000 floor → floor applies.
    expect(wastedCostCents(1_000_000n)).toBe(WASTED_COST_FLOOR_CENTS);
    expect(wastedCostCents(1_000_000n)).toBe(100_000n);
  });

  it('binds exactly at $50,000 where 2% equals the floor', () => {
    // 2% of $50,000 = $1,000 = floor.
    expect(wastedCostCents(5_000_000n)).toBe(100_000n);
  });

  it('never takes more than the player has (clamped to current, never negative)', () => {
    expect(wastedCostCents(50_000n)).toBe(50_000n); // has $500, floor is $1,000 → loses all $500
    expect(wastedCostCents(1n)).toBe(1n);
    expect(wastedCostCents(0n)).toBe(0n);
    expect(wastedCostCents(-5n)).toBe(0n);
  });
});

describe('bustedCostCents', () => {
  it('is 5% of current', () => {
    expect(bustedCostCents(10_000_000n)).toBe(500_000n); // 5% of $100,000 = $5,000
    expect(BUSTED_COST_PCT).toBe(5n);
  });

  it('has no floor and rounds down with integer division', () => {
    expect(bustedCostCents(1_000_000n)).toBe(50_000n); // 5% of $10,000 = $500
    expect(bustedCostCents(99n)).toBe(4n); // 5% of 99 = 4.95 → 4
  });

  it('is clamped to current and never negative', () => {
    expect(bustedCostCents(0n)).toBe(0n);
    expect(bustedCostCents(-100n)).toBe(0n);
  });
});

describe('deathCostCents dispatch', () => {
  it('routes wasted and busted to their respective costs', () => {
    expect(deathCostCents('wasted', 10_000_000n)).toBe(wastedCostCents(10_000_000n));
    expect(deathCostCents('busted', 10_000_000n)).toBe(bustedCostCents(10_000_000n));
  });
});

describe('riskReward rebalance (critique #12)', () => {
  it('WASTED is a flat $1,000 at any valuation of $1,000 or more (cap meets the floor)', () => {
    for (const cents of [100_000n, 1_000_000n, 8_100_000n, 10_000_000n, 10_000_000_000n]) expect(wastedCostCents(cents, true)).toBe(WASTED_COST_CAP_CENTS);
    expect(WASTED_COST_CAP_CENTS).toBe(100_000n);
  });
  it('WASTED is still clamped to the balance below $1,000, and 0 when broke', () => {
    expect(wastedCostCents(50_000n, true)).toBe(50_000n);
    expect(wastedCostCents(0n, true)).toBe(0n);
    expect(wastedCostCents(-5n, true)).toBe(0n);
  });
  it('BUSTED is 5% up to a $2,500 cap (the QA Seed case: $81k → $2,500, not $4,050)', () => {
    expect(bustedCostCents(8_100_000n, true)).toBe(BUSTED_COST_CAP_CENTS);
    expect(bustedCostCents(8_100_000n, false)).toBe(405_000n);
    expect(bustedCostCents(2_000_000n, true)).toBe(100_000n); // $20k → $1,000, under the cap
    expect(bustedCostCents(5_000_000n, true)).toBe(250_000n); // exactly at the cap
    expect(bustedCostCents(0n, true)).toBe(0n);
  });
  it('flag off keeps the old rules exactly', () => {
    expect(wastedCostCents(10_000_000n)).toBe(200_000n);
    expect(bustedCostCents(100_000_000n)).toBe(5_000_000n);
  });
  it('deathCostCents passes rebalance through to both kinds', () => {
    expect(deathCostCents('busted', 100_000_000n, true)).toBe(250_000n);
    expect(deathCostCents('wasted', 100_000_000n, true)).toBe(100_000n);
    expect(deathCostCents('busted', 100_000_000n)).toBe(5_000_000n);
  });
});
