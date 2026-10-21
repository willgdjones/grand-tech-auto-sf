import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { ShapeUtils, Vector2 } from 'three';
import { readGlb, writeGlb } from '../glb';
import { packCompactMesh } from './compactMesh';
import { packBuildingRecipes } from './compactRecipe';
import { COMPACT_MESH_MAGIC, decodeCompactMesh, type CompactMeshGroup, type DecodedMapMesh } from '../../../../shared/mapMesh';
import { MAP_JOIN_MAGIC, decodeJoinRecipe, generateJoinFaces, joinFaceKey, meshJoinFaces, type JoinFace, type JoinRecipeHeader } from '../../../../shared/mapJoinRecipe';
import type { RecipeCollision, RecipeTriangulator } from '../../../../shared/mapRecipe';
const triangulate: RecipeTriangulator = rings => ShapeUtils.triangulateShape(rings[0]!.map(p => new Vector2(p[0], p[1])),
  rings.slice(1).map(r => r.map(p => new Vector2(p[0], p[1]))));
const zip = (bytes: Uint8Array) => gzipSync(bytes, { level: 9 }).length;
const ineligible = (error: unknown) => error instanceof Error && ['MAP_JOIN_LIMIT', 'MAP_JOIN_RANGE', 'MAP_JOIN_SURFACES', 'MAP_JOIN_TRANSFORM'].includes(error.message);
function allFaces(meshes: DecodedMapMesh[]) {
  return meshes.flatMap(mesh => meshJoinFaces(mesh).map(face => JSON.stringify([mesh.group.name, mesh.group.translation, mesh.group.scale, joinFaceKey(face)]))).sort();
}
async function explicitFaces(faces: JoinFace[], transform: CompactMeshGroup): Promise<Uint8Array> {
  if (!faces.length) return new Uint8Array();
  const vertices = new Map<string, number>(), xyz: number[] = [], indices: number[] = [], rgb: number[] = [];
  for (const face of faces) {
    rgb.push(...face.rgb, 0);
    for (const p of face.points) { const key = p.join(','); if (!vertices.has(key)) { vertices.set(key, vertices.size); xyz.push(...p, 0); } indices.push(vertices.get(key)!); }
  }
  await MeshoptEncoder.ready;
  const positions = new Int16Array(xyz), order = new Uint32Array(indices);
  const streams = [MeshoptEncoder.encodeVertexBuffer(new Uint8Array(positions.buffer), vertices.size, 8),
    MeshoptEncoder.encodeIndexBuffer(new Uint8Array(order.buffer), order.length, 4), MeshoptEncoder.encodeVertexBuffer(new Uint8Array(rgb), faces.length, 4)];
  const group: CompactMeshGroup = { ...transform, vertices: vertices.size, triangles: faces.length, streams: streams.map(b => b.length) as [number, number, number] };
  const json = Buffer.from(JSON.stringify([group])), framing = Buffer.alloc(16);
  framing.writeUInt32LE(COMPACT_MESH_MAGIC); framing.writeUInt32LE(1, 4); framing.writeUInt32LE(json.length, 8);
  const bytes = Buffer.concat([framing, json, ...streams]);
  const decoded = await decodeCompactMesh(bytes, MeshoptDecoder);
  assert.deepEqual(meshJoinFaces(decoded[0]!).map(joinFaceKey).sort(), faces.map(joinFaceKey).sort());
  return bytes;
}

/** Reconstruct only appended source seam faces, retaining every unmatched face.
 * Both alternatives are fully framed and compressed before selecting the smaller.
 * All oriented quantized geometry/RGB/transforms are checked before returning.
 */
export async function packJoinRecipes(source: Uint8Array, compactAll: Uint8Array<ArrayBuffer>, collisionBytes?: Uint8Array) {
  const baseline = collisionBytes ? await packBuildingRecipes(compactAll, collisionBytes)
    : { bytes: compactAll, used: false, recipeTriangles: 0, fallbackTriangles: 0 };
  const ordinary = { bytes: baseline.bytes, used: false, joinTriangles: 0, fallbackJoinTriangles: 0,
    buildingRecipesUsed: baseline.used, recipeTriangles: baseline.recipeTriangles, fallbackTriangles: baseline.fallbackTriangles };
  const doc = await readGlb(source), sourceFaces: JoinFace[] = [];
  const appended = doc.getRoot().listNodes().filter(node => node.getName() === 'roads_surface_join');
  if (!appended.length) return ordinary;
  for (const node of appended) {
    const mesh = node.getMesh(); assert(mesh?.getName() === 'roads');
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute('POSITION')!.getArray(), colors = primitive.getAttribute('COLOR_0')!.getArray(), indices = primitive.getIndices()!.getArray();
      assert(positions instanceof Int16Array && colors instanceof Uint8Array && indices);
      for (let t = 0; t < indices.length; t += 3) sourceFaces.push({
        points: [0, 1, 2].map(c => Array.from(positions.subarray(indices[t + c]! * 3, indices[t + c]! * 3 + 3))),
        rgb: Array.from(colors.subarray(indices[t]! * 3, indices[t]! * 3 + 3)),
      });
    }
    node.dispose();
  }
  ordinary.fallbackJoinTriangles = sourceFaces.length;
  const compactBase = await packCompactMesh(await writeGlb(doc)), decodedBase = await decodeCompactMesh(compactBase, MeshoptDecoder);
  let generated: ReturnType<typeof generateJoinFaces>;
  try { generated = generateJoinFaces(decodedBase); }
  catch (error) { if (ineligible(error)) return ordinary; throw error; }
  const { faces, transform } = generated;
  const remaining = new Map<string, JoinFace[]>(), mask = new Uint8Array(Math.ceil(faces.length / 8));
  for (const face of sourceFaces) { const key = joinFaceKey(face), list = remaining.get(key) ?? []; list.push(face); remaining.set(key, list); }
  let selected = 0;
  for (const [i, face] of faces.entries()) if (remaining.get(joinFaceKey(face))?.pop()) { selected++; mask[i >> 3]! |= 1 << (i & 7); }
  if (!selected) return ordinary;
  const fallback = [...remaining.values()].flat(), extra = await explicitFaces(fallback, transform);
  const base = collisionBytes ? await packBuildingRecipes(compactBase, collisionBytes)
    : { bytes: compactBase, used: false, recipeTriangles: 0, fallbackTriangles: 0 };
  const selection = selected === faces.length ? new Uint8Array() : mask;
  const header: JoinRecipeHeader = { baseBytes: base.bytes.length, generatedFaces: faces.length, selectedFaces: selected,
    maskBytes: selection.length, fallbackBytes: extra.length };
  const json = Buffer.from(JSON.stringify(header)), framing = Buffer.alloc(16);
  framing.writeUInt32LE(MAP_JOIN_MAGIC); framing.writeUInt32LE(1, 4); framing.writeUInt32LE(json.length, 8);
  const bytes = Buffer.concat([framing, json, base.bytes, selection, extra]);
  let decoded: DecodedMapMesh[];
  try { decoded = await decodeJoinRecipe(bytes, MeshoptDecoder, collisionBytes ? JSON.parse(new TextDecoder().decode(collisionBytes)) as RecipeCollision : undefined, triangulate); }
  catch (error) { if (ineligible(error)) return ordinary; throw error; }
  assert.deepEqual(allFaces(decoded), allFaces(await decodeCompactMesh(compactAll, MeshoptDecoder)), 'Join recipe changed source oriented/color/transform faces');
  if (zip(bytes) >= zip(baseline.bytes)) return ordinary;
  return { bytes, used: true, joinTriangles: selected, fallbackJoinTriangles: fallback.length,
    buildingRecipesUsed: base.used, recipeTriangles: base.recipeTriangles, fallbackTriangles: base.fallbackTriangles };
}
