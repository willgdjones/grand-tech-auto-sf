import { expect, it } from 'vitest';
import { MeshoptDecoder } from 'meshoptimizer';
import { ShapeUtils, Vector2 } from 'three';
import { packCompactMesh } from '../src/pipeline/compactMesh';
import { packHeightPredictedMesh } from '../src/pipeline/compactHeightPredictor';
import { addTerrainMeshes, ChunkMeshes, chunkGlb, type Cut } from '../src/pipeline/meshes';
import { SpatialIndex } from '../src/pipeline/geometry';
import { createHeightfield, encodeHeightfield } from '../src/pipeline/heightfield';
import { decodeCompactMesh } from '../../../shared/mapMesh';
import { decodeHeightPredictedMesh } from '../../../shared/mapHeightPredictor';
import { MAP_RECIPE_MAGIC } from '../../../shared/mapRecipe';
import { digest } from '../src/pipeline/sources';

it('restores every ordered mesh word from a nested recipe and rejects a mismatched contact grid', async () => {
  const bounds: [number, number, number, number] = [0, 0, 256, 256];
  const terrain = { sample: (x: number, z: number) => 20 + 10 * Math.sin(x * .07) + 8 * Math.cos(z * .08) };
  const meshes = new ChunkMeshes(bounds); addTerrainMeshes(meshes, terrain, new SpatialIndex<Cut>(32), 4, 4);
  const compact = await packCompactMesh(await chunkGlb(meshes.chunks.get('0_0')!, 256));
  const height = encodeHeightfield(createHeightfield(bounds, terrain, 4));
  const collision = { origin: [0, 0, 0], buildings: [] };
  const json = Buffer.from(JSON.stringify({ collisionSha256: digest(Buffer.from(JSON.stringify(collision) + '\n')),
    translation: [128, 0, 128], scale: [128, 1, 128], recipes: [] })), prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(MAP_RECIPE_MAGIC); prefix.writeUInt32LE(1, 4); prefix.writeUInt32LE(json.length, 8);
  const source = Buffer.concat([prefix, json, compact]), packed = await packHeightPredictedMesh(source, height);
  expect(packed.used).toBe(true); expect(packed.predictedVertices).toBeGreaterThan(1000);
  const triangulate = (rings: number[][][]) => ShapeUtils.triangulateShape(rings[0]!.map(p => new Vector2(p[0], p[1])),
    rings.slice(1).map(r => r.map(p => new Vector2(p[0], p[1]))));
  const before = await decodeCompactMesh(compact, MeshoptDecoder);
  const after = await decodeHeightPredictedMesh(packed.bytes, height, MeshoptDecoder, collision, triangulate);
  expect(after).toHaveLength(before.length);
  for (const [i, mesh] of before.entries()) {
    expect(after[i]!.positions).toEqual(mesh.positions); expect(after[i]!.indices).toEqual(mesh.indices); expect(after[i]!.colors).toEqual(mesh.colors);
  }
  const wrong = Uint8Array.from(height); wrong[32]! ^= 1;
  await expect(decodeHeightPredictedMesh(packed.bytes, wrong, MeshoptDecoder, collision, triangulate)).rejects.toThrow('MAP_HEIGHT_FIELD_HASH');
}, 30_000);
