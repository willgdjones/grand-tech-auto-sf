import { expect, it } from 'vitest';
import { ShapeUtils, Vector2 } from 'three';
import { MeshoptDecoder } from 'meshoptimizer';
import { generateSourceSurface, decodeSurfaceContainer } from '../../../shared/mapSurfaceRecipe';
import { MAP_JOIN_MAGIC, generateJoinFaces } from '../../../shared/mapJoinRecipe';
import { MAP_RECIPE_MAGIC, type RecipeTriangulator } from '../../../shared/mapRecipe';
import { decodeCompactMesh, type DecodedMapMesh } from '../../../shared/mapMesh';
import type { Road } from '../../../shared/mapSurfaceSourceV1';
import { encodeHeightfield, createHeightfield } from '../src/pipeline/heightfield';
import { digest } from '../src/pipeline/sources';
import { packHeightPredictedMesh } from '../src/pipeline/compactHeightPredictor';
import { encodeSurfaceFallback, encodeSurfacePlan, packSurfaceRecipes, surfaceFaceMultiset, surfaceFrame } from '../src/pipeline/compactSurfaceRecipe';

it('recovers source hills, colored exceptions and nested seams through the actual surface decoder', async () => {
  const bounds: [number, number, number, number] = [0, 0, 256, 256], roads: Road[] = [];
  for (let i = 0; i < 7; i++) for (const axis of [0, 1]) roads.push({ id: `${axis}:${i}`, width: 6.4, tags: { highway: 'residential' },
    points: Array.from({ length: 9 }, (_, j) => ({ id: `${axis}:${i}:${j}`, x: axis ? j * 32 : 24 + i * 32, z: axis ? 24 + i * 32 : j * 32 })) });
  const input = { bounds, carve: true, step: 16 as const, roads, pavements: [] }, plan = encodeSurfacePlan(roads, []);
  const generated = generateSourceSurface(plan, input), hill = (x: number, z: number) => 8 + x * .018 + z * .006 + Math.sin(x / 24) * .25;
  const height = encodeHeightfield(createHeightfield(bounds, { sample: hill }, 4));
  const groups: DecodedMapMesh[] = (['terrain', 'roads'] as const).map(name => {
    const mesh = generated[name], positions = new Int16Array(mesh.positions.length / 3 * 4), translation: [number, number, number] = [128, 16, 128], scale: [number, number, number] = [128, 16, 128];
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      const x = mesh.positions[v * 3]!, z = mesh.positions[v * 3 + 2]!, y = hill(x, z) + (name === 'roads' ? .1 : 0);
      positions.set([Math.round((x - 128) / 128 * 32767), Math.round((y - 16) / 16 * 32767), Math.round((z - 128) / 128 * 32767)], v * 4);
    }
    const indices = Uint32Array.from(mesh.indices), colors = new Uint8Array(indices.length / 3 * 4);
    for (let t = 0; t < colors.length / 4; t++) colors.set(name === 'roads' ? [52, 54, 56] : [77, 103, 65], t * 4);
    return { group: { name, translation, scale, vertices: positions.length / 4, triangles: indices.length / 3, streams: [1, 1, 1] }, positions, indices, colors };
  });
  // A source-authored exception is intentionally absent from the source plan.
  const road = groups[1]!, extra = new Int16Array(road.positions.length + 12); extra.set(road.positions);
  extra.set([173, -13001, 319, 0, 419, -12823, 911, 0, 817, -12947, 473, 0], road.positions.length);
  const order = new Uint32Array(road.indices.length + 3); order.set(road.indices); order.set([road.group.vertices, road.group.vertices + 1, road.group.vertices + 2], road.indices.length);
  const rgb = new Uint8Array(road.colors.length + 4); rgb.set(road.colors); rgb.set([207, 61, 31, 0], road.colors.length);
  groups[1] = { group: { ...road.group, vertices: road.group.vertices + 3, triangles: road.group.triangles + 1 }, positions: extra, indices: order, colors: rgb };
  const compact = await encodeSurfaceFallback(groups), decoded = await decodeCompactMesh(compact, MeshoptDecoder);
  const collision = new TextEncoder().encode(JSON.stringify({ version: 1, origin: [0, 0, 0], buildings: [] }) + '\n');
  const building = surfaceFrame(MAP_RECIPE_MAGIC, { collisionSha256: digest(collision), translation: [128, 16, 128], scale: [128, 16, 128], recipes: [] }, [compact]);
  const joins = generateJoinFaces(decoded);
  const joined = surfaceFrame(MAP_JOIN_MAGIC, { baseBytes: building.length, generatedFaces: joins.faces.length, selectedFaces: joins.faces.length, maskBytes: 0, fallbackBytes: 0 }, [building]);
  const predicted = await packHeightPredictedMesh(joined, height), source = predicted.bytes;
  const packed = await packSurfaceRecipes(source, height, collision, input);
  expect(packed.used).toBe(true); expect(packed.selectedFaces).toBeGreaterThan(1000); expect(packed.fallbackFaces).toBeGreaterThan(0);
  const triangulate: RecipeTriangulator = rings => ShapeUtils.triangulateShape(rings[0]!.map(p => new Vector2(p[0], p[1])), rings.slice(1).map(r => r.map(p => new Vector2(p[0], p[1]))));
  const buildings = JSON.parse(new TextDecoder().decode(collision));
  const before = await decodeSurfaceContainer(source, height, MeshoptDecoder, buildings, triangulate), after = await decodeSurfaceContainer(packed.bytes, height, MeshoptDecoder, buildings, triangulate);
  expect(surfaceFaceMultiset(after)).toEqual(surfaceFaceMultiset(before));
  const corrupt = Uint8Array.from(height); corrupt[32]! ^= 1;
  await expect(decodeSurfaceContainer(packed.bytes, corrupt, MeshoptDecoder, buildings, triangulate)).rejects.toThrow('MAP_SURFACE_HEIGHT_HASH');
}, 30_000);
