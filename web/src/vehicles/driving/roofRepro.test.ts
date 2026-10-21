import { describe, expect, it, vi } from 'vitest';

// Reproduce the #5.46 live bug with the real driving physics: hill air + a roof-high drivable surface.
vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: Object.freeze({ ...actual.flags, driving: true, hillJumps: true, arcadeHandling: true }) };
});

import { createDrivingState, updateDriving } from './controller';
import { isOnBuildingRoof, type RoofGuardWorld } from './roofGuard';
import type { MovementWorld } from '../../movement/world';

// A contiguous rowhouse-block "roof" over footprint [10..30]x[10..30] at y=15; street elsewhere at y=2.
// This mirrors the dense LiDAR failure: the surface sample reads as the roof and the collision box sits
// below the roof, so standing ON the roof is not a collision — the car treats the roof as drivable ground.
const ROOF_Y = 15, STREET_Y = 2;
const onRoofXZ = (x: number, z: number) => x >= 10 && x <= 30 && z >= 10 && z <= 30;
const world: MovementWorld = {
  heightAt: (x, z) => (onRoofXZ(x, z) ? ROOF_Y : STREET_Y),
  collidesCircle: () => false, // on top of the roof the car is above the collision box -> no block
};
// The World the roof guard sees: a building footprint (roof top 15) over the same region; the ROAD graph
// is always street level (2), independent of the terrain field.
const guardWorld: RoofGuardWorld = {
  buildingTopAt: (x, z, slack = 0) => (x >= 10 - slack && x <= 30 + slack && z >= 10 - slack && z <= 30 + slack ? ROOF_Y : null),
  roadHeightAt: () => STREET_Y,
};

describe('REPRO #5.46: a car can end up driving on building roofs (gtasf-roof-fix)', () => {
  it('a car landing over a roof-high footprint sticks to the roof as drivable ground', () => {
    // Car airborne just above the roof over the footprint, descending — as after a hill/jump launch.
    const car = createDrivingState({ x: 20, y: ROOF_Y + 3, z: 12, yaw: 0 });
    car.airborne = true; car.vy = -2; car.speed = 8; // rolling forward along +z
    for (let i = 0; i < 40; i++) updateDriving(car, { steer: 0, throttle: 1, brake: 0, handbrake: false }, 1 / 30, world);
    // BUG: the car has settled ON the roof (y ~= 15), not fallen to the street (y=2), and is still moving.
    expect(car.airborne).toBe(false);
    expect(Math.abs(car.y - ROOF_Y)).toBeLessThan(1.0);
    expect(car.z).toBeGreaterThan(12); // it drove forward across the roof
    expect(onRoofXZ(car.x, car.z)).toBe(true);

    // FIX: the roof guard flags exactly this state, so main.ts stops the car and recovers it to a road.
    expect(isOnBuildingRoof(guardWorld, car.x, car.z, car.y)).toBe(true);
  });

  it('a car on the normal street is never flagged (no false recovery)', () => {
    const car = createDrivingState({ x: 100, y: STREET_Y, z: 100, yaw: 0 });
    car.speed = 8;
    for (let i = 0; i < 20; i++) updateDriving(car, { steer: 0, throttle: 1, brake: 0, handbrake: false }, 1 / 30, world);
    expect(Math.abs(car.y - STREET_Y)).toBeLessThan(1.0);
    expect(isOnBuildingRoof(guardWorld, car.x, car.z, car.y)).toBe(false);
  });
});
