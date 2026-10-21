import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { Box3, LOD, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { VehicleAssetId } from '../../assets/manifest';
import { createVehicleTemplate, type VehicleTemplate } from './vehicle';
import { createStageCarSlot, stageCarForRound } from './stageCar';

it('loads shipped stage cars, keeps a valid car through failures, and disposes late upgrades after demotion or teardown', async () => {
  const templateFor = async (id: VehicleAssetId) => {
    const bytes = await readFile(new URL(`../../../public/assets/vehicles/${id}.glb`, import.meta.url));
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(Uint8Array.from(bytes).buffer, '');
    return createVehicleTemplate(id, gltf);
  };
  const pending: { id: VehicleAssetId; resolve(value: VehicleTemplate | undefined): void }[] = [];
  const load = vi.fn((id: VehicleAssetId) => new Promise<VehicleTemplate | undefined>(resolve => pending.push({ id, resolve })));
  const beforeReplace = vi.fn(), failed = vi.fn();
  const slot = createStageCarSlot({ beforeReplace, failed, changed: () => {} }, load);
  for (const id of ['pre-seed', 'series-a', 'series-d', 'unicorn', 'decacorn']) {
    const choice = stageCarForRound({ id })!;
    expect(choice).not.toBeNull();
    const previous = slot.template, oldDispose = previous && vi.spyOn(previous, 'dispose');
    slot.select(choice);
    if (slot.busy) {
      const next = pending.shift()!;
      expect(next.id).toBe(choice.assetId);
      next.resolve(await templateFor(next.id));
      await vi.waitFor(() => expect(slot.busy).toBe(false));
      if (oldDispose) expect(oldDispose).toHaveBeenCalledOnce();
    }
    expect(slot.template?.assetId).toBe(choice.assetId);
    const instance = slot.template!.createInstance();
    instance.update(.016, 12, .1);
    const size = new Box3().setFromObject(instance.root).getSize(new Vector3());
    expect([size.x, size.y, size.z].every(value => Number.isFinite(value) && value > 0)).toBe(true);
    expect(instance.root.children.some(child => child instanceof LOD)).toBe(true);
    instance.dispose();
  }
  const executive = slot.template!;
  slot.select(stageCarForRound({ id: 'pre-seed' }));
  pending.shift()!.resolve(undefined);
  await vi.waitFor(() => expect(slot.busy).toBe(false));
  expect(failed).toHaveBeenCalledOnce();
  expect(slot.template).toBe(executive); // Failed replacement never hides the working car.
  slot.select(stageCarForRound({ id: 'pre-seed' }));
  const delayed = pending.shift()!, late = await templateFor(delayed.id), lateDispose = vi.spyOn(late, 'dispose');
  slot.select(stageCarForRound({ id: 'bootstrapping' }));
  expect(slot.template).toBeUndefined();
  delayed.resolve(late);
  await vi.waitFor(() => expect(lateDispose).toHaveBeenCalledOnce());
  slot.select(stageCarForRound({ id: 'series-a' }));
  const last = pending.shift()!, afterDestroy = await templateFor(last.id), disposed = vi.spyOn(afterDestroy, 'dispose');
  slot.destroy(); slot.destroy(); last.resolve(afterDestroy);
  await vi.waitFor(() => expect(disposed).toHaveBeenCalledOnce());
  expect(slot.template).toBeUndefined();
  expect(beforeReplace).toHaveBeenCalled();
});
