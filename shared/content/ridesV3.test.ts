import { expect, it, vi } from 'vitest';
vi.mock('../flags', () => ({ flags: { economyV3: true } }));
import { FUNDING_ROUNDS } from '../funding';
import { LOOK_TIERS, defaultAppearance, resolveLook, tierForRound, unlockRoundLabel } from './cosmetics';
import { PERSONAL_RIDES, fastestUnlockedRide, rideSpeedCapMps, rideUnlocked, unlockedRides } from './rides';

it.each([
  ['bootstrapping', 0, 'scooter', 'Bootstrapping', 19],
  ['seed', 1, 'skateboard', 'Seed', 21],
  ['series-a', 2, 'ebike', 'Series A', 22],
  ['series-b', 3, 'onewheel', 'Series B', 23],
  ['series-c', 4, 'segway', 'Series C', 23],
  ['series-d', 5, 'segway', 'Decacorn', 23],
] as const)('v3 %s grants star %i look, ride, label and authenticated movement cap', (id, star, rideId, label, cap) => {
  const round = FUNDING_ROUNDS.find(round => round.id === id)!;
  expect(round.stars).toBe(star);
  expect(tierForRound(round)).toBe(LOOK_TIERS[star]);
  expect(tierForRound(round).label).toBe(label);
  expect(unlockRoundLabel(star)).toBe(label);
  // The menu resolves these IDs to labels, so every displayed requirement must exist.
  expect(FUNDING_ROUNDS.find(round => round.id === LOOK_TIERS[star]!.unlockRoundId)?.label).toBe(label);
  expect(fastestUnlockedRide(round).id).toBe(rideId);
  expect(unlockedRides(round).map(ride => ride.id)).toEqual(PERSONAL_RIDES.slice(0, Math.min(star + 1, 5)).map(ride => ride.id));
  expect(rideSpeedCapMps(round, 11)).toBe(cap);
  expect(resolveLook({ ...defaultAppearance(), stageRound: star }).tier.index).toBe(star);
});

it('keeps the Segway locked until Series C, and unknown rounds cannot grant higher speed', () => {
  const segway = PERSONAL_RIDES.find(ride => ride.id === 'segway')!;
  expect(rideUnlocked(segway, { id: 'series-b' })).toBe(false);
  expect(rideUnlocked(segway, { id: 'series-c' })).toBe(true);
  expect(tierForRound({ id: 'unicorn' }).index).toBe(0);
  expect(rideSpeedCapMps({ id: 'unknown' }, 11)).toBe(19);
});
