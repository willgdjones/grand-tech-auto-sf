import { expect, it } from 'vitest';
import { REGEN_CAP, REGEN_DELAY_MS, REGEN_HP_PER_SEC, regenHealth } from './regen';

it('regenerates only after the delay, only up to the cap, never for the dead', () => {
  expect(regenHealth(20, REGEN_DELAY_MS - 1, 1000)).toBe(20);                    // hurt too recently
  expect(regenHealth(20, REGEN_DELAY_MS, 1000)).toBe(20 + REGEN_HP_PER_SEC);     // one second of regen
  expect(regenHealth(REGEN_CAP - 0.5, REGEN_DELAY_MS, 10_000)).toBe(REGEN_CAP);  // capped at half
  expect(regenHealth(80, REGEN_DELAY_MS, 10_000)).toBe(80);                      // above the cap: pickups only
  expect(regenHealth(0, REGEN_DELAY_MS, 10_000)).toBe(0);                        // dead stays dead
});
