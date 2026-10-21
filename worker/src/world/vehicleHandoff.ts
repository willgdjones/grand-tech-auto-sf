import { flags } from '@gtasf/shared/flags';
import { VEHICLE_KINDS } from '@gtasf/shared/protocol/constants';
import { validPose } from '@gtasf/shared/protocol/pose';
import { SF_ZONE_GRID, cellIndex, cellOf, globalPlayerId, type ZoneGrid } from '@gtasf/shared/world/zones';
import type { Point, Pose, VehicleEntry, VehicleKind } from '@gtasf/shared/protocol/types';
import { MOVE_BURST_CM, type MovementState } from './movement';
import { routePose, type RouteSegment } from './localRoads';
import { isCableCar } from '@gtasf/shared/transit/cableCars';
import { isMuniBus } from '@gtasf/shared/transit/muni';

/**
 * Occupied-vehicle border handoff contract (gtasf-zoned-vehicle-handoff, behind flags.zonedWorld).
 *
 * Seamless handoff (gtasf-djjz) moves a crossing player's *on-foot* session to the destination cell
 * with a stable id. A player DRIVING a car across a border must also keep driving without a
 * teleport/stall, so the authoritative car state travels in the handoff blob and the destination
 * recreates the car under the driver. This module is the pure contract + validator for that driven-car
 * state; the WorldDO/WorldVehicles wiring (build the blob in maybeHandoff, recreate it in
 * /internal/handoff/receive) consumes it. Passenger rides (robotaxi/cable-car) carry their trip
 * separately — a follow-up — so those kinds are excluded here.
 */

/** Kinds a player can drive (what WorldVehicles.enter accepts: everything except the board-only,
 *  server-driven robotaxi and cable-car). Derived from the canonical wire kind set, not hand-listed. */
export const DRIVEABLE_KINDS: readonly VehicleKind[] = VEHICLE_KINDS.filter(k => k !== 'robotaxi' && k !== 'cable-car');

/** entry.speedCmps is clamped to 6000 (60 m/s) at the source (worker/src/world/vehicles.ts move). */
const MAX_SPEED_CMPS = 6000;

/** Reserve the low block for deterministic cable cars; moving entities retain their birth-zone ID. */
export function zonedVehicleId(cellIdx: number, localId: number): number {
  return globalPlayerId(cellIdx + 1, localId);
}

/** Match checkMovement's one-send-interval driving credit (bus 30 m/s; other cars 75 m/s). */
export function drivingBurstCm(kind: VehicleKind): number {
  return Math.max(MOVE_BURST_CM, (kind === 'bus' ? 30 : 75) * 10);
}

/** The driven car's authoritative state that travels with its driver on a zone handoff. Pose is world
 *  centimetres; seq is the car's 16-bit movement sequence; carryCm is the elapsed-credit debt. */
export interface DrivenVehicleHandoff {
  readonly kind: VehicleKind;
  readonly pose: Pose;
  readonly speedCmps: number;
  readonly seq: number;
  readonly carryCm: number;
}

/**
 * Reject a malformed or out-of-range driven-vehicle handoff before the destination recreates the car
 * — the transferred blob crosses a trust boundary (another DO), so it is validated exactly like a
 * resumed on-foot session (WorldSessions.adopt, gtasf-djjz): a valid driveable kind, a valid pose, a
 * bounded non-negative speed, a 16-bit sequence, and a carry within the burst budget.
 */
export function validDrivenVehicleHandoff(value: unknown): value is DrivenVehicleHandoff {
  if (!value || typeof value !== 'object') return false;
  const v = value as DrivenVehicleHandoff;
  return (DRIVEABLE_KINDS as readonly string[]).includes(v.kind)
    && !!v.pose && validPose(v.pose)
    && Number.isFinite(v.speedCmps) && v.speedCmps >= 0 && v.speedCmps <= MAX_SPEED_CMPS
    && Number.isInteger(v.seq) && v.seq >= 0 && v.seq <= 0xffff
    && Number.isFinite(v.carryCm) && v.carryCm >= -1 && v.carryCm <= drivingBurstCm(v.kind);
}

/** Send side: extract the handoff state from the origin cell's driven car (a WorldVehicles `Car`),
 *  read structurally so this stays decoupled from vehicles.ts. The DRIVER_FLAG is dropped — the
 *  destination re-applies it when it re-seats the driver. The result always passes
 *  {@link validDrivenVehicleHandoff} (guaranteed by the round-trip test). */
export function occupiedVehicleState(car: {
  readonly entry: { readonly kind: VehicleKind; readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly speedCmps: number };
  readonly movement: { readonly seq: number; readonly carryCm: number };
}): DrivenVehicleHandoff {
  const e = car.entry;
  return { kind: e.kind, pose: { x: e.x, y: e.y, z: e.z, yaw: e.yaw, flags: 0 }, speedCmps: e.speedCmps, seq: car.movement.seq, carryCm: car.movement.carryCm };
}

/**
 * Destination side: build the WorldVehicles `Car` ({entry, movement}) to recreate a handed-off driven
 * car under its driver, from the validated state. Pure (returns the object; the thin stateful step —
 * `cars.set(id, …)` + `occupants.set(playerId, id)` + emit — stays in WorldVehicles). The id is the
 * globally-unique handoff vehicle id so it never collides with the destination cell's own parked ids;
 * `accepted` is true (the move sequence is resumed, not replayed) and the DRIVER_FLAG is applied by the
 * caller when it re-seats, so the stored poses carry flags 0.
 */
export function adoptedCar(state: DrivenVehicleHandoff, vehicleId: number, playerId: number, now: number): { entry: VehicleEntry; movement: MovementState } {
  const p = state.pose;
  return {
    entry: { id: vehicleId, x: p.x, y: p.y, z: p.z, yaw: p.yaw, flags: 0, kind: state.kind, driverId: playerId, speedCmps: state.speedCmps },
    movement: { pose: { x: p.x, y: p.y, z: p.z, yaw: p.yaw, flags: 0 }, seq: state.seq, accepted: true, carryCm: state.carryCm, lastAt: now },
  };
}

/** Cell-aware starter placement (zoned world): the subset of starter parked cars whose position (world
 *  metres) falls inside cell `cellIdx`, so cars are spawned once in their own cell instead of duplicated
 *  into every cell. The single world passes the whole set (no cell). Used when a zone learns its cell. */
export function parkedCarsForCell<T extends { readonly x: number; readonly z: number }>(cars: readonly T[], cellIdx: number, grid: ZoneGrid = SF_ZONE_GRID): T[] {
  return cars.filter(car => { const cell = cellOf(grid, car.x, car.z); return cellIndex(grid, cell.cx, cell.cy) === cellIdx; });
}

/**
 * A robotaxi RIDE crossing a zone border (gtasf-zoned-vehicle-handoff): the rider is a passenger in a
 * server-driven taxi, so the taxi's pose travels as the vehicle state above and this carries the ride's
 * routing intent — the requestId, the destination, and the phase. Design (re-route, don't ship the
 * route): the destination cell recreates the taxi at the resumed pose and RE-ROUTES to `destination`
 * from there using its own citywide road graph, rather than transferring the large RouteSegment[]
 * route/ride arrays. Keeps the blob tiny and leverages the per-cell router.
 */
const COORD_LIMIT = 1e7; // metres|cm sanity bound; the validator rejects NaN/Infinity/garbage, not units
export interface TaxiRideHandoff {
  readonly requestId: number;
  readonly destination: Point;
  readonly state: 'pickup' | 'riding';
}

/** Reject a malformed taxi-ride handoff before the destination resumes the ride (trust boundary). */
export function validTaxiRideHandoff(value: unknown): value is TaxiRideHandoff {
  if (!value || typeof value !== 'object') return false;
  const t = value as TaxiRideHandoff;
  const d = t.destination;
  return Number.isInteger(t.requestId) && t.requestId >= 0 && t.requestId <= 0xffffffff
    && !!d && [d.x, d.y, d.z].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= COORD_LIMIT)
    && (t.state === 'pickup' || t.state === 'riding');
}

/** Only the remaining route travels; the first segment retains its exact progress. */
export interface TaxiTransfer extends TaxiRideHandoff {
  readonly state: 'riding';
  readonly pose: Pose;
  readonly speedCmps: number;
  readonly route: RouteSegment[];
  readonly travelled: number;
}
export type OccupiedVehicleTransfer =
  | { readonly id: number; readonly mode: 'driver'; readonly state: DrivenVehicleHandoff }
  | { readonly id: number; readonly mode: 'taxi'; readonly state: TaxiTransfer }
  | { readonly id: number; readonly mode: 'cable' };

export function validTaxiTransfer(value: unknown): value is TaxiTransfer {
  if (!validTaxiRideHandoff(value)) return false;
  const t = value as TaxiTransfer;
  if (t.state !== 'riding' || !t.pose || !validPose(t.pose) || !Number.isFinite(t.speedCmps)
    || t.speedCmps < 0 || t.speedCmps > 6000 || !Array.isArray(t.route) || !t.route.length || t.route.length > 16384
    || !Number.isFinite(t.travelled) || t.travelled < 0) return false;
  const point = (p: unknown): p is [number, number, number] => Array.isArray(p) && p.length === 3
    && p.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 20_000);
  for (let i = 0; i < t.route.length; i++) {
    const s = t.route[i];
    if (!s || !point(s.from) || !point(s.to) || !Number.isFinite(s.length) || s.length <= 0
      || !Number.isFinite(s.speed) || s.speed < 1 || s.speed > 12) return false;
    if (Math.abs(Math.hypot(...s.to.map((n, axis) => n - s.from[axis]!)) - s.length) > 0.02) return false;
    if (i && Math.hypot(...s.from.map((n, axis) => n - t.route[i - 1]!.to[axis]!)) > 0.02) return false;
  }
  if (t.travelled > t.route[0]!.length) return false;
  const expected = routePose(t.route[0]!, t.travelled);
  return Math.hypot(expected.x - t.pose.x, expected.y - t.pose.y, expected.z - t.pose.z) <= 2;
}

export function validOccupiedTransfer(value: unknown): value is OccupiedVehicleTransfer {
  if (!value || typeof value !== 'object') return false;
  const v = value as OccupiedVehicleTransfer;
  if (!Number.isInteger(v.id) || v.id < 1 || v.id > 0xffffffff) return false;
  if (v.mode === 'cable') return isCableCar(v.id) || (flags.muni && isMuniBus(v.id));
  // The low block is reserved for cable cars; traffic IDs cannot become occupied vehicles.
  const localId = v.id % (1 << 24);
  if (v.id < (1 << 24) || localId < 1 || localId >= 1_000_000) return false;
  return v.mode === 'driver' ? validDrivenVehicleHandoff(v.state) : v.mode === 'taxi' && validTaxiTransfer(v.state);
}
