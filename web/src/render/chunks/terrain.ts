import type { RoadGraph } from '@gtasf/shared/roadgraph';
import { flags } from '@gtasf/shared/flags';

export interface Heightfield { size: number; step: number; baseCm: number; x: number; z: number; values: Uint16Array }
export interface BuildingFootprint { id: string; minY: number; maxY: number; rings: [number, number][][] }
export interface ChunkCollision { version: 1; origin: [number, number, number]; buildings: BuildingFootprint[] }

export function decodeHeightfield(buffer: ArrayBuffer): Heightfield {
  const view = new DataView(buffer);
  if (view.byteLength < 32 || view.getUint32(0, false) !== 0x47544846 || view.getUint16(4, true) !== 1) throw new Error('Invalid GTHF map data');
  const size = view.getUint16(6, true), step = view.getFloat32(8, true);
  if (size < 2 || view.byteLength !== 32 + size * size * 2 || !Number.isFinite(step) || step <= 0 || Math.abs(view.getFloat32(24, true) - .01) > 1e-8) throw new Error('Invalid GTHF dimensions');
  const values = new Uint16Array(size * size);
  for (let i = 0; i < values.length; i++) values[i] = view.getUint16(32 + i * 2, true);
  return { size, step, baseCm: view.getInt32(12, true), x: view.getInt32(16, true), z: view.getInt32(20, true), values };
}

export function sampleHeight(field: Heightfield, x: number, z: number): number | null {
  const span = (field.size - 1) * field.step;
  const u = (x - field.x * span) / field.step, v = (z - field.z * span) / field.step;
  if (u < 0 || v < 0 || u > field.size - 1 || v > field.size - 1) return null;
  const ix = Math.min(field.size - 2, Math.floor(u)), iz = Math.min(field.size - 2, Math.floor(v));
  const a = u - ix, b = v - iz, i = iz * field.size + ix;
  const top = field.values[i]! * (1 - a) + field.values[i + 1]! * a;
  const bottom = field.values[i + field.size]! * (1 - a) + field.values[i + field.size + 1]! * a;
  return (field.baseCm + top * (1 - b) + bottom * b) / 100;
}

/** Small spatial buckets avoid scanning the whole city's polylines every movement tick. */
function* roadSamplerSteps(graph: RoadGraph) {
  // Geometry stays in the immutable source graph. Typed segment references keep
  // the citywide broad phase out of the garbage collector's object traversal.
  let capacity = 0;
  for (const edge of graph.edges) capacity += Math.max(0, edge.points.length - 1);
  const edgeIds = new Uint32Array(capacity), pointIds = new Uint32Array(capacity), elevated = new Uint8Array(capacity);
  // gtasf-c8sj: flat segment endpoints (ax,ay,az,bx,by,bz) so the hot query skips edge/point object hops.
  const flat = flags.fastRoadSampler ? new Float32Array(capacity * 6) : undefined;
  const cells = new Map<number, Map<number, number[]>>(), step = 32;
  let count = 0;
  for (let edgeId = 0; edgeId < graph.edges.length; edgeId++) {
    if ((edgeId & INDEX_SLICE) === INDEX_SLICE) yield;
    const edge = graph.edges[edgeId]!;
    const metadata = edge as typeof edge & { bridge?: boolean; tunnel?: boolean; layer?: number };
    const raised = metadata.bridge || metadata.tunnel || metadata.layer ? 1 : 0;
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1]!, b = edge.points[i]!, id = count++;
      edgeIds[id] = edgeId; pointIds[id] = i; elevated[id] = raised;
      if (flat) { const o = id * 6; flat[o] = a[0]; flat[o + 1] = a[1]; flat[o + 2] = a[2]; flat[o + 3] = b[0]; flat[o + 4] = b[1]; flat[o + 5] = b[2]; }
      for (let x = Math.floor((Math.min(a[0], b[0]) - 4) / step); x <= Math.floor((Math.max(a[0], b[0]) + 4) / step); x++) {
        let column = cells.get(x);
        if (!column) { column = new Map(); cells.set(x, column); }
        for (let z = Math.floor((Math.min(a[2], b[2]) - 4) / step); z <= Math.floor((Math.max(a[2], b[2]) + 4) / step); z++) {
          let cell = column.get(z);
          if (!cell) { cell = []; column.set(z, cell); }
          cell.push(id);
        }
      }
    }
  }
  function sample(x: number, z: number, referenceY: number | undefined, firstMatch: boolean): number | null {
    const cell = cells.get(Math.floor(x / step))?.get(Math.floor(z / step));
    if (!cell) return null;
    let nearest = Infinity, height: number | null = null;
    for (const id of cell) {
      let ax: number, ay: number, az: number, bx: number, by: number, bz: number;
      if (flat) { const o = id * 6; ax = flat[o]!; ay = flat[o + 1]!; az = flat[o + 2]!; bx = flat[o + 3]!; by = flat[o + 4]!; bz = flat[o + 5]!; }
      else {
        const points = graph.edges[edgeIds[id]!]!.points, pointId = pointIds[id]!;
        const a = points[pointId - 1]!, b = points[pointId]!; ax = a[0]; ay = a[1]; az = a[2]; bx = b[0]; by = b[1]; bz = b[2];
      }
      const dx = bx - ax, dz = bz - az, length2 = dx * dx + dz * dz;
      const t = length2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length2)) : 0;
      const y = ay + (by - ay) * t;
      // A surface lane under a bridge must not win merely because it is closer
      // in XZ. Keep every candidate on the player's current vertical level.
      if ((elevated[id] && referenceY === undefined) || (referenceY !== undefined && Math.abs(referenceY - y) > 5)) continue;
      const distance2 = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2;
      if (distance2 >= 3.5 * 3.5) continue;
      // At a tunnel portal, a street only four metres overhead still passes the
      // broad level filter. Wheel samples must prefer the continuing bore over
      // a marginally closer segment at that different elevation.
      const score = distance2 + (referenceY === undefined ? 0 : 4 * (referenceY - y) ** 2);
      if (score < nearest) {
        // Placement only needs to know whether any lane matches. Keep the same
        // radius, level and finite-score rules as the nearest-height query.
        if (firstMatch) return y;
        nearest = score; height = y;
      }
    }
    return height;
  }
  return Object.assign((x: number, z: number, referenceY?: number) => sample(x, z, referenceY, false), {
    contains: (x: number, z: number, referenceY?: number) => sample(x, z, referenceY, true) !== null,
  });
}

/** Exact nearest polyline point with a spatial broad phase; original graph order breaks ties. */
function* roadSnapperSteps(graph: RoadGraph) {
  // The immutable source graph already owns every point. Keep numeric segment
  // references instead of a separate object for every city segment.
  let capacity = 0;
  for (const edge of graph.edges) capacity += Math.max(0, edge.points.length - 1);
  const edgeIds = new Uint32Array(capacity), pointIds = new Uint32Array(capacity), stamps = new Uint32Array(capacity);
  const cells = new Map<number, Map<number, number[]>>(), step = 64;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, order = 0, stamp = 0;
  for (let edgeId = 0; edgeId < graph.edges.length; edgeId++) {
    if ((edgeId & INDEX_SLICE) === INDEX_SLICE) yield;
    const edge = graph.edges[edgeId]!;
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1]!, b = edge.points[i]!, dx = b[0] - a[0], dz = b[2] - a[2];
      if (!(dx * dx + dz * dz)) continue;
      const id = order++; edgeIds[id] = edgeId; pointIds[id] = i;
      const x0 = Math.floor(Math.min(a[0], b[0]) / step), x1 = Math.floor(Math.max(a[0], b[0]) / step);
      const z0 = Math.floor(Math.min(a[2], b[2]) / step), z1 = Math.floor(Math.max(a[2], b[2]) / step);
      minX = Math.min(minX, x0); maxX = Math.max(maxX, x1); minZ = Math.min(minZ, z0); maxZ = Math.max(maxZ, z1);
      for (let x = x0; x <= x1; x++) {
        let column = cells.get(x);
        if (!column) { column = new Map(); cells.set(x, column); }
        for (let z = z0; z <= z1; z++) {
          let cell = column.get(z);
          if (!cell) { cell = []; column.set(z, cell); }
          cell.push(id);
        }
      }
    }
  }
  return (x: number, z: number, maxDistance = 100): { x: number; y: number; z: number; yaw: number } | null => {
    if (!Number.isFinite(x) || !Number.isFinite(z) || Number.isNaN(maxDistance)) return null;
    // Zero denotes an untouched segment, including after the 32-bit wrap.
    stamp = (stamp + 1) >>> 0;
    if (!stamp) { stamps.fill(0); stamp = 1; }
    const radius = Math.abs(maxDistance), query = stamp;
    let best = radius ** 2, bestOrder = Infinity, result: { x: number; y: number; z: number; yaw: number } | null = null;
    for (let cx = Math.max(minX, Math.floor((x - radius) / step)); cx <= Math.min(maxX, Math.floor((x + radius) / step)); cx++) {
      const column = cells.get(cx);
      if (!column) continue;
      for (let cz = Math.max(minZ, Math.floor((z - radius) / step)); cz <= Math.min(maxZ, Math.floor((z + radius) / step)); cz++) {
        const cell = column.get(cz);
        if (!cell) continue;
        for (const id of cell) {
          if (stamps[id] === query) continue; stamps[id] = query;
          const points = graph.edges[edgeIds[id]!]!.points, pointId = pointIds[id]!;
          const a = points[pointId - 1]!, b = points[pointId]!, dx = b[0] - a[0], dz = b[2] - a[2], length2 = dx * dx + dz * dz;
          const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / length2));
          const px = a[0] + dx * t, pz = a[2] + dz * t, distance2 = (x - px) ** 2 + (z - pz) ** 2;
          if (distance2 < best || (result && distance2 === best && id < bestOrder)) {
            best = distance2; bestOrder = id; result = { x: px, y: a[1] + (b[1] - a[1]) * t, z: pz, yaw: Math.atan2(dx, dz) };
          }
        }
      }
    }
    return result;
  };
}

function inRing(x: number, z: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Full polygon and courtyard boundaries; camera boxes are intentionally a separate API. */
export function circleHitsBuilding(building: BuildingFootprint, x: number, z: number, radius: number): boolean {
  if (building.rings[0] && inRing(x, z, building.rings[0])) {
    let inCourtyard = false;
    for (let i = 1; i < building.rings.length; i++) {
      if (inRing(x, z, building.rings[i]!)) { inCourtyard = true; break; }
    }
    if (!inCourtyard) return true;
  }
  for (const ring of building.rings) for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!, dx = b[0] - a[0], dz = b[1] - a[1];
    const length2 = dx * dx + dz * dz;
    const t = length2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / length2)) : 0;
    if ((x - a[0] - dx * t) ** 2 + (z - a[1] - dz * t) ** 2 < radius * radius) return true;
  }
  return false;
}

interface IndexedBuilding {
  building: BuildingFootprint; originX: number; originZ: number;
  minX: number; maxX: number; minZ: number; maxZ: number; stamp: number;
}
/** Spatial broad phase for the many sphere samples made by the follow camera each frame. */
export class FootprintIndex {
  // Numeric columns avoid allocating a string and an empty array for every
  // camera sphere or metre of overhead wire checked against the same cells.
  private cells = new Map<number, Map<number, IndexedBuilding[]>>();
  private stamp = 0;
  readonly stats = { queries: 0, candidates: 0, polygonTests: 0 };
  rebuild(chunks: Iterable<ChunkCollision>): void {
    this.cells.clear();
    const seen = new Set<string>();
    for (const chunk of chunks) for (const building of chunk.buildings) {
      if (seen.has(building.id)) continue;
      seen.add(building.id);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const point of building.rings[0] ?? []) {
        const x = point[0] + chunk.origin[0], z = point[1] + chunk.origin[2];
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      if (!Number.isFinite(minX)) continue;
      const item: IndexedBuilding = { building, originX: chunk.origin[0], originZ: chunk.origin[2], minX, maxX, minZ, maxZ, stamp: -1 };
      for (let x = Math.floor(minX / 32); x <= Math.floor(maxX / 32); x++) {
        let column = this.cells.get(x);
        if (!column) { column = new Map(); this.cells.set(x, column); }
        for (let z = Math.floor(minZ / 32); z <= Math.floor(maxZ / 32); z++) {
          let cell = column.get(z);
          if (!cell) { cell = []; column.set(z, cell); }
          cell.push(item);
        }
      }
    }
  }
  collides(x: number, y: number, z: number, radius: number, height: number): boolean {
    const stamp = ++this.stamp; this.stats.queries++;
    for (let cx = Math.floor((x - radius) / 32); cx <= Math.floor((x + radius) / 32); cx++) {
      const column = this.cells.get(cx);
      if (!column) continue;
      for (let cz = Math.floor((z - radius) / 32); cz <= Math.floor((z + radius) / 32); cz++) {
        const cell = column.get(cz);
        if (!cell) continue;
        for (const item of cell) {
          if (item.stamp === stamp) continue; item.stamp = stamp; this.stats.candidates++;
          if (x + radius < item.minX || x - radius > item.maxX || z + radius < item.minZ || z - radius > item.maxZ) continue;
          if (y + height <= item.building.minY || y >= item.building.maxY) continue;
          this.stats.polygonTests++;
          if (circleHitsBuilding(item.building, x - item.originX, z - item.originZ, radius)) return true;
        }
      }
    }
    return false;
  }
}

/** gtasf-0k01: city-wide road indices are built in slices (a yield every 512 edges: ~1 ms desktop, a few ms on a throttled phone),
 *  so swapping in the full graph after READY never blocks the main thread for ~1 s. The sync builders below run
 *  the same steps to completion. */
export const INDEX_SLICE = 511;
export function runIndexSteps<T>(steps: Generator<void, T>): T {
  for (;;) { const next = steps.next(); if (next.done) return next.value; }
}
/** Runs index steps, awaiting between() after each 512-edge step — or, with roadIndexBursts, only after ~budgetMs of work.
 *  roadIndexBursts (c6aa0f54) finished the three city-wide indexes far sooner (per-step yields took ~80 s after READY on a
 *  throttled phone) but its chained 12 ms bursts held ~75% of a frame-bound phone's main thread while they ran: lane D's
 *  #6.42 bisect pinned the idle phone gate's 2x drop on that commit (7-10 fps vs 21-26 at its parent). Off until a paced
 *  variant (slicesFramePaced) passes the gate. */
export async function runIndexStepsSliced<T>(steps: Generator<void, T>, between: () => Promise<void>, budgetMs = flags.roadIndexBursts ? 12 : 0): Promise<T> {
  let started = performance.now();
  for (;;) {
    const next = steps.next(); if (next.done) return next.value;
    if (performance.now() - started >= budgetMs) { await between(); started = performance.now(); }
  }
}
export function createRoadSampler(graph: RoadGraph) { return runIndexSteps(roadSamplerSteps(graph)); }
export function createRoadSamplerSliced(graph: RoadGraph, between: () => Promise<void>) { return runIndexStepsSliced(roadSamplerSteps(graph), between); }
export function createRoadSnapper(graph: RoadGraph) { return runIndexSteps(roadSnapperSteps(graph)); }
export function createRoadSnapperSliced(graph: RoadGraph, between: () => Promise<void>) { return runIndexStepsSliced(roadSnapperSteps(graph), between); }
