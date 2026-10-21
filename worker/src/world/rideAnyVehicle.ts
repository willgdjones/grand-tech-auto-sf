import { flags } from '@gtasf/shared/flags';
import type { Pose, VehicleEntry } from '@gtasf/shared/protocol/types';
import { isCableCar, sampleCableCar } from '@gtasf/shared/transit/cableCars';
import { isMuniBus, sampleMuniBus } from '@gtasf/shared/transit/muni';
import type { LocalRoads } from './localRoads';
import type { TrafficSimulation } from './traffic/simulation';
import type { WorldVehicles } from './vehicles';

/** gtasf-aj86q: reach (cm) for taking over / boarding a vehicle — horizontal; vertically always ENTER_REACH_CM (review R-L1:
 *  speed must not let a player on the street take a car on the deck above). The server checks the car's extrapolated CURRENT
 *  pose while the client judged reach from its interpolated render (1-2 m behind a moving car), so the reach grows
 *  with speed: 4 m standing, + 0.35 s of travel, capped at 9 m. */
export const ENTER_REACH_CM = 400;
export function enterReachCm(speedCmps: number): number {
  return Math.min(900, ENTER_REACH_CM + Math.abs(Number.isFinite(speedCmps) ? speedCmps : 0) * 0.35);
}

const enabled = () => flags.rideAnyVehicle && !flags.zonedWorld;
/** Exit only onto a road centreline at the vehicle's deck height. Try beside it, then behind it;
 * never extrapolate a side offset beyond a narrow road/bridge ribbon or use the street below. */
export function safeRideExit(entry: VehicleEntry, roads: LocalRoads): Pose | undefined {
  const angle = entry.yaw / 256 * Math.PI * 2, sin = Math.sin(angle), cos = Math.cos(angle);
  const rear = entry.kind === 'bus' || entry.kind === 'cable-car' ? 650 : 350;
  for (const [dx, dz, tolerance] of [[-cos * 240, sin * 240, 1], [cos * 240, -sin * 240, 1], [-sin * rear, -cos * rear, 2]] as const) {
    const snap = roads.snap({ x: entry.x + dx, y: entry.y, z: entry.z + dz }, tolerance, 2.5);
    if (!snap || Math.hypot(snap.point[0] * 100 - entry.x, snap.point[2] * 100 - entry.z) < 150) continue;
    return { x: Math.round(snap.point[0] * 100), y: Math.round(snap.point[1] * 100), z: Math.round(snap.point[2] * 100), yaw: entry.yaw, flags: 0 };
  }
}

/** Bridges lane NPCs and time-derived transit into the fleet's existing seat authority. */
export class RideAnyVehicles {
  private readonly riders = new Map<number, { vehicleId: number; exitRequested: boolean; lastExit?: Pose }>();
  constructor(private readonly fleet: WorldVehicles, private readonly traffic: () => TrafficSimulation | undefined,
    private readonly roads: () => LocalRoads) {}
  owns(playerId: number): boolean { return this.riders.has(playerId); }
  renewPassengerActivity(playerId: number, before: Pose, after: Pose, now: number, activity: { lastInput: number }): void {
    const ride = this.riders.get(playerId), entry = ride && this.fleet.cars.get(ride.vehicleId)?.entry;
    if (entry && entry.speedCmps > 0 && (after.flags & 0x80) && after.x === entry.x && after.y === entry.y && after.z === entry.z &&
      (before.x !== after.x || before.y !== after.y || before.z !== after.z)) activity.lastInput = now;
  }
  get retainedTraffic(): ReadonlySet<number> { return new Set([...this.riders.values()].map(ride => ride.vehicleId)); }
  private current(id: number, now: number): VehicleEntry | undefined {
    if (flags.cableCars && isCableCar(id)) return sampleCableCar(id, now)?.entry;
    if (flags.muni && isMuniBus(id)) return sampleMuniBus(id, now)?.entry;
    return this.traffic()?.vehicle(id);
  }
  private exitPose(entry: VehicleEntry, now: number): Pose | undefined {
    const road = safeRideExit(entry, this.roads()); if (road) return road;
    // The small dev road graph omits parts of the transit lines. Their authored, ground-height
    // track is also a safe surface: step behind/along that track, never sideways off its deck.
    const sample = isCableCar(entry.id) ? sampleCableCar : isMuniBus(entry.id) ? sampleMuniBus : undefined;
    if (!sample) return;
    for (let delta = 500; delta <= 12000; delta += 500) for (const direction of [-1, 1]) {
      const point = sample(entry.id, now + delta * direction)?.entry; if (!point) continue;
      const distance = Math.hypot(point.x - entry.x, point.z - entry.z);
      if (distance >= 600 && distance <= 900) return { x: point.x, y: point.y, z: point.z, yaw: entry.yaw, flags: 0 };
    }
  }
  /** undefined means this is an ordinary parked/owned car: use the existing enter path. */
  enter(playerId: number, pose: Pose, id: number, now: number): boolean | undefined {
    if (!enabled()) return undefined;
    const entry = this.current(id, now);
    if (!entry) return undefined;
    if (this.fleet.occupants.has(playerId) || entry.driverId ||
      Math.hypot(pose.x - entry.x, pose.z - entry.z) > enterReachCm(entry.speedCmps) || Math.abs(pose.y - entry.y) > ENTER_REACH_CM) return false;
    if (!['bus', 'robotaxi', 'cable-car'].includes(entry.kind)) {
      if (!flags.driving || !this.fleet.takeTraffic(playerId, pose, entry, now, enterReachCm(entry.speedCmps))) return false;
      this.traffic()?.relinquish(id); // NPC driver disappears; the same car is now player-controlled.
      return true;
    }
    if ([...this.fleet.occupants.values()].filter(vehicleId => vehicleId === id).length >= 12) return false;
    this.fleet.updateCable({ ...entry }, now);
    if (!this.fleet.boardPassenger(playerId, id, now)) return false;
    this.riders.set(playerId, { vehicleId: id, exitRequested: false, lastExit: this.exitPose(entry, now) });
    return true;
  }
  exit(playerId: number, now: number): boolean {
    const ride = this.riders.get(playerId); if (!ride) return false;
    const entry = this.current(ride.vehicleId, now);
    const exit = entry && this.exitPose(entry, now);
    if (!entry || !exit) { ride.exitRequested = true; return false; }
    this.fleet.updateCable({ ...entry }, now);
    if (!this.fleet.exit(playerId, ride.vehicleId, now, exit, true)) return false;
    this.riders.delete(playerId); this.releaseMirror(ride.vehicleId); return true;
  }
  step(now: number): void {
    for (const [playerId, ride] of this.riders) {
      if (this.fleet.occupants.get(playerId) !== ride.vehicleId) { this.riders.delete(playerId); this.releaseMirror(ride.vehicleId); continue; }
      const entry = this.current(ride.vehicleId, now);
      if (!entry) continue;
      this.fleet.updateCable({ ...entry }, now);
      ride.lastExit = this.exitPose(entry, now) ?? ride.lastExit;
      if (ride.exitRequested) this.exit(playerId, now);
    }
  }
  disconnect(playerId: number, now: number): void {
    const ride = this.riders.get(playerId); if (!ride) return;
    const entry = this.current(ride.vehicleId, now);
    const exit = (entry && this.exitPose(entry, now)) ?? ride.lastExit;
    // Socket removal must always release its seat without stopping shared transit.
    const stoppedPose = exit ?? (entry && { x: entry.x, y: entry.y, z: entry.z, yaw: entry.yaw, flags: 0 });
    if (stoppedPose) this.fleet.exit(playerId, ride.vehicleId, now, stoppedPose, true);
    else this.fleet.occupants.delete(playerId);
    this.riders.delete(playerId); this.releaseMirror(ride.vehicleId);
  }
  private releaseMirror(id: number): void {
    if (!isCableCar(id) && ![...this.fleet.occupants.values()].includes(id)) this.fleet.cars.delete(id);
  }
}
