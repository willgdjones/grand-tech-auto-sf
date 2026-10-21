import { expect, it } from 'vitest';
import { PED_PUNCH_INTERVAL_MS, pedPunchAllowed } from './pedMelee';

it('a ped punch is rate-limited per player', () => {
  expect(pedPunchAllowed(-Infinity, 0)).toBe(true);
  expect(pedPunchAllowed(1_000, 1_000 + PED_PUNCH_INTERVAL_MS - 1)).toBe(false);
  expect(pedPunchAllowed(1_000, 1_000 + PED_PUNCH_INTERVAL_MS)).toBe(true);
});
