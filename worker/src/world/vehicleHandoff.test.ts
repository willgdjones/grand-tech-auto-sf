import { describe, expect, it } from 'vitest';
import type { Pose } from '@gtasf/shared/protocol/types';
import { DRIVEABLE_KINDS, type DrivenVehicleHandoff, type TaxiRideHandoff, type TaxiTransfer, adoptedCar, occupiedVehicleState, parkedCarsForCell, validDrivenVehicleHandoff, validTaxiRideHandoff, validOccupiedTransfer, zonedVehicleId } from './vehicleHandoff';
import { MOVE_BURST_CM } from './movement';
import { SF_ZONE_GRID, cellIndex, cellOf } from '@gtasf/shared/world/zones';
import { WorldVehicles } from './vehicles';
import { LocalRobotaxis } from './localRobotaxi';
import { validZoneTransfer } from './zoneTransfers';

const pose = (): Pose => ({ x: 119687, y: 328, z: -122430, yaw: 96, flags: 0 });
const base = (over: Partial<DrivenVehicleHandoff> = {}): DrivenVehicleHandoff =>
  ({ kind: 'prius', pose: pose(), speedCmps: 1200, seq: 7, carryCm: 10, ...over });

describe('driven-vehicle handoff contract', () => {
  it('driveable kinds exclude the board-only robotaxi and cable-car', () => {
    expect(DRIVEABLE_KINDS).toEqual(['prius', 'tesla', 'subaru', 'bus', 'supercar']);
  });
  it('accepts a well-formed driven-vehicle handoff', () => {
    expect(validDrivenVehicleHandoff(base())).toBe(true);
    expect(validDrivenVehicleHandoff(base({ kind: 'supercar', speedCmps: 0, seq: 0, carryCm: MOVE_BURST_CM }))).toBe(true);
    expect(validDrivenVehicleHandoff(base({ seq: 0xffff }))).toBe(true);
  });
  it('rejects a non-driveable (board-only) kind — robotaxi/cable-car carry their trip separately', () => {
    expect(validDrivenVehicleHandoff(base({ kind: 'robotaxi' }))).toBe(false);
    expect(validDrivenVehicleHandoff(base({ kind: 'cable-car' }))).toBe(false);
    expect(validDrivenVehicleHandoff(base({ kind: 'spaceship' as never }))).toBe(false);
  });
  it('rejects an invalid pose (never trust the transferred blob)', () => {
    expect(validDrivenVehicleHandoff(base({ pose: { ...pose(), x: Number.NaN } }))).toBe(false);
    expect(validDrivenVehicleHandoff(base({ pose: { ...pose(), yaw: 999 } }))).toBe(false);
  });
  it('rejects out-of-range speed / seq / carry', () => {
    expect(validDrivenVehicleHandoff(base({ speedCmps: -1 }))).toBe(false);
    expect(validDrivenVehicleHandoff(base({ speedCmps: 6001 }))).toBe(false);       // > 60 m/s source clamp
    expect(validDrivenVehicleHandoff(base({ seq: 0x1_0000 }))).toBe(false);          // > 16-bit
    expect(validDrivenVehicleHandoff(base({ seq: 1.5 }))).toBe(false);
    expect(validDrivenVehicleHandoff(base({ carryCm: 751 }))).toBe(false);
    expect(validDrivenVehicleHandoff(base({ kind: 'bus', carryCm: 301 }))).toBe(false);
    expect(validDrivenVehicleHandoff(base({ carryCm: 750 }))).toBe(true);
    expect(validDrivenVehicleHandoff(null)).toBe(false);
    expect(validDrivenVehicleHandoff({ ...base(), pose: null })).toBe(false);
    expect(validDrivenVehicleHandoff(base({ carryCm: -2 }))).toBe(false);
  });

  it('extracts a driven car to a valid handoff (DRIVER_FLAG dropped; always round-trips valid)', () => {
    const car = { entry: { kind: 'prius' as const, x: 100, y: 200, z: 300, yaw: 96, speedCmps: 1200 }, movement: { seq: 7, carryCm: 10 } };
    const state = occupiedVehicleState(car);
    expect(state).toEqual({ kind: 'prius', pose: { x: 100, y: 200, z: 300, yaw: 96, flags: 0 }, speedCmps: 1200, seq: 7, carryCm: 10 });
    expect(validDrivenVehicleHandoff(state)).toBe(true); // the send side always produces a valid blob
  });

  it('builds the destination Car from a handoff and round-trips (extract∘adopt = identity)', () => {
    const state = base({ kind: 'tesla', speedCmps: 900, seq: 42, carryCm: 5 });
    const car = adoptedCar(state, 0x1000005, 7, 1234);
    expect(car.entry).toEqual({ id: 0x1000005, x: state.pose.x, y: state.pose.y, z: state.pose.z, yaw: state.pose.yaw, flags: 0, kind: 'tesla', driverId: 7, speedCmps: 900 });
    expect(car.movement).toMatchObject({ seq: 42, carryCm: 5, accepted: true, lastAt: 1234 });
    expect(occupiedVehicleState(car)).toEqual(state); // send∘receive on the state is identity (flags normalised to 0)
  });
});

describe('cell-aware starter placement', () => {
  const ferry = { id: 'ferry', x: 1196, z: -1224 };  // NE corridor
  const far = { id: 'far', x: -6000, z: -6000 };      // SW grid corner
  it('places each starter car only in the cell that contains it', () => {
    const ferryCell = cellOf(SF_ZONE_GRID, ferry.x, ferry.z), ferryIdx = cellIndex(SF_ZONE_GRID, ferryCell.cx, ferryCell.cy);
    const farCell = cellOf(SF_ZONE_GRID, far.x, far.z), farIdx = cellIndex(SF_ZONE_GRID, farCell.cx, farCell.cy);
    expect(ferryIdx).not.toBe(farIdx);
    expect(parkedCarsForCell([ferry, far], ferryIdx)).toEqual([ferry]);
    expect(parkedCarsForCell([ferry, far], farIdx)).toEqual([far]);
    expect(parkedCarsForCell([ferry, far], 999)).toEqual([]); // a cell with none
  });
  it('creates each parked car once citywide and preserves zoned taxi IDs across allocator restarts', () => {
    const ids = new Set<number>();
    const host = { emit() {}, pose() {} };
    const counters = new Map<number, number>();
    for (let cell = 0; cell < 20; cell++) {
      const allocate = () => { const id = counters.get(cell) ?? 1000; counters.set(cell, id + 1); return id; };
      const fleet = new WorldVehicles(host);
      fleet.configureZone(cell, allocate);
      for (const car of fleet.cars.values()) {
        expect(ids.has(car.entry.id)).toBe(false);
        ids.add(car.entry.id);
        const home = cellOf(SF_ZONE_GRID, car.entry.x / 100, car.entry.z / 100);
        expect(cellIndex(SF_ZONE_GRID, home.cx, home.cy)).toBe(cell);
      }
      const taxi = fleet.allocateTaxiId();
      const restored = new WorldVehicles(host); restored.configureZone(cell, allocate);
      expect(restored.allocateTaxiId()).toBe(taxi + 1);
      expect(taxi).toBeGreaterThan(2_000_000); // deterministic cable-car range remains distinct
    }
    // Zoning splits the same citywide stock (Ferry/street corridor + district parking, gtasf-tns2) without loss or
    // duplication; uniqueness and home cell are checked per car above.
    const unzoned = new WorldVehicles(host);
    expect(ids.size).toBe(unzoned.cars.size);
    expect([...unzoned.cars.keys()].slice(0, 4)).toEqual([1, 2, 3, 4]);
  });
});

describe('taxi-ride handoff contract', () => {
  const ride = (over: Partial<TaxiRideHandoff> = {}): TaxiRideHandoff =>
    ({ requestId: 5, destination: { x: 100, y: 0, z: -200 }, state: 'riding', ...over });
  it('accepts a well-formed ride (both phases)', () => {
    expect(validTaxiRideHandoff(ride())).toBe(true);
    expect(validTaxiRideHandoff(ride({ state: 'pickup' }))).toBe(true);
    expect(validTaxiRideHandoff(ride({ requestId: 0 }))).toBe(true);
  });
  it('rejects a bad requestId, destination or phase (trust boundary)', () => {
    expect(validTaxiRideHandoff(ride({ requestId: -1 }))).toBe(false);
    expect(validTaxiRideHandoff(ride({ requestId: 1.5 }))).toBe(false);
    expect(validTaxiRideHandoff(ride({ destination: { x: Number.NaN, y: 0, z: 0 } }))).toBe(false);
    expect(validTaxiRideHandoff(ride({ destination: null as never }))).toBe(false);
    expect(validTaxiRideHandoff(ride({ state: 'driving' as never }))).toBe(false);
  });
});

it('keeps a travelling car, seat and movement sequence while removing the source without an exit', () => {
  const messages: unknown[] = [];
  const host = { emit: (m: unknown) => { messages.push(m); }, pose() {} };
  const source = new WorldVehicles(host), destination = new WorldVehicles(host);
  source.configureZone(0, () => 1000); destination.configureZone(1, () => 1000);
  const vehicleId = zonedVehicleId(2, 8), state = base({ carryCm: 750 });
  expect(source.adoptCar(99, vehicleId, state, 1000)).toBe(true);
  const transferred = occupiedVehicleState(source.cars.get(vehicleId)!);
  expect(destination.adoptCar(99, vehicleId, transferred, 1000)).toBe(true);
  expect(source.detach(99)).toBe(vehicleId);
  expect(source.cars.has(vehicleId)).toBe(false);
  expect(messages).not.toContainEqual(expect.objectContaining({ mode: 'on-foot' }));
  expect(destination.move(99, { type: 'VEHICLE_MOVE', vehicleId, ...state.pose, seq: 8, x: state.pose.x + 200 }, 1100)).toBe(true);
  expect(destination.cars.get(vehicleId)!.entry).toMatchObject({ id: vehicleId, driverId: 99, x: state.pose.x + 200 });
  expect(destination.move(99, { type: 'VEHICLE_MOVE', vehicleId, ...state.pose, seq: 7 }, 1200)).toBe(false);
});

it('continues the exact taxi segment after pause and adoption, retaining the passenger and destination', () => {
  const playerId = 99, vehicleId = zonedVehicleId(2, 1000);
  const positions = new Map<number, Pose>();
  const messages: unknown[] = [];
  const host = { emit: (m: unknown) => { messages.push(m); }, pose: (id: number, p: Pose) => { positions.set(id, p); } };
  const source = new WorldVehicles(host), destination = new WorldVehicles(host);
  const taxis = new LocalRobotaxis(source, { emit: host.emit, locate: id => positions.get(id) });
  const next = new LocalRobotaxis(destination, { emit: host.emit, locate: id => positions.get(id) });
  const state: TaxiTransfer = { requestId: 5, destination: { x: 10000, y: 0, z: 0 }, state: 'riding',
    pose: { x: 1000, y: 0, z: 0, yaw: 64, flags: 0 }, speedCmps: 1000,
    route: [{ from: [0, 0, 0], to: [100, 0, 0], length: 100, speed: 10 }], travelled: 10 };
  expect(taxis.adopt(playerId, vehicleId, state, 1000)).toBe(true);
  taxis.step(1100);
  const transfer = taxis.transfer(playerId)!;
  expect(validOccupiedTransfer({ id: vehicleId, mode: 'taxi', state: transfer })).toBe(true);
  taxis.pause(playerId); taxis.step(2000);
  expect(taxis.transfer(playerId)).toEqual(transfer);
  expect(next.adopt(playerId, vehicleId, transfer, 2000)).toBe(true);
  taxis.detach(playerId); source.detach(playerId);
  expect(destination.cars.get(vehicleId)!.entry).toMatchObject(transfer.pose);
  next.step(2100);
  expect(destination.cars.get(vehicleId)!.entry.x).toBeGreaterThan(transfer.pose.x);
  expect(destination.occupants.get(playerId)).toBe(vehicleId);
  expect(next.trips.get(playerId)).toMatchObject({ requestId: 5, destination: state.destination, state: 'riding' });
  expect(messages).not.toContainEqual(expect.objectContaining({ state: 'cancelled' }));
  expect(validOccupiedTransfer({ id: vehicleId, mode: 'taxi', state: { ...transfer, travelled: 200 } })).toBe(false);
  expect(validZoneTransfer({ key: '00000000-0000-0000-0000-000000000000', from: { cx: 0, cy: 0 }, to: { cx: 1, cy: 0 },
    expiresAt: 8000, vehicle: { id: vehicleId, mode: 'taxi', state: transfer } }, 1000)).toBe(true);
});
