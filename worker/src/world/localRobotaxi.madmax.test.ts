import { expect, test, vi } from 'vitest';

// Mad-Max behaviour is flag-gated; the classic-path smoke lives in localRobotaxi.test.ts (flag off).
vi.mock('@gtasf/shared/flags', () => ({ flags: { madMaxRobotaxi: true } }));

import { LocalRobotaxis } from './localRobotaxi';
import type { WorldVehicles } from './vehicles';
import type { LocalRoads, RouteSegment } from './localRoads';

function fakeFleet() {
  const cars = new Map<number, { entry: Record<string, number | string> }>();
  const occupants = new Map<number, number>();
  let nextTaxi = 1;
  return {
    cars, occupants,
    allocateTaxiId() { return nextTaxi++; },
    addTaxi(id: number, pose: Record<string, number>) { cars.set(id, { entry: { ...pose, kind: 'robotaxi', driverId: 0, speedCmps: 0 } }); },
    boardTaxi(playerId: number, vehicleId: number) { occupants.set(playerId, vehicleId); return true; },
    moveTaxi(id: number, pose: Record<string, number>, speedCmps: number) { const car = cars.get(id); if (car) car.entry = { ...car.entry, ...pose, speedCmps }; },
    exit(playerId: number) { occupants.delete(playerId); return true; },
  } as unknown as WorldVehicles & { cars: typeof cars; occupants: typeof occupants };
}
const ride: RouteSegment[] = [
  { from: [0, 0, 0], to: [100, 0, 0], length: 100, speed: 10 },
  { from: [100, 0, 0], to: [200, 0, 0], length: 100, speed: 10 },
];
function harness() {
  const fleet = fakeFleet();
  const host = { emit: vi.fn(), locate: () => ({ x: 0, y: 0, z: 0, yaw: 0, flags: 0 }) };
  const approach = vi.fn((): RouteSegment[] => []);
  const roads = {
    snap: () => ({ edge: {}, point: [0, 0, 0], along: 0, distance: 0 }),
    route: () => ride,
    approach,
  } as unknown as LocalRoads;
  return { taxis: new LocalRobotaxis(fleet, host as never, roads), fleet, approach, host };
}

test('mad-max hail: instant curb pickup boards immediately with no upstream approach', () => {
  const { taxis, fleet, approach } = harness();
  expect(taxis.hail(1, 100, { x: 200, y: 0, z: 0 }, 1000)).toBe(true);
  expect(approach).not.toHaveBeenCalled();          // no 150 m approach drive
  expect(fleet.occupants.get(1)).toBeDefined();     // boarded this tick
  expect(taxis.trips.get(1)?.state).toBe('riding');  // already riding, not "pickup"
});

test('mad-max ride runs at the boosted speed', () => {
  const { taxis, fleet } = harness();
  taxis.hail(1, 100, { x: 200, y: 0, z: 0 }, 1000);
  const vehicleId = taxis.trips.get(1)!.vehicleId;
  taxis.step(2000); // one tick while riding
  expect(fleet.cars.get(vehicleId)!.entry.speedCmps).toBe(2400); // 10 m/s * 2.4 * 100 cm
});

test('goToLocation dispatches an instant ride (pane 13 "Go to friend")', () => {
  const { taxis, fleet } = harness();
  expect(taxis.goToLocation(2, 200, { x: 150, y: 0, z: 0 }, 5000)).toBe(true);
  expect(fleet.occupants.get(2)).toBeDefined();
  expect(taxis.trips.get(2)?.state).toBe('riding');
});

test('mad-max ride ETA reflects the boosted speed, not the lane speed (gtasf-ygtw)', () => {
  const { taxis, host } = harness();
  taxis.hail(1, 100, { x: 200, y: 0, z: 0 }, 1000);
  // ride = 2 segments x 100 m @ 10 m/s = 20 s at lane speed; the 2.4x boosted ride is ceil(20/2.4)=9 s.
  const messages = (host.emit as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(c => c[0] as { state: string; etaSeconds: number });
  const riding = messages.filter(m => m.state === 'riding');
  expect(riding.length).toBeGreaterThan(0);
  expect(riding[0]!.etaSeconds).toBe(9); // not 20 (the lane-speed figure)
});
