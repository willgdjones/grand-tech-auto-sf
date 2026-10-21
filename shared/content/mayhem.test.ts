import { describe, expect, it } from 'vitest';
import {
  MAYHEM_ITEMS, MAYHEM_FIRE_COOLDOWN_MS, WATER_SPLASH_RADIUS_M, cycleMayhemItem, mayhemCanFire, mayhemItemAt, mayhemItemIndex, mayhemWaterHit,
} from './mayhem';

describe('playful mayhem contract', () => {
  it('has the three non-lethal items in stable slots', () => {
    expect(MAYHEM_ITEMS.map(i => i.id)).toEqual(['paintball', 'confetti', 'water']);
    expect(MAYHEM_ITEMS.map(i => i.slot)).toEqual([1, 2, 3]);
    expect(MAYHEM_ITEMS.find(i => i.id === 'confetti')!.auto).toBe(true); // confetti auto-fires on round close
    expect(MAYHEM_ITEMS.find(i => i.id === 'paintball')!.auto).toBe(false);
  });

  it('round-trips item ids through their wire index', () => {
    for (const item of MAYHEM_ITEMS) expect(mayhemItemAt(mayhemItemIndex(item.id))!.id).toBe(item.id);
    expect(mayhemItemAt(99)).toBeNull();
  });

  it('cycles the selected item with wrap-around (scroll picking)', () => {
    expect(cycleMayhemItem('paintball', 1)).toBe('confetti');
    expect(cycleMayhemItem('water', 1)).toBe('paintball');      // wraps forward
    expect(cycleMayhemItem('paintball', -1)).toBe('water');     // wraps back
    expect(cycleMayhemItem('confetti', 0)).toBe('confetti');    // no move
  });

  it('rate-limits fires to the cooldown', () => {
    expect(mayhemCanFire(Number.NEGATIVE_INFINITY, 1000)).toBe(true); // never fired
    expect(mayhemCanFire(1000, 1000 + MAYHEM_FIRE_COOLDOWN_MS)).toBe(true);
    expect(mayhemCanFire(1000, 1000 + MAYHEM_FIRE_COOLDOWN_MS - 1)).toBe(false);
  });

  it('water splash hits the local player only within the splash radius (planar, y-ignored)', () => {
    const me = { x: 10, z: -5 };
    expect(mayhemWaterHit([10, 0, -5], me)).toBe(true);                               // dead on
    expect(mayhemWaterHit([10, 99, -5], me)).toBe(true);                              // y ignored (uphill)
    expect(mayhemWaterHit([10 + WATER_SPLASH_RADIUS_M - 0.01, 0, -5], me)).toBe(true); // just inside
    expect(mayhemWaterHit([10 + WATER_SPLASH_RADIUS_M + 0.5, 0, -5], me)).toBe(false); // just outside
    expect(mayhemWaterHit([10, 0, -5 - 100], me)).toBe(false);                        // far away
  });
});
