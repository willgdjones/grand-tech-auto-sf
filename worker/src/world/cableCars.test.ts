import { expect, it } from 'vitest';
import { cableCarIds, nearestCableStops, sampleCableCar } from '@gtasf/shared/transit/cableCars';
import { cableRoutes } from '@gtasf/shared/transit/cableRoutes';
import type { Pose, S2CMessage } from '@gtasf/shared/protocol/types';
import { WorldVehicles } from './vehicles';
import { WorldCableCars } from './cableCars';
import { INPUT_IDLE_MS } from '@gtasf/shared/admission';

it('keeps seated moving riders active beyond five minutes on every sourced direction without faking socket liveness', () => {
  const epoch = Date.UTC(2026, 9, 3, 8);
  for (const route of cableRoutes) {
    let boarding: ReturnType<typeof sampleCableCar>, start = epoch;
    for (; start < epoch + 600_000 && !boarding; start += 1000)
      boarding = cableCarIds.map(id => sampleCableCar(id, start)!).find(car => car.line === route.line && car.destination === route.destination && car.boarding);
    expect(boarding, route.id).toBeDefined(); start -= 1000;
    const carId = boarding!.entry.id, positions = new Map<number, Pose>([[1, boarding!.entry]]);
    const session = { lastInput: start, lastSeen: start };
    let service: WorldCableCars;
    const fleet = new WorldVehicles({ emit: () => undefined, pose: (id, pose, now) => {
      // Baseline has no cable renewal, matching the existing WorldDO path.
      service.renewPassengerActivity?.(id, positions.get(id)!, pose, now, session);
      positions.set(id, pose);
    } });
    service = new WorldCableCars(fleet);
    expect(service.board(1, boarding!.entry, carId, start)).toBe(true);
    const end = start + INPUT_IDLE_MS + 60_000;
    for (let now = start + 1000; now <= end; now += 1000) {
      expect(session.lastInput + INPUT_IDLE_MS, `${route.id} idle at ${now - start}ms`).toBeGreaterThan(now);
      service.step(now);
      expect(fleet.occupants.get(1)).toBe(carId);
    }
    expect(session.lastInput).toBeGreaterThan(start + INPUT_IDLE_MS);
    expect(session.lastSeen).toBe(start);
    if (route === cableRoutes[0]) {
      let now = end;
      while (fleet.cars.get(carId)!.entry.speedCmps === 0) service.step(now += 1000);
      const car = fleet.cars.get(carId)!.entry;
      const after = { ...car, flags: 0x80 }, before = { ...after, x: after.x - 100 };
      const activity = { lastInput: 1, lastSeen: 2 };
      service.renewPassengerActivity(1, after, after, now, activity);
      service.renewPassengerActivity(1, before, { ...after, x: after.x + 1 }, now, activity);
      service.renewPassengerActivity(1, { ...before, flags: 0x40 }, after, now, activity);
      service.renewPassengerActivity(1, before, { ...after, flags: 0x40 }, now, activity);
      expect(activity.lastInput).toBe(1);
      fleet.occupants.delete(1);
      service.renewPassengerActivity(1, before, after, now, activity);
      fleet.occupants.set(1, 1);
      service.renewPassengerActivity(1, before, after, now, activity);
      fleet.occupants.set(1, carId);
      expect(activity.lastInput).toBe(1);
      const speed = car.speedCmps;
      car.speedCmps = 0;
      service.renewPassengerActivity(1, before, after, now, activity);
      car.speedCmps = speed; car.driverId = 1;
      service.renewPassengerActivity(1, before, after, now, activity);
      car.driverId = 0;
      expect(activity.lastInput).toBe(1);
      service.renewPassengerActivity(1, before, after, now, activity);
      expect(activity).toEqual({ lastInput: now, lastSeen: 2 });
    }
    const lastInput = session.lastInput;
    const exitAt = Math.max(end, lastInput);
    expect(fleet.exit(1, carId, exitAt)).toBe(true);
    service.step(exitAt + INPUT_IDLE_MS);
    expect(session.lastInput).toBe(lastInput);
  }
});

it('runs all three sourced lines by absolute time and validates shared passenger boarding, movement and exits', () => {
  expect(cableRoutes.map(r => r.id)).toEqual(['PH-outbound', 'PH-inbound', 'PM-outbound', 'PM-inbound', 'C-outbound', 'C-inbound']);
  for (const route of cableRoutes) {
    expect(route.lengthM).toBeGreaterThan(2200); expect(route.stops.length).toBeGreaterThanOrEqual(18);
    expect(route.points.every(p => p.every(Number.isFinite))).toBe(true);
  }
  const positions = new Map<number, Pose>(), messages: S2CMessage[] = [];
  const fleet = new WorldVehicles({ emit: message => messages.push(message), pose: (id, pose) => positions.set(id, pose) });
  const service = new WorldCableCars(fleet);
  const epoch = Date.UTC(2026, 9, 3, 8), carId = cableCarIds[0]!;
  let now = epoch;
  while (!sampleCableCar(carId, now)!.boarding && now < epoch + 120_000) now += 100;
  const state = sampleCableCar(carId, now)!; expect(state.boarding).toBe(true);
  const at = state.entry;
  expect(service.board(1, { ...at, x: at.x + 701 }, carId, now)).toBe(false);
  expect(service.board(1, at, carId, now)).toBe(true);
  expect(service.board(2, at, carId, now)).toBe(true);
  expect(service.board(1, at, carId, now)).toBe(false);
  expect(fleet.move(1, { type: 'VEHICLE_MOVE', vehicleId: carId, seq: 1, ...at, x: at.x + 2000 }, now + 100)).toBe(false);
  service.step(now + 15_000);
  const moved = sampleCableCar(carId, now + 15_000)!.entry;
  expect(positions.get(1)).toEqual({ x: moved.x, y: moved.y, z: moved.z, yaw: moved.yaw, flags: 0x80 });
  expect(positions.get(2)).toEqual(positions.get(1));
  expect(Math.hypot(moved.x - at.x, moved.z - at.z)).toBeGreaterThan(100);
  expect(fleet.exit(1, carId, now + 15_000)).toBe(true);
  expect(fleet.occupants.get(2)).toBe(carId);
  expect(fleet.cars.get(carId)!.entry.speedCmps).toBe(moved.speedCmps);
  expect(service.board(3, moved, carId, now + 15_000)).toBe(false);
  expect(messages.filter(m => m.type === 'VEHICLE_STATE' && m.mode === 'passenger')).toHaveLength(2);
  expect(fleet.states().filter(m => m.type === 'VEHICLE_STATE' && m.mode === 'passenger')).toHaveLength(1);
  let maximumStepCm = 0;
  for (const id of cableCarIds) {
    const a = sampleCableCar(id, epoch)!, b = sampleCableCar(id, epoch)!;
    expect(a).toEqual(b);
    // No hidden per-runtime phase: crossing any timetable/terminal boundary remains continuous.
    let before = a.entry;
    for (let time = epoch + 100; time <= epoch + 2_400_000; time += 100) {
      const after = sampleCableCar(id, time)!.entry;
      maximumStepCm = Math.max(maximumStepCm, Math.hypot(after.x - before.x, after.z - before.z));
      before = after;
    }
  }
  expect(maximumStepCm).toBeLessThan(55);
  const choices = nearestCableStops({ x: 1200, z: -1224 }, epoch);
  expect(choices.map(c => c.title)).toEqual(['Powell–Hyde', 'Powell–Mason', 'California']);
  expect(choices.every(c => c.waitSeconds >= 0 && c.waitSeconds < 300)).toBe(true);
});
