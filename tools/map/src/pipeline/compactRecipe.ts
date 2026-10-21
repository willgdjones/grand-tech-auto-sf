import { gzipSync } from 'node:zlib';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { ShapeUtils, Vector2 } from 'three';
import { COMPACT_MESH_LIMIT, COMPACT_MESH_MAGIC, compactMeshHeader, decodeCompactMesh, type CompactMeshGroup, type DecodedMapMesh } from '../../../../shared/mapMesh';
import { MAP_RECIPE_MAGIC, buildingRecipeFaces, decodeBuildingRecipe, type BuildingRecipeHeader, type RecipeCollision, type RecipeTriangulator } from '../../../../shared/mapRecipe';
import { digest } from './sources';

const triangulate: RecipeTriangulator = rings => ShapeUtils.triangulateShape(rings[0]!.map(p => new Vector2(p[0], p[1])),
  rings.slice(1).map(r => r.map(p => new Vector2(p[0], p[1]))));
function faceKey(points: number[][]) {
  const corners = points.map(p => p.join(','));
  return corners.map((_, i) => [corners[i], corners[(i + 1) % 3], corners[(i + 2) % 3]].join(';')).sort()[0]!;
}
function keyAt(mesh: DecodedMapMesh, t: number) {
  return faceKey([0, 1, 2].map(c => Array.from(mesh.positions.subarray(mesh.indices[t * 3 + c]! * 4, mesh.indices[t * 3 + c]! * 4 + 3))));
}
function orientedColoredFaces(meshes: DecodedMapMesh[]) {
  const faces = [];
  for (const mesh of meshes) for (let t = 0; t < mesh.group.triangles; t++) faces.push(JSON.stringify([
    mesh.group.name, mesh.group.translation, mesh.group.scale, keyAt(mesh, t), ...mesh.colors.subarray(t * 4, t * 4 + 3),
  ]));
  return faces.sort();
}
function fallbackMesh(source: Uint8Array, mesh: DecodedMapMesh, selected: number[]): Uint8Array<ArrayBuffer> {
  const parsed = compactMeshHeader(source), groups: CompactMeshGroup[] = [], body: Uint8Array[] = []; let at = parsed.dataOffset;
  for (const group of parsed.groups) {
    const length = group.streams.reduce((sum, n) => sum + n, 0);
    if (group.name !== 'buildings') { groups.push(group); body.push(source.subarray(at, at + length)); }
    at += length;
  }
  if (selected.length) {
    const xyz: number[] = [], faces: number[] = [], rgb: number[] = [], remap = new Map<number, number>();
    for (const t of selected) {
      rgb.push(...mesh.colors.subarray(t * 4, t * 4 + 4));
      for (let c = 0; c < 3; c++) {
        const old = mesh.indices[t * 3 + c]!; let index = remap.get(old);
        if (index === undefined) { index = remap.size; remap.set(old, index); xyz.push(...mesh.positions.subarray(old * 4, old * 4 + 4)); }
        faces.push(index);
      }
    }
    const positions = new Int16Array(xyz), indices = new Uint32Array(faces), colors = new Uint8Array(rgb);
    const streams = [MeshoptEncoder.encodeVertexBuffer(new Uint8Array(positions.buffer), remap.size, 8),
      MeshoptEncoder.encodeIndexBuffer(new Uint8Array(indices.buffer), indices.length, 4), MeshoptEncoder.encodeVertexBuffer(colors, selected.length, 4)];
    groups.push({ ...mesh.group, vertices: remap.size, triangles: selected.length, streams: streams.map(s => s.length) as [number, number, number] });
    body.push(...streams);
  }
  const json = new TextEncoder().encode(JSON.stringify(groups)), output = new Uint8Array(16 + json.length + body.reduce((sum, part) => sum + part.length, 0));
  const header = new DataView(output.buffer); header.setUint32(0, COMPACT_MESH_MAGIC, true); header.setUint32(4, 1, true); header.setUint32(8, json.length, true);
  output.set(json, 16); at = 16 + json.length;
  for (const part of body) { output.set(part, at); at += part.length; }
  return output;
}

/** Converts only exactly recovered oriented/color-matched faces. Unmatched,
 * simplified and clipped source faces are retained. Choose the smaller container. */
export async function packBuildingRecipes(source: Uint8Array<ArrayBuffer>, collisionBytes: Uint8Array) {
  await MeshoptEncoder.ready;
  const meshes = await decodeCompactMesh(source, MeshoptDecoder), mesh = meshes.find(m => m.group.name === 'buildings');
  if (!mesh) return { bytes: source, used: false, recipeTriangles: 0, fallbackTriangles: 0 };
  const collision = JSON.parse(new TextDecoder().decode(collisionBytes)) as RecipeCollision;
  const header: BuildingRecipeHeader = { collisionSha256: digest(collisionBytes), translation: mesh.group.translation, scale: mesh.group.scale, recipes: [] };
  const lookup = new Map<string, number[]>(), covered = new Set<number>();
  for (let t = 0; t < mesh.group.triangles; t++) { const key = keyAt(mesh, t), list = lookup.get(key) ?? []; list.push(t); lookup.set(key, list); }
  for (const [index, building] of collision.buildings.entries()) {
    let generated: Int16Array;
    try { generated = buildingRecipeFaces(building, collision.origin, header, triangulate); }
    catch (error) {
      // A source collision may extend below visual foundations or have no rendered
      // counterpart. It is ineligible; original geometry remains the fallback.
      if (error instanceof Error && error.message === 'MAP_RECIPE_RANGE') continue;
      throw error;
    }
    const selected: number[] = [], colors: number[] = [];
    for (let t = 0; t < generated.length / 9; t++) {
      const key = faceKey([0, 1, 2].map(c => Array.from(generated.subarray(t * 9 + c * 3, t * 9 + c * 3 + 3))));
      const original = lookup.get(key)?.find(id => !covered.has(id));
      if (original === undefined) continue;
      covered.add(original); selected.push(t); colors.push(...mesh.colors.subarray(original * 4, original * 4 + 3));
    }
    if (selected.length) header.recipes.push([index, selected.length === generated.length / 9 ? null : selected, colors]);
  }
  const fallback = [...Array(mesh.group.triangles).keys()].filter(t => !covered.has(t));
  if (!covered.size) return { bytes: source, used: false, recipeTriangles: 0, fallbackTriangles: fallback.length };
  const json = new TextEncoder().encode(JSON.stringify(header)), rest = fallbackMesh(source, mesh, fallback);
  const fallbackBudget = compactMeshHeader(rest).groups.reduce((sum, g) => sum + g.vertices * 8 + g.triangles * 52, 0);
  if (json.length > 2_000_000 || 16 + json.length + rest.length > COMPACT_MESH_LIMIT || fallbackBudget + covered.size * 76 > COMPACT_MESH_LIMIT)
    return { bytes: source, used: false, recipeTriangles: 0, fallbackTriangles: mesh.group.triangles };
  const output = new Uint8Array(16 + json.length + rest.length), view = new DataView(output.buffer);
  view.setUint32(0, MAP_RECIPE_MAGIC, true); view.setUint32(4, 1, true); view.setUint32(8, json.length, true);
  output.set(json, 16); output.set(rest, 16 + json.length);
  const decoded = await decodeBuildingRecipe(output, collision, triangulate, MeshoptDecoder);
  const before = orientedColoredFaces(meshes), after = orientedColoredFaces(decoded);
  if (before.length !== after.length || before.some((face, i) => face !== after[i])) throw new Error('Building recipe changes source geometry');
  const used = gzipSync(output, { level: 9 }).length < gzipSync(source, { level: 9 }).length;
  return { bytes: used ? output : source, used, recipeTriangles: used ? covered.size : 0,
    fallbackTriangles: used ? fallback.length : mesh.group.triangles };
}
