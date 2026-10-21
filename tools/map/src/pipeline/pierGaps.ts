import { contains, polygonBounds } from './geometry';
import { extractPolygons } from './osm';
import { FilledTerrain } from './sunkenPlazas';
import type { Bounds, HeightSampler, OsmExtract, Polygon } from './types';

/** Waterfront buildings and piers that OSM maps standing over the Bay (the Ferry Station Post Office on the
 * Embarcadero, the pier sheds) sit on bathymetry in the 3DEP DEM. Between such a footprint and the seawall bank the
 * bake left a 1-3 m strip of open water, which reads in game as a long blue crack beside the promenade (critic
 * openingDrive #4, docs/sf-data/shore-seams). Fill it: within GAP metres of both the footprint and dry land, raise
 * the underwater cells (and the footprint itself, which the building hides) to the surrounding land grade, relaxed
 * so the fill meets the bank smoothly. Open water further out keeps the raw DEM exactly. */
const STEP = 2, GAP = 8, MARGIN = 12, LAND = 0.5, ITERATIONS = 600;

function overWater(tags: Record<string, string | undefined>): boolean {
  return Boolean(tags.building) || tags.man_made === 'pier';
}

interface Fill { x0: number; z0: number; nx: number; nz: number; raise: Float32Array }

/** Exported for tests: the raise grid for one footprint (null when it doesn't stand over water next to land). */
export function pierGapFill(polygon: Polygon, dem: HeightSampler): (Fill & { cells: number; max: number }) | null {
  const [a, b, c, d] = polygonBounds(polygon);
  const x0 = a - MARGIN, z0 = b - MARGIN, nx = Math.ceil((c - a + 2 * MARGIN) / STEP) + 1, nz = Math.ceil((d - b + 2 * MARGIN) / STEP) + 1, n = nx * nz;
  const raw = new Float64Array(n), inside = new Uint8Array(n);
  let footprint = 0, wet = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = x0 + i * STEP, z = z0 + j * STEP;
    raw[k] = dem.sample(x, z);
    if (contains(polygon, [x, z])) { inside[k] = 1; footprint++; if (raw[k]! < LAND) wet++; }
  }
  // Only footprints that mostly stand over water; a dry building on the shore is left alone.
  if (footprint < 4 || wet < footprint * 0.3) return null;
  // Grid distance (metres, 4-neighbour BFS) to the footprint and to dry land.
  const distance = (seed: (k: number) => boolean) => {
    const dist = new Float32Array(n).fill(Infinity), queue: number[] = [];
    for (let k = 0; k < n; k++) if (seed(k)) { dist[k] = 0; queue.push(k); }
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q]!, i = k % nx, j = (k - i) / nx;
      for (const [u, v] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]] as const) {
        if (u < 0 || v < 0 || u >= nx || v >= nz) continue;
        const m = v * nx + u; if (dist[m]! <= dist[k]! + STEP) continue;
        dist[m] = dist[k]! + STEP; queue.push(m);
      }
    }
    return dist;
  };
  const toPier = distance(k => inside[k] === 1), toLand = distance(k => raw[k]! >= LAND);
  // Free cells: underwater, and either under the footprint near land or in the strip between footprint and land.
  const free = new Uint8Array(n); let cells = 0;
  for (let k = 0; k < n; k++) if (raw[k]! < LAND && toLand[k]! <= GAP && (inside[k] || toPier[k]! <= GAP)) { free[k] = 1; cells++; }
  if (!cells) return null;
  // Land grade: the median dry height within GAP of the free cells.
  const shore: number[] = [];
  for (let k = 0; k < n; k++) if (raw[k]! >= LAND && toPier[k]! <= 2 * GAP) shore.push(raw[k]!);
  if (!shore.length) return null;
  shore.sort((p, q) => p - q);
  const grade = shore[Math.floor(shore.length / 2)]!;
  // Relax: dry land is fixed at the raw DEM; free cells average their land/free neighbours (open water is ignored,
  // so the fill stays at grade toward the Bay instead of sagging into it). The border is never free (MARGIN > GAP
  // around the footprint keeps the raise zero at the grid edge, so the sampled surface is continuous).
  const surface = Float64Array.from(raw, (h, k) => free[k] ? grade : h);
  for (let it = 0; it < ITERATIONS; it++) for (let k = 0; k < n; k++) if (free[k]) {
    const i = k % nx, j = (k - i) / nx; let sum = 0, count = 0;
    for (const [u, v] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]] as const) {
      if (u < 0 || v < 0 || u >= nx || v >= nz) continue;
      const m = v * nx + u; if (!free[m] && raw[m]! < LAND) continue;
      sum += surface[m]!; count++;
    }
    if (count) surface[k] = sum / count;
  }
  const raise = new Float32Array(n); let max = 0;
  for (let k = 0; k < n; k++) if (free[k]) { raise[k] = Math.max(0, surface[k]! - raw[k]!); max = Math.max(max, raise[k]!); }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (!i || !j || i === nx - 1 || j === nz - 1) raise[j * nx + i] = 0;
  return { x0, z0, nx, nz, raise, cells, max };
}

/** MAP_FILL_PIER_GAPS=1 turns it on (off by default: the published bakes stay byte-identical until a reviewed bake). */
export function fillPierGaps(dem: HeightSampler, osm: OsmExtract, warnings: string[], bounds?: Bounds): HeightSampler {
  if (process.env.MAP_FILL_PIER_GAPS !== '1') return dem;
  const fills: Fill[] = [];
  let total = 0;
  for (const { polygon } of extractPolygons(osm, overWater, warnings)) {
    const [a, b, c, d] = polygonBounds(polygon);
    if (bounds && (c < bounds[0] || a > bounds[2] || d < bounds[1] || b > bounds[3])) continue;
    // A cheap pre-check before the grid: the footprint centre must be under water.
    if (dem.sample((a + c) / 2, (b + d) / 2) >= LAND) continue;
    const fill = pierGapFill(polygon, dem);
    if (fill) { fills.push(fill); total += fill.cells; }
  }
  console.log(`Pier gaps: filled ${fills.length} over-water footprints, ${total} cells (${STEP} m)`);
  return fills.length ? new FilledTerrain(dem, fills) : dem;
}
