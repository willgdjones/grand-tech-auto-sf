import { expect, it } from 'vitest';
import { chunkGlb, ChunkMeshes, upward } from '../src/pipeline/meshes';
import { appendSurfaceJoinsToGlb } from '../src/pipeline/appendSurfaceJoins';
import { readGlb } from '../src/glb';
import type { Document } from '@gltf-transform/core';

function meshes(doc: Document) {
  return doc.getRoot().listNodes().map(node => ({
    matrix: node.getMatrix(), name: node.getName(), primitives: node.getMesh()!.listPrimitives().map(p => ({
      material: p.getMaterial()!.getName(), mode: p.getMode(),
      attributes: p.listSemantics().map(semantic => {
        const a = p.getAttribute(semantic)!;
        return { semantic, type: a.getType(), normalized: a.getNormalized(), values: [...a.getArray()!] };
      }), indices: [...p.getIndices()!.getArray()!],
    })),
  }));
}

it('loads appended joins while preserving every source mesh byte, transform and material', async () => {
  const chunks = new ChunkMeshes([0, 0, 256, 256]), chunk = chunks.chunks.get('0_0')!;
  chunk.terrain.add(upward([0, 0, 4], [8, 0, 4], [4, 0, 8]), [.3, .4, .2]);
  chunk.roads.add(upward([0, .1, 4], [8, .1, 4], [4, .1, 0]), [.2, .21, .22]);
  chunk.buildings.add([[12, 0, 0], [12, 8, 0], [12, 8, 8]], [.4, .3, .2]);
  const input = await chunkGlb(chunk, 256), before = meshes(await readGlb(input));
  const repair = await appendSurfaceJoinsToGlb(input), after = await readGlb(repair.bytes);
  expect(repair.trianglesAdded).toBeGreaterThan(0);
  expect(meshes(after).slice(0, before.length)).toEqual(before);
  const added = after.getRoot().listNodes().slice(before.length);
  expect(added.length).toBeGreaterThan(0);
  let count = 0;
  for (const node of added) for (const p of node.getMesh()!.listPrimitives()) {
    expect(p.getMaterial()!.getName()).toBe('roads');
    expect(p.getAttribute('POSITION')!.getCount()).toBeLessThanOrEqual(3000);
    expect(p.listAttributes().reduce((sum, a) => sum + a.getByteLength(), 0) + p.getIndices()!.getByteLength()).toBeLessThan(64 * 1024);
    count += p.getIndices()!.getCount() / 3;
  }
  expect(count).toBe(repair.trianglesAdded);
});
