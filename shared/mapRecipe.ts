/** Exact building recipes over already-required collision rings. GTCX is opt-in
 * through compactMapAssets; unmatched geometry stays in the embedded GTCM file. */
import { COMPACT_MESH_LIMIT, decodeCompactMesh, type CompactMeshGroup, type DecodedMapMesh, type MapMeshDecoder } from './mapMesh';

export const MAP_RECIPE_MAGIC = 0x58435447;
export interface RecipeCollision {
  origin: number[];
  buildings: { minY: number; maxY: number; rings: number[][][] }[];
}
type XYZ = [number, number, number];
type Triangle = [XYZ, XYZ, XYZ];
export type RecipeTriangulator = (rings: number[][][]) => number[][];
export interface BuildingRecipeHeader {
  collisionSha256: string;
  translation: XYZ; scale: XYZ;
  /** collision index, all faces or selected generated face ordinals, flat RGB */
  recipes: [number, number[] | null, number[]][];
}

function upward(a: XYZ, b: XYZ, c: XYZ): Triangle {
  return (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) > 0 ? [a, b, c] : [a, c, b];
}
function clip(source: Triangle): Triangle[] {
  let polygon: XYZ[] = source;
  for (const [axis, edge, greater] of [[0, 0, true], [0, 256, false], [2, 0, true], [2, 256, false]] as const) {
    const result: XYZ[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
      const ia = greater ? a[axis] >= edge : a[axis] <= edge, ib = greater ? b[axis] >= edge : b[axis] <= edge;
      if (ia) result.push(a);
      if (ia !== ib) {
        const t = (edge - a[axis]) / (b[axis] - a[axis]);
        const p = a.map((n, k) => n + (b[k]! - n) * t) as XYZ; p[axis] = edge; result.push(p);
      }
    }
    polygon = result;
  }
  const result: Triangle[] = [];
  for (let i = 1; i < polygon.length - 1; i++) result.push([polygon[0]!, polygon[i]!, polygon[i + 1]!]);
  return result;
}

/** Identical extrusion/clip/1mm-round/quantize rules to the source mesher. The
 * converter accepts only faces that also occur exactly in its source GLB. */
export function buildingRecipeFaces(building: RecipeCollision['buildings'][number], origin: number[], transform: Pick<BuildingRecipeHeader, 'translation' | 'scale'>,
  triangulate: RecipeTriangulator): Int16Array {
  if (!building || !Array.isArray(building.rings) || !building.rings.length || building.rings.length > 10_000
    || !Number.isFinite(building.minY) || !Number.isFinite(building.maxY) || building.minY > building.maxY) throw new Error('MAP_RECIPE_BUILDING');
  let vertices = 0;
  const rings = building.rings.map(ring => {
    if (!Array.isArray(ring)) throw new Error('MAP_RECIPE_RING');
    vertices += ring.length;
    if (vertices > 100_000) throw new Error('MAP_RECIPE_LIMIT');
    for (const p of ring) if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) throw new Error('MAP_RECIPE_POINT');
    const clean = ring.filter((p, i) => !i || p[0] !== ring[i - 1]![0] || p[1] !== ring[i - 1]![1]);
    if (clean.length > 1 && clean[0]![0] === clean.at(-1)![0] && clean[0]![1] === clean.at(-1)![1]) clean.pop();
    return clean;
  });
  const output: number[] = [], points = rings.flat();
  function emit(triangle: Triangle) {
    for (const face of clip(triangle)) {
      const [a, b, c] = face, u = b.map((v, i) => v - a[i]!), v = c.map((n, i) => n - a[i]!);
      if (Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) < 1e-8) continue;
      for (const p of face) for (let axis = 0; axis < 3; axis++) {
        const offset = origin[axis] ?? 0, mm = Math.round((p[axis]! + offset) * 1000) / 1000 - offset;
        const q = Math.round((mm - transform.translation[axis]!) / transform.scale[axis]! * 32767);
        if (q < -32768 || q > 32767) throw new Error('MAP_RECIPE_RANGE');
        output.push(q);
      }
      if (output.length * 2 > COMPACT_MESH_LIMIT) throw new Error('MAP_RECIPE_LIMIT');
    }
  }
  if (rings[0]!.length >= 3) for (const triangle of triangulate(rings)) {
    if (triangle.length !== 3 || triangle.some(i => !Number.isSafeInteger(i) || i < 0 || i >= points.length)) throw new Error('MAP_RECIPE_TRIANGULATOR');
    emit(upward(...triangle.map(i => [points[i]![0]!, building.maxY, points[i]![1]!] as XYZ) as Triangle));
  }
  for (const [r, original] of building.rings.entries()) {
    const area = original.reduce((sum, a, i) => { const b = original[(i + 1) % original.length]!; return sum + a[0]! * b[1]! - b[0]! * a[1]!; }, 0);
    const ring = (r === 0 ? area < 0 : area > 0) ? original : [...original].reverse();
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      const bottomA: XYZ = [a[0]!, building.minY, a[1]!], bottomB: XYZ = [b[0]!, building.minY, b[1]!];
      const topA: XYZ = [a[0]!, building.maxY, a[1]!], topB: XYZ = [b[0]!, building.maxY, b[1]!];
      emit([bottomA, bottomB, topB]); emit([bottomA, topB, topA]);
    }
  }
  return new Int16Array(output);
}

export function isBuildingRecipe(source: Uint8Array): boolean {
  return source.length >= 4 && new DataView(source.buffer, source.byteOffset, 4).getUint32(0, true) === MAP_RECIPE_MAGIC;
}
export function buildingRecipeHeader(source: Uint8Array) {
  if (source.length < 16 || source.length > COMPACT_MESH_LIMIT) throw new Error('MAP_RECIPE_SIZE');
  const view = new DataView(source.buffer, source.byteOffset, 16), length = view.getUint32(8, true);
  if (!isBuildingRecipe(source) || view.getUint32(4, true) !== 1 || view.getUint32(12, true)
    || length > 2_000_000 || 16 + length >= source.length) throw new Error('MAP_RECIPE_HEADER');
  const header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source.subarray(16, 16 + length))) as BuildingRecipeHeader;
  if (!header || !/^[a-f0-9]{64}$/.test(header.collisionSha256) || !Array.isArray(header.recipes) || header.recipes.length > 10_000) throw new Error('MAP_RECIPE_HEADER');
  for (const vector of [header.translation, header.scale]) if (!Array.isArray(vector) || vector.length !== 3 || !vector.every(Number.isFinite)) throw new Error('MAP_RECIPE_TRANSFORM');
  if (header.scale.some(v => v <= 0)) throw new Error('MAP_RECIPE_TRANSFORM');
  let faces = 0;
  for (const recipe of header.recipes) {
    if (!Array.isArray(recipe) || recipe.length !== 3 || !Number.isSafeInteger(recipe[0]) || recipe[0] < 0 || !Array.isArray(recipe[2])
      || !recipe[2].length || recipe[2].length % 3 || recipe[2].some(n => !Number.isSafeInteger(n) || n < 0 || n > 255)) throw new Error('MAP_RECIPE_RECORD');
    if (recipe[1] !== null && (!Array.isArray(recipe[1]) || recipe[1].length !== recipe[2].length / 3
      || recipe[1].some(n => !Number.isSafeInteger(n) || n < 0) || new Set(recipe[1]).size !== recipe[1].length)) throw new Error('MAP_RECIPE_FACES');
    faces += recipe[2].length / 3;
    if (faces * 76 > COMPACT_MESH_LIMIT) throw new Error('MAP_RECIPE_LIMIT');
  }
  return { header, faces, fallback: source.subarray(16 + length) };
}
export async function decodeBuildingRecipe(source: Uint8Array, collision: RecipeCollision, triangulate: RecipeTriangulator, decoder: MapMeshDecoder): Promise<DecodedMapMesh[]> {
  const { header, faces, fallback } = buildingRecipeHeader(source);
  const collisionBytes = new TextEncoder().encode(JSON.stringify(collision) + '\n');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', collisionBytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  if (hash !== header.collisionSha256) throw new Error('MAP_RECIPE_COLLISION_HASH');
  if (!Array.isArray(collision.origin) || collision.origin.length !== 3 || !collision.origin.every(Number.isFinite)) throw new Error('MAP_RECIPE_ORIGIN');
  const result = await decodeCompactMesh(fallback, decoder);
  if (result.reduce((sum, mesh) => sum + mesh.group.vertices * 8 + mesh.group.triangles * 52, faces * 76) > COMPACT_MESH_LIMIT) throw new Error('MAP_RECIPE_LIMIT');
  const positions = new Int16Array(faces * 12), indices = new Uint32Array(faces * 3), colors = new Uint8Array(faces * 4);
  let at = 0;
  for (const [building, selected, rgb] of header.recipes) {
    const sourceFaces = buildingRecipeFaces(collision.buildings[building]!, collision.origin, header, triangulate);
    const ordinals = selected ?? Array.from({ length: sourceFaces.length / 9 }, (_, i) => i);
    if (ordinals.length !== rgb.length / 3) throw new Error('MAP_RECIPE_FACES');
    for (const [i, face] of ordinals.entries()) {
      if (face * 9 + 9 > sourceFaces.length) throw new Error('MAP_RECIPE_FACES');
      for (let c = 0; c < 3; c++) {
        positions.set(sourceFaces.subarray(face * 9 + c * 3, face * 9 + c * 3 + 3), (at * 3 + c) * 4);
        indices[at * 3 + c] = at * 3 + c;
      }
      colors.set(rgb.slice(i * 3, i * 3 + 3), at * 4); at++;
    }
  }
  const group: CompactMeshGroup = { name: 'buildings', translation: header.translation, scale: header.scale,
    vertices: faces * 3, triangles: faces, streams: [1, 1, 1] };
  if (faces) result.push({ group, positions, indices, colors });
  return result;
}
