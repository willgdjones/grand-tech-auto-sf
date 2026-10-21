import { flags } from '@gtasf/shared/flags';
import type { RoadEdge } from '@gtasf/shared/roadgraph';
import type { Point, Pose, QuickRobotaxiTarget } from '@gtasf/shared/protocol/types';
import type { RideCharge, RideQuote } from '../funding/rides';
import { LocalRoads, routePose, type RoadSnap, type RouteSegment } from './localRoads';

export const QUICK_PICKUP_MS = 3000;
export const QUICK_FORCE_BOARD_MS = 4000;
export const QUICK_CARD_MS = 4000;
export const QUICK_LOAD_TIMEOUT_MS = 6000;
export interface FundingRing { x: number; y: number; z: number; radiusM: number }
export interface QuickDrop { snap: RoadSnap; pose: Pose }
export interface QuickTripDestination extends QuickDrop { title: string; friendPlayerId?: number }
export interface QuickTaxiServices {
  resolve(playerId: number, destination: Point, target: QuickRobotaxiTarget): Promise<QuickTripDestination | null>;
  quote(playerId: number, distanceM: number): Promise<RideQuote>;
  charge(playerId: number, rideId: string, fareCents: string): Promise<RideCharge>;
  /** Undo a charge whose trip was abandoned before dispatch. */
  refund?(playerId: number, rideId: string): Promise<boolean>;
  charged?(playerId: number, friendPlayerId: number | undefined, rideId: string): void;
  /** gtasf-d4zmv: refund a dispatched ride that the server ended before the jump (idempotent by rideId). */
  refundDispatched?(playerId: number, rideId: string): Promise<boolean>;
  /** Clear accumulated movement credit after the server-authorized jump and exit. */
  arrived?(playerId: number, now: number): void;
  now?(): number;
}

/** quickDropKerb (critic N19b): the passenger steps 2.6 m to the KERB side (right of travel). WorldVehicles.exit already
 *  steps that way (despite its 'driver's side' comment: +z for an eastbound cab under the yaw/256 convention, unit-tested),
 *  but only 2.1 m — from the middle of the kerb lane that lands in the gutter; 2.6 m clears the kerb line. */
export const KERB_STEP_CM = 260;
/** Leave 10m beyond the payout radius AND room for the exit's side step (2.1 m driver side, or the 2.6 m kerb step). */
export function outsideFundingRings(point: Point, rings: readonly FundingRing[]): boolean {
  const margin = 10 + (flags.quickDropKerb ? KERB_STEP_CM / 100 : 2.1) + .1;
  return rings.every(r => Math.hypot(point.x / 100 - r.x, point.z / 100 - r.z) > r.radiusM + margin);
}
/** Where a quick-ride passenger stands after the drop: KERB_STEP_CM to the right of the cab's heading (yaw /256 turn,
 *  the same direction as WorldVehicles.exit's step). */
export function kerbExit(drop: Pose): Pose {
  const angle = drop.yaw / 256 * Math.PI * 2;
  return { ...drop, x: drop.x - Math.round(Math.cos(angle) * KERB_STEP_CM), z: drop.z + Math.round(Math.sin(angle) * KERB_STEP_CM), flags: 0 };
}
/** The outermost (kerb-side) lane of each way and direction — right-hand traffic, higher lane index = further out
 *  (the same rule streetParkingBays uses). Cached per graph edge list. */
const kerbLaneCache = new WeakMap<readonly RoadEdge[], ReadonlySet<string>>();
export function kerbLaneIds(edges: readonly RoadEdge[]): ReadonlySet<string> {
  const cached = kerbLaneCache.get(edges);
  if (cached) return cached;
  const outer = new Map<string, RoadEdge>();
  for (const edge of edges) {
    if (!edge.id.startsWith('lane:')) continue;
    const meta = edge as RoadEdge & { osmWay?: number }, first = edge.points[0]!, last = edge.points.at(-1)!;
    const direction = Math.round(Math.atan2(last[0] - first[0], last[2] - first[2]) * 4 / Math.PI);
    const key = meta.osmWay === undefined ? edge.id.slice(0, edge.id.lastIndexOf(':')) : `way:${meta.osmWay}:${direction}`;
    if (!outer.has(key) || outer.get(key)!.lane < edge.lane) outer.set(key, edge);
  }
  const ids = new Set([...outer.values()].map(edge => edge.id));
  kerbLaneCache.set(edges, ids);
  return ids;
}

/** Road-only drop selection, including arbitrary map pins near an event. No client ring metadata is trusted. */
export function safeQuickDrop(roads: LocalRoads, target: Point, rings: readonly FundingRing[], maximumM = 150): QuickDrop | null {
  // quickDropKerb: stop in the kerb-side lane so the kerb step lands on the sidewalk; any lane if none qualifies.
  if (flags.quickDropKerb) return pickQuickDrop(roads, target, rings, maximumM, kerbLaneIds(roads.graph.edges)) ?? pickQuickDrop(roads, target, rings, maximumM);
  return pickQuickDrop(roads, target, rings, maximumM);
}
function pickQuickDrop(roads: LocalRoads, target: Point, rings: readonly FundingRing[], maximumM: number, only?: ReadonlySet<string>): QuickDrop | null {
  const base = roads.snap(target, 1, 3) ?? roads.snap(target, maximumM, 3) ?? roads.snap(target, maximumM);
  if (!base) return null;
  const origin = base.point;
  let best: QuickDrop | null = null, bestScore = Infinity;
  for (const edge of roads.lanesNear({ x: origin[0], z: origin[2] }, maximumM)) {
    if (!edge.id.startsWith('lane:') || (only && !only.has(edge.id))) continue;
    let along = 0;
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1]!, b = edge.points[i]!, dx = b[0] - a[0], dz = b[2] - a[2];
      const length = Math.hypot(dx, b[1] - a[1], dz), flat = dx * dx + dz * dz;
      if (length < .001 || flat < .001) { along += length; continue; }
      const t = Math.max(0, Math.min(1, ((origin[0] - a[0]) * dx + (origin[2] - a[2]) * dz) / flat));
      if (Math.hypot(a[0] + t * dx - origin[0], a[2] + t * dz - origin[2]) > maximumM) { along += length; continue; }
      // Nearest point first, then small steps along the lane until outside nearby rings.
      for (let offset = 0; offset <= maximumM * 2; offset += 5) {
        for (const sign of offset ? [-1, 1] : [1]) {
          const at = Math.max(0, Math.min(length, t * length + offset * sign));
          const pose = routePose({ from: a, to: b, length, speed: edge.speedMps }, at);
          const separation = Math.hypot(pose.x / 100 - target.x / 100, pose.z / 100 - target.z / 100);
          if (separation > maximumM - 2.2 || !outsideFundingRings(pose, rings)) continue;
          const score = Math.hypot(pose.x / 100 - origin[0], pose.y / 100 - origin[1], pose.z / 100 - origin[2]);
          if (score >= bestScore) continue;
          bestScore = score;
          best = { pose, snap: { edge, point: [pose.x / 100, pose.y / 100, pose.z / 100], along: along + at, distance: separation } };
        }
        if (offset === 0 && bestScore < .01) break;
      }
      along += length;
    }
  }
  return best;
}

/** One short lane-bound departure shot; the cross-city route is never simulated. */
export function quickDeparture(snap: RoadSnap): RouteSegment[] {
  const route: RouteSegment[] = [];
  let along = 0, remaining = 6;
  for (let i = 1; i < snap.edge.points.length && remaining > 0; i++) {
    const a = snap.edge.points[i - 1]!, b = snap.edge.points[i]!, length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const start = Math.max(0, snap.along - along); along += length;
    if (start >= length || !length) continue;
    const used = Math.min(remaining, length - start);
    const point = (at: number): [number, number, number] => [a[0] + (b[0] - a[0]) * at / length, a[1] + (b[1] - a[1]) * at / length, a[2] + (b[2] - a[2]) * at / length];
    route.push({ from: point(start), to: point(start + used), length: used, speed: 6 }); remaining -= used;
  }
  return route;
}

/** Keep billing tied to the profile that paid, even after its socket disappears. */
export function createQuickTaxiBilling(options: {
  device(playerId: number): string;
  charge(deviceId: string, rideId: string, fareCents: string): Promise<RideCharge>;
  refund(deviceId: string, rideId: string): Promise<boolean>;
}) {
  const pending = new Map<string, { playerId: number; deviceId: string }>();
  return {
    async charge(playerId: number, rideId: string, fareCents: string): Promise<RideCharge> {
      const deviceId = options.device(playerId);
      pending.set(rideId, { playerId, deviceId });
      try {
        const result = await options.charge(deviceId, rideId, fareCents);
        if (!result.ok) pending.delete(rideId);
        return result;
      } catch (error) { pending.delete(rideId); throw error; }
    },
    async refund(playerId: number, rideId: string): Promise<boolean> {
      const receipt = pending.get(rideId);
      if (!receipt || receipt.playerId !== playerId) return false;
      try { return await options.refund(receipt.deviceId, rideId); }
      finally { pending.delete(rideId); }
    },
    dispatched(rideId: string) { pending.delete(rideId); },
  };
}
