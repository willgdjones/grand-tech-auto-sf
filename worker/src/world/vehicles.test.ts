import { describe, expect, it, vi } from 'vitest';
import type { Pose, S2CMessage } from '@gtasf/shared/protocol/types';
import { KERB_CARS_MAX, OPENING_CARS_MAX, WorldVehicles } from './vehicles';
import { LocalRoads } from './localRoads';
import type { RoadGraph } from '@gtasf/shared/roadgraph';
import { LOCAL_SPAWN } from './localSpawn';
import { flags } from '@gtasf/shared/flags';
import { SF_ZONE_GRID, cellIndex, cellOf } from '@gtasf/shared/world/zones';
import { zonedVehicleId } from './vehicleHandoff';

vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { flags: { ...actual.flags, graphicsV2: false, personalCar: false } }; // personalCar: own file (personalCar.test.ts)
});

it('smoke: nearby driver enters, drives, excludes another player, exits and releases the car', () => {
  const messages: S2CMessage[] = [], players = new Map<number, Pose>();
  const fleet = new WorldVehicles({ emit: message => messages.push(message), pose: (id, pose) => players.set(id, pose) });
  expect(fleet.enter(1, LOCAL_SPAWN, 1, 1000)).toBe(true);
  expect(fleet.enter(2, LOCAL_SPAWN, 1, 1000)).toBe(false);
  const initial = players.get(1)!;
  expect(fleet.move(1, { ...initial, type: 'VEHICLE_MOVE', vehicleId: 1, seq: 1, x: initial.x + 300 }, 1100)).toBe(true);
  expect(fleet.move(2, { ...initial, type: 'VEHICLE_MOVE', vehicleId: 1, seq: 1 }, 1100)).toBe(false);
  expect(fleet.move(1, { ...initial, type: 'VEHICLE_MOVE', vehicleId: 1, seq: 2, x: initial.x + 100000 }, 1100)).toBe(false);
  expect(fleet.cars.get(1)?.entry.speedCmps).toBe(3000);
  expect(fleet.exit(1, 1, 1200)).toBe(true);
  expect(players.get(1)?.flags).toBe(0);
  expect(fleet.enter(2, players.get(1)!, 1, 1200)).toBe(true);
  fleet.disconnect(2, 1300);
  expect(fleet.cars.get(1)?.entry.driverId).toBe(0);
  expect(messages.filter(m => m.type === 'VEHICLE_STATE')).toHaveLength(4);
});

it.each(['prius', 'bus'] as const)('accepts sustained 48mps %s driving plus hill motion but rejects teleporting', kind => {
  const fleet = new WorldVehicles({ emit() {}, pose() {} });
  fleet.cars.get(1)!.entry.kind = kind;
  expect(fleet.enter(1, LOCAL_SPAWN, 1, 1000)).toBe(true);
  let pose = { ...fleet.cars.get(1)!.entry };
  for (let seq = 1; seq <= 20; seq++) {
    pose = { ...pose, x: pose.x + 480, y: pose.y + 180 };
    expect(fleet.move(1, { ...pose, type: 'VEHICLE_MOVE', vehicleId: 1, seq }, 1000 + seq * 100)).toBe(true);
  }
  expect(fleet.cars.get(1)!.entry.speedCmps).toBe(4800);
  expect(fleet.move(1, { ...pose, type: 'VEHICLE_MOVE', vehicleId: 1, seq: 21, x: pose.x + 10000 }, 3100)).toBe(false);
});

it('stocks ten authoritative Ferry cars and replenishes a vacated bay without stealing the driven car', () => {
  const fleet = new WorldVehicles({ emit() {}, pose() {} });
  const nearby = [...fleet.cars.values()].filter(car => Math.hypot(car.entry.x - LOCAL_SPAWN.x, car.entry.z - LOCAL_SPAWN.z) < 6000);
  expect(nearby).toHaveLength(10);
  expect(new Set(nearby.map(car => car.entry.kind)).size).toBe(3);
  const original = { ...fleet.cars.get(5)!.entry };
  expect(fleet.enter(1, original, 5, 0)).toBe(true);
  expect(fleet.enter(2, original, 5, 0)).toBe(false);
  const away: Pose = { x: original.x + 20000, y: original.y, z: original.z, yaw: original.yaw, flags: 0 };
  expect(fleet.respawnDriver(1, away, 1000)).toBe(true);
  fleet.replenishParked(1000, []);
  fleet.replenishParked(45000, []);
  expect(fleet.cars.size).toBe(13);
  fleet.replenishParked(46000, [{ pose: original }]); // A player standing in the empty bay blocks refill.
  expect(fleet.cars.size).toBe(13);
  fleet.addTaxi(900, original);
  fleet.replenishParked(47000, []); // So does a vehicle, even if its rider isn't here.
  expect(fleet.cars.size).toBe(14);
  fleet.cars.delete(900);
  fleet.replenishParked(48000, [{ pose: away }]);
  const replacement = [...fleet.cars.values()].find(car => car.entry.id !== 5 && car.entry.x === original.x && car.entry.z === original.z)!;
  expect(replacement.entry.kind).toBe(original.kind);
  expect(replacement.entry.driverId).toBe(0);
  expect(fleet.occupants.get(1)).toBe(5);
  expect(fleet.cars.get(5)!.entry.x).toBe(away.x);
  fleet.replenishParked(200000, []);
  expect(fleet.cars.has(5)).toBe(true); // An occupied original is never reclaimed.
  fleet.exit(1, 5, 201000);
  fleet.replenishParked(202000, [{ pose: away }]);
  expect(fleet.cars.has(5)).toBe(true);
  fleet.replenishParked(203000, []);
  expect(fleet.cars.has(5)).toBe(false); // Only distant, unoccupied abandoned stock is collected.
  expect(fleet.cars.has(replacement.entry.id)).toBe(true);
});

it('keeps Ferry bays in their owning zone and replaces a departed car with a fresh zoned ID', () => {
  const fleet = new WorldVehicles({ emit() {}, pose() {} });
  const original = { ...fleet.cars.get(5)!.entry };
  const cell = cellOf(SF_ZONE_GRID, original.x / 100, original.z / 100);
  const zone = cellIndex(SF_ZONE_GRID, cell.cx, cell.cy);
  const expected = [...fleet.cars.values()].filter(car => {
    const at = cellOf(SF_ZONE_GRID, car.entry.x / 100, car.entry.z / 100);
    return cellIndex(SF_ZONE_GRID, at.cx, at.cy) === zone;
  }).length;
  fleet.configureZone(zone, () => 1200);
  expect(fleet.cars.size).toBe(expected);
  const id = zonedVehicleId(zone, 5);
  expect(fleet.enter(1, original, id, 0)).toBe(true);
  expect(fleet.detach(1)).toBe(id);
  fleet.replenishParked(1000, []);
  fleet.replenishParked(46000, []);
  expect(fleet.cars.size).toBe(expected);
  expect(fleet.cars.get(zonedVehicleId(zone, 1200))?.entry.x).toBe(original.x);
  expect(fleet.cars.has(id)).toBe(false);
});

it('keeps the legacy starter fleet when Ferry replenishment is disabled', () => {
  const mutable = flags as { ferryParkedCars: boolean }, before = mutable.ferryParkedCars;
  mutable.ferryParkedCars = false;
  try {
    const fleet = new WorldVehicles({ emit() {}, pose() {} });
    fleet.cars.delete(1);
    fleet.replenishParked(1000, []); fleet.replenishParked(100000, []);
    expect(fleet.cars.size).toBe(3);
  } finally { mutable.ferryParkedCars = before; }
});

it('keeps graphics-v2 street stock authoritative and refills through the existing bay lifecycle', () => {
  const mutable = flags as { graphicsV2: boolean }; mutable.graphicsV2 = true;
  try {
    const fleet = new WorldVehicles({ emit() {}, pose() {} });
    const stock = [...fleet.cars.values()].filter(car => car.entry.id > 13);
    expect(stock.length).toBeGreaterThan(0); expect(stock.length).toBeLessThanOrEqual(24);
    const original = { ...stock[0]!.entry };
    expect(fleet.enter(71, original, original.id, 0)).toBe(true);
    expect(fleet.enter(72, original, original.id, 0)).toBe(false);
    const away = { ...original, x: original.x + 20000 };
    expect(fleet.respawnDriver(71, away, 1000)).toBe(true);
    fleet.replenishParked(1000, []);
    fleet.replenishParked(46000, [{ pose: original }]);
    expect(fleet.cars.size).toBe(stock.length + 13);
    fleet.replenishParked(47000, []);
    expect(fleet.cars.size).toBe(stock.length + 14);
    expect(fleet.occupants.get(71)).toBe(original.id);
    const replacement = [...fleet.cars.values()].find(car => car.entry.id !== original.id && car.entry.x === original.x && car.entry.z === original.z);
    expect(replacement?.entry.driverId).toBe(0);
  } finally { mutable.graphicsV2 = false; }
});

function districtRoadFixture(): LocalRoads {
  const graph: RoadGraph = { version: 1, nodes: [], edges: [] };
  for (const [district, x, z] of [[0, 550, 100], [1, -1200, 2600]]) for (let i = 0; i < 5; i++) {
    const from = `${district}-${i}-a`, to = `${district}-${i}-b`, row = z! + i * 60;
    graph.nodes.push({ id: from, x: x! - 60, y: 10, z: row }, { id: to, x: x! + 60, y: 10, z: row });
    graph.edges.push({ id: `lane:${district}-${i}`, ...{ osmWay: district! * 100 + i }, from, to, lengthM: 120, speedMps: 8, lane: 0,
      points: [[x! - 60, 10, row], [x! + 60, 10, row]] });
  }
  return new LocalRoads(graph);
}

it('stocks bounded district cars once and reuses ownership and safe bay refill', () => {
  const mutable = flags as { graphicsV2: boolean }; mutable.graphicsV2 = true;
  try {
    const fleet = new WorldVehicles({ emit() {}, pose() {} }), roads = districtRoadFixture();
    fleet.configureStreetParking(roads);
    const stock = [...fleet.cars.values()].filter(car => car.entry.id >= 200 && car.entry.id < 1000);
    expect(stock).toHaveLength(8); // Four per neighbourhood, despite five eligible streets each.
    expect(stock.some(car => car.entry.x < 0)).toBe(true);
    expect(stock.some(car => car.entry.x > 0)).toBe(true);
    const count = fleet.cars.size;
    fleet.configureStreetParking(roads); expect(fleet.cars.size).toBe(count);
    const original = { ...stock[0]!.entry }, away = { ...original, x: original.x + 20000 };
    expect(fleet.enter(91, original, original.id, 0)).toBe(true);
    expect(fleet.enter(92, original, original.id, 0)).toBe(false);
    expect(fleet.respawnDriver(91, away, 1000)).toBe(true);
    fleet.replenishParked(1000, []); fleet.replenishParked(46000, [{ pose: original }]);
    expect(fleet.cars.size).toBe(count);
    fleet.replenishParked(47000, []);
    expect(fleet.cars.size).toBe(count + 1);
    expect(fleet.occupants.get(91)).toBe(original.id);
    expect(fleet.cars.get(original.id)!.entry.x).toBe(away.x);
  } finally { mutable.graphicsV2 = false; }
});

it('gives district cars identical zone ownership before or after asynchronous graph loading', () => {
  const mutable = flags as { graphicsV2: boolean }; mutable.graphicsV2 = true;
  try {
    const roads = districtRoadFixture(), before = new WorldVehicles({ emit() {}, pose() {} }), after = new WorldVehicles({ emit() {}, pose() {} });
    const cell = cellOf(SF_ZONE_GRID, 550, 100), zone = cellIndex(SF_ZONE_GRID, cell.cx, cell.cy);
    before.configureZone(zone, () => 1300); before.configureStreetParking(roads);
    after.configureStreetParking(roads); after.configureZone(zone, () => 1300);
    const poses = (fleet: WorldVehicles) => [...fleet.cars.values()].map(car => car.entry).sort((a, b) => a.id - b.id);
    expect(poses(before).length).toBeGreaterThan(0);
    expect(poses(before)).toEqual(poses(after));
    for (const car of poses(before)) {
      const at = cellOf(SF_ZONE_GRID, car.x / 100, car.z / 100);
      expect(cellIndex(SF_ZONE_GRID, at.cx, at.cy)).toBe(zone);
    }
    mutable.graphicsV2 = false;
    const disabled = new WorldVehicles({ emit() {}, pose() {} }), count = disabled.cars.size;
    disabled.configureStreetParking(roads); expect(disabled.cars.size).toBe(count);
  } finally { mutable.graphicsV2 = false; }
});

it('remove (vehicle exploded): ejects the driver on foot first, then the car is gone and cannot be entered', () => {
  const messages: S2CMessage[] = [], players = new Map<number, Pose>();
  const fleet = new WorldVehicles({ emit: message => messages.push(message), pose: (id, pose) => players.set(id, pose) });
  expect(fleet.enter(1, LOCAL_SPAWN, 1, 1000)).toBe(true);
  expect(fleet.remove(1, 1100)).toBe(true);
  expect(fleet.has(1)).toBe(false);
  expect(fleet.occupants.has(1)).toBe(false);
  expect(messages.some(m => m.type === 'VEHICLE_STATE' && m.playerId === 1 && m.mode === 'on-foot')).toBe(true);
  expect(players.get(1)?.flags).toBe(0); // on foot
  expect(fleet.enter(1, LOCAL_SPAWN, 1, 1200)).toBe(false);
  expect(fleet.remove(1, 1300)).toBe(false); // already gone
});

describe('kerb-car theft caps (review K-M1)', () => {
  const at = (x: number) => ({ x, y: 0, z: 900_000, yaw: 0, flags: 0 });
  it('a player keeps one kerb car: a new theft discards their previous, undriven one', () => {
    const fleet = new WorldVehicles({ emit() {}, pose() {} });
    expect(fleet.addKerbCar(90_001, at(0), 'prius', 0, 7)).toBe(true);
    expect(fleet.addKerbCar(90_002, at(1000), 'prius', 1, 7)).toBe(true);
    expect(fleet.cars.has(90_001)).toBe(false);
    expect(fleet.cars.has(90_002)).toBe(true);
  });
  it('a previous kerb car someone is driving is kept (theirs now)', () => {
    const fleet = new WorldVehicles({ emit() {}, pose() {} });
    fleet.addKerbCar(90_001, at(0), 'prius', 0, 7);
    expect(fleet.enter(8, at(100), 90_001, 1)).toBe(true);
    fleet.addKerbCar(90_002, at(1000), 'prius', 2, 7);
    expect(fleet.cars.has(90_001)).toBe(true);
  });
  it('a world holds at most KERB_CARS_MAX spawned kerb cars', () => {
    const fleet = new WorldVehicles({ emit() {}, pose() {} });
    for (let p = 0; p < KERB_CARS_MAX; p++) expect(fleet.addKerbCar(90_000 + p, at(p * 1000), 'prius', p, 100 + p)).toBe(true);
    expect(fleet.addKerbCar(91_000, at(-5000), 'prius', 99, 999)).toBe(false);
    fleet.discard(90_000);
    expect(fleet.addKerbCar(91_000, at(-5000), 'prius', 99, 999)).toBe(true);
  });
});

describe('opening cars (openingDrive, review OD-M1)', () => {
  const at = (x: number) => ({ x, y: 0, z: 950_000, yaw: 0, flags: 0 });
  it('have their own cap: a full opening cap never refuses kerb theft, and opening cars never fill the kerb cap', () => {
    const fleet = new WorldVehicles({ emit() {}, pose() {} });
    for (let i = 0; i < OPENING_CARS_MAX; i++) expect(fleet.addOpeningCar(80_000 + i, at(i * 1000), 'tesla', i)).toBe(true);
    expect(fleet.addOpeningCar(80_999, at(-9000), 'tesla', 99)).toBe(false);
    expect(fleet.kerbCarCount).toBe(0);
    expect(fleet.addKerbCar(90_001, at(50_000), 'prius', 100, 7)).toBe(true);
  });
  it('a device\'s previous idle opening car is discarded on a new ask (frees its cap slot)', () => {
    const fleet = new WorldVehicles({ emit() {}, pose() {} });
    for (let i = 0; i < OPENING_CARS_MAX; i++) fleet.addOpeningCar(80_000 + i, at(i * 1000), 'tesla', i);
    fleet.discardIdleOpening(80_000);
    expect(fleet.cars.has(80_000)).toBe(false);
    expect(fleet.addOpeningCar(80_100, at(-1000), 'tesla', 9)).toBe(true);
  });
  it('an opening car someone is driving is kept on a new ask, and stops counting against the cap', () => {
    const fleet = new WorldVehicles({ emit() {}, pose() {} });
    for (let i = 0; i < OPENING_CARS_MAX; i++) fleet.addOpeningCar(80_000 + i, at(i * 1000), 'tesla', i);
    expect(fleet.enter(5, at(100), 80_000, 10)).toBe(true);
    fleet.discardIdleOpening(80_000);
    expect(fleet.cars.has(80_000)).toBe(true);
    expect(fleet.addOpeningCar(80_200, at(-2000), 'tesla', 11)).toBe(true);
  });
});
