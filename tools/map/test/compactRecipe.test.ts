import { expect, it, vi } from 'vitest';
import { MeshoptDecoder } from 'meshoptimizer';
import { ShapeUtils, Vector2, type Mesh } from 'three';
import { addBuildings, ChunkMeshes, chunkGlb } from '../src/pipeline/meshes';
import type { Building } from '../src/pipeline/types';
import { packCompactMesh } from '../src/pipeline/compactMesh';
import { packBuildingRecipes } from '../src/pipeline/compactRecipe';
import { buildingRecipeHeader, decodeBuildingRecipe, type RecipeCollision } from '../../../shared/mapRecipe';
import { decodeCompactMesh } from '../../../shared/mapMesh';
import { loadCompactMesh } from '../../../web/src/render/chunks/compactMesh';

vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, compactMapAssets: true } };
});

it('reuses surveyed courtyards and clipped rings, retains unmatched geometry, and rejects a different collision cohort', async () => {
  const meshes = new ChunkMeshes([-512, -256, -256, 0]), chunk = meshes.chunks.get('-2_-1')!;
  const buildings: Building[] = [], collision: RecipeCollision = { origin: [-512, 0, -256], buildings: [] };
  for (let i = 0; i < 100; i++) {
    const x = -513 + i % 10 * 26, z = -259 + Math.floor(i / 10) * 26, h = 5.231 + i * .731;
    const polygon: Building['polygon'] = [[[x, z], [x + 10.193, z + .271], [x + 12.137, z + 11.529], [x + 6.821, z + 14.333], [x - .897, z + 7.321]]];
    if (i === 22) polygon.push([[x + 3, z + 4], [x + 3, z + 7], [x + 6, z + 7], [x + 6, z + 4]]);
    const building: Building = { id: String(i), polygon, height: h, base: 0, foundation: -2, heightSource: 'datasf',
      landuse: '', colour: [((i * 73) % 255) / 255, ((i * 37) % 255) / 255, ((i * 13) % 255) / 255] };
    buildings.push(building);
    collision.buildings.push({ minY: -2, maxY: h, rings: polygon.map(r => r.map(([a, b]) => [Math.round((a + 512) * 1000) / 1000, Math.round((b + 256) * 1000) / 1000])) });
  }
  addBuildings(meshes, buildings, 0);
  chunk.buildings.add([[-440, 10, -210], [-436, 16, -210], [-432, 10, -207]], [.2, .4, .6]); // unmatched non-extruded roof
  chunk.structures.add([[-451, 1, -251], [-451, 5, -250], [-451, 1, -248]], [.3, .4, .5]);
  const source = await packCompactMesh(await chunkGlb(chunk, 256));
  const packed = await packBuildingRecipes(source, new TextEncoder().encode(JSON.stringify(collision) + '\n'));
  expect(packed.used).toBe(true); expect(packed.recipeTriangles).toBeGreaterThan(chunk.buildings.indices.length / 6);
  expect(packed.fallbackTriangles).toBeGreaterThan(0);
  const decoded = await decodeBuildingRecipe(packed.bytes, collision, rings => ShapeUtils.triangulateShape(
    rings[0]!.map(p => new Vector2(p[0], p[1])), rings.slice(1).map(r => r.map(p => new Vector2(p[0], p[1])))), MeshoptDecoder);
  const original = await decodeCompactMesh(source, MeshoptDecoder);
  expect(decoded.reduce((n, m) => n + m.group.triangles, 0)).toBe(original.reduce((n, m) => n + m.group.triangles, 0));
  expect(decoded.find(m => m.group.name === 'structures')?.positions).toEqual(original.find(m => m.group.name === 'structures')?.positions);
  const root = await loadCompactMesh(packed.bytes.buffer, collision);
  let triangles = 0;
  root.traverse(object => {
    const mesh = object as unknown as Mesh; if (!mesh.isMesh) return;
    expect(Object.values(mesh.geometry.attributes).reduce((n, a) => n + a.array.byteLength, 0)).toBeLessThanOrEqual(65536);
    triangles += mesh.geometry.getAttribute('position').count / 3;
    mesh.geometry.dispose(); (mesh.material as { dispose(): void }).dispose();
  });
  expect(triangles).toBe(chunk.buildings.indices.length / 3 + 1);
  await expect(loadCompactMesh(packed.bytes.buffer)).rejects.toThrow('COLLISION_REQUIRED');
  await expect(loadCompactMesh(packed.bytes.buffer, { ...collision, origin: [0, 0, 0] })).rejects.toThrow('COLLISION_HASH');
  expect(() => buildingRecipeHeader(packed.bytes.subarray(0, 20))).toThrow();
});
