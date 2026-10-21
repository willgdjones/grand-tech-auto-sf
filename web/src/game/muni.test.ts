import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { Group, Matrix4, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { muniBusIds, sampleMuniBus } from '@gtasf/shared/transit/muni';
import { createFleet } from './fleet';

vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, driving: true, muni: true, cableCars: false, rideAnyVehicle: false } };
});
// Read the actual shipped model; only its browser transport is replaced.
vi.mock('../vehicles/models/vehicle', async importOriginal => {
  const actual = await importOriginal<typeof import('../vehicles/models/vehicle')>();
  return { ...actual, async loadVehicleTemplate(id: Parameters<typeof actual.loadVehicleTemplate>[0]) {
    const bytes = await readFile(new URL(`../../public/assets/vehicles/${id}.glb`, import.meta.url));
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(Uint8Array.from(bytes).buffer, '');
    return actual.createVehicleTemplate(id, gltf);
  } };
});

it('keeps the real six-bus fleet without snapshots, exposes only stopped boarding and distinguishes a parked bus', async () => {
  const parent = new Group(), fleet = await createFleet(parent);
  try {
    expect([...fleet.cars.keys()]).toEqual(muniBusIds);
    const id = muniBusIds[0]!, bus = fleet.cars.get(id)!, pose = bus.muni!, entry = pose.entry;
    const size = bus.cameraBounds.getSize(new Vector3());
    expect(size.z).toBeGreaterThan(8); expect(size.y).toBeGreaterThan(2);
    const start = Date.UTC(2026, 9, 3, 14); let stoppedAt = start;
    while (!sampleMuniBus(id, stoppedAt)!.boarding && stoppedAt < start + 120_000) stoppedAt += 1000;
    expect(sampleMuniBus(id, stoppedAt)!.boarding).toBe(true);
    fleet.sync([], stoppedAt); fleet.setCruiseMode(true);
    fleet.update(1 / 60, 0, undefined, undefined, stoppedAt);
    expect(fleet.cars.size).toBe(6); expect(bus.muni).toBe(pose); expect(bus.data).toBe(entry);
    expect([...fleet.cars.values()].every(car => car.model.root.visible)).toBe(true);
    expect(fleet.nearest(bus.model.root.position, .01)?.data.id).toBe(id);
    expect(bus.model.root.position.x).toBe(entry.x / 100); expect(bus.model.root.position.y).toBe(entry.y / 100);
    const identity = bus.cameraInverse.clone().multiply(bus.model.root.matrixWorld), expected = new Matrix4();
    identity.elements.forEach((value, i) => expect(value).toBeCloseTo(expected.elements[i]!, 8));
    expect(bus.model.cameraTarget.getWorldPosition(new Vector3()).y).toBeGreaterThan(bus.model.root.position.y);
    let movingAt = stoppedAt + 1000;
    while (sampleMuniBus(id, movingAt)!.boarding) movingAt += 1000;
    fleet.update(1 / 60, 0, undefined, undefined, movingAt);
    expect(bus.muni).toBe(pose); expect(bus.data).toBe(entry);
    expect(fleet.nearest(bus.model.root.position, .01)?.data.id).not.toBe(id);
    fleet.sync([{ id: 99, kind: 'bus', driverId: 0, x: 500_000, y: 0, z: 500_000, yaw: 0, flags: 0, speedCmps: 0 }], movingAt);
    expect(fleet.cars.get(99)!.muni).toBeUndefined();
    expect(fleet.nearest({ x: 5000, z: 5000 })?.data.id).toBe(99);
    fleet.sync([], movingAt + 1000); expect(fleet.cars.has(99)).toBe(false); expect(fleet.cars.size).toBe(6);
  } finally { fleet.dispose(); }
  expect(parent.children).toHaveLength(0);
});
