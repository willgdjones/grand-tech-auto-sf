import { expect, it } from 'vitest';
import type { Pose, S2CMessage } from '@gtasf/shared/protocol/types';
import { LocalRobotaxis } from './localRobotaxi';
import { LOCAL_SPAWN, LOMBARD_SPAWN, LOCAL_TAXI_DESTINATION } from './localSpawn';
import { WorldVehicles } from './vehicles';
import { LocalRoads, routeLength } from './localRoads';
import { INPUT_IDLE_MS } from '@gtasf/shared/admission';

it('smoke: 150m dispatch, real-road ride, duplicate hails, separate riders and disconnect cleanup', () => {
  const players = new Map<number, Pose>([[1, { ...LOCAL_SPAWN }]]), messages: S2CMessage[] = [], riding: Pose[] = [];
  const fleet = new WorldVehicles({ emit: m => messages.push(m), pose: (id, pose) => {
    players.set(id, pose); if (pose.flags & 0x80) riding.push(pose);
  } });
  const taxis = new LocalRobotaxis(fleet, { emit: m => messages.push(m), locate: id => players.get(id) });
  expect(taxis.hail(1, 1, LOCAL_TAXI_DESTINATION, 1000)).toBe(true);
  const approach = taxis.trips.get(1)!.route;
  expect(routeLength(approach)).toBeCloseTo(150, 5);
  const requested = messages.find(m => m.type === 'ROBOTAXI_STATE' && m.state === 'requested');
  expect(requested).toMatchObject({ etaSeconds: 13 });
  const roads = new LocalRoads(), curb = roads.snap(LOCAL_SPAWN)!;
  expect(curb.distance).toBeGreaterThan(15); expect(curb.distance).toBeLessThan(25);
  for (let now = 1100; now < 900000 && taxis.trips.size; now += 100) {
    // The player walks over to the curb after hailing from the clear plaza.
    if (now === 12000) players.set(1, { ...LOCAL_SPAWN, x: Math.round(curb.point[0] * 100), y: Math.round(curb.point[1] * 100), z: Math.round(curb.point[2] * 100) });
    taxis.step(now);
  }
  expect(messages.filter(m => m.type === 'ROBOTAXI_STATE').map(m => m.state)).toEqual(expect.arrayContaining(['requested', 'pickup', 'riding', 'arrived']));
  expect(taxis.trips.size).toBe(0); expect(fleet.occupants.size).toBe(0);
  expect(riding.length).toBeGreaterThan(100);
  expect(Math.max(...riding.map(p => p.y)) - riding.at(-1)!.y).toBeGreaterThan(3200);
  expect(Math.max(...riding.map(p => p.z)) - Math.min(...riding.map(p => p.z))).toBeGreaterThan(2000);
  expect(Math.abs(players.get(1)!.x - LOCAL_TAXI_DESTINATION.x)).toBeLessThan(250);
  expect(players.get(1)!.flags).toBe(0);
  expect(routeLength(roads.route(roads.snap(LOCAL_TAXI_DESTINATION)!, curb)!)).toBeGreaterThan(2500);
  // A second player can cancel a pickup without inheriting a vehicle seat.
  players.set(2, { ...LOMBARD_SPAWN });
  expect(taxis.hail(2, 2, LOCAL_TAXI_DESTINATION, 170000)).toBe(true);
  expect(taxis.cancel(2, 2, 170100)).toBe(true);
  expect(taxis.trips.size).toBe(0); expect(fleet.occupants.has(2)).toBe(false);

  // Two people hailing at the same curb receive distinct taxis. A repeated
  // request cannot create another car, and another person's cancel cannot own it.
  const pickup = roads.snap(LOMBARD_SPAWN)!;
  const curbPose = { ...LOMBARD_SPAWN, x: Math.round(pickup.point[0] * 100), y: Math.round(pickup.point[1] * 100), z: Math.round(pickup.point[2] * 100) };
  players.set(2, { ...curbPose }); players.set(3, { ...curbPose });
  const start = 900_000;
  expect(taxis.hail(2, 20, LOCAL_TAXI_DESTINATION, start)).toBe(true);
  expect(taxis.hail(3, 30, LOCAL_TAXI_DESTINATION, start)).toBe(true);
  const taxiA = taxis.trips.get(2)!.vehicleId, taxiB = taxis.trips.get(3)!.vehicleId;
  expect(taxiA).not.toBe(taxiB);
  const cars = fleet.cars.size;
  expect(taxis.hail(2, 20, LOCAL_TAXI_DESTINATION, start + 10)).toBe(true);
  expect(fleet.cars.size).toBe(cars);
  expect(taxis.hail(2, 21, LOCAL_TAXI_DESTINATION, start + 20)).toBe(false);
  expect(taxis.cancel(3, 20, start + 30)).toBe(false);
  expect(taxis.trips.size).toBe(2);
  expect(fleet.enter(3, fleet.cars.get(taxiA)!.entry, taxiA, start + 40)).toBe(false);
  for (let now = start + 100; now <= start + 20_000 && fleet.occupants.size < 2; now += 100) taxis.step(now);
  expect(fleet.occupants.get(2)).toBe(taxiA); expect(fleet.occupants.get(3)).toBe(taxiB);
  // Even the seated rider cannot submit steering poses for an autonomous car.
  const before = { ...fleet.cars.get(taxiA)!.entry };
  expect(fleet.move(2, { ...before, type: 'VEHICLE_MOVE', vehicleId: taxiA, seq: 1, x: before.x + 100 }, start + 20_001)).toBe(false);
  expect(fleet.cars.get(taxiA)!.entry).toEqual(before);
  taxis.disconnect(2, start + 20_100);
  expect(taxis.trips.has(2)).toBe(false); expect(fleet.occupants.has(2)).toBe(false); expect(fleet.cars.has(taxiA)).toBe(false);
  expect(taxis.trips.has(3)).toBe(true); expect(fleet.occupants.get(3)).toBe(taxiB);
  expect(taxis.cancel(3, 30, start + 20_200)).toBe(true);
  expect(taxis.trips.size).toBe(0); expect(fleet.occupants.size).toBe(0); expect(fleet.cars.has(taxiB)).toBe(false);
});

it('keeps a real ride active beyond input idle without renewing socket liveness or stationary sessions', () => {
  const roads = new LocalRoads(), curb = roads.snap(LOCAL_SPAWN)!;
  const players = new Map<number, Pose>([[1, { ...LOCAL_SPAWN, x: Math.round(curb.point[0] * 100),
    y: Math.round(curb.point[1] * 100), z: Math.round(curb.point[2] * 100) }]]);
  const session = { lastInput: 1000, lastSeen: 1000 };
  let taxis: LocalRobotaxis, lastRideAt = 0, boardedAt = 0;
  const fleet = new WorldVehicles({ emit: () => undefined, pose: (id, pose, now) => {
    taxis.renewPassengerActivity(id, players.get(id)!, pose, now, session);
    players.set(id, pose);
  } });
  taxis = new LocalRobotaxis(fleet, { emit: message => {
    if (message.type === 'ROBOTAXI_STATE' && message.state === 'riding' && !boardedAt) boardedAt = currentTime;
  }, locate: id => players.get(id) }, roads);
  let currentTime = 1000;
  expect(taxis.hail(1, 1, LOCAL_TAXI_DESTINATION, currentTime)).toBe(true);
  for (currentTime = 1100; currentTime < 900_000 && taxis.trips.size; currentTime += 100) {
    taxis.step(currentTime);
    expect(session.lastInput + INPUT_IDLE_MS).toBeGreaterThan(currentTime);
    if (taxis.trips.get(1)?.state === 'pickup') expect(session.lastInput).toBe(1000);
    if (taxis.trips.get(1)?.state === 'riding') lastRideAt = currentTime;
  }
  expect(lastRideAt).toBeGreaterThan(INPUT_IDLE_MS + 1000);
  expect(boardedAt).toBeGreaterThan(1000);
  expect(taxis.trips.size).toBe(0);
  expect(session.lastSeen).toBe(1000);
  const lastInput = session.lastInput, pose = players.get(1)!;
  taxis.renewPassengerActivity(1, pose, { ...pose, x: pose.x + 100 }, currentTime + INPUT_IDLE_MS, session);
  expect(session.lastInput).toBe(lastInput);
  expect(session.lastInput + INPUT_IDLE_MS).toBeLessThanOrEqual(currentTime + INPUT_IDLE_MS);

  // A separate live trip exercises stationary, wrong-seat, driver and cable exclusions.
  players.set(2, { ...LOCAL_SPAWN, x: Math.round(curb.point[0] * 100), y: Math.round(curb.point[1] * 100), z: Math.round(curb.point[2] * 100) });
  expect(taxis.hail(2, 2, LOCAL_TAXI_DESTINATION, currentTime)).toBe(true);
  while (taxis.trips.get(2)?.state === 'pickup') { currentTime += 100; taxis.step(currentTime); }
  currentTime += 100; taxis.step(currentTime);
  const trip = taxis.trips.get(2)!, car = fleet.cars.get(trip.vehicleId)!.entry;
  const after = { ...car, flags: 0x80 }, before = { ...after, x: after.x - 100 }, activity = { lastInput: 1 };
  taxis.renewPassengerActivity(2, after, after, currentTime, activity);
  expect(activity.lastInput).toBe(1);
  fleet.occupants.set(2, trip.vehicleId + 1);
  taxis.renewPassengerActivity(2, before, after, currentTime, activity);
  expect(activity.lastInput).toBe(1);
  fleet.occupants.set(2, trip.vehicleId);
  car.driverId = 2;
  taxis.renewPassengerActivity(2, before, { ...after, flags: 0x40 }, currentTime, activity);
  expect(activity.lastInput).toBe(1);
  car.driverId = 0; car.kind = 'cable-car';
  taxis.renewPassengerActivity(2, before, after, currentTime, activity);
  expect(activity.lastInput).toBe(1);
  car.kind = 'robotaxi'; car.speedCmps = 0;
  taxis.renewPassengerActivity(2, before, after, currentTime, activity);
  expect(activity.lastInput).toBe(1);
});
