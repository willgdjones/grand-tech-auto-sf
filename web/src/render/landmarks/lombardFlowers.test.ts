import { expect, it, vi } from 'vitest';
import { InstancedMesh, Matrix4, PerspectiveCamera, Texture, Vector3 } from 'three';
import { createLombardFlowerBeds, LOMBARD_LOCAL_PATH } from './neighbourhoods';
import { createLombardGarden, gardenRoadDistance } from './lombardFlowers';
import { disposeLandmark } from './primitives';
import { graphicsPreset } from '../graphicsPreset';

vi.mock('../graphicsPreset', () => ({ graphicsPreset: vi.fn(() => 'hd') }));
// Only the DOM paint surface is replaced. Real Three geometry, instances, LOD and terrain hooks run.
const maps: Texture[] = [];
vi.mock('./lombardFlowerTextures', async importOriginal => ({
  ...await importOriginal<typeof import('./lombardFlowerTextures')>(),
  createLombardFlowerTextures: () => {
    const make = () => { const t = new Texture(); maps.push(t); return t; };
    return { foliage: make(), flowers: make(), soil: make(), hedge: make() };
  },
}));

it('keeps the actual Lombard road clear, resamples every bed, bounds Low/LOD work and releases resources', () => {
  const hd = createLombardGarden({ path: LOMBARD_LOCAL_PATH, detail: 'near', heightAt: () => 8 });
  vi.mocked(graphicsPreset).mockReturnValue('low');
  const low = createLombardGarden({ path: LOMBARD_LOCAL_PATH, detail: 'near', heightAt: () => 8 });
  expect(hd.userData.gardenDetail).toBe('hd'); expect(low.userData.gardenDetail).toBe('low');
  const matrix = new Matrix4(), point = new Vector3();
  let hdTriangles = 0, lowTriangles = 0;
  for (const [root, isLow] of [[hd, false], [low, true]] as const) {
    expect(root.children).toHaveLength(5);
    for (const child of root.children) {
      expect(child).toBeInstanceOf(InstancedMesh);
      const mesh = child as InstancedMesh;
      const n = mesh.count * (mesh.geometry.index?.count ?? 0) / 3;
      if (isLow) lowTriangles += n; else hdTriangles += n;
      const vertices = mesh.geometry.getAttribute('position');
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        for (let v = 0; v < vertices.count; v++) {
          point.fromBufferAttribute(vertices, v).applyMatrix4(matrix);
          expect(gardenRoadDistance(LOMBARD_LOCAL_PATH, point.x, point.z)).toBeGreaterThan(2.65);
        }
      }
      mesh.getMatrixAt(0, matrix); const previousY = matrix.elements[13]!;
      const geometry = mesh.geometry;
      root.userData.resampleTerrain(() => isLow ? 10 : 11);
      mesh.getMatrixAt(0, matrix);
      expect(matrix.elements[13]).toBeCloseTo(previousY + (isLow ? 2 : 3), 4);
      expect(mesh.geometry).toBe(geometry);
      root.userData.resampleTerrain(() => null);
      root.userData.resampleTerrain(() => Number.NaN);
      mesh.getMatrixAt(0, matrix); expect(Number.isFinite(matrix.elements[13])).toBe(true);
      // Return to initial surface so every batch independently verifies its complete update.
      root.userData.resampleTerrain(() => 8);
    }
  }
  expect(lowTriangles).toBeLessThan(hdTriangles); expect(hdTriangles).toBeLessThan(35_000);
  const flowers = hd.getObjectByName('Lombard hydrangea florets') as InstancedMesh;
  const camera = new PerspectiveCamera(); camera.position.set(300, 30, 0);
  const render = flowers.onBeforeRender as (...args: unknown[]) => void;
  render(null, null, camera); expect(flowers.count).toBe(flowers.userData.farCount);
  camera.position.set(0, 2, 0); render(null, null, camera); expect(flowers.count).toBe(flowers.userData.fullCount);
  const textureDisposals = maps.map(map => vi.spyOn(map, 'dispose'));
  const bufferDisposals = [...hd.children, ...low.children].map(mesh => vi.spyOn(mesh as InstancedMesh, 'dispose'));
  disposeLandmark(hd); disposeLandmark(low);
  for (const dispose of [...textureDisposals, ...bufferDisposals]) expect(dispose).toHaveBeenCalledOnce();
  vi.mocked(graphicsPreset).mockReturnValue('hd');
});

it('omits all flower-bed geometry and texture creation from the playtest entry point', () => {
  const before = maps.length, heightAt = vi.fn(() => 8);
  for (const detail of ['near', 'far'] as const) {
    const garden = createLombardFlowerBeds({ detail, heightAt });
    expect(garden.children).toHaveLength(0);
    expect(garden.userData.resampleTerrain).toBeUndefined();
  }
  expect(maps).toHaveLength(before);
  expect(heightAt).not.toHaveBeenCalled();
});
