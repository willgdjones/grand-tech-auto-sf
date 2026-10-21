import { describe, expect, it } from 'vitest';
import { openingCarPose } from './openingCar';

const start = { x: 100, z: -200 };
const road = (x: number, z: number, yaw: number) => ({ x, y: 3, z, yaw });

describe('opening car (openingDrive)', () => {
  it('spawns on the road beside a player at the start, facing their way along the road', () => {
    expect(openingCarPose({ x: 10_100, z: -20_000 }, start, road(102, -200, 10), 12)).toEqual({ x: 10_200, y: 300, z: -20_000, yaw: 10, flags: 0 });
    // The road edge points the other way: the car is turned round to face where the player faces.
    expect(openingCarPose({ x: 10_100, z: -20_000 }, start, road(102, -200, 140), 12)).toMatchObject({ yaw: 12 });
    expect(openingCarPose({ x: 10_100, z: -20_000 }, start, road(102, -200, 250), 5)).toMatchObject({ yaw: 250 }); // wraps
  });
  it('is not a free car anywhere: away from the start, off-road or out of reach it refuses', () => {
    expect(openingCarPose({ x: 15_000, z: -20_000 }, start, road(150, -200, 0), 0)).toBe('not-at-start');
    expect(openingCarPose({ x: 10_100, z: -20_000 }, start, null, 0)).toBe('no-road');
    expect(openingCarPose({ x: 10_100, z: -20_000 }, start, road(108, -200, 0), 0)).toBe('reach');
  });
});
