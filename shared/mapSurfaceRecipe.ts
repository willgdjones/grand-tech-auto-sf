/** GTCZ v1: regenerate XZ topology, keep exact source Y/RGB and explicit fallback.
 * Browser entry points check compactMapAssets. Header/dependency/height hashes
 * fail closed; this module never simplifies source geometry or samples new Y. */
import { COMPACT_MESH_LIMIT, decodeCompactMesh, type CompactMeshGroup, type DecodedMapMesh, type MapMeshDecoder } from './mapMesh';
import { decodeBuildingRecipe, isBuildingRecipe, type RecipeCollision, type RecipeTriangulator } from './mapRecipe';
import { decodeJoinRecipe, isJoinRecipe } from './mapJoinRecipe';
import { decodeHeightPredictedMesh, isHeightPredictedMesh, predictionField, type PredictionField } from './mapHeightPredictor';
import { ChunkMeshes, SpatialIndex, addRoadMeshes, addTerrainMeshes, surfaceSourceProject,
  type Bounds, type Cut, type MeshData, type Pavement, type Road, type Tags } from './mapSurfaceSourceV1';

export const MAP_SURFACE_MAGIC = 0x5a435447;
const MAX_FACES = Math.floor(COMPACT_MESH_LIMIT / 76);
export interface SurfaceSourcePlan {
  nodes: number; tags: Tags[]; roads: [number, number, number[]][]; pavements: number[][][];
}
export interface SurfaceGroup {
  name: 'terrain' | 'roads'; translation: [number, number, number]; scale: [number, number, number];
  generatedFaces: number; generatedSha256: string; selectedFaces: number; maskBytes: number;
  heightBytes: number; exceptionBytes: number; exceptionCount: number; colorBytes: number;
}
export interface SurfaceRecipeHeader {
  bounds: Bounds; carve: boolean; step: 16 | 32; planBytes: number; baseBytes: number;
  heightSha256: string; groups: SurfaceGroup[];
}
export class SurfaceReader {
  at = 0;
  constructor(readonly bytes: Uint8Array) {}
  uint(): number {
    let word = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      if (this.at >= this.bytes.length) throw new Error('MAP_SURFACE_VARINT');
      const byte = this.bytes[this.at++]!;
      if (shift === 28 && byte > 15) throw new Error('MAP_SURFACE_VARINT');
      word = (word | (byte & 127) << shift) >>> 0;
      if (!(byte & 128)) return word;
    }
    throw new Error('MAP_SURFACE_VARINT');
  }
  int(): number { const n = this.uint(); return (n >>> 1) ^ -(n & 1); }
  float(): number {
    if (this.at + 8 > this.bytes.length) throw new Error('MAP_SURFACE_FLOAT');
    const n = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.at, 8).getFloat64(0, true); this.at += 8;
    if (!Number.isFinite(n)) throw new Error('MAP_SURFACE_FLOAT'); return n;
  }
  verify() { if (this.at !== this.bytes.length) throw new Error('MAP_SURFACE_TRAILING'); }
}
export async function surfaceHash(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))].map(n => n.toString(16).padStart(2, '0')).join('');
}
function integer(n: number, min: number, max: number): boolean { return Number.isSafeInteger(n) && n >= min && n <= max; }
function hash(n: unknown): boolean { return typeof n === 'string' && /^[a-f0-9]{64}$/.test(n); }
export function decodeSurfacePlan(bytes: Uint8Array): { roads: Road[]; pavements: Pavement[] } {
  if (bytes.length < 4 || bytes.length > 1_000_000) throw new Error('MAP_SURFACE_PLAN_SIZE');
  const length = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  if (!length || length > 500_000 || length + 4 > bytes.length) throw new Error('MAP_SURFACE_PLAN_HEADER');
  const plan = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(4, 4 + length))) as SurfaceSourcePlan;
  if (!plan || !integer(plan.nodes, 0, 16_384) || !Array.isArray(plan.tags) || plan.tags.length > 1024
    || !Array.isArray(plan.roads) || plan.roads.length > 2048 || !Array.isArray(plan.pavements) || plan.pavements.length > 1024) throw new Error('MAP_SURFACE_PLAN_HEADER');
  for (const tags of plan.tags) if (!tags || typeof tags !== 'object' || Array.isArray(tags) || Object.keys(tags).length > 20
    || Object.values(tags).some(v => typeof v !== 'string' || v.length > 512)) throw new Error('MAP_SURFACE_TAGS');
  const source = new SurfaceReader(bytes.subarray(4 + length)), nodes: Road['points'] = [];
  let lat = 0, lon = 0, mx = 0, mz = 0;
  for (let id = 0; id < plan.nodes; id++) {
    const mode = source.uint(); let x: number, z: number;
    if (mode === 0) { lat += source.int(); lon += source.int(); [x, z] = surfaceSourceProject(lon / 1e7, lat / 1e7); }
    else if (mode === 1) { x = source.float(); z = source.float(); }
    else if (mode === 2) { mx += source.int(); mz += source.int(); x = mx / 1000; z = mz / 1000; }
    else throw new Error('MAP_SURFACE_COORDINATES');
    if (![x, z].every(n => Number.isFinite(n) && Math.abs(n) <= 100_000)) throw new Error('MAP_SURFACE_COORDINATES');
    nodes.push({ id: String(id), x, z });
  }
  source.verify();
  const points = (ids: number[], minimum: number) => {
    if (!Array.isArray(ids) || !integer(ids.length, minimum, 16_384) || ids.some(id => !integer(id, 0, nodes.length - 1))) throw new Error('MAP_SURFACE_POINTS');
    return ids.map(id => nodes[id]!);
  };
  let segments = 0;
  const roads = plan.roads.map((road, i): Road => {
    if (!Array.isArray(road) || road.length !== 3 || !Number.isFinite(road[0]) || road[0] <= 0 || road[0] > 80
      || !integer(road[1], 0, plan.tags.length - 1)) throw new Error('MAP_SURFACE_ROAD');
    const line = points(road[2], 2);
    for (let j = 1; j < line.length; j++) segments += Math.max(1, Math.ceil(Math.hypot(line[j]!.x - line[j - 1]!.x, line[j]!.z - line[j - 1]!.z) / 12));
    if (segments > 20_000) throw new Error('MAP_SURFACE_GENERATION_LIMIT');
    return { id: String(i), width: road[0], tags: plan.tags[road[1]]!, points: line };
  });
  let vertices = 0;
  const pavements = plan.pavements.map(polygon => {
    if (!Array.isArray(polygon) || !integer(polygon.length, 1, 128)) throw new Error('MAP_SURFACE_PAVEMENT');
    return { polygon: polygon.map(ids => { vertices += ids.length; if (vertices > 32_768) throw new Error('MAP_SURFACE_GENERATION_LIMIT');
      return points(ids, 3).map(({ x, z }): [number, number] => [x, z]); }) };
  });
  return { roads, pavements };
}
export function generateSourceSurface(plan: Uint8Array, header: Pick<SurfaceRecipeHeader, 'bounds' | 'carve' | 'step'>): { terrain: MeshData; roads: MeshData } {
  const { roads, pavements } = decodeSurfacePlan(plan), { bounds, carve, step } = header;
  let cells = 0;
  for (const { polygon } of pavements) {
    const points = polygon.flat(), minX = Math.max(bounds[0], Math.min(...points.map(p => p[0]))), maxX = Math.min(bounds[2], Math.max(...points.map(p => p[0])));
    const minZ = Math.max(bounds[1], Math.min(...points.map(p => p[1]))), maxZ = Math.min(bounds[3], Math.max(...points.map(p => p[1])));
    cells += Math.max(0, Math.ceil((maxX - minX) / 4) + 1) * Math.max(0, Math.ceil((maxZ - minZ) / 4) + 1);
    if (cells > 30_000) throw new Error('MAP_SURFACE_GENERATION_LIMIT');
  }
  const meshes = new ChunkMeshes(bounds, 256), flat = { sample: () => 0 };
  const cuts = addRoadMeshes(meshes, roads, flat, 1, pavements, true);
  addTerrainMeshes(meshes, flat, carve ? cuts : new SpatialIndex<Cut>(32), step, 4);
  return meshes.chunks.values().next().value!;
}
/** Six signed Int32 XZ words per oriented triangle, with the original mesh's
 * exact quantization transform. The SHA covers this complete generated order. */
export function surfaceXZ(data: MeshData, bounds: Bounds, group: Pick<SurfaceGroup, 'translation' | 'scale'>): Int32Array<ArrayBuffer> {
  if (data.indices.length / 3 > MAX_FACES) throw new Error('MAP_SURFACE_GENERATION_LIMIT');
  const result = new Int32Array(data.indices.length * 2);
  for (const [i, index] of data.indices.entries()) for (const [axis, coordinate] of [0, 2].entries()) {
    const q = Math.round((data.positions[index * 3 + coordinate]! - bounds[axis]! - group.translation[coordinate]!) / group.scale[coordinate]! * 32767);
    if (!integer(q, -0x80000000, 0x7fffffff)) throw new Error('MAP_SURFACE_RANGE'); result[i * 2 + axis] = q;
  }
  return result;
}
export function surfaceHeightPrediction(x: number, z: number, group: Pick<SurfaceGroup, 'translation' | 'scale' | 'name'>, field: PredictionField): number {
  const wx = x / 32767 * group.scale[0] + group.translation[0], wz = z / 32767 * group.scale[2] + group.translation[2];
  const px = Math.max(0, Math.min(field.size - 1, wx / field.step)), pz = Math.max(0, Math.min(field.size - 1, wz / field.step));
  const ix = Math.min(field.size - 2, Math.floor(px)), iz = Math.min(field.size - 2, Math.floor(pz)), fx = px - ix, fz = pz - iz;
  const h = (a: number, b: number) => field.values[b * field.size + a]!;
  const y = (field.offsetCm + (h(ix, iz) * (1 - fx) + h(ix + 1, iz) * fx) * (1 - fz)
    + (h(ix, iz + 1) * (1 - fx) + h(ix + 1, iz + 1) * fx) * fz) / 100 + (group.name === 'roads' ? .1 : 0);
  const predicted = Math.round((y - group.translation[1]) / group.scale[1] * 32767);
  if (!integer(predicted, -0x7fffffff, 0x7fffffff)) throw new Error('MAP_SURFACE_HEIGHT_RANGE'); return predicted;
}
export function isSurfaceRecipe(source: Uint8Array): boolean {
  return source.length >= 4 && new DataView(source.buffer, source.byteOffset, 4).getUint32(0, true) === MAP_SURFACE_MAGIC;
}
export function surfaceRecipeHeader(source: Uint8Array) {
  if (source.length < 16 || source.length > COMPACT_MESH_LIMIT) throw new Error('MAP_SURFACE_SIZE');
  const view = new DataView(source.buffer, source.byteOffset, 16), length = view.getUint32(8, true);
  if (!isSurfaceRecipe(source) || view.getUint32(4, true) !== 1 || view.getUint32(12, true) || !length || length > 16_384 || 16 + length >= source.length) throw new Error('MAP_SURFACE_HEADER');
  const header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source.subarray(16, 16 + length))) as SurfaceRecipeHeader;
  if (!header || !Array.isArray(header.bounds) || header.bounds.length !== 4 || header.bounds.some(n => !Number.isFinite(n) || Math.abs(n) > 100_000 || n % 256)
    || header.bounds[2] !== header.bounds[0] + 256 || header.bounds[3] !== header.bounds[1] + 256 || typeof header.carve !== 'boolean'
    || ![16, 32].includes(header.step) || !integer(header.planBytes, 4, 1_000_000) || !integer(header.baseBytes, 16, COMPACT_MESH_LIMIT)
    || !hash(header.heightSha256) || !Array.isArray(header.groups) || !integer(header.groups.length, 1, 2)) throw new Error('MAP_SURFACE_HEADER');
  const names = new Set<string>(); let count = 0, end = 16 + length + header.planBytes + header.baseBytes;
  for (const group of header.groups) {
    if (!group || !['roads', 'terrain'].includes(group.name) || names.has(group.name) || !hash(group.generatedSha256)
      || !integer(group.generatedFaces, 1, MAX_FACES) || !integer(group.selectedFaces, 1, group.generatedFaces)
      || group.maskBytes !== (group.selectedFaces === group.generatedFaces ? 0 : Math.ceil(group.generatedFaces / 8))
      || !integer(group.heightBytes, 1, COMPACT_MESH_LIMIT) || !integer(group.exceptionBytes, 0, COMPACT_MESH_LIMIT)
      || !integer(group.exceptionCount, 0, group.selectedFaces * 3) || group.colorBytes !== group.selectedFaces * 3) throw new Error('MAP_SURFACE_GROUP');
    for (const vector of [group.translation, group.scale]) if (!Array.isArray(vector) || vector.length !== 3 || !vector.every(Number.isFinite)) throw new Error('MAP_SURFACE_TRANSFORM');
    if (group.scale.some(n => n <= 0)) throw new Error('MAP_SURFACE_TRANSFORM');
    names.add(group.name); count += group.selectedFaces;
    end += group.maskBytes + group.heightBytes + group.exceptionBytes + group.colorBytes;
  }
  if (end !== source.length || count > MAX_FACES) throw new Error('MAP_SURFACE_SIZE');
  let at = 16 + length;
  const plan = source.subarray(at, at += header.planBytes), base = source.subarray(at, at += header.baseBytes);
  if (isSurfaceRecipe(base) || isJoinRecipe(base) || isHeightPredictedMesh(base)) throw new Error('MAP_SURFACE_NESTING');
  return { header, plan, base, dataOffset: at };
}
/** Seam generation consumes one group for each material/transform. */
export function mergeSurfaceGroups(groups: DecodedMapMesh[]): DecodedMapMesh[] {
  const buckets = new Map<string, DecodedMapMesh[]>();
  for (const mesh of groups) { const key = JSON.stringify([mesh.group.name, mesh.group.translation, mesh.group.scale]);
    const list = buckets.get(key) ?? []; list.push(mesh); buckets.set(key, list); }
  return [...buckets.values()].map((list): DecodedMapMesh => {
    if (list.length === 1) return list[0]!;
    const vertices = list.reduce((n, m) => n + m.group.vertices, 0), triangles = list.reduce((n, m) => n + m.group.triangles, 0);
    if (vertices * 8 + triangles * 52 > COMPACT_MESH_LIMIT) throw new Error('MAP_SURFACE_DECODE_BUDGET');
    const positions = new Int16Array(vertices * 4), indices = new Uint32Array(triangles * 3), colors = new Uint8Array(triangles * 4);
    let vertex = 0, triangle = 0;
    for (const mesh of list) { positions.set(mesh.positions, vertex * 4); colors.set(mesh.colors, triangle * 4);
      for (let i = 0; i < mesh.indices.length; i++) indices[triangle * 3 + i] = mesh.indices[i]! + vertex;
      vertex += mesh.group.vertices; triangle += mesh.group.triangles; }
    return { group: { ...list[0]!.group, vertices, triangles, streams: [1, 1, 1] }, positions, indices, colors };
  });
}
export async function decodeSurfaceRecipe(source: Uint8Array, height: Uint8Array, decoder: MapMeshDecoder, collision: RecipeCollision | undefined, triangulate: RecipeTriangulator): Promise<DecodedMapMesh[]> {
  const { header, plan, base, dataOffset } = surfaceRecipeHeader(source);
  if (await surfaceHash(height) !== header.heightSha256) throw new Error('MAP_SURFACE_HEIGHT_HASH');
  const field = predictionField(height), generated = generateSourceSurface(plan, header);
  if (isBuildingRecipe(base) && !collision) throw new Error('MAP_RECIPE_COLLISION_REQUIRED');
  const result = isBuildingRecipe(base) ? await decodeBuildingRecipe(base, collision!, triangulate, decoder) : await decodeCompactMesh(base, decoder);
  const decodedBytes = result.reduce((n, mesh) => n + mesh.group.vertices * 8 + mesh.group.triangles * 52, 0)
    + header.groups.reduce((n, group) => n + group.selectedFaces * 76, 0);
  if (decodedBytes > COMPACT_MESH_LIMIT) throw new Error('MAP_SURFACE_DECODE_BUDGET');
  let at = dataOffset;
  for (const group of header.groups) {
    const xz = surfaceXZ(generated[group.name], header.bounds, group);
    if (xz.length !== group.generatedFaces * 6 || await surfaceHash(new Uint8Array(xz.buffer)) !== group.generatedSha256) throw new Error('MAP_SURFACE_GENERATOR_HASH');
    const mask = source.subarray(at, at += group.maskBytes), heights = new SurfaceReader(source.subarray(at, at += group.heightBytes));
    const exceptions = new SurfaceReader(source.subarray(at, at += group.exceptionBytes)), rgb = source.subarray(at, at += group.colorBytes);
    const overrides = new Map<number, number>(); let exceptionAt = 0;
    for (let i = 0; i < group.exceptionCount; i++) {
      const delta = exceptions.uint(); if (i && !delta) throw new Error('MAP_SURFACE_EXCEPTION'); exceptionAt += delta;
      if (exceptionAt >= group.selectedFaces * 3) throw new Error('MAP_SURFACE_EXCEPTION'); overrides.set(exceptionAt, exceptions.int());
    }
    exceptions.verify();
    if (mask.length) for (let i = group.generatedFaces; i < mask.length * 8; i++) if (mask[i >> 3]! & (1 << (i & 7))) throw new Error('MAP_SURFACE_MASK');
    const positions = new Int16Array(group.selectedFaces * 12), indices = new Uint32Array(group.selectedFaces * 3), colors = new Uint8Array(group.selectedFaces * 4);
    const knownHeights = new Map<string, number>(); let selected = 0, corner = 0;
    for (let face = 0; face < group.generatedFaces; face++) {
      if (mask.length && !(mask[face >> 3]! & (1 << (face & 7)))) continue;
      if (selected >= group.selectedFaces) throw new Error('MAP_SURFACE_MASK');
      for (let c = 0; c < 3; c++) {
        const x = xz[face * 6 + c * 2]!, z = xz[face * 6 + c * 2 + 1]!, key = `${x},${z}`;
        if (!knownHeights.has(key)) knownHeights.set(key, surfaceHeightPrediction(x, z, group, field) + heights.int());
        const y = knownHeights.get(key)! + (overrides.get(corner) ?? 0);
        if (![x, y, z].every(n => integer(n, -32768, 32767))) throw new Error('MAP_SURFACE_RANGE');
        positions.set([x, y, z], corner * 4); indices[corner] = corner; corner++;
      }
      colors.set(rgb.subarray(selected * 3, selected * 3 + 3), selected * 4); selected++;
    }
    if (selected !== group.selectedFaces) throw new Error('MAP_SURFACE_MASK'); heights.verify();
    result.push({ group: { name: group.name, translation: group.translation, scale: group.scale, vertices: corner, triangles: selected, streams: [1, 1, 1] }, positions, indices, colors });
  }
  return mergeSurfaceGroups(result);
}
export async function decodeSurfaceContainer(source: Uint8Array, height: Uint8Array | undefined, decoder: MapMeshDecoder,
  collision: RecipeCollision | undefined, triangulate: RecipeTriangulator): Promise<DecodedMapMesh[]> {
  if (isHeightPredictedMesh(source)) {
    if (!height) throw new Error('MAP_HEIGHT_FIELD_REQUIRED');
    return decodeHeightPredictedMesh(source, height, decoder, collision, triangulate);
  }
  if (isJoinRecipe(source)) return decodeJoinRecipe(source, decoder, collision, triangulate, base => {
    if (isJoinRecipe(base) || isHeightPredictedMesh(base)) throw new Error('MAP_SURFACE_NESTING');
    return decodeSurfaceContainer(base, height, decoder, collision, triangulate);
  });
  if (isSurfaceRecipe(source)) {
    if (!height) throw new Error('MAP_HEIGHT_FIELD_REQUIRED');
    return decodeSurfaceRecipe(source, height, decoder, collision, triangulate);
  }
  if (isBuildingRecipe(source)) {
    if (!collision) throw new Error('MAP_RECIPE_COLLISION_REQUIRED'); return decodeBuildingRecipe(source, collision, triangulate, decoder);
  }
  return decodeCompactMesh(source, decoder);
}
