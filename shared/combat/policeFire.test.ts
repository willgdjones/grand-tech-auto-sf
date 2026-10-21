import { describe, expect, it } from 'vitest';
import { POLICE_FIRE_INTERVAL_MS, POLICE_FIRE_RANGE_M, POLICE_HIT_CHANCE_FAR, POLICE_HIT_CHANCE_NEAR, policeHitChance, unitMayFire } from './policeFire';

describe('unitMayFire', () => {
  it('police hold fire below 2 stars', () => {
    expect(unitMayFire(1, 5, -Infinity, 0)).toBe(false);
    expect(unitMayFire(2, 5, -Infinity, 0)).toBe(true);
  });
  it('only within range', () => {
    expect(unitMayFire(3, POLICE_FIRE_RANGE_M, -Infinity, 0)).toBe(true);
    expect(unitMayFire(3, POLICE_FIRE_RANGE_M + 0.1, -Infinity, 0)).toBe(false);
  });
  it('one shot per unit per interval', () => {
    expect(unitMayFire(3, 10, 1000, 1000 + POLICE_FIRE_INTERVAL_MS - 1)).toBe(false);
    expect(unitMayFire(3, 10, 1000, 1000 + POLICE_FIRE_INTERVAL_MS)).toBe(true);
  });
});

describe('policeHitChance', () => {
  it('falls from near to far', () => {
    expect(policeHitChance(0, 0, false)).toBeCloseTo(POLICE_HIT_CHANCE_NEAR);
    expect(policeHitChance(POLICE_FIRE_RANGE_M, 0, false)).toBeCloseTo(POLICE_HIT_CHANCE_FAR);
    expect(policeHitChance(10, 0, false)).toBeGreaterThan(policeHitChance(20, 0, false));
  });
  it('moving fast or being in a car makes you harder to hit', () => {
    const still = policeHitChance(10, 0, false);
    expect(policeHitChance(10, 6, false)).toBeCloseTo(still / 2);
    expect(policeHitChance(10, 0, true)).toBeCloseTo(still / 2);
    expect(policeHitChance(10, 12, true)).toBeCloseTo(still / 4);
  });
  it('is always a probability', () => {
    for (const d of [-5, 0, 17, 35, 500]) for (const s of [0, 3, 50]) for (const v of [false, true]) {
      const p = policeHitChance(d, s, v); expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThanOrEqual(1);
    }
  });
});
