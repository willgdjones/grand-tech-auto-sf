import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import type { Pose, VehicleKind } from '@gtasf/shared/protocol/types';
import { KERB_CARS_MAX, WorldVehicles } from './vehicles';
import { LOCAL_SPAWN } from './localSpawn';
import { loadPersonalCar, savePersonalCar } from './personalCar';

vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { flags: { ...actual.flags, graphicsV2: false, personalCar: true, driving: true } };
});

function fleetWithLog() {
  const left: { playerId: number; kind: VehicleKind; pose: Pose }[] = [];
  const fleet = new WorldVehicles({ emit() {}, pose() {}, personalCarLeft: (playerId, kind, pose) => left.push({ playerId, kind, pose }) });
  return { fleet, left };
}
const away = (p: Pose, dx: number): Pose => ({ x: p.x + dx, y: p.y, z: p.z, yaw: p.yaw, flags: 0 });

it('the road car you drove and left is yours: saved, and kept out of the abandoned-car sweep', () => {
  const { fleet, left } = fleetWithLog();
  const original = { ...fleet.cars.get(5)!.entry };
  expect(fleet.enter(1, original, 5, 0)).toBe(true);
  expect(fleet.respawnDriver(1, away(original, 20000), 1000)).toBe(true);
  expect(fleet.exit(1, 5, 2000)).toBe(true);
  expect(left).toEqual([{ playerId: 1, kind: original.kind, pose: expect.objectContaining({ x: original.x + 20000 }) }]);
  expect(fleet.personalCarOf(1)?.id).toBe(5);
  for (const t of [45_000, 46_000, 300_000, 400_000]) fleet.replenishParked(t, []); // bay retires it; sweep would collect it
  expect(fleet.cars.has(5)).toBe(true);
  // Someone else drives off in it: it becomes theirs, and the first owner no longer has a car here.
  expect(fleet.enter(2, fleet.cars.get(5)!.entry, 5, 500_000)).toBe(true);
  expect(fleet.exit(2, 5, 501_000)).toBe(true);
  expect(fleet.personalCarOf(2)?.id).toBe(5);
  expect(fleet.personalCarOf(1)).toBeUndefined();
});

it('a passenger, a bus or a cable car never becomes a personal car', () => {
  const { fleet, left } = fleetWithLog();
  fleet.cars.get(1)!.entry.kind = 'bus';
  expect(fleet.enter(1, LOCAL_SPAWN, 1, 0)).toBe(true);
  expect(fleet.exit(1, 1, 1000)).toBe(true);
  expect(fleet.personalCarOf(1)).toBeUndefined();
  expect(left).toHaveLength(0);
});

it('releasing on disconnect removes the parked car (it is saved per device) but never one someone is driving', () => {
  const { fleet } = fleetWithLog();
  expect(fleet.spawnPersonal(5000, { ...LOCAL_SPAWN, flags: 0 }, 'tesla', 1, 0)).toBe(true);
  expect(fleet.spawnPersonal(5001, { ...LOCAL_SPAWN, flags: 0 }, 'bus', 2, 0)).toBe(false); // only road cars
  fleet.releasePersonal(1);
  expect(fleet.cars.has(5000)).toBe(false);
  expect(fleet.spawnPersonal(5002, { ...LOCAL_SPAWN, flags: 0 }, 'prius', 1, 0)).toBe(true);
  expect(fleet.enter(3, LOCAL_SPAWN, 5002, 10)).toBe(true);
  fleet.releasePersonal(1);
  expect(fleet.cars.has(5002)).toBe(true);
  expect(fleet.removePersonal(1)).toBe(true); // nothing owned any more
});

it('a delivery replaces the parked car; a car being driven cannot be replaced', () => {
  const { fleet } = fleetWithLog();
  expect(fleet.spawnPersonal(6000, { ...LOCAL_SPAWN, flags: 0 }, 'subaru', 1, 0)).toBe(true);
  expect(fleet.removePersonal(1)).toBe(true);
  expect(fleet.cars.has(6000)).toBe(false);
  expect(fleet.spawnPersonal(6001, away(LOCAL_SPAWN, 900), 'subaru', 1, 0)).toBe(true);
  expect(fleet.enter(2, fleet.cars.get(6001)!.entry, 6001, 10)).toBe(true);
  expect(fleet.removePersonal(1)).toBe(false);
});

it('an owned kerb car survives stealing another kerb car and does not count against the kerb cap', () => {
  const { fleet } = fleetWithLog();
  const spot = (i: number): Pose => ({ ...LOCAL_SPAWN, x: LOCAL_SPAWN.x + 100_000 + i * 1000, flags: 0 });
  expect(fleet.addKerbCar(7000, spot(0), 'prius', 0, 1)).toBe(true);
  expect(fleet.enter(1, spot(0), 7000, 0)).toBe(true);
  expect(fleet.exit(1, 7000, 1000)).toBe(true);
  expect(fleet.personalCarOf(1)?.id).toBe(7000);
  expect(fleet.kerbCarCount).toBe(0);
  expect(fleet.addKerbCar(7001, spot(1), 'subaru', 2000, 1)).toBe(true);
  expect(fleet.cars.has(7000)).toBe(true);
  for (let i = 2; i < KERB_CARS_MAX + 1; i++) expect(fleet.addKerbCar(7000 + i, spot(i), 'prius', 3000, 100 + i)).toBe(true);
});

it('D1 store: one row per device, last save wins, road cars only', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0051_personal_cars.sql', import.meta.url), 'utf8'));
  const db = { prepare(sql: string) { const st = sqlite.prepare(sql); let b: (string | number)[] = [];
    const w = { bind(...v: (string | number)[]) { b = v; return w; }, async first() { return st.get(...b) ?? null; }, async run() { st.run(...b); return {}; } }; return w; } } as unknown as D1Database;
  expect(await loadPersonalCar(db, 'dev-a')).toBeNull();
  await savePersonalCar(db, 'dev-a', 'prius', { x: 100, y: 5, z: -200, yaw: 300, flags: 0x40 }, 1);
  await savePersonalCar(db, 'dev-a', 'tesla', { x: 150, y: 6, z: -250, yaw: 12, flags: 0 }, 2);
  await savePersonalCar(db, 'dev-a', 'bus', { x: 0, y: 0, z: 0, yaw: 0, flags: 0 }, 3); // ignored
  expect(await loadPersonalCar(db, 'dev-a')).toEqual({ kind: 'tesla', pose: { x: 150, y: 6, z: -250, yaw: 12, flags: 0 }, savedAt: 2 });
  await savePersonalCar(db, 'dev-b', 'supercar', { x: 1, y: 2, z: 3, yaw: 300, flags: 0 }, 4);
  expect((await loadPersonalCar(db, 'dev-b'))?.pose.yaw).toBe(44); // wire yaw is a byte
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM personal_cars').get()).toEqual({ n: 2 });
});
