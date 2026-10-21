import { expect, it, vi } from 'vitest';
import type { Mesh } from 'three';
import { MeshoptDecoder } from 'meshoptimizer';
import { ChunkMeshes, chunkGlb } from '../src/pipeline/meshes';
import { packCompactMesh } from '../src/pipeline/compactMesh';
import { compactMeshHeader, decodeCompactMesh } from '../../../shared/mapMesh';
import { loadCompactMesh } from '../../../web/src/render/chunks/compactMesh';

vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, compactMapAssets: true } };
});

it('retains real quantized triangle data and material names while bounding every runtime upload', async () => {
  const chunk = new ChunkMeshes([0, 0, 256, 256]).chunks.get('0_0')!;
  for (let i = 0; i < 1600; i++) chunk.terrain.add([[1, 2, 1], [1, 3, 5], [5, 4, 1]], [.25, .5, .75]);
  chunk.buildings.add([[5, 2, 5], [5, 12, 5], [9, 12, 5]], [.75, .25, .5]);
  const packed = await packCompactMesh(await chunkGlb(chunk, 256));
  const decoded = await decodeCompactMesh(packed, MeshoptDecoder);
  expect(decoded.map(p => [p.group.name, p.group.triangles])).toEqual([['terrain', 1600], ['buildings', 1]]);
  expect(decoded[0]!.positions.length).toBe(12); // shared three positions, no repeated face normals
  const root = await loadCompactMesh(packed.buffer);
  let count = 0;
  root.traverse(object => {
    // tools/map and web deliberately resolve their own Three workspace dependency.
    const mesh = object as unknown as Mesh; if (!mesh.isMesh) return;
    const geometry = mesh.geometry, bytes = Object.values(geometry.attributes).reduce((n, a) => n + a.array.byteLength, 0);
    expect(bytes).toBeLessThanOrEqual(65536); count += geometry.getAttribute('position').count / 3;
    expect((mesh.material as { name: string }).name).toBe(mesh.name);
    geometry.dispose(); (mesh.material as { dispose(): void }).dispose();
  });
  expect(count).toBe(1601);
  expect(() => compactMeshHeader(packed.subarray(0, -1))).toThrow();
  const invalid = packed.slice(); new DataView(invalid.buffer).setUint32(8, 0xffffffff, true);
  expect(() => compactMeshHeader(invalid)).toThrow();
});
