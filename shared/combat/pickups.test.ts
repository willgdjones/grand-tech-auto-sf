import { describe, expect, it } from 'vitest';
import { absorbDamage, applyPickup, PICKUP_AMOUNT, PICKUP_SPOTS } from './pickups';
import { MAX_ARMOUR, MAX_HEALTH } from './economy';

describe('health + armour pickups', () => {
  it('health tops up (capped); a full player does not consume it', () => {
    expect(applyPickup('health', 40, 0)).toEqual({ health: 40 + PICKUP_AMOUNT.health, armour: 0 });
    expect(applyPickup('health', 90, 0)).toEqual({ health: MAX_HEALTH, armour: 0 });
    expect(applyPickup('health', MAX_HEALTH, 30)).toBeNull();
  });
  it('armour tops up (capped); full armour does not consume it', () => {
    expect(applyPickup('armour', 100, 0)).toEqual({ health: 100, armour: PICKUP_AMOUNT.armour });
    expect(applyPickup('armour', 100, 80)).toEqual({ health: 100, armour: MAX_ARMOUR });
    expect(applyPickup('armour', 100, MAX_ARMOUR)).toBeNull();
  });
  it('armour absorbs damage first, the rest hits health', () => {
    expect(absorbDamage(100, 30, 50)).toEqual({ health: 80, armour: 0 });
    expect(absorbDamage(100, 60, 50)).toEqual({ health: 100, armour: 10 });
    expect(absorbDamage(20, 0, 50)).toEqual({ health: 0, armour: 0 });
    expect(absorbDamage(100, 0, -5)).toEqual({ health: 100, armour: 0 });
  });
  it('spots are a short fixed list (wire index fits a byte)', () => {
    expect(PICKUP_SPOTS.length).toBeGreaterThan(0);
    expect(PICKUP_SPOTS.length).toBeLessThan(256);
  });
});
