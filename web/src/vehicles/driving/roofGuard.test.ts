import { describe, expect, it } from 'vitest';
import { isOnBuildingRoof, type RoofGuardWorld } from './roofGuard';

/** A world with one building footprint (its box [10..30] x [10..30], roof top 15) over a street at y=2. */
function world(opts: { roadNull?: boolean } = {}): RoofGuardWorld {
  const inFootprint = (x: number, z: number, slack = 0) => x >= 10 - slack && x <= 30 + slack && z >= 10 - slack && z <= 30 + slack;
  return {
    buildingTopAt: (x, z, slack = 0) => (inFootprint(x, z, slack) ? 15 : null),
    roadHeightAt: () => (opts.roadNull ? null : 2), // road graph is street level (bare of buildings)
  };
}

describe('roof guard — cars must never use a building roof as ground (gtasf-roof-fix)', () => {
  it('flags a car resting on the building roof (above the road network, on a footprint)', () => {
    // Car at the roof top (y=15) over the footprint, with the road graph at street level (2).
    expect(isOnBuildingRoof(world(), 20, 20, 15)).toBe(true);
  });

  it('is robust to a roof-high surface sample: still flagged because the road graph is below', () => {
    // Even if terrain/surface reads as the roof, the road graph (roadHeightAt) stays at 2, so y=14.5 > 2 -> roof.
    expect(isOnBuildingRoof(world(), 20, 20, 14.5)).toBe(true);
  });

  it('flags a roof even when no road sits under the footprint (roadHeightAt null)', () => {
    expect(isOnBuildingRoof(world({ roadNull: true }), 20, 20, 15)).toBe(true);
  });

  it('does NOT flag a car on the street next to the building (low y, inside the slack)', () => {
    // Driving past at street level: a tall building is near, but the car's y is the street, far below the roof.
    expect(isOnBuildingRoof(world(), 20, 20, 2.2)).toBe(false);
  });

  it('does NOT flag a car away from any building footprint (open road / hill)', () => {
    expect(isOnBuildingRoof(world(), 100, 100, 2)).toBe(false);
    expect(isOnBuildingRoof(world(), 100, 100, 40)).toBe(false); // high up but no footprint -> not our case
  });

  it('does NOT flag a car just below the roof lip (within topMargin of the street, not the roof)', () => {
    expect(isOnBuildingRoof(world(), 20, 20, 4)).toBe(false); // y=4 is far below top-2=13
  });

  it('ignores non-finite coordinates', () => {
    expect(isOnBuildingRoof(world(), NaN, 20, 15)).toBe(false);
    expect(isOnBuildingRoof(world(), 20, 20, Infinity)).toBe(false);
  });
});
