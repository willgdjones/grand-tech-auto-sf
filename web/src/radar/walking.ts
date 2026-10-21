import { flags } from '@gtasf/shared/flags';
import type { MovementWorld } from '../movement/world';
import type { MapRoute } from './routing';

type Point = { x: number; y: number; z: number };
type Target = Point & { walkingStop?: boolean; event?: unknown };
const RANGE = 96, STEP = 2, MARGIN = 12, MAX_NODES = 512, MAX_PROBES = 12_000;

/** Short paths on loaded authored ground only. The caller supplies no inferred terrain/water surface. */
export function createWalkingRouter(ground: MovementWorld, isLoaded: (x: number, z: number) => boolean) {
  function route(from: { x: number; y?: number; z: number }, to: Target, mode: 'walk' | 'road'): MapRoute | null {
    if (!flags.walkingRoutes || mode !== 'walk' || !to.walkingStop || to.event
      || ![from.x, from.y, from.z, to.x, to.y, to.z].every(Number.isFinite)
      || Math.hypot(to.x - from.x, to.z - from.z) > RANGE || Math.abs(to.y - from.y!) > 3) return null;
    let probes = 0;
    const start: Point = { x: from.x, y: from.y!, z: from.z };
    function sample(x: number, z: number): Point | null {
      if (++probes > MAX_PROBES || !isLoaded(x, z)) return null;
      const y = ground.heightAt(x, z);
      return y === null || !Number.isFinite(y) || Math.abs(y - start.y) > 3
        || ground.collidesCircle?.(x, z, .35) ? null : { x, y, z };
    }
    // Match movement's bounded substeps and step-height rule; include both endpoints.
    function segment(a: Point, b: Point): Point[] | null {
      const distance = Math.hypot(b.x - a.x, b.z - a.z), count = Math.max(1, Math.ceil(distance / .15));
      const points: Point[] = [a]; let previous = a;
      for (let i = 1; i <= count; i++) {
        const p = sample(a.x + (b.x - a.x) * i / count, a.z + (b.z - a.z) * i / count);
        if (!p || Math.abs(p.y - previous.y) > .35 + distance / count * 1.25) return null;
        // Retain metre-scale height samples so the GPS ribbon follows real paving.
        if (i === count || i % 6 === 0) points.push(p);
        previous = p;
      }
      return points;
    }
    const first = sample(start.x, start.z), goal = sample(to.x, to.z);
    if (!first || !goal || Math.abs(first.y - start.y) > .4 || Math.abs(goal.y - to.y) > .5) return null;
    function finish(points: Point[]): MapRoute | null {
      let distanceM = 0;
      for (let i = 1; i < points.length; i++) distanceM += Math.hypot(points[i]!.x - points[i - 1]!.x,
        points[i]!.y - points[i - 1]!.y, points[i]!.z - points[i - 1]!.z);
      if (distanceM > RANGE * 2) return null;
      return { points: points.map(p => [p.x, p.y, p.z]), distanceM, approach: goal!, destinationDistanceM: 0, mode: 'walk' };
    }
    const direct = segment(first, goal);
    if (direct) return finish(direct);

    type Node = { x: number; z: number; point: Point; cost: number; score: number; parent?: Node; leg?: Point[] };
    const root: Node = { x: 0, z: 0, point: first, cost: 0, score: 0 };
    const open: Node[] = [root], costs = new Map([['0,0', 0]]), closed = new Set<string>();
    const minX = Math.min(first.x, goal.x) - MARGIN, maxX = Math.max(first.x, goal.x) + MARGIN;
    const minZ = Math.min(first.z, goal.z) - MARGIN, maxZ = Math.max(first.z, goal.z) + MARGIN;
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
    // At most 512 expanded nodes and 12k surface/collider probes per route request.
    while (open.length && closed.size < MAX_NODES && probes < MAX_PROBES) {
      let best = 0;
      for (let i = 1; i < open.length; i++) if (open[i]!.score < open[best]!.score) best = i;
      const current = open.splice(best, 1)[0]!, key = `${current.x},${current.z}`;
      if (closed.has(key)) continue;
      closed.add(key);
      if (Math.hypot(current.point.x - goal.x, current.point.z - goal.z) <= STEP * 1.5) {
        const last = segment(current.point, goal);
        if (last) {
          const legs: Point[][] = [last]; let node = current;
          while (node.parent) { legs.push(node.leg!); node = node.parent; }
          return finish(legs.reverse().flatMap((leg, i) => i ? leg.slice(1) : leg));
        }
      }
      for (const [dx, dz] of directions) {
        const x = current.x + dx, z = current.z + dz, key = `${x},${z}`;
        const px = first.x + x * STEP, pz = first.z + z * STEP;
        if (closed.has(key) || px < minX || px > maxX || pz < minZ || pz > maxZ) continue;
        const cost = current.cost + Math.hypot(dx, dz) * STEP;
        if (cost >= (costs.get(key) ?? Infinity)) continue;
        const point = sample(px, pz); if (!point) continue;
        const leg = segment(current.point, point); if (!leg) continue;
        costs.set(key, cost); open.push({ x, z, point, cost, parent: current, leg,
          score: cost + Math.hypot(point.x - goal.x, point.z - goal.z) });
      }
    }
    return null;
  }
  return { route };
}
