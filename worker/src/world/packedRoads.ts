import type { Point } from '@gtasf/shared/protocol/types';
import type { RoadEdge } from '@gtasf/shared/roadgraph';
import { ROAD_EDGE_FLAGS, type PackedRoadGraph, type PackedPublicEdge, type PackedPublicNode } from '@gtasf/shared/roadgraphPacked';
import { LocalRoads, routeLength, type RoadSnap, type RouteSegment } from './localRoads';

type Vec = [number, number, number];
const CELL_M = 128;
const distance = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lerp = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Whole-city routing keeps the binary columns resident and decodes only nearby/used roads. */
export class PackedRoads extends LocalRoads {
  private readonly outgoingOffsets: Uint32Array;
  private readonly outgoingEdges: Uint32Array;
  private readonly incomingOffsets: Uint32Array;
  private readonly incomingEdges: Uint32Array;
  private readonly cells: Uint32Array;
  private readonly cellEdges: Uint32Array;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly width: number;
  private readonly height: number;
  private readonly edges = new Map<number, PackedPublicEdge>();
  private readonly indices = new WeakMap<RoadEdge, number>();
  private readonly visited: Uint32Array;
  private searchId = 0;
  private readonly cost: Float64Array;
  private readonly previous: Uint32Array;
  private readonly pathCache = new Map<string, number[]>();
  readonly retainedBytes: number;

  constructor(readonly packed: PackedRoadGraph) {
    super({ version: 1, nodes: [], edges: [] });
    const c = packed.columns, n = packed.counts.nodes, e = packed.counts.edges;
    const adjacency = (nodes: Uint32Array) => {
      const offsets = new Uint32Array(n + 1);
      for (let i = 0; i < e; i++) if (this.routable(i)) offsets[nodes[i]! + 1]!++;
      for (let i = 1; i < offsets.length; i++) offsets[i]! += offsets[i - 1]!;
      const edges = new Uint32Array(offsets[n]!), cursor = offsets.slice();
      for (let i = 0; i < e; i++) if (this.routable(i)) edges[cursor[nodes[i]!]!++] = i;
      return { offsets, edges };
    };
    const out = adjacency(c.edgeFrom), incoming = adjacency(c.edgeTo);
    this.outgoingOffsets = out.offsets; this.outgoingEdges = out.edges;
    this.incomingOffsets = incoming.offsets; this.incomingEdges = incoming.edges;
    // Bounding cells include curved interiors, not only the lane endpoints.
    const boxes = new Int32Array(e * 4);
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < e; i++) {
      if (!this.routable(i) || c.edgeFlags[i]! & ROAD_EDGE_FLAGS.connector) continue;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const p of packed.edgePoints(i)) { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[2]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[2]); }
      x0 = Math.floor(x0 / CELL_M); z0 = Math.floor(z0 / CELL_M); x1 = Math.floor(x1 / CELL_M); z1 = Math.floor(z1 / CELL_M);
      boxes.set([x0, z0, x1, z1], i * 4);
      minX = Math.min(minX, x0); minZ = Math.min(minZ, z0); maxX = Math.max(maxX, x1); maxZ = Math.max(maxZ, z1);
    }
    if (!Number.isFinite(minX)) { minX = minZ = maxX = maxZ = 0; }
    this.minX = minX; this.minZ = minZ; this.width = maxX - minX + 1; this.height = maxZ - minZ + 1;
    if (this.width * this.height > 1_000_000) throw new Error('ROAD_PACK_SPATIAL_BOUNDS');
    this.cells = new Uint32Array(this.width * this.height + 1);
    const visit = (fn: (edge: number, cell: number) => void) => {
      for (let i = 0; i < e; i++) {
        if (!this.routable(i) || c.edgeFlags[i]! & ROAD_EDGE_FLAGS.connector) continue;
        const at = i * 4;
        for (let z = boxes[at + 1]!; z <= boxes[at + 3]!; z++) for (let x = boxes[at]!; x <= boxes[at + 2]!; x++) fn(i, (z - minZ) * this.width + x - minX);
      }
    };
    visit((_, cell) => { this.cells[cell + 1]!++; });
    for (let i = 1; i < this.cells.length; i++) this.cells[i]! += this.cells[i - 1]!;
    if (this.cells.at(-1)! > 4_000_000) throw new Error('ROAD_PACK_SPATIAL_SIZE');
    this.cellEdges = new Uint32Array(this.cells.at(-1)!);
    const cursor = this.cells.slice(); visit((edge, cell) => { this.cellEdges[cursor[cell]!++] = edge; });
    this.visited = new Uint32Array(e + 1); this.cost = new Float64Array(e + 1); this.previous = new Uint32Array(e + 1);
    this.retainedBytes = packed.bytes.byteLength + [this.outgoingOffsets, this.outgoingEdges, this.incomingOffsets, this.incomingEdges,
      this.cells, this.cellEdges, this.visited, this.cost, this.previous].reduce((sum, a) => sum + a.byteLength, 0);
  }
  private routable(index: number) { return !!(this.packed.columns.edgeFlags[index]! & ROAD_EDGE_FLAGS.routable); }
  private edge(index: number): PackedPublicEdge {
    const old = this.edges.get(index);
    if (old) { this.edges.delete(index); this.edges.set(index, old); return old; }
    const value = this.packed.edge(index); this.indices.set(value, index); this.edges.set(index, value);
    if (this.edges.size > 2048) this.edges.delete(this.edges.keys().next().value!);
    return value;
  }
  private candidates(x: number, z: number, radius: number): Set<number> {
    const result = new Set<number>();
    const x0 = Math.max(0, Math.floor((x - radius) / CELL_M) - this.minX), x1 = Math.min(this.width - 1, Math.floor((x + radius) / CELL_M) - this.minX);
    const z0 = Math.max(0, Math.floor((z - radius) / CELL_M) - this.minZ), z1 = Math.min(this.height - 1, Math.floor((z + radius) / CELL_M) - this.minZ);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const cell = cz * this.width + cx;
      for (let i = this.cells[cell]!; i < this.cells[cell + 1]!; i++) result.add(this.cellEdges[i]!);
    }
    return result;
  }
  /** Decode only spatial candidates, including curved interiors; unlike traffic, do not truncate at 128. */
  override lanesNear(point: { x: number; z: number }, radius: number): readonly RoadEdge[] {
    return [...this.candidates(point.x, point.z, radius)].map(index => this.edge(index));
  }
  override snap(point: Point, maximumM = 35, maximumHeightM = Infinity): RoadSnap | undefined {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z) || !Number.isFinite(maximumM) || maximumM < 0) return;
    const x = point.x / 100, z = point.z / 100;
    const useHeight = Number.isFinite(maximumHeightM);
    if (useHeight && (!Number.isFinite(point.y) || maximumHeightM < 0)) return;
    let best: RoadSnap | undefined;
    let bestScore = Infinity;
    for (const index of this.candidates(x, z, maximumM)) {
      const edge = this.edge(index); let along = 0;
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1]!, b = edge.points[i]!, length = distance(a, b);
        if (!length) continue;
        const dx = b[0] - a[0], dz = b[2] - a[2], d = dx * dx + dz * dz;
        const t = d ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / d)) : 0;
        const projected = lerp(a, b, t), separation = Math.hypot(x - projected[0], z - projected[2]);
        const vertical = useHeight ? Math.abs(point.y / 100 - projected[1]) : 0;
        const score = Math.hypot(separation, vertical);
        if (separation <= maximumM && vertical <= maximumHeightM && score < bestScore) {
          best = { edge, point: projected, along: along + t * length, distance: separation };
          bestScore = score;
        }
        along += length;
      }
    }
    return best;
  }
  /** Traffic queries only occupied areas; full-city edges are never eagerly decoded. */
  nearbyEdges(points: readonly { x: number; z: number }[], radius: number): RoadEdge[] {
    const candidates = new Set<number>();
    const c = this.packed.columns;
    for (const point of points) {
      const proximity = (index: number) => {
        const a = c.edgeFrom[index]! * 3, b = c.edgeTo[index]! * 3;
        return Math.min((c.nodeXYZ[a]! / 100 - point.x) ** 2 + (c.nodeXYZ[a + 2]! / 100 - point.z) ** 2,
          (c.nodeXYZ[b]! / 100 - point.x) ** 2 + (c.nodeXYZ[b + 2]! / 100 - point.z) ** 2);
      };
      // A traffic source needs a bounded local choice, not every lane in a crowded city.
      for (const index of [...this.candidates(point.x, point.z, radius)].sort((a, b) => proximity(a) - proximity(b)).slice(0, 128)) candidates.add(index);
    }
    return [...candidates].map(index => this.edge(index));
  }
  targetNode(edge: RoadEdge): PackedPublicNode | undefined {
    const index = this.indices.get(edge); return index === undefined ? undefined : this.packed.node(this.packed.columns.edgeTo[index]!);
  }
  successors(edge: RoadEdge): RoadEdge[] {
    const index = this.indices.get(edge); return index === undefined ? [] : this.next(index).map(i => this.edge(i));
  }
  private next(index: number): number[] {
    const c = this.packed.columns, explicit = c.edgeFlags[index]! & ROAD_EDGE_FLAGS.next;
    const node = c.edgeTo[index]!, a = explicit ? c.edgeNextOffsets[index]! : this.outgoingOffsets[node]!, b = explicit ? c.edgeNextOffsets[index + 1]! : this.outgoingOffsets[node + 1]!;
    const source = explicit ? c.next : this.outgoingEdges, result: number[] = [];
    for (let i = a; i < b; i++) if (this.routable(source[i]!)) result.push(source[i]!);
    return result;
  }
  override route(from: RoadSnap, to: RoadSnap): RouteSegment[] | undefined {
    const start = this.indices.get(from.edge), goal = this.indices.get(to.edge);
    if (start === undefined || goal === undefined) return;
    if (start === goal && to.along >= from.along) return this.sliceEdge(from.edge, from.along, to.along);
    const path = this.findEdges(start, goal);
    if (!path) return;
    return [...this.sliceEdge(from.edge, from.along), ...path.slice(0, -1).flatMap(i => this.sliceEdge(this.edge(i))), ...this.sliceEdge(to.edge, 0, to.along)];
  }
  override approach(to: RoadSnap, metres = 35): RouteSegment[] {
    let route = this.sliceEdge(to.edge, 0, to.along), index = this.indices.get(to.edge);
    const visited = new Set<number>(), c = this.packed.columns;
    while (index !== undefined && routeLength(route) < metres && !visited.has(index)) {
      visited.add(index); const node = c.edgeFrom[index]!;
      let previous: number | undefined;
      for (let i = this.incomingOffsets[node]!; i < this.incomingOffsets[node + 1]!; i++) {
        const candidate = this.incomingEdges[i]!;
        if (!visited.has(candidate) && this.next(candidate).includes(index)) { previous = candidate; break; }
      }
      if (previous === undefined) break;
      route = [...this.sliceEdge(this.edge(previous)), ...route]; index = previous;
    }
    let trim = Math.max(0, routeLength(route) - metres);
    while (route.length && trim >= route[0]!.length) trim -= route.shift()!.length;
    if (route[0] && trim > 0) { const first = route[0]; route[0] = { ...first, from: lerp(first.from, first.to, trim / first.length), length: first.length - trim }; }
    return route;
  }
  private sliceEdge(edge: RoadEdge, start = 0, end = Infinity): RouteSegment[] {
    const result: RouteSegment[] = []; let travelled = 0;
    for (let i = 1; i < edge.points.length; i++) {
      const from = edge.points[i - 1]!, to = edge.points[i]!, length = distance(from, to), a = Math.max(0, start - travelled), b = Math.min(length, end - travelled);
      if (b - a > .00001) result.push({ from: lerp(from, to, a / length), to: lerp(from, to, b / length), length: b - a, speed: Math.max(1, Math.min(12, edge.speedMps)) });
      travelled += length;
    }
    return result;
  }
  private findEdges(start: number, goal: number): number[] | undefined {
    const key = `${start}:${goal}`, cached = this.pathCache.get(key);
    if (cached) return cached;
    if (++this.searchId === 0xffffffff) { this.searchId = 1; this.visited.fill(0); }
    const epoch = this.searchId, terminal = this.packed.counts.edges, c = this.packed.columns;
    const goalNode = c.edgeFrom[goal]! * 3, heap: { edge: number; score: number; cost: number }[] = [];
    const heuristic = (edge: number) => {
      if (edge === terminal) return 0;
      const at = c.edgeTo[edge]! * 3;
      return .99 * Math.hypot(c.nodeXYZ[at]! - c.nodeXYZ[goalNode]!, c.nodeXYZ[at + 2]! - c.nodeXYZ[goalNode + 2]!) / 100;
    };
    const push = (edge: number, cost: number) => {
      const item = { edge, cost, score: cost + heuristic(edge) }; let at = heap.length; heap.push(item);
      while (at > 0) { const parent = (at - 1) >>> 1; if (heap[parent]!.score <= item.score) break; heap[at] = heap[parent]!; at = parent; }
      heap[at] = item;
    };
    const pop = () => {
      const item = heap[0]!, last = heap.pop()!;
      if (heap.length) {
        let at = 0;
        while (at * 2 + 1 < heap.length) {
          let child = at * 2 + 1; if (child + 1 < heap.length && heap[child + 1]!.score < heap[child]!.score) child++;
          if (heap[child]!.score >= last.score) break; heap[at] = heap[child]!; at = child;
        }
        heap[at] = last;
      }
      return item;
    };
    this.cost[start] = 0; this.visited[start] = epoch; push(start, 0);
    while (heap.length) {
      const current = pop(); if (current.cost !== this.cost[current.edge]) continue;
      if (current.edge === terminal) {
        const path = [goal]; let at = this.previous[terminal]!;
        while (at !== start) { path.push(at); at = this.previous[at]!; }
        path.reverse(); this.pathCache.set(key, path);
        if (this.pathCache.size > 64) this.pathCache.delete(this.pathCache.keys().next().value!);
        return path;
      }
      for (const next of this.next(current.edge)) {
        const target = next === goal ? terminal : next, cost = current.cost + (next === goal ? 0 : Math.max(.001, c.edgeLength[next]!));
        if (this.visited[target] === epoch && cost >= this.cost[target]!) continue;
        this.visited[target] = epoch; this.cost[target] = cost; this.previous[target] = current.edge; push(target, cost);
      }
    }
    return;
  }
}
