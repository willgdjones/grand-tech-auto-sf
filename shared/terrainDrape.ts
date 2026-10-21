/** Terrain-plane clipping adapted from jeantimex/tokyo src/world/drape.js (MIT).
 * Copyright (c) 2026 Yong Su. See docs/licenses/jeantimex-tokyo-MIT.txt.
 * GTASF changes: XYZ coordinates, typed attributes, exact surface projection and bounded grid cache.
 */
export type DrapeVertex = [number, number, number, ...number[]];
export type DrapeTriangle = [DrapeVertex, DrapeVertex, DrapeVertex];
export type EmitDrapeTriangle = (a: DrapeVertex, b: DrapeVertex, c: DrapeVertex) => void;
export type RoadDrape = (triangle: DrapeTriangle, lift: number, emit: EmitDrapeTriangle) => number;
const EPSILON = 1e-9;
export const areaXZ = (a: DrapeVertex, b: DrapeVertex, c: DrapeVertex) =>
  (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);

/** Convex half-plane clipping; y, UVs and any other attributes interpolate with each cut. */
export function clipDrapePolygon(polygon: DrapeVertex[], distance: (p: DrapeVertex) => number): DrapeVertex[] {
  if (!polygon.length) return [];
  const output: DrapeVertex[] = [];
  let a = polygon[polygon.length - 1]!, da = distance(a);
  for (const b of polygon) {
    const db = distance(b);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      output.push(a.map((v, i) => v + (b[i]! - v) * t) as DrapeVertex);
    }
    if (db >= 0) output.push(b);
    a = b; da = db;
  }
  return output;
}

/** Clip to a real decoded or compiler terrain triangle, retaining source y until projection. */
export function clipToSurface(source: DrapeTriangle, surface: DrapeTriangle): DrapeVertex[] {
  const determinant = areaXZ(...surface);
  if (Math.abs(determinant) < EPSILON) return [];
  const sign = Math.sign(determinant);
  let polygon: DrapeVertex[] = source;
  for (let i = 0; i < 3 && polygon.length >= 3; i++) {
    const a = surface[i]!, b = surface[(i + 1) % 3]!;
    polygon = clipDrapePolygon(polygon, p => sign * ((b[0] - a[0]) * (p[2] - a[2]) - (b[2] - a[2]) * (p[0] - a[0])));
  }
  return polygon;
}

export function surfacePlaneHeight(surface: DrapeTriangle, x: number, z: number): number {
  const [a, b, c] = surface, determinant = areaXZ(a, b, c);
  const u = ((x - a[0]) * (c[2] - a[2]) - (z - a[2]) * (c[0] - a[0])) / determinant;
  const v = ((b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0])) / determinant;
  return a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]);
}

export function emitSurfacePolygon(polygon: DrapeVertex[], surface: DrapeTriangle, lift: number, emit: EmitDrapeTriangle): number {
  const points = polygon.map(p => [p[0], surfacePlaneHeight(surface, p[0], p[2]) + lift, p[2], ...p.slice(3)] as DrapeVertex);
  let count = 0;
  for (let i = 1; i + 1 < points.length; i++) {
    const a = points[0]!, b = points[i]!, c = points[i + 1]!;
    if (Math.abs(areaXZ(a, b, c)) < EPSILON) continue;
    // +y-up, +z-south: negative XZ determinant is the upward winding.
    if (areaXZ(a, b, c) < 0) emit(a, b, c); else emit(a, c, b);
    count++;
  }
  return count;
}

/** The same world-aligned NE–SW diagonals for road surfaces and their markings.
 * Scope instances per chunk/build so the sample cache cannot retain a whole city.
 */
export function createTerrainDraper(step: number, sample: (x: number, z: number) => number) {
  if (!Number.isFinite(step) || step <= 0) throw new Error('Invalid terrain drape step');
  const cache = new Map<string, number>();
  const node = (i: number, j: number): DrapeVertex => {
    const key = `${i},${j}`;
    let height = cache.get(key);
    if (height === undefined) {
      height = sample(i * step, j * step);
      if (!Number.isFinite(height)) throw new Error('Missing terrain drape sample');
      cache.set(key, height);
    }
    return [i * step, height, j * step];
  };
  function cell(i: number, j: number): [DrapeTriangle, DrapeTriangle] {
    const a = node(i, j), b = node(i + 1, j), c = node(i, j + 1), d = node(i + 1, j + 1);
    return [[a, c, b], [b, c, d]];
  }
  function height(x: number, z: number): number {
    const i = Math.floor(x / step), j = Math.floor(z / step);
    return surfacePlaneHeight(cell(i, j)[x / step - i + z / step - j <= 1 ? 0 : 1], x, z);
  }
  function triangle(source: DrapeTriangle, lift: number, emit: EmitDrapeTriangle): number {
    const minX = Math.min(...source.map(p => p[0])), maxX = Math.max(...source.map(p => p[0]));
    const minZ = Math.min(...source.map(p => p[2])), maxZ = Math.max(...source.map(p => p[2]));
    // Degenerate edges do not sample unnecessary neighbour cells at exact tile boundaries.
    if (Math.abs(areaXZ(...source)) < EPSILON) return 0;
    let count = 0;
    for (let j = Math.floor(minZ / step); j < Math.ceil(maxZ / step); j++) {
      let row = clipDrapePolygon(source, p => p[2] - j * step);
      row = clipDrapePolygon(row, p => (j + 1) * step - p[2]);
      if (row.length < 3) continue;
      const lo = Math.min(...row.map(p => p[0])), hi = Math.max(...row.map(p => p[0]));
      for (let i = Math.floor(lo / step); i < Math.ceil(hi / step); i++) for (const surface of cell(i, j)) {
        count += emitSurfacePolygon(clipToSurface(source, surface), surface, lift, emit);
      }
    }
    return count;
  }
  return { height, triangle, clear() { cache.clear(); } };
}
