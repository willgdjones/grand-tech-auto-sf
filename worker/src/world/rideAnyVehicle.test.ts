import { afterEach, expect, test, vi } from 'vitest';
import type { Pose } from '@gtasf/shared/protocol/types';
import type { RoadGraph } from '@gtasf/shared/roadgraph';
import { cableCarIds, sampleCableCar } from '@gtasf/shared/transit/cableCars';
import { flags } from '@gtasf/shared/flags';
import { LocalRoads } from './localRoads';
import { TrafficSimulation } from './traffic/simulation';
import { PASSENGER_FLAG, DRIVER_FLAG, WorldVehicles } from './vehicles';
import { RideAnyVehicles, safeRideExit, enterReachCm } from './rideAnyVehicle';
vi.mock('@gtasf/shared/flags', () => ({ flags: { rideAnyVehicle: true, driving: true, cableCars: true, muni: true, zonedWorld: false, arcadeHandling: false } }));
afterEach(() => Object.assign(flags, { rideAnyVehicle: true, zonedWorld: false }));
const observer: Pose = { x: 0, y: 2000, z: 0, yaw: 0, flags: 0 };
function setup() {
  const graph: RoadGraph = { version: 1, nodes: [], edges: [] };
  for (let i = 0; i < 12; i++) {
    const x = 20 + i * 20;
    graph.nodes.push({ id: `a${i}`, x, y: 20, z: 0 }, { id: `b${i}`, x, y: 20, z: 200 });
    graph.edges.push({ id: `lane:${i}`, from: `a${i}`, to: `b${i}`, lane: 1, lengthM: 200, speedMps: 10, points: [[x, 20, 0], [x, 20, 200]] });
  }
  const roads = new LocalRoads(graph), traffic = new TrafficSimulation(graph, { maximum: 12, perPlayer: 12 });
  const poses = new Map<number, Pose>();
  const fleet = new WorldVehicles({ emit() {}, pose: (id, pose) => poses.set(id, pose) });
  const rides = new RideAnyVehicles(fleet, () => traffic, () => roads);
  traffic.step(.1, [observer], 1000); traffic.step(.1, [observer], 1100);
  return { roads, traffic, fleet, rides, poses };
}
test('moving traffic takeover validates current 3D proximity, keeps speed and excludes a second driver', () => {
  const { traffic, fleet, rides, poses } = setup();
  const car = traffic.snapshotFor(observer).find(car => car.kind === 'prius')!;
  expect(car.speedCmps).toBeGreaterThan(0);
  const reach = enterReachCm(car.speedCmps); // gtasf-aj86q: grows with speed (the client sees a lagging render)
  expect(reach).toBeGreaterThan(400);
  expect(rides.enter(1, { ...car, x: car.x + reach + 1 }, car.id, 1100)).toBe(false);
  expect(rides.enter(1, { ...car, y: car.y - reach - 1 }, car.id, 1100)).toBe(false);
  Object.assign(flags, { rideAnyVehicle: false }); expect(rides.enter(1, car, car.id, 1100)).toBeUndefined();
  Object.assign(flags, { rideAnyVehicle: true });
  expect(rides.enter(1, { ...car, x: car.x + 300 }, car.id, 1100)).toBe(true);
  expect(traffic.vehicle(car.id)).toBeUndefined();
  expect(fleet.cars.get(car.id)!.entry).toMatchObject({ driverId: 1, speedCmps: car.speedCmps, flags: 0 });
  expect(poses.get(1)).toMatchObject({ x: car.x, y: car.y, z: car.z, flags: DRIVER_FLAG });
  expect(fleet.enter(2, car, car.id, 1100)).toBe(false);
  traffic.step(.1, [observer], 4000, fleet.snapshot(1, 4000).entries);
  expect(traffic.vehicle(car.id)).toBeUndefined(); // Replenishment cannot reuse the stolen car id.
  expect(fleet.exit(1, car.id, 4100)).toBe(true);
});
test('traffic bus and robotaxi passengers follow route, cannot steer, and exit on the same road deck', () => {
  for (const kind of ['bus', 'robotaxi'] as const) {
    const { traffic, fleet, rides, poses } = setup();
    const car = traffic.snapshotFor(observer).find(car => car.kind === kind)!;
    expect(car).toBeDefined(); expect(car.speedCmps).toBeGreaterThan(0);
    expect(rides.enter(1, car, car.id, 1100)).toBe(true);
    expect(rides.enter(2, car, car.id, 1100)).toBe(true);
    expect(poses.get(1)!.flags).toBe(PASSENGER_FLAG);
    expect(fleet.move(1, { ...car, type: 'VEHICLE_MOVE', vehicleId: car.id, seq: 1, x: car.x + 100 }, 1200)).toBe(false);
    traffic.step(.1, [car], 1200, [], rides.retainedTraffic); rides.step(1200);
    expect(poses.get(1)!.z).toBeGreaterThan(car.z);
    const speed = traffic.vehicle(car.id)!.speedCmps;
    expect(rides.exit(1, 1200)).toBe(true);
    expect(poses.get(1)!.flags).toBe(0); expect(poses.get(1)!.y).toBe(2000);
    expect(fleet.occupants.get(2)).toBe(car.id); expect(fleet.cars.get(car.id)!.entry.speedCmps).toBe(speed);
    rides.disconnect(2, 1250); expect(fleet.occupants.has(2)).toBe(false);
    expect(traffic.vehicle(car.id)!.speedCmps).toBe(speed); expect(fleet.cars.has(car.id)).toBe(false);
  }
});
test('safe exits reject the street below a bridge and stay seated until a valid exit is available', () => {
  const { traffic, fleet, roads } = setup();
  const car = traffic.snapshotFor(observer).find(car => car.kind === 'bus')!;
  const below = new LocalRoads({ ...roads.graph, edges: roads.graph.edges.map(edge => ({ ...edge, points: edge.points.map(([x, , z]) => [x, 0, z]) })) });
  expect(safeRideExit(car, below)).toBeUndefined();
  let activeRoads = below;
  const rides = new RideAnyVehicles(fleet, () => traffic, () => activeRoads);
  expect(rides.enter(1, car, car.id, 1100)).toBe(true);
  expect(rides.exit(1, 1100)).toBe(false); expect(fleet.occupants.has(1)).toBe(true);
  activeRoads = roads; rides.step(1200); expect(fleet.occupants.has(1)).toBe(false);
});
test('a moving cable car can be boarded between stops and carries the passenger on its clock', () => {
  const { fleet, roads, poses } = setup();
  const rides = new RideAnyVehicles(fleet, () => undefined, () => roads);
  const now = 10000, cable = cableCarIds.map(id => sampleCableCar(id, now)!).find(car => !car.boarding && car.entry.speedCmps > 0)!;
  expect(rides.enter(1, cable.entry, cable.entry.id, now)).toBe(true);
  rides.step(now + 1000);
  const { x, y, z, yaw } = sampleCableCar(cable.entry.id, now + 1000)!.entry;
  expect(poses.get(1)).toEqual({ x, y, z, yaw, flags: PASSENGER_FLAG });
  expect(rides.exit(1, now + 1000)).toBe(true); // Authored track remains safe outside the tiny dev road graph.
  const exit = poses.get(1)!;
  expect(exit.flags).toBe(0); expect(Math.hypot(exit.x - x, exit.z - z)).toBeGreaterThanOrEqual(600);
  expect(Math.hypot(exit.x - x, exit.z - z)).toBeLessThanOrEqual(900);
});

test('gtasf-aj86q: reach to take over a moving car is 4 m standing, grows with speed (render lag), capped at 9 m', async () => {
    const { enterReachCm, ENTER_REACH_CM } = await import('./rideAnyVehicle');
    expect(enterReachCm(0)).toBe(ENTER_REACH_CM);
    expect(enterReachCm(1000)).toBe(750);        // 10 m/s → 4 m + 3.5 m
    expect(enterReachCm(-1000)).toBe(750);       // reversing counts too
    expect(enterReachCm(5000)).toBe(900);        // capped
    expect(enterReachCm(Number.NaN)).toBe(ENTER_REACH_CM);
});
