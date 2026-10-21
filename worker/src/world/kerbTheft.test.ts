import { expect, it } from 'vitest';
import { KERB_REACH_M, KERB_ROAD_M, kerbTheftValid } from './kerbTheft';

it('a kerb-car claim is valid only within reach of the player and beside a real road', () => {
  const car = { x: 10_000, z: 20_000 };                       // cm
  const road = { x: 100 + KERB_ROAD_M - 1, z: 200 };           // metres, just inside the kerb band
  expect(kerbTheftValid({ x: car.x + 300, z: car.z }, car, road)).toBe(true);
  expect(kerbTheftValid({ x: car.x + (KERB_REACH_M + 1) * 100, z: car.z }, car, road)).toBe(false); // too far: no remote spawns
  expect(kerbTheftValid({ x: car.x, z: car.z }, car, { x: 100 + KERB_ROAD_M + 5, z: 200 })).toBe(false); // not at a kerb
  expect(kerbTheftValid({ x: car.x, z: car.z }, car, null)).toBe(false); // roads not loaded: refuse
});
