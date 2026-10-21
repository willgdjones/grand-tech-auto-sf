/** GTCJ v1: exact appended seams, regenerated from quantized base surfaces.
 * Algorithm pinned from surfaceJoins.ts at 88acbf9. Source selection and an
 * explicit face fallback preserve newer or otherwise unmatched source seams.
 * Do not change its geometry/order: a changed algorithm requires a new version.
 */
import { COMPACT_MESH_LIMIT, decodeCompactMesh, type CompactMeshGroup, type DecodedMapMesh, type MapMeshDecoder } from './mapMesh';
import { decodeBuildingRecipe, isBuildingRecipe, type RecipeCollision, type RecipeTriangulator } from './mapRecipe';
type XYZ = [number, number, number];
export const MAP_JOIN_MAGIC = 0x4a435447;
const MAX_FACES = Math.floor(COMPACT_MESH_LIMIT / 76);


/** Existing mesh arrays are read only: joins never alter road/contact heights. */
export interface JoinSurface {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
  colours: ArrayLike<number>;
}
export interface SurfaceJoinTriangle { points: [XYZ, XYZ, XYZ]; colour: [number, number, number] }
interface Edge { a: XYZ; b: XYZ; count: number; road: boolean; colour: [number, number, number] }
export interface SurfaceJoinResult { triangles: SurfaceJoinTriangle[]; joinedPairs: number; rejectedWidePairs: number }
const key = (p: XYZ) => p.map(n => n.toFixed(5)).join(',');
const interpolate = (a: XYZ, b: XYZ, t: number): XYZ => a.map((n, i) => n + (b[i]! - n) * t) as XYZ;

/** Seal narrow road/ground and junction cracks with vertical faces between their
 * actual existing edges. The 0.5m cap excludes bridge decks/tunnel levels. Both
 * windings match the existing opaque, front-sided road material contract.
 */
export function createSurfaceJoins(terrain: JoinSurface, roads: JoinSurface): SurfaceJoinResult {
  function boundaries(surface: JoinSurface, road: boolean): Edge[] {
    const edges = new Map<string, Edge>();
    const point = (i: number): XYZ => [surface.positions[i * 3]!, surface.positions[i * 3 + 1]!, surface.positions[i * 3 + 2]!];
    for (let t = 0; t < surface.indices.length; t += 3) {
      const first = surface.indices[t]!, points = [point(first), point(surface.indices[t + 1]!), point(surface.indices[t + 2]!)];
      const colour = [surface.colours[first * 3]! / 255, surface.colours[first * 3 + 1]! / 255, surface.colours[first * 3 + 2]! / 255] as [number, number, number];
      for (let i = 0; i < 3; i++) {
        const a = points[i]!, b = points[(i + 1) % 3]!, id = [key(a), key(b)].sort().join('|'), edge = edges.get(id);
        if (edge) edge.count++;
        else edges.set(id, { a, b, colour, road, count: 1 });
      }
    }
    return [...edges.values()].filter(e => e.count === 1 && Math.hypot(e.a[0] - e.b[0], e.a[2] - e.b[2]) > .05);
  }
  const edges = [...boundaries(roads, true), ...boundaries(terrain, false)];
  function cells(edge: Edge): string[] {
    const result: string[] = [];
    for (let x = Math.floor((Math.min(edge.a[0], edge.b[0]) - .02) / 16); x <= Math.floor((Math.max(edge.a[0], edge.b[0]) + .02) / 16); x++)
      for (let z = Math.floor((Math.min(edge.a[2], edge.b[2]) - .02) / 16); z <= Math.floor((Math.max(edge.a[2], edge.b[2]) + .02) / 16); z++) { result.push(`${x},${z}`); if (result.length > 4096) throw new Error('MAP_JOIN_LIMIT'); }
    return result;
  }
  const grid = new Map<string, number[]>();
  edges.forEach((edge, i) => { for (const cell of cells(edge)) { const list = grid.get(cell) ?? []; list.push(i); grid.set(cell, list); } });
  const result: SurfaceJoinResult = { triangles: [], joinedPairs: 0, rejectedWidePairs: 0 }, seen = new Set<string>();
  edges.forEach((a, i) => {
    if (!a.road) return;
    const dx = a.b[0] - a.a[0], dz = a.b[2] - a.a[2], length = Math.hypot(dx, dz);
    const along = (p: XYZ) => ((p[0] - a.a[0]) * dx + (p[2] - a.a[2]) * dz) / (length * length);
    const perpendicular = (p: XYZ) => Math.abs((p[0] - a.a[0]) * dz - (p[2] - a.a[2]) * dx) / length;
    for (const j of new Set(cells(a).flatMap(cell => grid.get(cell) ?? []))) {
      if (i === j) continue;
      const pair = [i, j].sort((n, m) => n - m).join(','); if (seen.has(pair)) continue; seen.add(pair); if (seen.size > 2_000_000) throw new Error('MAP_JOIN_LIMIT');
      const b = edges[j]!;
      // Shared quantization/rounding can move a border a few millimetres in XZ.
      if (perpendicular(b.a) > .02 || perpendicular(b.b) > .02) continue;
      const b0 = along(b.a), b1 = along(b.b), from = Math.max(0, Math.min(b0, b1)), to = Math.min(1, Math.max(b0, b1));
      if ((to - from) * length < .05 || Math.abs(b1 - b0) < 1e-8) continue;
      const onA = (t: number) => interpolate(a.a, a.b, t), onB = (t: number) => interpolate(b.a, b.b, (t - b0) / (b1 - b0));
      const firstGap = onA(from)[1] - onB(from)[1], lastGap = onA(to)[1] - onB(to)[1];
      const gap = Math.max(Math.abs(firstGap), Math.abs(lastGap));
      if (gap < .005) continue;
      if (gap > .5) { result.rejectedWidePairs++; continue; }
      const breaks = firstGap * lastGap < 0 ? [from, from + (to - from) * firstGap / (firstGap - lastGap), to] : [from, to];
      for (let k = 1; k < breaks.length; k++) {
        const a0 = onA(breaks[k - 1]!), a1 = onA(breaks[k]!), b0p = onB(breaks[k - 1]!), b1p = onB(breaks[k]!);
        for (const points of [[a0, b0p, b1p], [a0, b1p, a1]] as [XYZ, XYZ, XYZ][]) {
          const u = points[1].map((n, axis) => n - points[0][axis]!), v = points[2].map((n, axis) => n - points[0][axis]!);
          if (Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) < 1e-8) continue;
          result.triangles.push({ points, colour: a.colour }, { points: [points[2], points[1], points[0]], colour: a.colour });
          if (result.triangles.length > MAX_FACES) throw new Error('MAP_JOIN_LIMIT');
        }
      }
      result.joinedPairs++;
    }
  });
  return result;
}

export interface JoinFace { points: number[][]; rgb: number[] }
export interface JoinRecipeHeader {
  baseBytes: number; generatedFaces: number; selectedFaces: number; maskBytes: number; fallbackBytes: number;
}
export function joinFaceKey(face: JoinFace): string {
  const p = face.points.map(v => v.join(','));
  return [0, 1, 2].map(r => [0, 1, 2].map(c => p[(r + c) % 3]).join(';')).sort()[0] + ':' + face.rgb.join(',');
}
export function meshJoinFaces(mesh: DecodedMapMesh): JoinFace[] {
  return Array.from({ length: mesh.group.triangles }, (_, t) => ({
    points: [0, 1, 2].map(c => { const at = mesh.indices[t * 3 + c]! * 4; return Array.from(mesh.positions.subarray(at, at + 3)); }),
    rgb: Array.from(mesh.colors.subarray(t * 4, t * 4 + 3)),
  }));
}
function surface(mesh: DecodedMapMesh): JoinSurface {
  const positions = new Float64Array(mesh.group.triangles * 9), indices = new Uint32Array(mesh.group.triangles * 3), colours = new Uint8Array(positions.length);
  for (let t = 0; t < mesh.group.triangles; t++) for (let c = 0; c < 3; c++) {
    indices[t * 3 + c] = t * 3 + c;
    for (let axis = 0; axis < 3; axis++) {
      positions[t * 9 + c * 3 + axis] = mesh.positions[mesh.indices[t * 3 + c]! * 4 + axis]! / 32767 * mesh.group.scale[axis]! + mesh.group.translation[axis]!;
      colours[t * 9 + c * 3 + axis] = mesh.colors[t * 4 + axis]!;
    }
  }
  return { positions, indices, colours };
}
export function generateJoinFaces(meshes: DecodedMapMesh[]): { faces: JoinFace[]; transform: CompactMeshGroup } {
  const roads = meshes.filter(m => m.group.name === 'roads'), terrain = meshes.filter(m => m.group.name === 'terrain');
  if (roads.length !== 1 || terrain.length > 1) throw new Error('MAP_JOIN_SURFACES');
  const road = roads[0]!, ground = terrain[0];
  if (ground && JSON.stringify([road.group.translation, road.group.scale]) !== JSON.stringify([ground.group.translation, ground.group.scale])) throw new Error('MAP_JOIN_TRANSFORM');
  if ((road.group.triangles + (ground?.group.triangles ?? 0)) * 76 > COMPACT_MESH_LIMIT) throw new Error('MAP_JOIN_LIMIT');
  const generated = createSurfaceJoins(ground ? surface(ground) : { positions: [], indices: [], colours: [] }, surface(road));
  const faces = generated.triangles.map(triangle => ({
    points: triangle.points.map(p => p.map((n, axis) => {
      const q = Math.round((n - road.group.translation[axis]!) / road.group.scale[axis]! * 32767);
      if (!Number.isFinite(q) || q < -32768 || q > 32767) throw new Error('MAP_JOIN_RANGE'); return q;
    })), rgb: triangle.colour.map(n => Math.round(n * 255)),
  }));
  return { faces, transform: road.group };
}
export function isJoinRecipe(source: Uint8Array): boolean {
  return source.length >= 4 && new DataView(source.buffer, source.byteOffset, 4).getUint32(0, true) === MAP_JOIN_MAGIC;
}
export function joinRecipeHeader(source: Uint8Array) {
  if (source.length < 16 || source.length > COMPACT_MESH_LIMIT) throw new Error('MAP_JOIN_SIZE');
  const view = new DataView(source.buffer, source.byteOffset, 16), length = view.getUint32(8, true);
  if (!isJoinRecipe(source) || view.getUint32(4, true) !== 1 || view.getUint32(12, true) || length > 4096 || 16 + length >= source.length) throw new Error('MAP_JOIN_HEADER');
  const header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source.subarray(16, 16 + length))) as JoinRecipeHeader;
  if (!header || [header.baseBytes, header.generatedFaces, header.selectedFaces, header.maskBytes, header.fallbackBytes].some(n => !Number.isSafeInteger(n) || n < 0)
    || header.baseBytes < 16 || header.generatedFaces > MAX_FACES || header.selectedFaces > header.generatedFaces
    || header.maskBytes !== (header.selectedFaces === header.generatedFaces ? 0 : Math.ceil(header.generatedFaces / 8))
    || 16 + length + header.baseBytes + header.maskBytes + header.fallbackBytes !== source.length) throw new Error('MAP_JOIN_HEADER');
  let at = 16 + length;
  const base = source.subarray(at, at += header.baseBytes), mask = source.subarray(at, at += header.maskBytes), fallback = source.subarray(at);
  if (isJoinRecipe(base)) throw new Error('MAP_JOIN_NESTING');
  if (mask.length) {
    let selected = 0;
    for (let i = 0; i < mask.length * 8; i++) if (mask[i >> 3]! & (1 << (i & 7))) { if (i >= header.generatedFaces) throw new Error('MAP_JOIN_MASK'); selected++; }
    if (selected !== header.selectedFaces) throw new Error('MAP_JOIN_MASK');
  }
  return { header, base, mask, fallback };
}
export async function decodeJoinRecipe(source: Uint8Array, decoder: MapMeshDecoder, collision: RecipeCollision | undefined,
  triangulate: RecipeTriangulator, decodeBase?: (source: Uint8Array) => Promise<DecodedMapMesh[]>): Promise<DecodedMapMesh[]> {
  const { header, base, mask, fallback } = joinRecipeHeader(source);
  if (isBuildingRecipe(base) && !collision) throw new Error('MAP_RECIPE_COLLISION_REQUIRED');
  const result = decodeBase ? await decodeBase(base) : isBuildingRecipe(base) ? await decodeBuildingRecipe(base, collision!, triangulate, decoder) : await decodeCompactMesh(base, decoder);
  const extra = fallback.length ? await decodeCompactMesh(fallback, decoder) : [];
  if ([...result, ...extra].reduce((sum, m) => sum + m.group.vertices * 8 + m.group.triangles * 52, header.generatedFaces * 76) > COMPACT_MESH_LIMIT) throw new Error('MAP_JOIN_LIMIT');
  const { faces, transform } = generateJoinFaces(result);
  if (faces.length !== header.generatedFaces) throw new Error('MAP_JOIN_COUNT');
  if (extra.some(m => m.group.name !== 'roads' || JSON.stringify([m.group.translation, m.group.scale]) !== JSON.stringify([transform.translation, transform.scale]))) throw new Error('MAP_JOIN_FALLBACK');
  const positions = new Int16Array(header.selectedFaces * 12), indices = new Uint32Array(header.selectedFaces * 3), colors = new Uint8Array(header.selectedFaces * 4);
  let at = 0;
  for (const [i, face] of faces.entries()) {
    if (mask.length && !(mask[i >> 3]! & (1 << (i & 7)))) continue;
    for (let c = 0; c < 3; c++) { positions.set(face.points[c]!, (at * 3 + c) * 4); indices[at * 3 + c] = at * 3 + c; }
    colors.set(face.rgb, at * 4); at++;
  }
  if (at !== header.selectedFaces) throw new Error('MAP_JOIN_COUNT');
  if (at) result.push({ group: { ...transform, triangles: at, vertices: at * 3, streams: [1, 1, 1] }, positions, indices, colors });
  return [...result, ...extra];
}
