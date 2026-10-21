import { polygonBounds } from './geometry';
import { extractPolygons } from './osm';
import type { Bounds, HeightSampler, OsmExtract } from './types';

/** Surface plazas mapped below street level (Hallidie Plaza at Powell/Market, `level=-0.9`) are real sunken bowls
 * in the 3DEP DEM (floor ~5.7 m, street ~11 m), but the game has no stairs or retaining walls for them: the coarse
 * ground reads as a pit with building bases and cars floating over or buried in its slopes (founder playtest
 * 2026-10-14, gtasf-659xq). The DEM bowl is wider than the OSM polygon, so raising only the polygon to a rim median
 * left a 3 m dip (#6.17). Instead fill every closed depression in a MARGIN-metre neighbourhood of each such plaza:
 * priority-flood to the spill level, then a Laplace relaxation so the filled surface meets the street grade on every
 * side (no flat shelf, no ramp). Cells outside depressions keep the raw DEM exactly. */
const MARGIN = 40, STEP = 2, DEPTH = 0.3, ITERATIONS = 2000;

export function sunkenPlaza(tags: Record<string, string | undefined>): boolean {
  const level = Number(tags.level?.split(';')[0]);
  if (!(level < 0) || tags.building || tags.indoor || tags.tunnel || tags.covered === 'yes' || /underground|indoor/.test(tags.location ?? '')) return false;
  return tags.highway === 'pedestrian' || tags.place === 'square' || tags.leisure === 'park' || tags.landuse === 'plaza';
}

/** Raise (metres, >= 0) over a STEP grid; zero on the border, so the sampled surface is continuous at its edge. */
interface Fill { x0: number; z0: number; nx: number; nz: number; raise: Float32Array }

export function fillDepressions([x0, z0, x1, z1]: Bounds, dem: HeightSampler): Fill & { cells: number; max: number } {
  const nx = Math.ceil((x1 - x0) / STEP) + 1, nz = Math.ceil((z1 - z0) / STEP) + 1, n = nx * nz;
  const raw = new Float64Array(n);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) raw[j * nx + i] = dem.sample(x0 + i * STEP, z0 + j * STEP);
  // Priority flood from the border: each cell's spill level is the lowest maximum height on a path to the border.
  const spill = new Float64Array(n), done = new Uint8Array(n), heap: number[] = [];
  const less = (a: number, b: number) => spill[heap[a]!]! < spill[heap[b]!]!;
  const swap = (a: number, b: number) => { const t = heap[a]!; heap[a] = heap[b]!; heap[b] = t; };
  const push = (k: number) => { heap.push(k); for (let c = heap.length - 1; c > 0;) { const p = (c - 1) >> 1; if (!less(c, p)) break; swap(c, p); c = p; } };
  const pop = () => {
    const top = heap[0]!, last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let c = 0; ;) {
        const l = 2 * c + 1, r = l + 1; let m = c;
        if (l < heap.length && less(l, m)) m = l;
        if (r < heap.length && less(r, m)) m = r;
        if (m === c) break; swap(m, c); c = m;
      }
    }
    return top;
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (!i || !j || i === nx - 1 || j === nz - 1) {
    const k = j * nx + i; spill[k] = raw[k]!; done[k] = 1; push(k);
  }
  while (heap.length) {
    const k = pop(), i = k % nx, j = (k - i) / nx;
    for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]] as const) {
      if (a < 0 || b < 0 || a >= nx || b >= nz || done[b * nx + a]) continue;
      const q = b * nx + a; done[q] = 1; spill[q] = Math.max(raw[q]!, spill[k]!); push(q);
    }
  }
  // Laplace relaxation over the depressed cells (border cells are never depressed), never below the raw DEM.
  const free = Uint8Array.from(raw, (h, k) => spill[k]! - h > DEPTH ? 1 : 0), surface = Float64Array.from(spill);
  for (let it = 0; it < ITERATIONS; it++) for (let k = 0; k < n; k++) if (free[k])
    surface[k] = Math.max(raw[k]!, (surface[k - 1]! + surface[k + 1]! + surface[k - nx]! + surface[k + nx]!) / 4);
  const raise = new Float32Array(n); let cells = 0, max = 0;
  for (let k = 0; k < n; k++) if (free[k]) { raise[k] = surface[k]! - raw[k]!; cells++; max = Math.max(max, raise[k]!); }
  return { x0, z0, nx, nz, raise, cells, max };
}

export class FilledTerrain implements HeightSampler {
  constructor(readonly base: HeightSampler, readonly fills: readonly Fill[]) {}
  sample(x: number, z: number): number {
    let raise = 0;
    for (const { x0, z0, nx, nz, raise: r } of this.fills) {
      const u = (x - x0) / STEP, v = (z - z0) / STEP;
      if (u < 0 || v < 0 || u >= nx - 1 || v >= nz - 1) continue;
      const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, k = j * nx + i;
      raise = Math.max(raise, (r[k]! * (1 - fu) + r[k + 1]! * fu) * (1 - fv) + (r[k + nx]! * (1 - fu) + r[k + nx + 1]! * fu) * fv);
    }
    return this.base.sample(x, z) + raise;
  }
}

/** MAP_FLATTEN_SUNKEN=0 keeps the raw DEM bowls. */
export function flattenSunkenPlazas(dem: HeightSampler, osm: OsmExtract, warnings: string[]): HeightSampler {
  if (process.env.MAP_FLATTEN_SUNKEN === '0') return dem;
  const found = extractPolygons(osm, sunkenPlaza, warnings);
  // One neighbourhood per cluster of plazas (Hallidie is two ways): merge overlapping padded bounds.
  const areas: { bounds: Bounds; names: string[] }[] = [];
  for (const { id, tags, polygon } of found) {
    const [a, b, c, d] = polygonBounds(polygon);
    let area = { bounds: [a - MARGIN, b - MARGIN, c + MARGIN, d + MARGIN] as Bounds, names: [String(tags.name ?? id)] };
    for (let i = areas.length - 1; i >= 0; i--) {
      const o = areas[i]!.bounds, m = area.bounds;
      if (o[0] > m[2] || m[0] > o[2] || o[1] > m[3] || m[1] > o[3]) continue;
      area = { bounds: [Math.min(o[0], m[0]), Math.min(o[1], m[1]), Math.max(o[2], m[2]), Math.max(o[3], m[3])], names: [...areas[i]!.names, ...area.names] };
      areas.splice(i, 1);
    }
    areas.push(area);
  }
  const fills = areas.map(({ bounds, names }) => {
    const fill = fillDepressions(bounds, dem);
    console.log(`Sunken plaza ${[...new Set(names)].join(' + ')}: filled ${fill.cells} cells (${STEP} m), max raise ${fill.max.toFixed(2)} m`);
    return fill;
  }).filter(f => f.cells);
  return fills.length ? new FilledTerrain(dem, fills) : dem;
}
