import { afterEach, expect, test, vi } from 'vitest';
import { flags } from '@gtasf/shared/flags';
import type { VehicleEntry } from '@gtasf/shared/protocol/types';
import { vehicleEntryMode, vehicleEntryRadius } from './vehicleEntry';
vi.mock('@gtasf/shared/flags', () => ({ flags: { rideAnyVehicle: true, zonedWorld: false } }));
afterEach(() => Object.assign(flags, { rideAnyVehicle: true, zonedWorld: false }));
const car: VehicleEntry = { id: 1000000, kind: 'prius', x: 0, y: 0, z: 0, yaw: 0, flags: 0x20, driverId: 0, speedCmps: 1100 };
test('moving cars are drivers, transit is passenger-only, and owned/dispatched cars stay protected', () => {
  expect(vehicleEntryMode(car)).toBe('driver'); expect(vehicleEntryRadius(car)).toBe(4);
  for (const kind of ['bus', 'robotaxi', 'cable-car'] as const) expect(vehicleEntryMode({ ...car, kind }, false)).toBe('passenger');
  expect(vehicleEntryMode({ ...car, driverId: 5 })).toBeNull();
  expect(vehicleEntryMode({ ...car, kind: 'robotaxi', flags: 0 })).toBeNull();
  Object.assign(flags, { rideAnyVehicle: false });
  expect(vehicleEntryMode(car)).toBeNull();
  expect(vehicleEntryMode({ ...car, kind: 'cable-car', flags: 0 })).toBeNull();
  expect(vehicleEntryMode({ ...car, flags: 0, speedCmps: 0 })).toBe('driver');
  expect(vehicleEntryRadius({ ...car, flags: 0 })).toBe(5.5);
});

test('parked buses retain driving and reach while scheduled Muni remains a passenger ride', () => {
  const parked: VehicleEntry = { ...car, id: 42, kind: 'bus', flags: 0, speedCmps: 0 };
  expect(vehicleEntryMode(parked)).toBe('driver');
  expect(vehicleEntryRadius(parked)).toBe(5.5);
  const muni = { ...parked, id: 3_000_000, speedCmps: 600 };
  expect(vehicleEntryMode(muni, false)).toBe('passenger');
  expect(vehicleEntryRadius(muni)).toBe(4);
});
