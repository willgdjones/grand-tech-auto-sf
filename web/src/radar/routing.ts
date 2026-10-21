import { flags } from '@gtasf/shared/flags';
import type { RoadEdge, RoadGraph, RoadNode } from '@gtasf/shared/roadgraph';

type Point = [number, number, number];
/** The only edge fields the assembled router reads (gtasf-fddi / N16): a full RoadEdge fits, and so does a light edge built
 *  from a worker-sent typed view, which lets the router assemble without main's full-graph unpack. */
export interface RouterEdge { id: string; from: string; to: string; lengthM: number; points: readonly (readonly [number, number, number])[] }
export interface RoadSnap { edge: RouterEdge; point: Point; along: number; distance: number }
export interface MapRoute { points: Point[]; distanceM: number; approach: { x: number; y: number; z: number }; destinationDistanceM: number; mode?: 'walk' }
export interface MapRouter { route: (from: { x: number; y?: number; z: number }, to: { x: number; z: number }) => MapRoute | null; snap: (x: number, z: number, maxDistance?: number, referenceY?: number) => RoadSnap | null }

/** gtasf-fddi: the plain-data half of the routing index — everything buildRouterStructures produces and
 * assembleMapRouter closes over. Holds only typed arrays, Maps of ids->index/node and scalars (edge
 * references are kept by INDEX into graph.edges, never as objects), so the whole thing structured-clones
 * across a worker boundary and the typed arrays post as transferables. `nodes`/`cells` are the large Maps. */
export interface RouterStructures {
  nodes: Map<string, RoadNode>;
  outgoing: Map<string, number>;
  nextEdge: Uint32Array;
  laneEdges: Uint32Array;
  bounds: Float64Array;
  laneStamps: Float64Array;
  cells: Map<string, Uint32Array>;
  cellSize: number;
  minCellX: number; maxCellX: number; minCellZ: number; maxCellZ: number;
}

/** Default per-slice CPU budget for the incremental build (gtasf-a989): each generator step does at most
 * this many ms of work before yielding, so no single frame absorbs the whole ~412 ms (4x-throttled phone)
 * / ~135 ms (desktop) routing-index build. Tuned below the ~16 ms frame so a slice never alone busts budget. */
export const MAP_ROUTER_SLICE_MS = 6;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Directed source-lane routing. Never invent a straight line through an unmapped block.
 * Synchronous: drains the shared incremental builder with an unbounded budget, so the index it produces
 * is byte-identical to the sliced path — only WHEN the work happens differs (gtasf-a989). */
export function createMapRouter(graph: RoadGraph): MapRouter {
  const build = buildAndAssemble(graph, Infinity);
  let step = build.next();
  while (!step.done) step = build.next();
  return step.value;
}

/** gtasf-a989: the SAME build as createMapRouter, expressed as a generator that yields every ~budgetMs so a
 * driver (radar.ts) can spread it across frames/idle callbacks instead of blocking one frame for the whole
 * whole-city index. Drive with `let s = gen.next(); while (!s.done) { await nextFrame(); s = gen.next(); }`;
 * `s.value` is the finished router. Routes are identical to createMapRouter — same structures, same closures. */
export function createMapRouterIncremental(graph: RoadGraph, budgetMs = MAP_ROUTER_SLICE_MS): Generator<void, MapRouter, void> {
  return buildAndAssemble(graph, budgetMs);
}

/** The one build code path. With budgetMs = Infinity the yields never fire (drained synchronously); with a
 * finite budget it yields between slices. gtasf-fddi split this into buildRouterStructures (the plain-data
 * half, which a worker can run off-main) + assembleMapRouter (the closures); `yield*` keeps the slice yields
 * on exactly the same boundaries, so asyncMapRouter timing and every produced route are unchanged. */
function* buildAndAssemble(graph: RoadGraph, budgetMs: number): Generator<void, MapRouter, void> {
  const structures = yield* buildRouterStructures(graph, budgetMs);
  return assembleMapRouter(graph, structures);
}

/** gtasf-fddi: build ONLY the plain-data routing structures (the former first half of buildAndAssemble).
 * Yields on the SAME per-phase budget boundaries, so driving it with a finite budget slices identically to
 * before; with budgetMs = Infinity it drains in one pass (a worker uses that to build the whole-city index
 * off the main thread, then posts these structures back for assembleMapRouter). No runtime router state
 * lives here — `stamp` (snap's query counter) belongs to the assembled router, not the shared structures. */
export function* buildRouterStructures(graph: RoadGraph, budgetMs: number): Generator<void, RouterStructures, void> {
  const sliced = Number.isFinite(budgetMs);
  let sliceStart = sliced ? nowMs() : 0;

  const nodes = new Map<string, RoadNode>();
  for (let i = 0; i < graph.nodes.length; i++) {
    const node = graph.nodes[i]!; nodes.set(node.id, node);
    if (sliced && (i & 2047) === 2047 && nowMs() - sliceStart >= budgetMs) { yield; sliceStart = nowMs(); }
  }
  // One linked edge-index list per source node avoids retaining an Array for
  // every junction. Insert backwards so traversal still follows source order.
  const outgoing = new Map<string, number>(), nextEdge = new Uint32Array(graph.edges.length);
  for (let i = graph.edges.length - 1; i >= 0; i--) {
    const from = graph.edges[i]!.from;
    nextEdge[i] = outgoing.get(from) ?? 0; outgoing.set(from, i + 1);
    if (sliced && (i & 2047) === 0 && nowMs() - sliceStart >= budgetMs) { yield; sliceStart = nowMs(); }
  }
  let laneCount = 0;
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i]!; if (edge.id.startsWith('lane:') && edge.points.length >= 2) laneCount++;
    if (sliced && (i & 16383) === 16383 && nowMs() - sliceStart >= budgetMs) { yield; sliceStart = nowMs(); }
  }
  const laneEdges = new Uint32Array(laneCount), bounds = new Float64Array(laneCount * 4);
  const laneStamps = new Float64Array(laneCount); laneStamps.fill(-1);
  if (sliced && nowMs() - sliceStart >= budgetMs) { yield; sliceStart = nowMs(); }
  const cells = new Map<string, Uint32Array>(), cellSize = 128;
  let minCellX = Infinity, maxCellX = -Infinity, minCellZ = Infinity, maxCellZ = -Infinity;
  {
    const buildingCells = new Map<string, number[]>(); let lane = 0;
    for (let edgeIndex = 0; edgeIndex < graph.edges.length; edgeIndex++) {
      const edge = graph.edges[edgeIndex]!;
      // Junction connectors do not describe curb/drop-off lanes. Index each
      // complete lane, including segments whose endpoints are remote.
      if (!edge.id.startsWith('lane:') || edge.points.length < 2) continue;
      laneEdges[lane] = edgeIndex;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const point of edge.points) {
        minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]);
        minZ = Math.min(minZ, point[2]); maxZ = Math.max(maxZ, point[2]);
      }
      const offset = lane * 4;
      bounds[offset] = minX; bounds[offset + 1] = maxX; bounds[offset + 2] = minZ; bounds[offset + 3] = maxZ;
      const x0 = Math.floor(minX / cellSize), x1 = Math.floor(maxX / cellSize);
      const z0 = Math.floor(minZ / cellSize), z1 = Math.floor(maxZ / cellSize);
      minCellX = Math.min(minCellX, x0); maxCellX = Math.max(maxCellX, x1);
      minCellZ = Math.min(minCellZ, z0); maxCellZ = Math.max(maxCellZ, z1);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const key = `${x}_${z}`, cell = buildingCells.get(key) ?? []; cell.push(lane); buildingCells.set(key, cell);
      }
      lane++;
      if (sliced && (lane & 511) === 0 && nowMs() - sliceStart >= budgetMs) { yield; sliceStart = nowMs(); }
    }
    let finalized = 0;
    for (const [key, entries] of buildingCells) {
      cells.set(key, Uint32Array.from(entries));
      if (sliced && (++finalized & 2047) === 0 && nowMs() - sliceStart >= budgetMs) { yield; sliceStart = nowMs(); }
    }
  }
  return { nodes, outgoing, nextEdge, laneEdges, bounds, laneStamps, cells, cellSize, minCellX, maxCellX, minCellZ, maxCellZ };
}

/** gtasf-fddi: wrap built RouterStructures in the snap/path/slice/route closures. Byte-identical to the
 * former inline assembly in buildAndAssemble — createMapRouter[Incremental] and the worker-built path both
 * finish here, so a worker-produced index routes exactly as the synchronous build. `stamp` is per-router
 * runtime state (snap's query counter); the closures read graph.edges for snap/slice, so the MAIN thread
 * must hold the graph whose edge order matches the structures' indices. */
export function assembleMapRouter(graph: { readonly edges: readonly RouterEdge[] }, structures: RouterStructures): MapRouter {
  const { nodes, outgoing, nextEdge, laneEdges, bounds, laneStamps, cells, cellSize, minCellX, maxCellX, minCellZ, maxCellZ } = structures;
  let stamp = 0;
  function snap(x: number, z: number, maxDistance = 150, referenceY?: number, exclude?: ReadonlySet<RouterEdge>): RoadSnap | null {
    if (!Number.isFinite(x) || !Number.isFinite(z) || Number.isNaN(maxDistance) || maxDistance < 0
      || (referenceY !== undefined && !Number.isFinite(referenceY))) return null;
    let best: RoadSnap | null = null, bestOrder = Infinity;
    const query = ++stamp;
    for (let cx = Math.max(minCellX, Math.floor((x - maxDistance) / cellSize)); cx <= Math.min(maxCellX, Math.floor((x + maxDistance) / cellSize)); cx++) {
      for (let cz = Math.max(minCellZ, Math.floor((z - maxDistance) / cellSize)); cz <= Math.min(maxCellZ, Math.floor((z + maxDistance) / cellSize)); cz++) {
        for (const lane of cells.get(`${cx}_${cz}`) ?? []) {
          if (laneStamps[lane] === query) continue; laneStamps[lane] = query;
          const offset = lane * 4;
          if (bounds[offset + 1]! < x - maxDistance || bounds[offset]! > x + maxDistance || bounds[offset + 3]! < z - maxDistance || bounds[offset + 2]! > z + maxDistance) continue;
          const edge = graph.edges[laneEdges[lane]!]!;
          if (exclude?.has(edge)) continue;
          let along = 0;
          for (let i = 1; i < edge.points.length; i++) {
            const a = edge.points[i - 1]!, b = edge.points[i]!, dx = b[0] - a[0], dz = b[2] - a[2], length2 = dx * dx + dz * dz;
            const length = Math.hypot(dx, b[1] - a[1], dz), t = length2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / length2)) : 0;
            const point: Point = [a[0] + dx * t, a[1] + (b[1] - a[1]) * t, a[2] + dz * t];
            // Player height is authoritative. Keep curb/vehicle offsets, reject other decks.
            if (referenceY !== undefined && Math.abs(point[1] - referenceY) > 3) { along += length; continue; }
            const distance = Math.hypot(x - point[0], z - point[2]);
            // Grid traversal must not change the source-order tie break at junctions.
            if (distance <= maxDistance && (!best || distance < best.distance || (distance === best.distance && lane < bestOrder))) {
              best = { edge, point, along: along + length * t, distance }; bestOrder = lane;
            }
            along += length;
          }
        }
      }
    }
    return best;
  }
  // routerTypedAstar (gtasf-fddi): the same A* over integer node indices and typed arrays instead of string-keyed Maps and heap
  // objects. A 5-7 km plan was 130-290 ms of main thread on a 4x phone. Same pushes, pops and comparisons in the same order, so
  // routes are byte-identical. The index is built once, on the first plan.
  let typed: { index: Map<string, number>; has: Uint8Array; x: Float64Array; z: Float64Array; first: Int32Array; to: Int32Array;
    from: Int32Array; costs: Float64Array; seen: Uint32Array; prev: Int32Array; gen: number;
    hid: Int32Array; hpri: Float64Array; hcost: Float64Array } | null = null;
  function typedIndex() {
    if (typed) return typed;
    const edges = graph.edges, index = new Map<string, number>();
    for (const id of nodes.keys()) index.set(id, index.size);
    for (const e of edges) { if (!index.has(e.from)) index.set(e.from, index.size); if (!index.has(e.to)) index.set(e.to, index.size); }
    const n = index.size, has = new Uint8Array(n), x = new Float64Array(n), z = new Float64Array(n), first = new Int32Array(n);
    let i = 0; for (const node of nodes.values()) { has[i] = 1; x[i] = node.x; z[i] = node.z; i++; }
    for (const [id, k] of index) first[k] = outgoing.get(id) ?? 0;
    const to = new Int32Array(edges.length), from = new Int32Array(edges.length);
    for (let e = 0; e < edges.length; e++) { to[e] = index.get(edges[e]!.to)!; from[e] = index.get(edges[e]!.from)!; }
    typed = { index, has, x, z, first, to, from, costs: new Float64Array(n), seen: new Uint32Array(n), prev: new Int32Array(n), gen: 0,
      hid: new Int32Array(1024), hpri: new Float64Array(1024), hcost: new Float64Array(1024) };
    return typed;
  }
  function pathTyped(fromId: string, toId: string): RouterEdge[] | null {
    const t = typedIndex(), start = t.index.get(fromId), goalIndex = t.index.get(toId);
    if (start === undefined) return fromId === toId ? [] : null; // the Map version: nothing to expand
    if (++t.gen === 0xffffffff) { t.seen.fill(0); t.gen = 1; }
    const gen = t.gen, { has, x, z, first, costs, seen, prev } = t, edges = graph.edges;
    const goal = goalIndex !== undefined && has[goalIndex] ? goalIndex : -1, gx = goal >= 0 ? x[goal]! : 0, gz = goal >= 0 ? z[goal]! : 0;
    const cost = (k: number) => seen[k] === gen ? costs[k]! : Infinity;
    let size = 0;
    function push(id: number, c: number) {
      const priority = c + (goal >= 0 && has[id] ? Math.hypot(x[id]! - gx, z[id]! - gz) : 0);
      if (size === t.hid.length) { const grow = <T extends Int32Array | Float64Array>(a: T, ctor: new (n: number) => T) => { const b = new ctor(a.length * 2); b.set(a); return b; };
        t.hid = grow(t.hid, Int32Array); t.hpri = grow(t.hpri, Float64Array); t.hcost = grow(t.hcost, Float64Array); }
      const hid = t.hid, hpri = t.hpri, hcost = t.hcost;
      let index = size++; hid[index] = id; hpri[index] = priority; hcost[index] = c;
      while (index > 0) { const parent = (index - 1) >> 1; if (hpri[parent]! <= priority) break;
        const pi = hid[parent]!, pp = hpri[parent]!, pc = hcost[parent]!; hid[parent] = hid[index]!; hpri[parent] = hpri[index]!; hcost[parent] = hcost[index]!;
        hid[index] = pi; hpri[index] = pp; hcost[index] = pc; index = parent; }
    }
    seen[start] = gen; costs[start] = 0; push(start, 0);
    while (size) {
      const hid = t.hid, hpri = t.hpri, hcost = t.hcost, current = hid[0]!, currentCost = hcost[0]!;
      size--;
      if (size) {
        hid[0] = hid[size]!; hpri[0] = hpri[size]!; hcost[0] = hcost[size]!; let index = 0;
        while (true) { let next = index; const left = index * 2 + 1, right = left + 1;
          if (left < size && hpri[left]! < hpri[next]!) next = left;
          if (right < size && hpri[right]! < hpri[next]!) next = right;
          if (next === index) break;
          const ni = hid[index]!, np = hpri[index]!, nc = hcost[index]!; hid[index] = hid[next]!; hpri[index] = hpri[next]!; hcost[index] = hcost[next]!;
          hid[next] = ni; hpri[next] = np; hcost[next] = nc; index = next; }
      }
      if (currentCost !== cost(current)) continue;
      if (current === goalIndex) {
        const result: RouterEdge[] = []; let node = current;
        while (node !== start) { const e = prev[node]!; result.push(edges[e]!); node = t.from[e]!; }
        return result.reverse();
      }
      for (let entry = first[current]!; entry !== 0; entry = nextEdge[entry - 1]!) {
        const e = entry - 1, next = t.to[e]!, c = currentCost + Math.max(.001, edges[e]!.lengthM);
        if (c >= cost(next)) continue;
        seen[next] = gen; costs[next] = c; prev[next] = e; push(next, c);
      }
    }
    return null;
  }
  function path(from: string, to: string): RouterEdge[] | null {
    if (flags.routerTypedAstar) return pathTyped(from, to);
    // Binary min-heap keeps route choices cheap on the complete city graph.
    const heap: { id: string; priority: number; cost: number }[] = [], costs = new Map([[from, 0]]), previous = new Map<string, RouterEdge>();
    const goal = nodes.get(to);
    function push(id: string, cost: number) {
      const node = nodes.get(id), priority = cost + (goal && node ? Math.hypot(node.x - goal.x, node.z - goal.z) : 0);
      let index = heap.length; heap.push({ id, priority, cost });
      while (index > 0) { const parent = (index - 1) >> 1; if (heap[parent]!.priority <= priority) break; [heap[parent], heap[index]] = [heap[index]!, heap[parent]!]; index = parent; }
    }
    function pop() {
      const result = heap[0]!, last = heap.pop()!;
      if (heap.length) {
        heap[0] = last; let index = 0;
        while (true) { let next = index, left = index * 2 + 1, right = left + 1;
          if (left < heap.length && heap[left]!.priority < heap[next]!.priority) next = left;
          if (right < heap.length && heap[right]!.priority < heap[next]!.priority) next = right;
          if (next === index) break; [heap[index], heap[next]] = [heap[next]!, heap[index]!]; index = next;
        }
      }
      return result;
    }
    push(from, 0);
    while (heap.length) {
      const current = pop(); if (current.cost !== costs.get(current.id)) continue;
      if (current.id === to) {
        const result: RouterEdge[] = []; let node = to;
        while (node !== from) { const edge = previous.get(node)!; result.push(edge); node = edge.from; }
        return result.reverse();
      }
      for (let entry = outgoing.get(current.id) ?? 0; entry !== 0; entry = nextEdge[entry - 1]!) {
        const edge = graph.edges[entry - 1]!;
        const cost = current.cost + Math.max(.001, edge.lengthM);
        if (cost >= (costs.get(edge.to) ?? Infinity)) continue;
        costs.set(edge.to, cost); previous.set(edge.to, edge); push(edge.to, cost);
      }
    }
    return null;
  }
  function slice(edge: RouterEdge, from = 0, to = Infinity): Point[] {
    const points: Point[] = []; let along = 0;
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1]!, b = edge.points[i]!, length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (length > 0 && from <= along + length && to >= along) {
        for (const t of [Math.max(0, (from - along) / length), Math.min(1, (to - along) / length)]) points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
      along += length;
    }
    return points;
  }
  function route(from: { x: number; y?: number; z: number }, to: { x: number; z: number }): MapRoute | null {
    // Event/landmark destination Y may be an unloaded fallback; only use the player's Y.
    const start = snap(from.x, from.z, 150, from.y), end = snap(to.x, to.z);
    if (!start || !end) return null;
    const direct = join(start, end);
    if (direct || !flags.routeSnapFallback) return direct;
    // routeSnapFallback (lane E 10-20: a job leg from the Caltrain / Moscone stop was unroutable until the player moved): the
    // nearest lane to a point by stacked roads can be an on-ramp or a one-way into a piece with no way on. A walker doesn't
    // care about lane direction, so try the next-nearest start lanes, then one other end lane. At most 4 more paths; a route
    // that already succeeds is unchanged.
    const tried = new Set<RouterEdge>([start.edge]);
    for (let i = 0; i < 3; i++) {
      const next = snap(from.x, from.z, 150, from.y, tried); if (!next) break;
      tried.add(next.edge); const alt = join(next, end); if (alt) return alt;
    }
    const otherEnd = snap(to.x, to.z, 150, undefined, new Set([end.edge]));
    return otherEnd ? join(start, otherEnd) : null;
  }
  function join(start: RoadSnap, end: RoadSnap): MapRoute | null {
    let points: Point[];
    if (start.edge === end.edge && end.along >= start.along) points = slice(start.edge, start.along, end.along);
    else {
      const middle = path(start.edge.to, end.edge.from); if (!middle) return null;
      points = [...slice(start.edge, start.along), ...middle.flatMap(edge => slice(edge)), ...slice(end.edge, 0, end.along)];
    }
    let distanceM = 0;
    for (let i = 1; i < points.length; i++) distanceM += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1], points[i]![2] - points[i - 1]![2]);
    return { points, distanceM, approach: { x: end.point[0], y: end.point[1], z: end.point[2] }, destinationDistanceM: end.distance };
  }
  return { route, snap };
}

/** gtasf-fddi / N16: the routable edges as transferable typed arrays (what the assembled router reads), so a worker can hand
 *  them to main and the router assembles without main's full-graph unpack. Float64 keeps coordinates bit-exact. */
export interface RouterEdgeView {
  ids: string[]; nodeIds: string[]; from: Uint32Array; to: Uint32Array; lengthM: Float64Array;
  pointOffsets: Uint32Array; points: Float64Array;
}
export function encodeRouterEdges(graph: { readonly edges: readonly RouterEdge[] }): RouterEdgeView {
  const edges = graph.edges, nodeIndex = new Map<string, number>(), nodeIds: string[] = [];
  const index = (id: string) => { let i = nodeIndex.get(id); if (i === undefined) { i = nodeIds.length; nodeIds.push(id); nodeIndex.set(id, i); } return i; };
  let pointCount = 0; for (const edge of edges) pointCount += edge.points.length;
  const from = new Uint32Array(edges.length), to = new Uint32Array(edges.length), lengthM = new Float64Array(edges.length);
  const pointOffsets = new Uint32Array(edges.length + 1), points = new Float64Array(pointCount * 3), ids = new Array<string>(edges.length);
  let cursor = 0;
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]!; ids[i] = edge.id; from[i] = index(edge.from); to[i] = index(edge.to); lengthM[i] = edge.lengthM;
    pointOffsets[i] = cursor / 3;
    for (const point of edge.points) { points[cursor++] = point[0]; points[cursor++] = point[1]; points[cursor++] = point[2]; }
  }
  pointOffsets[edges.length] = cursor / 3;
  return { ids, nodeIds, from, to, lengthM, pointOffsets, points };
}
/** classRouterEdges (lane B, from the late-opening profile): the object-literal edges below allocate an object, a getter
 *  and a closure per edge, and decoding the whole-city view that way was most of a 1.9 s long task on a 4x phone. One
 *  class instance per edge with a shared prototype getter is ~12x cheaper (150k edges: ~300 -> ~22 ms, node). Same fields;
 *  nothing spreads or key-iterates edges (the router reads them by index), so the prototype getter is safe. */
class ViewEdge implements RouterEdge {
  readonly id: string; readonly from: string; readonly to: string; readonly lengthM: number;
  private cached: [number, number, number][] | undefined;
  constructor(private readonly view: RouterEdgeView, private readonly index: number) {
    this.id = view.ids[index]!; this.from = view.nodeIds[view.from[index]!]!; this.to = view.nodeIds[view.to[index]!]!; this.lengthM = view.lengthM[index]!;
  }
  get points(): [number, number, number][] {
    if (!this.cached) {
      const v = this.view, out: [number, number, number][] = [];
      for (let p = v.pointOffsets[this.index]!; p < v.pointOffsets[this.index + 1]!; p++) out.push([v.points[p * 3]!, v.points[p * 3 + 1]!, v.points[p * 3 + 2]!]);
      this.cached = out;
    }
    return this.cached;
  }
}
/** Light RouterEdges over a view; each edge's points array is built on first access (snap only touches nearby lanes). */
export function decodeRouterEdges(view: RouterEdgeView): { edges: RouterEdge[] } {
  const edges = new Array<RouterEdge>(view.ids.length);
  if (flags.classRouterEdges) { for (let i = 0; i < edges.length; i++) edges[i] = new ViewEdge(view, i); return { edges }; }
  for (let i = 0; i < edges.length; i++) {
    let cached: [number, number, number][] | undefined;
    edges[i] = { id: view.ids[i]!, from: view.nodeIds[view.from[i]!]!, to: view.nodeIds[view.to[i]!]!, lengthM: view.lengthM[i]!,
      get points() {
        if (!cached) { cached = []; for (let p = view.pointOffsets[i]!; p < view.pointOffsets[i + 1]!; p++) cached.push([view.points[p * 3]!, view.points[p * 3 + 1]!, view.points[p * 3 + 2]!]); }
        return cached;
      } };
  }
  return { edges };
}
