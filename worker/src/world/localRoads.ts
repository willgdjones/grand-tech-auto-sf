import type { RoadEdge, RoadGraph } from '@gtasf/shared/roadgraph';
import type { Point, Pose } from '@gtasf/shared/protocol/types';
import { LOCAL_ROAD_GRAPH } from './localRoadData';

type Vec = [number, number, number];
export interface RouteSegment { from: Vec; to: Vec; length: number; speed: number }
export interface RoadSnap { edge: RoadEdge; point: Vec; along: number; distance: number }
const distance = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lerp = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Real lane geometry; the local subset can be replaced by the complete graph without changing dispatch. */
export class LocalRoads {
  private readonly outgoing = new Map<string, RoadEdge[]>();
  private readonly incoming = new Map<string, RoadEdge[]>();
  private readonly nodes: Map<string, RoadGraph['nodes'][number]>;
  constructor(readonly graph: RoadGraph = LOCAL_ROAD_GRAPH) {
    this.nodes = new Map(graph.nodes.map(node => [node.id, node]));
    for (const edge of graph.edges) {
      this.outgoing.set(edge.from, [...(this.outgoing.get(edge.from) ?? []), edge]);
      this.incoming.set(edge.to, [...(this.incoming.get(edge.to) ?? []), edge]);
    }
  }
  /** Candidate lane geometry for local destination searches. Packed maps override this storage boundary. */
  lanesNear(_point: { x: number; z: number }, _radius: number): readonly RoadEdge[] { return this.graph.edges; }
  /** Map pins omit the height bound; pickups supply it to avoid another road deck. */
  snap(point: Point, maximumM = 35, maximumHeightM = Infinity): RoadSnap | undefined {
    const p: Vec = [point.x / 100, point.y / 100, point.z / 100];
    const useHeight = Number.isFinite(maximumHeightM);
    if (useHeight && (!Number.isFinite(p[1]) || maximumHeightM < 0)) return;
    let best: RoadSnap | undefined;
    let bestScore = Infinity;
    for (const edge of this.graph.edges) {
      if (!edge.id.startsWith('lane:')) continue;
      let along = 0;
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1]!, b = edge.points[i]!, length = distance(a, b);
        if (!length) continue;
        // Height is resolved from the road; destination pins may only know their map XZ.
        const dx = b[0] - a[0], dz = b[2] - a[2], denominator = dx * dx + dz * dz;
        const t = denominator ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / denominator)) : 0;
        const projected = lerp(a, b, t), separation = Math.hypot(p[0] - projected[0], p[2] - projected[2]);
        const vertical = useHeight ? Math.abs(p[1] - projected[1]) : 0;
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
  route(from: RoadSnap, to: RoadSnap): RouteSegment[] | undefined {
    if (from.edge === to.edge && to.along >= from.along) return this.slice(from.edge, from.along, to.along);
    const middle = this.findPath(from.edge.to, to.edge.from);
    if (!middle) return undefined;
    return [...this.slice(from.edge, from.along), ...middle.flatMap(edge => this.slice(edge)), ...this.slice(to.edge, 0, to.along)];
  }
  approach(to: RoadSnap, metres = 35): RouteSegment[] {
    let route = this.slice(to.edge, 0, to.along), node = to.edge.from;
    const visited = new Set<string>();
    while (routeLength(route) < metres && !visited.has(node)) {
      visited.add(node);
      const edge = this.incoming.get(node)?.[0];
      if (!edge) break;
      route = [...this.slice(edge), ...route]; node = edge.from;
    }
    let trim = Math.max(0, routeLength(route) - metres);
    while (route.length && trim >= route[0]!.length) trim -= route.shift()!.length;
    if (route[0] && trim > 0) {
      const first = route[0]; route[0] = { ...first, from: lerp(first.from, first.to, trim / first.length), length: first.length - trim };
    }
    return route;
  }
  private slice(edge: RoadEdge, start = 0, end = Infinity): RouteSegment[] {
    const result: RouteSegment[] = []; let travelled = 0;
    for (let i = 1; i < edge.points.length; i++) {
      const from = edge.points[i - 1]!, to = edge.points[i]!, length = distance(from, to);
      const a = Math.max(0, start - travelled), b = Math.min(length, end - travelled);
      if (b - a > 0.00001) result.push({ from: lerp(from, to, a / length), to: lerp(from, to, b / length), length: b - a, speed: Math.max(1, Math.min(12, edge.speedMps)) });
      travelled += length;
    }
    return result;
  }
  private findPath(from: string, to: string): RoadEdge[] | undefined {
    const frontier = new Set([from]), costs = new Map([[from, 0]]), previous = new Map<string, RoadEdge>();
    const goal = this.nodes.get(to);
    const heuristic = (id: string) => { const n = this.nodes.get(id); return n && goal ? Math.hypot(n.x - goal.x, n.z - goal.z) : 0; };
    while (frontier.size) {
      let current = '', lowest = Infinity;
      for (const node of frontier) { const score = costs.get(node)! + heuristic(node); if (score < lowest) { current = node; lowest = score; } }
      if (current === to) {
        const path: RoadEdge[] = [];
        while (current !== from) { const edge = previous.get(current)!; path.unshift(edge); current = edge.from; }
        return path;
      }
      frontier.delete(current);
      for (const edge of this.outgoing.get(current) ?? []) {
        const cost = costs.get(current)! + Math.max(0.001, edge.lengthM);
        if (cost >= (costs.get(edge.to) ?? Infinity)) continue;
        costs.set(edge.to, cost); previous.set(edge.to, edge); frontier.add(edge.to);
      }
    }
    return undefined;
  }
}
export const routeLength = (route: RouteSegment[]) => route.reduce((sum, segment) => sum + segment.length, 0);
export function routePose(segment: RouteSegment, travelled: number): Pose {
  const [x, y, z] = lerp(segment.from, segment.to, Math.max(0, Math.min(1, travelled / segment.length)));
  const angle = Math.atan2(segment.to[0] - segment.from[0], segment.to[2] - segment.from[2]);
  return { x: Math.round(x * 100), y: Math.round(y * 100), z: Math.round(z * 100), yaw: Math.round((angle / (2 * Math.PI) + 1) * 256) % 256, flags: 0 };
}
