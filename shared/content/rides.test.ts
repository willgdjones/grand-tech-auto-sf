import { describe, expect, it, vi } from 'vitest';
vi.mock('../flags', () => ({ flags: { economyV3: false } }));
import { PERSONAL_RIDES, fastestUnlockedRide, rideSpeedCapMps, rideUnlocked, unlockedRides } from './rides';
import { FUNDING_ROUNDS } from '../funding';

const round = (id: string) => ({ id });
const first = (pred: (id: string) => boolean) => FUNDING_ROUNDS.find(r => pred(r.id))!;

describe('personal rides', () => {
  it('grants only the scooter at the start (Bootstrapping / pre-funding)', () => {
    const r = round('bootstrapping');
    expect(unlockedRides(r).map(x => x.id)).toEqual(['scooter']);
    expect(fastestUnlockedRide(r).id).toBe('scooter');
  });

  it('unlocks faster rides as the funding round rises', () => {
    expect(fastestUnlockedRide(round('seed')).id).toBe('skateboard');
    expect(fastestUnlockedRide(round('series-a')).id).toBe('ebike');
    expect(fastestUnlockedRide(round('series-d')).id).toBe('onewheel');
    expect(fastestUnlockedRide(round('unicorn')).id).toBe('segway');
  });

  it('every ride is ~2x the 8 m/s sprint and the roster ascends by tier', () => {
    for (const ride of PERSONAL_RIDES) expect(ride.speedMps).toBeGreaterThanOrEqual(14);
    for (let i = 1; i < PERSONAL_RIDES.length; i++) expect(PERSONAL_RIDES[i]!.tierIndex).toBeGreaterThan(PERSONAL_RIDES[i - 1]!.tierIndex);
  });

  it('locks a higher-tier ride until its stage is reached', () => {
    const ebike = PERSONAL_RIDES.find(r => r.id === 'ebike')!;
    expect(rideUnlocked(ebike, round('bootstrapping'))).toBe(false);
    expect(rideUnlocked(ebike, first(id => id === 'series-a'))).toBe(true);
  });

  it('server cap carries the fastest ride + slack and never dips below the on-foot cap', () => {
    expect(rideSpeedCapMps(round('bootstrapping'), 11)).toBeGreaterThanOrEqual(Math.ceil(14 * 1.35));
    expect(rideSpeedCapMps(round('unicorn'), 11)).toBeGreaterThanOrEqual(Math.ceil(17 * 1.35));
    expect(rideSpeedCapMps(round('bootstrapping'), 100)).toBe(100); // floored at the on-foot cap
  });
});
