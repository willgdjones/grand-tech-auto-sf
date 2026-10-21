import { expect, it, vi } from 'vitest';
import { muniBusIds, sampleMuniBus, MUNI_CAPACITY } from '@gtasf/shared/transit/muni';
import { WorldVehicles } from './vehicles';

vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, muni: true } };
});
const { WorldCableCars } = await import('./cableCars');

it('boards Muni 39 only while stopped, nearby and with a seat; riders follow the bus uphill and exit cleanly', () => {
  const epoch = Date.UTC(2026, 9, 5, 16), id = muniBusIds[0]!;
  let stopped = epoch, moving = epoch;
  while (!sampleMuniBus(id, stopped)!.boarding) stopped += 500;
  while (sampleMuniBus(id, moving)!.boarding || sampleMuniBus(id, moving)!.entry.speedCmps === 0) moving += 500;
  const fleet = new WorldVehicles({ emit: () => undefined, pose: () => undefined }), service = new WorldCableCars(fleet);
  const at = sampleMuniBus(id, stopped)!.entry, near = { x: at.x + 300, y: at.y, z: at.z, yaw: 0, flags: 0 };
  // Remote and moving boarding are rejected.
  expect(service.board(1, { ...near, x: at.x + 5_000 }, id, stopped)).toBe(false);
  const m = sampleMuniBus(id, moving)!.entry;
  expect(service.board(1, { x: m.x, y: m.y, z: m.z, yaw: 0, flags: 0 }, id, moving)).toBe(false);
  // Stopped, within reach: boards up to capacity, then full.
  for (let p = 1; p <= MUNI_CAPACITY; p++) expect(service.board(p, near, id, stopped)).toBe(true);
  expect(service.board(MUNI_CAPACITY + 1, near, id, stopped)).toBe(false);
  // Occupants ride with the time-derived bus; one exit leaves the others seated.
  service.step(stopped + 60_000);
  expect(fleet.occupants.get(1)).toBe(id);
  expect(fleet.exit(1, id, stopped + 60_000)).toBeTruthy();
  expect(fleet.occupants.has(1)).toBe(false);
  expect(fleet.occupants.get(2)).toBe(id);
});
