import { flags } from '@gtasf/shared/flags';
import type { Point, Pose, QuickRobotaxiTarget, RobotaxiState, S2CMessage } from '@gtasf/shared/protocol/types';
import { LocalRoads, routeLength, routePose, type RouteSegment } from './localRoads';
import { PASSENGER_FLAG, WorldVehicles } from './vehicles';
import { kerbExit, QUICK_CARD_MS, QUICK_FORCE_BOARD_MS, QUICK_LOAD_TIMEOUT_MS, QUICK_PICKUP_MS, quickDeparture, type QuickTaxiServices } from './quickRobotaxi';
import { validTaxiTransfer, type TaxiTransfer } from './vehicleHandoff';
import { bumpTaxi, type TaxiBump } from './robotaxiBump';

/** Mad-Max ride-speed multiplier over the lane's normal speed (PLAN-v2.1, gtasf-jl6b). */
const MADMAX_SPEED_SCALE = 2.4;
// Allow curb/road slope differences while keeping known positions on their deck.
const ROAD_LEVEL_TOLERANCE_M = 3;

interface Trip {
  playerId: number; requestId: number; vehicleId: number; destination: Point;
  state: 'pickup' | 'riding' | 'quick'; route: RouteSegment[]; ride: RouteSegment[];
  quick?: { drop: Pose; pickup: Pose; title: string; fareCents: string; freeRidesLeft: number; startedAt: number; ready: boolean; rideId?: string };
  segment: number; travelled: number; lastAt: number; nextNotice: number; pickupExpires: number;
  bump?: TaxiBump;
}
interface TaxiHost {
  emit(message: S2CMessage, playerId: number): void; locate(playerId: number): Pose | undefined;
  /** gtasf-sjmkk (GTA rule): no robotaxi stops for a wanted player — a robbery's escape must face the police. */
  wanted?(playerId: number): boolean;
  /** quickDropKerb (reviewer be4f94d2 LOW): is the cab-to-kerb step free of buildings? Absent/unknown = allow. */
  kerbStepClear?(from: Pose, to: Pose): boolean;
}

/** Authoritative lane follower for the playable graph. Clients cannot steer a robotaxi. */
export class LocalRobotaxis {
  readonly trips = new Map<number, Trip>();
  private readonly retired = new Map<number, number>();
  private readonly lastHail = new Map<number, number>();
  private readonly pending = new Map<number, { requestId: number; cancelled: boolean }>();
  private readonly quickReceipts = new Map<number, Extract<S2CMessage, { type: 'ROBOTAXI_STATE' }>>();
  private readonly departures = new Map<number, { route: RouteSegment[]; startedAt: number }>();
  private readonly paused = new Set<number>();
  constructor(private readonly fleet: WorldVehicles, private readonly host: TaxiHost, private readonly roads = new LocalRoads(), private readonly quickServices?: QuickTaxiServices) {}

  hail(playerId: number, requestId: number, destination: Point, now: number): boolean {
    const player = this.host.locate(playerId), existing = this.trips.get(playerId);
    if (existing?.requestId === requestId) { this.notice(existing, existing.state); return true; }
    if (!player) return false;
    const unavailable = () => { this.host.emit({ type: 'ROBOTAXI_STATE', requestId, vehicleId: 0, state: 'unavailable', pose: player, destination, etaSeconds: 0 }, playerId); return false; };
    if (this.host.wanted?.(playerId)) return unavailable();
    if (this.fleet.occupants.has(playerId) || now - (this.lastHail.get(playerId) ?? -Infinity) < 2000 || this.trips.size >= 100) return unavailable();
    this.lastHail.set(playerId, now);
    const pickup = this.roads.snap(player, 35, ROAD_LEVEL_TOLERANCE_M);
    // The client sends a resolved lane point, including its bridge/tunnel height.
    // Keep that level near the lane centre; unsnapped/heightless pins retain the map fallback.
    const dropoff = this.roads.snap(destination, 1, ROAD_LEVEL_TOLERANCE_M) ?? this.roads.snap(destination);
    if (!pickup || !dropoff) return unavailable();
    const ride = this.roads.route(pickup, dropoff);
    if (!ride?.length || routeLength(ride) < 2) return unavailable();
    this.cancel(playerId, undefined, now);
    // Mad-Max: instant curb pickup — spawn at the snapped pickup and board immediately, no approach.
    // Classic: spawn ~150 m upstream so the ride drives to the curb in roughly 13–15 seconds.
    const approach: RouteSegment[] = flags.madMaxRobotaxi ? [] : this.roads.approach(pickup, 150);
    const vehicleId = this.fleet.allocateTaxiId();
    // An empty approach means the cab is already at the curb; only boarding starts the ride.
    const trip: Trip = { playerId, requestId, vehicleId, destination, state: 'pickup', route: approach, ride,
      segment: 0, travelled: 0, lastAt: now, nextNotice: now + 1000, pickupExpires: now + 60_000 };
    this.fleet.addTaxi(vehicleId, approach.length ? routePose(approach[0]!, 0) : routePose(ride[0]!, 0));
    this.trips.set(playerId, trip);
    this.notice(trip, 'requested'); this.notice(trip, 'pickup');
    // Instant pickup boards at the curb regardless of the snap gap (the cab arrives at you).
    if (!approach.length) this.tryBoard(trip, now, flags.madMaxRobotaxi);
    return true;
  }
  /** Charges only after authoritative destination validation; duplicate in-flight hails coalesce. */
  async hailQuick(playerId: number, requestId: number, destination: Point, target: QuickRobotaxiTarget, now: number): Promise<boolean> {
    if (!flags.quickRobotaxi || flags.zonedWorld || !this.quickServices) { this.rejectQuick(playerId, requestId, destination); return false; }
    const existing = this.trips.get(playerId), waiting = this.pending.get(playerId);
    if (existing?.requestId === requestId) { this.notice(existing, existing.state); return true; }
    if (waiting?.requestId === requestId) return true;
    const receipt = this.quickReceipts.get(playerId);
    if (receipt?.requestId === requestId) { this.host.emit(receipt, playerId); return true; }
    if (this.host.wanted?.(playerId)) { this.rejectQuick(playerId, requestId, destination); return false; } // before any charge
    if (existing || waiting || this.fleet.occupants.has(playerId) || !this.host.locate(playerId)
      || now - (this.lastHail.get(playerId) ?? -Infinity) < 2000 || this.trips.size + this.pending.size >= 100) {
      this.rejectQuick(playerId, requestId, destination); return false;
    }
    this.lastHail.set(playerId, now);
    const pending = { requestId, cancelled: false }; this.pending.set(playerId, pending);
    const valid = () => !pending.cancelled && this.pending.get(playerId) === pending && !!this.host.locate(playerId) && !this.fleet.occupants.has(playerId);
    try {
      const drop = await this.quickServices.resolve(playerId, destination, target);
      const player = this.host.locate(playerId), pickup = player && this.roads.snap(player, 35, ROAD_LEVEL_TOLERANCE_M);
      if (!drop || !pickup || !valid()) { if (valid()) this.rejectQuick(playerId, requestId, destination); return false; }
      const distance = Math.hypot(drop.pose.x / 100 - pickup.point[0], drop.pose.z / 100 - pickup.point[2]);
      if (distance < 2) { this.rejectQuick(playerId, requestId, destination); return false; }
      const quote = await this.quickServices.quote(playerId, distance);
      if (!valid()) return false;
      if (!quote.affordable || target.maxFareCents && BigInt(quote.chargeCents) > BigInt(target.maxFareCents)) {
        this.rejectQuick(playerId, requestId, drop.pose, 'unaffordable', quote.chargeCents, drop.title, quote.freeRidesLeft); return false;
      }
      const rideId = crypto.randomUUID(), charged = await this.quickServices.charge(playerId, rideId, quote.chargeCents);
      if (!valid()) { if (charged.ok) await this.quickServices.refund?.(playerId, rideId).catch(() => undefined); return false; } // paid but no ride: give it back
      if (!charged.ok) { this.rejectQuick(playerId, requestId, drop.pose, 'unaffordable', quote.fareCents, drop.title, quote.freeRidesLeft); return false; }
      // D1 work may take longer than a tick: start pickup at the actual dispatch time.
      const dispatchAt = this.quickServices.now?.() ?? now;
      const rawApproach = this.roads.approach(pickup, 25), speed = Math.max(1, routeLength(rawApproach) / (QUICK_PICKUP_MS / 1000));
      const approach = rawApproach.map(segment => ({ ...segment, speed }));
      const departure = quickDeparture(pickup);
      const pickupPose = departure.length ? routePose(departure[0]!, 0) : { x: Math.round(pickup.point[0] * 100), y: Math.round(pickup.point[1] * 100), z: Math.round(pickup.point[2] * 100), yaw: drop.pose.yaw, flags: 0 };
      const vehicleId = this.fleet.allocateTaxiId();
      const trip: Trip = { playerId, requestId, vehicleId, destination: drop.pose, state: 'pickup', route: approach, ride: departure,
        segment: 0, travelled: 0, lastAt: dispatchAt, nextNotice: dispatchAt + 1000, pickupExpires: dispatchAt + (flags.robotaxiJump ? 0 : QUICK_FORCE_BOARD_MS), // robotaxiJump: board at once, no approach drive
        quick: { rideId, drop: drop.pose, pickup: pickupPose, title: drop.title, fareCents: charged.chargedCents,
          freeRidesLeft: Math.max(0, quote.freeRidesLeft - (charged.free ? 1 : 0)), startedAt: 0, ready: false } };
      this.fleet.addTaxi(vehicleId, approach.length ? routePose(approach[0]!, 0) : pickupPose);
      this.trips.set(playerId, trip); this.notice(trip, 'requested'); this.notice(trip, 'pickup');
      this.quickServices.charged?.(playerId, drop.friendPlayerId, rideId);
      return true;
    } catch { if (valid()) this.rejectQuick(playerId, requestId, destination); return false; }
    finally { if (this.pending.get(playerId) === pending) this.pending.delete(playerId); }
  }
  async quoteQuick(playerId: number, requestId: number, destination: Point, target: QuickRobotaxiTarget): Promise<void> {
    if (!flags.quickRobotaxi || flags.zonedWorld || !this.quickServices || this.host.wanted?.(playerId)) { this.rejectQuick(playerId, requestId, destination); return; }
    try {
      const drop = await this.quickServices.resolve(playerId, destination, target), player = this.host.locate(playerId);
      const pickup = player && this.roads.snap(player, 35, ROAD_LEVEL_TOLERANCE_M);
      if (!drop || !pickup) { this.rejectQuick(playerId, requestId, destination); return; }
      const quote = await this.quickServices.quote(playerId, Math.hypot(drop.pose.x / 100 - pickup.point[0], drop.pose.z / 100 - pickup.point[2]));
      this.rejectQuick(playerId, requestId, drop.pose, quote.affordable ? 'quoted' : 'unaffordable', quote.chargeCents, drop.title, quote.freeRidesLeft);
    } catch { this.rejectQuick(playerId, requestId, destination); }
  }
  ready(playerId: number, requestId: number): boolean {
    const trip = this.trips.get(playerId);
    if (!flags.quickRobotaxi || trip?.requestId !== requestId || trip.state !== 'quick' || !trip.quick) return false;
    trip.quick.ready = true; return true;
  }
  private rejectQuick(playerId: number, requestId: number, destination: Point, state: RobotaxiState = 'unavailable', fareCents = '0', title = 'Your destination', freeRidesLeft = 0): void {
    const pose = this.host.locate(playerId); if (!pose) return;
    this.host.emit({ type: 'ROBOTAXI_STATE', requestId, vehicleId: 0, state, pose, destination, etaSeconds: 0,
      quick: { title, fareCents, freeRidesLeft, durationMs: 0 } }, playerId);
  }
  /** Pane 13 "Go to friend": dispatch an instant Mad-Max robotaxi to any location. */
  goToLocation(playerId: number, requestId: number, destination: Point, now: number): boolean {
    return this.hail(playerId, requestId, destination, now);
  }
  cancel(playerId: number, requestId: number | undefined, now: number): boolean {
    const pending = this.pending.get(playerId);
    if (pending && (requestId === undefined || requestId === pending.requestId)) {
      pending.cancelled = true; this.pending.delete(playerId);
      const pose = this.host.locate(playerId); if (pose) this.rejectQuick(playerId, pending.requestId, pose, 'cancelled');
      return true;
    }
    const trip = this.trips.get(playerId);
    if (!trip || (requestId !== undefined && requestId !== trip.requestId)) return false;
    this.fleet.exit(playerId, trip.vehicleId, now);
    this.notice(trip, 'cancelled');
    this.trips.delete(playerId); this.fleet.cars.delete(trip.vehicleId);
    return true;
  }
  disconnect(playerId: number, now: number): void { this.cancel(playerId, undefined, now); this.lastHail.delete(playerId); this.quickReceipts.delete(playerId); }
  transfer(playerId: number): TaxiTransfer | undefined {
    const trip = this.trips.get(playerId);
    const car = trip && this.fleet.cars.get(trip.vehicleId)?.entry;
    if (!trip || !car || trip.state !== 'riding' || trip.segment >= trip.route.length) return undefined;
    const { x, y, z, yaw } = car;
    return { requestId: trip.requestId, destination: { ...trip.destination }, state: 'riding',
      pose: { x, y, z, yaw, flags: 0 }, speedCmps: car.speedCmps,
      route: trip.route.slice(trip.segment), travelled: trip.travelled };
  }
  pause(playerId: number): void { this.paused.add(playerId); }
  resume(playerId: number, now: number): void {
    this.paused.delete(playerId);
    const trip = this.trips.get(playerId); if (trip) trip.lastAt = now;
  }
  detach(playerId: number): void {
    this.trips.delete(playerId); this.paused.delete(playerId); this.lastHail.delete(playerId);
  }
  adopt(playerId: number, vehicleId: number, state: TaxiTransfer, now: number): boolean {
    if (!validTaxiTransfer(state) || this.trips.has(playerId) || this.fleet.cars.has(vehicleId) || this.fleet.occupants.has(playerId)) return false;
    this.fleet.addTaxi(vehicleId, state.pose);
    this.fleet.cars.get(vehicleId)!.entry.speedCmps = state.speedCmps;
    if (!this.fleet.boardTaxi(playerId, vehicleId, now)) { this.fleet.cars.delete(vehicleId); return false; }
    this.trips.set(playerId, { playerId, vehicleId, requestId: state.requestId, destination: state.destination,
      state: 'riding', route: state.route, ride: state.route, segment: 0, travelled: state.travelled,
      lastAt: now, nextNotice: now + 1000, pickupExpires: now });
    return true;
  }
  state(playerId: number): void { const trip = this.trips.get(playerId); if (trip) this.notice(trip, trip.state); }
  /** Only server-confirmed progress in this player's owned trip counts as activity. */
  renewPassengerActivity(playerId: number, before: Pose, after: Pose, now: number, activity: { lastInput: number }): void {
    const trip = this.trips.get(playerId);
    if (trip?.state !== 'riding' || this.fleet.occupants.get(playerId) !== trip.vehicleId) return;
    const car = this.fleet.cars.get(trip.vehicleId)?.entry;
    if (!car || car.kind !== 'robotaxi' || car.driverId !== 0 || car.speedCmps <= 0 ||
      before.flags !== PASSENGER_FLAG || after.flags !== PASSENGER_FLAG ||
      after.x !== car.x || after.y !== car.y || after.z !== car.z ||
      (before.x === after.x && before.y === after.y && before.z === after.z)) return;
    activity.lastInput = now;
  }
  step(now: number): void {
    for (const [id, departure] of this.departures) {
      let travelled = Math.max(0, now - departure.startedAt) / 1000 * 6;
      for (const segment of departure.route) {
        if (travelled <= segment.length) { this.fleet.moveTaxi(id, routePose(segment, travelled), 600, now); break; }
        travelled -= segment.length;
      }
      if (now - departure.startedAt >= 1500) { this.fleet.cars.delete(id); this.departures.delete(id); }
    }
    for (const [id, at] of this.retired) if (at <= now) { this.fleet.cars.delete(id); this.retired.delete(id); }
    for (const trip of this.trips.values()) {
      if (this.paused.has(trip.playerId)) continue;
      if (!this.host.locate(trip.playerId)) { this.disconnect(trip.playerId, now); continue; }
      // gtasf-d4zmv: the hail-entry check isn't enough: heat raised while the cab waits or the passenger is seated (a
      // kerbside robbery completed from the cab, or a crime in the D1 window) ends the ride at the kerb, fare refunded.
      if (trip.quick && (trip.state === 'pickup' || trip.state === 'quick') && this.host.wanted?.(trip.playerId)) {
        const rideId = trip.quick.rideId;
        this.cancel(trip.playerId, trip.requestId, now);
        if (rideId) void this.quickServices?.refundDispatched?.(trip.playerId, rideId).catch(() => undefined);
        continue;
      }
      if (trip.quick && trip.state === 'pickup' && now >= trip.pickupExpires) {
        this.fleet.moveTaxi(trip.vehicleId, trip.quick.pickup, 0, now);
        if (!this.tryBoard(trip, now, true)) this.cancel(trip.playerId, trip.requestId, now);
        continue;
      }
      if (trip.quick && trip.state === 'quick') {
        if (trip.quick.ready || now - trip.quick.startedAt >= QUICK_LOAD_TIMEOUT_MS) {
          this.fleet.moveTaxi(trip.vehicleId, trip.quick.drop, 0, now, trip.playerId);
          // N19b: out onto the kerb — unless a building is in the way (no sidewalk), then the standard exit step.
          const kerb = flags.quickDropKerb ? kerbExit(trip.quick.drop) : undefined;
          this.fleet.exit(trip.playerId, trip.vehicleId, now, kerb && (this.host.kerbStepClear?.(trip.quick.drop, kerb) ?? true) ? kerb : undefined);
          this.quickServices?.arrived?.(trip.playerId, now);
          this.notice(trip, 'arrived'); this.trips.delete(trip.playerId);
          const snap = this.roads.snap(trip.quick.drop, 1, ROAD_LEVEL_TOLERANCE_M);
          this.departures.set(trip.vehicleId, { route: snap ? quickDeparture(snap) : [], startedAt: now });
          continue;
        }
        // robotaxiJump (founder "robotaxi weird motion", gtasf-jnl2j): the 1.2 s lift-and-blur jump IS the ride, so the cab
        // just waits at the curb, speed 0. The old 6 m pull-away reached the client mostly done (a ~5 m sideways snap right
        // after boarding) and its 6 m/s kept the parked cab "moving" for the render (the wobble).
        if (flags.robotaxiJump) { this.fleet.moveTaxi(trip.vehicleId, trip.quick.pickup, 0, now, trip.playerId); continue; }
        // First second: show the taxi leaving on its actual lane, then hold under the title card (speed 0 once held).
        const elapsed = Math.max(0, now - trip.quick.startedAt) / 1000;
        let travelled = Math.min(6, elapsed * 6);
        for (const segment of trip.ride) {
          if (travelled <= segment.length) { this.fleet.moveTaxi(trip.vehicleId, routePose(segment, travelled), elapsed < 1 ? 600 : 0, now, trip.playerId); break; }
          travelled -= segment.length;
        }
        continue;
      }
      // Bound a suspended tick; never teleport a whole trip after an event-loop pause.
      let seconds = Math.min(0.25, Math.max(0, now - trip.lastAt) / 1000);
      const dt = seconds;
      trip.lastAt = now;
      while (seconds > 0 && trip.segment < trip.route.length) {
        const segment = trip.route[trip.segment]!;
        // Mad-Max rides run fast; pickup and all non-riding motion stay at the lane's normal speed.
        const speed = segment.speed * (flags.madMaxRobotaxi && trip.state === 'riding' ? MADMAX_SPEED_SCALE : 1);
        const available = (segment.length - trip.travelled) / speed;
        const used = Math.min(available, seconds);
        trip.travelled += used * speed; seconds -= used;
        let pose = routePose(segment, trip.travelled);
        // Loose-arcade bumps only shove a riderless pickup taxi; a ride's seat/camera is never disturbed.
        if (flags.arcadeHandling && trip.state === 'pickup' && seconds <= 0) pose = bumpTaxi(trip.bump ??= { offX: 0, offZ: 0, spin: 0 }, pose, this.bumpers(), dt);
        this.fleet.moveTaxi(trip.vehicleId, pose, Math.round(speed * 100), now,
          trip.state === 'riding' ? trip.playerId : undefined);
        if (trip.travelled + 0.00001 >= segment.length) { trip.segment++; trip.travelled = 0; }
      }
      if (trip.segment >= trip.route.length) {
        const car = this.fleet.cars.get(trip.vehicleId)!;
        car.entry.speedCmps = 0;
        if (trip.state === 'pickup') {
          if (!this.tryBoard(trip, now, false) && now >= trip.pickupExpires) this.cancel(trip.playerId, trip.requestId, now);
        } else {
          this.fleet.exit(trip.playerId, trip.vehicleId, now);
          this.notice(trip, 'arrived'); this.trips.delete(trip.playerId);
          this.retired.set(trip.vehicleId, now + 30_000);
        }
      }
      if (this.trips.has(trip.playerId) && now >= trip.nextNotice) { this.notice(trip, trip.state); trip.nextNotice = now + 1000; }
    }
  }
  private *bumpers() {
    for (const car of this.fleet.cars.values()) if (car.entry.driverId && car.entry.kind !== 'robotaxi') yield car.entry;
  }
  private tryBoard(trip: Trip, now: number, force = false): boolean {
    const player = this.host.locate(trip.playerId), car = this.fleet.cars.get(trip.vehicleId);
    if (!player || !car) return false;
    // Instant Mad-Max pickup boards at the curb regardless of the snap gap; classic requires arrival.
    if (!force && Math.hypot(player.x - car.entry.x, player.y - car.entry.y, player.z - car.entry.z) > 700) return false;
    if (!this.fleet.boardTaxi(trip.playerId, trip.vehicleId, now)) return false;
    if (trip.quick) {
      trip.state = 'quick'; trip.quick.startedAt = now; trip.lastAt = now;
      this.notice(trip, 'quick'); return true;
    }
    trip.state = 'riding'; trip.route = trip.ride; trip.segment = 0; trip.travelled = 0; trip.lastAt = now;
    this.notice(trip, 'riding'); return true;
  }
  private notice(trip: Trip, state: RobotaxiState): void {
    const car = this.fleet.cars.get(trip.vehicleId);
    if (!car) return;
    const { x, y, z, yaw, flags: poseFlags } = car.entry; // not the shared `flags` module (used just below)
    // ETA must use the SAME effective speed step() drives at, or a boosted mad-max ride (2.4x) shows an
    // ETA ~2.4x too long. Pickup/classic stay at lane speed. (gtasf-ygtw)
    const rideScale = flags.madMaxRobotaxi && trip.state === 'riding' ? MADMAX_SPEED_SCALE : 1;
    const remaining = trip.route.slice(trip.segment).reduce((sum, segment, i) => sum + (segment.length - (i === 0 ? trip.travelled : 0)) / (segment.speed * rideScale), 0);
    const message: Extract<S2CMessage, { type: 'ROBOTAXI_STATE' }> = { type: 'ROBOTAXI_STATE', requestId: trip.requestId, vehicleId: trip.vehicleId, state,
      pose: { x, y, z, yaw, flags: poseFlags }, destination: trip.destination,
      ...(trip.quick ? { quick: { title: trip.quick.title, fareCents: trip.quick.fareCents, freeRidesLeft: trip.quick.freeRidesLeft, durationMs: QUICK_CARD_MS } } : {}),
      etaSeconds: state === 'arrived' || state === 'cancelled' ? 0 : Math.min(65535, Math.ceil(remaining)) };
    if (trip.quick) this.quickReceipts.set(trip.playerId, message);
    this.host.emit(message, trip.playerId);
  }
}
