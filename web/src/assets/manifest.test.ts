import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AnimationMixer, Box3, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { modelAssets, avatarClips } from './manifest';

describe('shipped CC0 models', () => {
  it('matches the manifest, respects vehicle budgets, and decodes as self-contained GLBs', async () => {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    for (const definition of Object.values(modelAssets)) {
      const bytes = await readFile(new URL(`../../public${definition.url}`, import.meta.url));
      expect(bytes.byteLength, definition.url).toBe(definition.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), definition.url).toBe(definition.sha256);
      if (definition.kind === 'vehicle') expect(bytes.byteLength).toBeLessThan(300_000);
      const jsonLength = bytes.readUInt32LE(12);
      const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
      expect(json.extensionsRequired).toContain('EXT_meshopt_compression');
      expect(json.extensionsRequired).toContain('KHR_mesh_quantization');
      expect(json.images ?? []).toHaveLength(0);
      expect(json.buffers.every((buffer: { uri?: string }) => !buffer.uri)).toBe(true);
      const gltf = await loader.parseAsync(Uint8Array.from(bytes).buffer, '');
      if (definition.kind === 'vehicle') {
        const bounds = new Box3().setFromObject(gltf.scene, true), size = bounds.getSize(new Vector3());
        expect(bounds.min.y).toBeGreaterThan(-.002);
        expect(bounds.min.y).toBeLessThan(.002);
        expect(size.x).toBeGreaterThan(1.5);
        expect(size.z).toBeGreaterThan(4);
        if (definition.url.includes('robotaxi')) expect(gltf.scene.getObjectByName('lidar')).toBeDefined();
      } else {
        expect(gltf.animations.map(clip => clip.name).sort()).toEqual([...avatarClips].sort());
        const mixer = new AnimationMixer(gltf.scene);
        for (const clip of gltf.animations) {
          mixer.stopAllAction(); mixer.clipAction(clip).play(); mixer.setTime(clip.duration / 3);
          gltf.scene.updateMatrixWorld(true);
          gltf.scene.traverse(object => { if (object instanceof SkinnedMesh) { object.skeleton.update(); object.computeBoundingBox(); } });
          const bounds = new Box3().setFromObject(gltf.scene, true), size = bounds.getSize(new Vector3());
          expect([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite), clip.name).toBe(true);
          expect(size.y, clip.name).toBeGreaterThan(1.1);
          expect(size.y, clip.name).toBeLessThan(1.9);
          expect(size.x, clip.name).toBeLessThan(1);
          expect(bounds.min.y, clip.name).toBeGreaterThan(-.08);
        }
      }
    }
  });
});
