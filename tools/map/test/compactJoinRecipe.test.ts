import { expect, it } from 'vitest';
import { MeshoptDecoder } from 'meshoptimizer';
import { ChunkMeshes, chunkGlb } from '../src/pipeline/meshes';
import { readGlb, writeGlb } from '../src/glb';
import { appendSurfaceJoinsToGlb } from '../src/pipeline/appendSurfaceJoins';
import { packCompactMesh } from '../src/pipeline/compactMesh';
import { packJoinRecipes } from '../src/pipeline/compactJoinRecipe';
import { decodeJoinRecipe, joinRecipeHeader } from '../../../shared/mapJoinRecipe';
import { decodeCompactMesh } from '../../../shared/mapMesh';

it('restores appended seams with source exceptions and rejects corrupt selection/counts', async () => {
  const chunk = new ChunkMeshes([0, 0, 256, 256]).chunks.get('0_0')!;
  for (let i = 0; i < 64; i++) {
    const x = 4 + i % 8 * 30, z = 4 + Math.floor(i / 8) * 30, y = i * .08;
    chunk.terrain.add([[x, y, z], [x, y, z + 20], [x + 20, y, z]], [.3, .4, .2]);
    chunk.roads.add([[x, y + .12, z], [x, y + .12, z + 20], [x + 20, y + .12, z]], [.15 + i / 1000, .15, .17]);
  }
  const appended = await appendSurfaceJoinsToGlb(await chunkGlb(chunk, 256));
  expect(appended.trianglesAdded).toBeGreaterThan(500);
  const doc = await readGlb(appended.bytes), primitive = doc.getRoot().listNodes().find(n => n.getName() === 'roads_surface_join')!.getMesh()!.listPrimitives()[0]!;
  // An authored source exception must remain explicit; another removed source
  // face must never reappear merely because the algorithm could regenerate it.
  const position = primitive.getAttribute('POSITION')!, xyz = position.getArray()!.slice(); xyz[0]! += 3; position.setArray(xyz);
  const index = primitive.getIndices()!; index.setArray(index.getArray()!.slice(0, -3));
  const source = await writeGlb(doc), compact = await packCompactMesh(source), packed = await packJoinRecipes(source, compact);
  expect(packed.used).toBe(true); expect(packed.joinTriangles).toBeGreaterThan(500); expect(packed.fallbackJoinTriangles).toBeGreaterThan(0);
  const parsed = joinRecipeHeader(packed.bytes); expect(parsed.header.maskBytes).toBeGreaterThan(0);
  const decoded = await decodeJoinRecipe(packed.bytes, MeshoptDecoder, undefined, () => []), original = await decodeCompactMesh(compact, MeshoptDecoder);
  expect(decoded.reduce((sum, m) => sum + m.group.triangles, 0)).toBe(original.reduce((sum, m) => sum + m.group.triangles, 0));
  const invalid = Uint8Array.from(packed.bytes), maskAt = parsed.mask.byteOffset - packed.bytes.byteOffset;
  invalid[maskAt]! ^= 1;
  await expect(decodeJoinRecipe(invalid, MeshoptDecoder, undefined, () => [])).rejects.toThrow('MAP_JOIN_MASK');
  const badVersion = Uint8Array.from(packed.bytes); new DataView(badVersion.buffer).setUint32(4, 2, true);
  expect(() => joinRecipeHeader(badVersion)).toThrow('MAP_JOIN_HEADER');
  expect(() => joinRecipeHeader(packed.bytes.subarray(0, -1))).toThrow();
});
