/**
 * GTA V pivot — LANE B (combat & police): the live SFPD pursuit (flag wanted). WorldDO owns this; it tracks
 * the police units chasing each wanted player, steers them toward the player each tick (arcade seek, snapped
 * to the road graph), reports whether a player has escaped line of sight (gating wanted decay), and publishes
 * the units as police-flagged VehicleEntries so they ride the existing vehicle snapshot and render as cars.
 *
 * Pursuit math is the pure, tested shared/combat/police.ts; this is the stateful glue. Units are bucketed per
 * player and capped world-wide (review fix 3), so the per-tick loops are O(total units), not O(players x units).
 */
import type { VehicleEntry } from '@gtasf/shared/protocol/types';
import {
  desiredUnits, distanceTo, HELICOPTER_ALTITUDE_M, HELICOPTER_SIGHT_M, HELICOPTER_SPEED, helicopterCount,
  MAX_POLICE_UNITS, POLICE_CHASE_SPEED, POLICE_FLAG, POLICE_ID_BASE, POLICE_SIGHT_M,
  POLICE_SPAWN_MAX_M, POLICE_SPAWN_MIN_M, passedRoadblock, roadblockAnchor,
  roadblockCount, roadblockLine, ROADBLOCK_LEVEL, seek, spawnPoint, SWAT_SPEED, swatCount, POLICE_STANDOFF_M, POLICE_FOOT_STANDOFF_M,
  OFFICER_COVER_CAR_M, OFFICER_COVER_HOLD_M, OFFICER_COVER_OFFSET_M, OFFICER_COVER_SEARCH_M, OFFICER_TAKE_COVER_M, OFFICER_DEPLOY_MAX_M, OFFICER_DEPLOY_MIN_M, OFFICER_LEASH_M, OFFICER_SPEED, OFFICER_STALL_MS, OFFICER_STANDOFF_M, officersWanted } from '@gtasf/shared/combat/police';
import { POLICE_FIRE_MIN_LEVEL } from '@gtasf/shared/combat/policeFire';
import { SFPD_TUNING } from '@gtasf/shared/combat/sfpdTuning';
import { RAM_CONTACT_M, RAM_COOLDOWN_MS, RAM_MAX_DY_M, RAM_SPEED_BONUS, RAM_STANDOFF_M, shouldRam } from '@gtasf/shared/combat/policeRam';
import type { VehicleKind } from '@gtasf/shared/protocol/types';

/** A pursuing player, in world metres (y is the player's ground height, for the helicopter's hover altitude). */
export interface PursuitTarget { id: number; x: number; y?: number; z: number; level: number; /** sfpdOnFoot: officers only step out for a player on foot. */ onFoot?: boolean;
  /** policeRam: the player is driving (rammable). */ driving?: boolean;
  /** sfpdCover: the player fired within SFPD_FIRING_WINDOW_MS (officers in the open break for cover). */ firing?: boolean }
/** policeRam: a ground unit hit a wanted player's car this tick. */
export interface PoliceRam { targetId: number; unitId: number; x: number; y: number; z: number }
/** Snap a world point (metres) to the nearest road; yaw is a byte (0–255). */
export type RoadSnap = (xMetres: number, zMetres: number) => { x: number; y: number; z: number; yaw: number } | null;

/** Officers adopt the player's height only within this horizontal distance (the player is on the ground they stand on). */
export const OFFICER_ADOPT_PLAYER_Y_M = 3;
/** An on-foot officer's own ground height after stepping to (x, z). Review D-H1: they used to take the PLAYER's y wherever
 *  they were, so on a hill their wall checks and bust/fire sight lines ran under (or over) the houses between them and the
 *  player — walking and shooting through buildings. Now: the player's y only when beside them, else the street beneath
 *  them (road snap), else hold the last known height. */
export function officerGroundY(currentY: number, x: number, z: number, t: { x: number; z: number; y?: number }, snap: RoadSnap): number {
  if (t.y !== undefined && distanceTo(x, z, t.x, t.z) <= OFFICER_ADOPT_PLAYER_Y_M) return t.y;
  return snap(x, z)?.y ?? currentY;
}

type Role = 'chase' | 'block' | 'heli' | 'swat' | 'foot';
// lastD/stallMs: progress tracking for road-bound chasers (sfpdOnFoot deploys officers from a stalled car).
interface Unit { id: number; targetId: number; role: Role; x: number; y: number; z: number; yaw: number; speedMps: number; lastD?: number; stallMs?: number; parkedMs?: number; ramReadyAt?: number;
  /** policePresence: an officer's door spot + the cruiser they stepped out of (cleared once they leave cover). */
  cover?: { x: number; z: number; carId: number } }
/** Per-target heading estimate + the current roadblock's anchor (for "has the player passed it?"). */
interface Track { lastX: number; lastZ: number; heading: number; headingKnown: boolean; anchorX: number; anchorZ: number; anchorH: number; hasBlock: boolean }

/** gtasf-66lvh: reaction + escalation timing (defaults from SFPD_TUNING; tests pass zeros for instant pursuits). */
export interface PursuitTiming {
  /** First star → first cruiser dispatched. */ dispatchDelayMs: number;
  /** Between reinforcements, per target. */ dispatchIntervalMs: number;
  /** Time at 3★+ before roadblocks, 4★+ before the helicopter, 5★ before SWAT. */
  roadblockDelayMs: number; helicopterDelayMs: number; swatDelayMs: number;
  /** Roadblocks only while a unit sees the player (sfpdFairness). */ roadblockNeedsSight: boolean;
}
export const DEFAULT_PURSUIT_TIMING: PursuitTiming = Object.freeze({
  dispatchDelayMs: SFPD_TUNING.dispatchDelayMs, dispatchIntervalMs: SFPD_TUNING.dispatchIntervalMs,
  roadblockDelayMs: SFPD_TUNING.roadblockDelayMs, helicopterDelayMs: SFPD_TUNING.helicopterDelayMs, swatDelayMs: SFPD_TUNING.swatDelayMs,
  roadblockNeedsSight: SFPD_TUNING.roadblockNeedsSight,
});
/** Zero delays: every unit appears on the first tick (the pre-gtasf-66lvh behaviour; unit tests). */
export const INSTANT_PURSUIT_TIMING: PursuitTiming = Object.freeze({ dispatchDelayMs: 0, dispatchIntervalMs: 0, roadblockDelayMs: 0, helicopterDelayMs: 0, swatDelayMs: 0, roadblockNeedsSight: true });
/** Per-target dispatch clock + when each star level was first reached in this pursuit (escalation gates). */
interface Dispatch { nextAt: number; reachedAt: (number | undefined)[] }

const ID_SPAN = 100_000;
const MIN_MOVE_M = 0.3; // movement below this (per tick) doesn't update the heading estimate

export class WorldPolice {
  /** Units bucketed by the player they chase, so per-target work touches only that player's units. */
  private readonly byTarget = new Map<number, Map<number, Unit>>();
  private readonly tracks = new Map<number, Track>();
  private nextId = POLICE_ID_BASE;
  private total = 0; // live unit count across all players (kept in sync with the buckets)
  private clockMs = 0; // policeRam: summed update dt (per-unit ram cooldowns)
  private rams: PoliceRam[] = [];
  // Sight (gtasf-abijv): with a `canSee` line-of-sight check, units chase where they LAST SAW the player, so breaking
  // line of sight (and getting away from that spot) is how you escape; `seen` feeds escapedFor.
  private readonly lastSeen = new Map<number, { x: number; y?: number; z: number }>();
  private readonly seen = new Map<number, boolean>();
  /** dispatchTracksUntilSighted (critic N38): targets some unit has seen in this pursuit. */
  private readonly sightedOnce = new Set<number>();
  private lastSeenUsesSight = false;
  private ramOn = false;
  private readonly dispatch = new Map<number, Dispatch>();
  private readonly timing: PursuitTiming;

  /**
   * `offRoadBlocked(fromX, fromZ, toX, toZ, y)` (metres) says whether a straight step is blocked by a building; the
   * off-road fallback (when the road snap would undo a step) is only taken when it is clear, so cruisers cut across
   * plazas and lots but never drive through walls. Omitted ⇒ treated as clear.
   */
  constructor(private readonly snap: RoadSnap, private readonly rng: () => number = Math.random,
    private readonly offRoadBlocked?: (fromX: number, fromZ: number, toX: number, toZ: number, y: number) => boolean,
    timing: Partial<PursuitTiming> = {}) { this.timing = { ...DEFAULT_PURSUIT_TIMING, ...timing }; }

  /** gtasf-66lvh: the dispatch/escalation clock for a target (created on its first wanted tick). */
  private dispatchFor(t: PursuitTarget): Dispatch {
    let d = this.dispatch.get(t.id);
    if (!d) { d = { nextAt: this.clockMs + this.timing.dispatchDelayMs, reachedAt: [] }; this.dispatch.set(t.id, d); }
    for (let star = 1; star <= 5; star++) {
      if (t.level >= star) d.reachedAt[star] ??= this.clockMs;
      else d.reachedAt[star] = undefined;
    }
    return d;
  }

  /** Has the target held `star`+ for at least `delayMs` in this pursuit? */
  private escalated(t: PursuitTarget, star: number, delayMs: number): boolean {
    const at = this.dispatch.get(t.id)?.reachedAt[star];
    return at !== undefined && this.clockMs - at >= delayMs;
  }

  private bucket(targetId: number): Map<number, Unit> {
    let b = this.byTarget.get(targetId);
    if (!b) { b = new Map(); this.byTarget.set(targetId, b); }
    return b;
  }

  private dropBucket(targetId: number): void {
    const b = this.byTarget.get(targetId);
    if (b) { this.total -= b.size; this.byTarget.delete(targetId); }
  }

  private deleteUnit(bucket: Map<number, Unit>, id: number): void {
    if (bucket.delete(id)) this.total--;
  }

  /** Spawn a unit for a target, respecting the world-wide cap. Ground units road-snap; air units keep `airY`. */
  private spawn(targetId: number, role: Role, x: number, z: number, airY?: number): boolean {
    if (this.total >= MAX_POLICE_UNITS) return false;
    if (this.nextId >= POLICE_ID_BASE + ID_SPAN) this.nextId = POLICE_ID_BASE;
    const id = this.nextId++;
    const unit: Unit = airY !== undefined
      ? { id, targetId, role, x, y: airY, z, yaw: 0, speedMps: 0 } // helicopter: flies, not road-snapped
      : (() => { const road = this.snap(x, z); return { id, targetId, role, x: road?.x ?? x, y: road?.y ?? 0, z: road?.z ?? z, yaw: road?.yaw ?? 0, speedMps: 0 }; })();
    this.bucket(targetId).set(id, unit);
    this.total++;
    return true;
  }

  /** Spawn/despawn/steer every player's pursuit. `air` enables the Combat 5b helicopter + SWAT tiers (flag policeAir). */
  /** Steer every unit; returns the rams this tick (policeRam: `options.ram`). */
  update(dtSeconds: number, targets: readonly PursuitTarget[], options: { air?: boolean; foot?: boolean; ram?: boolean;
    /** policePresence: officers fight from their cruiser's door at 2★+ instead of charging (critique #16). */
    cover?: boolean;
    /** sfpdCover (gtasf-ex3nf): officers in the open near a player who is shooting run to the far side of a stopped cruiser. */
    takeCover?: boolean;
    /** Line of sight from a ground unit (metres) to the player; omitted ⇒ distance-only sight (units always know where you are). */
    canSee?: (unit: { x: number; y: number; z: number }, target: PursuitTarget) => boolean;
    /** wantedEscape (gtasf-66lvh): the player is in a hideout — ground units spot them only up close, the helicopter not at all. */
    inCover?: (target: PursuitTarget) => boolean;
    /** dispatchTracksUntilSighted (critic N38): until some unit has seen the player in this pursuit, units steer to the
     *  player's real position (callers keep reporting it) instead of the crime spot; last-seen searching starts after
     *  the first sighting. */
    trackUntilSighted?: boolean } = {}): PoliceRam[] {
    this.lastSeenUsesSight = options.canSee !== undefined || options.inCover !== undefined;
    const air = options.air ?? false, foot = options.foot ?? false;
    this.clockMs += Math.max(0, dtSeconds) * 1000; this.rams = []; this.ramOn = options.ram ?? false;
    const wanted = new Map(targets.filter(t => t.level > 0).map(t => [t.id, t]));
    // Drop buckets + tracks whose target is gone or no longer wanted.
    for (const id of this.byTarget.keys()) if (!wanted.has(id)) this.dropBucket(id);
    for (const id of this.tracks.keys()) if (!wanted.has(id)) this.tracks.delete(id);
    for (const id of this.lastSeen.keys()) if (!wanted.has(id)) { this.lastSeen.delete(id); this.seen.delete(id); }
    for (const id of this.sightedOnce) if (!wanted.has(id)) this.sightedOnce.delete(id);
    for (const id of this.dispatch.keys()) if (!wanted.has(id)) this.dispatch.delete(id);

    for (const truth of wanted.values()) {
      const bucket = this.bucket(truth.id);
      this.dispatchFor(truth);
      const t = this.chaseTarget(truth, bucket, options.canSee, options.inCover?.(truth) ?? false, options.trackUntilSighted ?? false);
      this.maintainGround(bucket, t, 'chase', desiredUnits(t.level), POLICE_CHASE_SPEED, dtSeconds, truth);
      this.updateRoadblock(truth, bucket);
      // Combat 5b (flag policeAir): SWAT vans (wanted 5) are heavier/slower ground units; the helicopter (wanted 4)
      // flies — car GLBs stand in until lane-A art. Both count toward the world cap + per-player bucket.
      this.maintainGround(bucket, t, 'swat', air && this.escalated(truth, 5, this.timing.swatDelayMs) ? swatCount(t.level) : 0, SWAT_SPEED, dtSeconds, truth);
      this.maintainHelis(bucket, t, air && this.escalated(truth, 4, this.timing.helicopterDelayMs) ? helicopterCount(t.level) : 0, dtSeconds);
      this.maintainOfficers(bucket, { ...t, firing: truth.firing }, foot, dtSeconds, options.cover ?? false, options.takeCover ?? false); // sfpdOnFoot: officers from stalled cars
    }
    return this.rams;
  }

  /** SFPD on foot: when a road-bound car has stalled out of bust range, it deploys officers who run to the player
   *  (building-blocked like the off-road fallback, never road-snapped). They count for bust/fire/sight like any
   *  ground unit, and give up beyond OFFICER_LEASH_M. */
  private maintainOfficers(bucket: Map<number, Unit>, t: PursuitTarget, enabled: boolean, dt: number, cover = false, takeCover = false): void {
    const officers = [...bucket.values()].filter(u => u.role === 'foot');
    if (!enabled) { for (const o of officers) this.deleteUnit(bucket, o.id); return; }
    for (const o of officers) if (distanceTo(o.x, o.z, t.x, t.z) > OFFICER_LEASH_M) this.deleteUnit(bucket, o.id);
    // Officers step out of a car that has stalled out of reach, or that has parked beside the player (GTA: cops get
    // out and give chase on foot) — only while the player is on foot.
    const stalled = t.onFoot ? [...bucket.values()].find(u => (u.role === 'chase' || u.role === 'swat')
      && ((u.stallMs ?? 0) >= OFFICER_STALL_MS || (u.parkedMs ?? 0) >= OFFICER_STALL_MS)) : undefined;
    let have = [...bucket.values()].filter(u => u.role === 'foot').length;
    for (const want = officersWanted(t.level, Boolean(stalled)); stalled && have < want; have++) {
      // Step out of the car one metre toward the player (side by side for the second officer).
      const d = Math.max(1e-3, distanceTo(stalled.x, stalled.z, t.x, t.z)), ux = (t.x - stalled.x) / d, uz = (t.z - stalled.z) / d;
      // Review D-L3: prefer a side that isn't a wall (this side, the other, then straight toward the player). If every
      // side reads blocked (a kerb line, or collision not loaded yet — the check fails closed) keep the old spot: the
      // officer can't walk through anything from there anyway, and police still deploy.
      const preferred = have % 2 ? 1 : -1;
      const sides = [preferred, -preferred, 0].map(side => ({ x: stalled.x + ux - uz * side, z: stalled.z + uz + ux * side }));
      const spot = sides.find(p => !this.offRoadBlocked?.(stalled.x, stalled.z, p.x, p.z, stalled.y)) ?? sides[0]!;
      if (!this.spawn(t.id, 'foot', spot.x, spot.z, stalled.y)) break; // capped
      if (cover) { const o = [...bucket.values()].at(-1); if (o?.role === 'foot') o.cover = { x: o.x, z: o.z, carId: stalled.id }; }
    }
    for (const o of bucket.values()) {
      if (o.role !== 'foot') continue;
      // sfpdCover: an officer charging in the open near a player who is SHOOTING breaks for the far side of the nearest stopped
      // cruiser (then holds there like a door-cover officer) instead of running into the line of fire.
      if (takeCover && !o.cover && t.firing && t.level >= POLICE_FIRE_MIN_LEVEL && distanceTo(o.x, o.z, t.x, t.z) <= OFFICER_TAKE_COVER_M) {
        const spot = this.coverSpot(bucket, o, t);
        if (spot) o.cover = spot;
      }
      // policePresence: at 2★+ hold at the cruiser door and shoot (policeFire counts officers as ground units) while the
      // player is in range and the car is still there; once they leave cover (player ran / car moved) they chase.
      if (o.cover) {
        const car = bucket.get(o.cover.carId);
        const holding = (cover || takeCover) && t.level >= POLICE_FIRE_MIN_LEVEL && distanceTo(o.x, o.z, t.x, t.z) <= OFFICER_COVER_HOLD_M
          && car !== undefined && car.speedMps < .5 && distanceTo(car.x, car.z, o.cover.x, o.cover.z) <= OFFICER_COVER_CAR_M;
        if (holding) {
          // sfpdCover: still running to a cover spot (a door-cover officer already stands on theirs, so this is a no-op for them).
          if (distanceTo(o.x, o.z, o.cover.x, o.cover.z) > .3) {
            const next = seek(o.x, o.z, o.cover.x, o.cover.z, OFFICER_SPEED, dt);
            if (!this.offRoadBlocked?.(o.x, o.z, next.x, next.z, o.y)) {
              o.speedMps = dt > 0 ? Math.hypot(next.x - o.x, next.z - o.z) / dt : 0;
              o.yaw = Math.round(((Math.atan2(next.x - o.x, next.z - o.z) / (2 * Math.PI) + 1) * 256)) % 256;
              o.x = next.x; o.z = next.z; o.y = officerGroundY(o.y, next.x, next.z, t, this.snap);
              continue;
            } // a wall on the way: hold where they are
          }
          o.speedMps = 0;
          o.yaw = Math.round(((Math.atan2(t.x - o.x, t.z - o.z) / (2 * Math.PI) + 1) * 256)) % 256; // face the player
          continue;
        }
        o.cover = undefined;
      }
      if (distanceTo(o.x, o.z, t.x, t.z) <= OFFICER_STANDOFF_M) { o.speedMps = 0; continue; }
      const next = seek(o.x, o.z, t.x, t.z, OFFICER_SPEED, dt);
      if (this.offRoadBlocked?.(o.x, o.z, next.x, next.z, o.y)) { o.speedMps = 0; continue; } // a wall: hold
      o.speedMps = dt > 0 ? Math.hypot(next.x - o.x, next.z - o.z) / dt : 0;
      o.yaw = Math.round(((Math.atan2(t.x - o.x, t.z - o.z) / (2 * Math.PI) + 1) * 256)) % 256;
      o.x = next.x; o.z = next.z;
      o.y = officerGroundY(o.y, next.x, next.z, t, this.snap);
    }
  }

  /** sfpdCover: the far side (away from the player) of the nearest stopped cruiser/SWAT van within OFFICER_COVER_SEARCH_M. */
  private coverSpot(bucket: Map<number, Unit>, o: Unit, t: PursuitTarget): { x: number; z: number; carId: number } | null {
    let best: Unit | null = null, bestD = OFFICER_COVER_SEARCH_M;
    for (const u of bucket.values()) {
      if ((u.role !== 'chase' && u.role !== 'swat') || u.speedMps >= .5) continue;
      const d = distanceTo(o.x, o.z, u.x, u.z);
      if (d <= bestD) { best = u; bestD = d; }
    }
    if (!best) return null;
    const away = Math.max(1e-3, distanceTo(best.x, best.z, t.x, t.z));
    return { x: best.x + (best.x - t.x) / away * OFFICER_COVER_OFFSET_M, z: best.z + (best.z - t.z) / away * OFFICER_COVER_OFFSET_M, carId: best.id };
  }

  /** Keep `want` road-bound seekers of `role` chasing the player at `speed`. */
  private maintainGround(bucket: Map<number, Unit>, t: PursuitTarget, role: Role, want: number, speed: number, dt: number, truth: PursuitTarget = t): void {
    const mine = [...bucket.values()].filter(u => u.role === role);
    const dispatch = this.dispatch.get(t.id);
    for (let i = mine.length; i < want; i++) {
      // gtasf-66lvh: cruisers are dispatched one at a time (a delay after the first star, then an interval).
      if (dispatch && this.clockMs < dispatch.nextAt) break;
      const ring = spawnPoint(t.x, t.z, this.rng() * Math.PI * 2, POLICE_SPAWN_MIN_M + this.rng() * (POLICE_SPAWN_MAX_M - POLICE_SPAWN_MIN_M));
      if (!this.spawn(t.id, role, ring.x, ring.z)) break; // capped
      if (dispatch) dispatch.nextAt = this.clockMs + this.timing.dispatchIntervalMs;
    }
    if (mine.length > want) for (const u of mine.slice(want)) this.deleteUnit(bucket, u.id);
    // Review: only ram a driver the units can SEE, and measure contact to the REAL car (t may be the last-seen spot).
    const rammable = this.ramOn && shouldRam(truth.level, truth.driving) && (this.seen.get(truth.id) ?? true);
    for (const u of bucket.values()) {
      if (u.role !== role) continue;
      // policeRam: a ready unit drives INTO a wanted driver's car; contact is a ram, then it backs off to the standoff.
      let ramming = rammable && this.clockMs >= (u.ramReadyAt ?? 0);
      if (ramming && distanceTo(u.x, u.z, truth.x, truth.z) <= RAM_CONTACT_M && (truth.y === undefined || Math.abs(u.y - truth.y) <= RAM_MAX_DY_M)) {
        this.rams.push({ targetId: t.id, unitId: u.id, x: u.x, y: u.y, z: u.z });
        u.ramReadyAt = this.clockMs + RAM_COOLDOWN_MS;
        ramming = false;
      }
      if (distanceTo(u.x, u.z, t.x, t.z) <= (ramming ? RAM_STANDOFF_M : t.onFoot ? POLICE_FOOT_STANDOFF_M : POLICE_STANDOFF_M)) { u.speedMps = 0; u.parkedMs = (u.parkedMs ?? 0) + dt * 1000; u.stallMs = 0; continue; } // parked beside the player
      u.parkedMs = 0;
      const next = seek(u.x, u.z, t.x, t.z, ramming ? speed * RAM_SPEED_BONUS : speed, dt);
      const moved = Math.hypot(next.x - u.x, next.z - u.z);
      let road = this.snap(next.x, next.z);
      // Snapping a straight-line step back onto the nearest road can undo it entirely (a road perpendicular to the
      // player, or a dead end) and freeze the unit for good. If the snap keeps < 30% of the step's progress, take the
      // unsnapped step (the cruiser cuts across) so a pursuit closes in — unless a building is in the way.
      if (road && moved > 0) {
        const before = distanceTo(u.x, u.z, t.x, t.z);
        if (before - distanceTo(road.x, road.z, t.x, t.z) < 0.3 * moved && !this.offRoadBlocked?.(u.x, u.z, next.x, next.z, u.y)) road = null;
      }
      u.x = road?.x ?? next.x; u.z = road?.z ?? next.z;
      if (road) { u.y = road.y; u.yaw = road.yaw; }
      else if (moved > 0) u.yaw = Math.round(((Math.atan2(t.x - u.x, t.z - u.z) / (2 * Math.PI) + 1) * 256)) % 256; // face the chase (byte yaw)
      u.speedMps = dt > 0 ? moved / dt : 0;
      // Stall tracking (sfpdOnFoot): out of bust range but within a short run, and barely closing → stalled.
      const d = distanceTo(u.x, u.z, t.x, t.z);
      const closing = u.lastD === undefined ? Infinity : u.lastD - d;
      u.stallMs = d > OFFICER_DEPLOY_MIN_M && d <= OFFICER_DEPLOY_MAX_M && closing < 0.1 * speed * dt ? (u.stallMs ?? 0) + dt * 1000 : 0;
      u.lastD = d;
    }
  }

  /** Keep `want` helicopters hovering over + following the player in 2D at altitude (no road snap). */
  private maintainHelis(bucket: Map<number, Unit>, t: PursuitTarget, want: number, dt: number): void {
    const altitude = (t.y ?? 0) + HELICOPTER_ALTITUDE_M;
    const mine = [...bucket.values()].filter(u => u.role === 'heli');
    for (let i = mine.length; i < want; i++) {
      const ring = spawnPoint(t.x, t.z, this.rng() * Math.PI * 2, POLICE_SPAWN_MIN_M);
      if (!this.spawn(t.id, 'heli', ring.x, ring.z, altitude)) break;
    }
    if (mine.length > want) for (const u of mine.slice(want)) this.deleteUnit(bucket, u.id);
    for (const u of bucket.values()) {
      if (u.role !== 'heli') continue;
      const next = seek(u.x, u.z, t.x, t.z, HELICOPTER_SPEED, dt);
      const moved = Math.hypot(next.x - u.x, next.z - u.z);
      u.x = next.x; u.z = next.z; u.y = altitude; // flies straight to the player at altitude, no snapping
      u.yaw = Math.round(((Math.atan2(t.x - u.x, t.z - u.z) / (2 * Math.PI) + 1) * 256)) % 256;
      u.speedMps = dt > 0 ? moved / dt : 0;
    }
  }

  /** Where the units should head this tick: the player while any unit sees them (within sight range and, with
   *  `canSee`, an unblocked line; the helicopter's spotlight needs no line), else the last place they were seen
   *  (the crime scene to start with). Records `seen` for escapedFor. */
  private chaseTarget(t: PursuitTarget, bucket: Map<number, Unit>, canSee: ((unit: Unit, target: PursuitTarget) => boolean) | undefined, inCover = false, trackUntilSighted = false): PursuitTarget {
    let sees = false;
    for (const u of bucket.values()) {
      const heli = u.role === 'heli';
      if (heli && inCover) continue; // under a garage roof: the spotlight can't find you
      if (distanceTo(u.x, u.z, t.x, t.z) > (inCover ? SFPD_TUNING.hideoutSpotM : heli ? HELICOPTER_SIGHT_M : POLICE_SIGHT_M)) continue;
      if (heli || !canSee || canSee(u, t)) { sees = true; break; }
    }
    if (sees) this.sightedOnce.add(t.id);
    const last = this.lastSeen.get(t.id);
    // Tracking stops at cover (seeded-graph chase 10-20): with real roads, units homed straight into the garage a never-seen
    // player had hidden in and spotted them at 9 m. In cover they search the last tracked spot (the garage edge) instead.
    if (sees || !last || (!canSee && !inCover) || (trackUntilSighted && !this.sightedOnce.has(t.id) && !inCover)) {
      this.lastSeen.set(t.id, { x: t.x, ...(t.y !== undefined ? { y: t.y } : {}), z: t.z });
      this.seen.set(t.id, sees);
      return t;
    }
    this.seen.set(t.id, false);
    return { ...t, x: last.x, z: last.z, ...(last.y !== undefined ? { y: last.y } : {}) };
  }

  /** Form / re-form a stationary roadblock ahead of the player once wanted ≥ ROADBLOCK_LEVEL. */
  private updateRoadblock(t: PursuitTarget, bucket: Map<number, Unit>): void {
    const track = this.tracks.get(t.id) ?? { lastX: t.x, lastZ: t.z, heading: 0, headingKnown: false, anchorX: 0, anchorZ: 0, anchorH: 0, hasBlock: false };
    const dx = t.x - track.lastX, dz = t.z - track.lastZ;
    if (Math.hypot(dx, dz) >= MIN_MOVE_M) { track.heading = Math.atan2(dz, dx); track.headingKnown = true; } // only when actually moving
    track.lastX = t.x; track.lastZ = t.z;
    this.tracks.set(t.id, track);

    const count = roadblockCount(t.level);
    const blocks = [...bucket.values()].filter(u => u.role === 'block');
    // No roadblock below level 3, or until we know which way the player is heading (so it forms ahead, not at a guess).
    // gtasf-66lvh: only after ROADBLOCK delay at 3★+, and never planted ahead of a player the units can't see (that
    // was the police reading your position off the map and re-spotting you at every block).
    const ready = this.escalated(t, ROADBLOCK_LEVEL, this.timing.roadblockDelayMs);
    if (t.level < ROADBLOCK_LEVEL || count === 0 || !track.headingKnown || !ready) {
      for (const u of blocks) this.deleteUnit(bucket, u.id);
      track.hasBlock = false;
      return;
    }
    // (Re)form a block when there isn't one, the car count changed, or the player drove past the last one.
    const reform = !track.hasBlock || blocks.length !== count
      || passedRoadblock(t.x, t.z, track.anchorX, track.anchorZ, track.anchorH);
    if (!reform || (this.timing.roadblockNeedsSight && this.lastSeenUsesSight && this.seen.get(t.id) === false)) return;
    for (const u of blocks) this.deleteUnit(bucket, u.id);
    const anchor = roadblockAnchor(t.x, t.z, track.heading);
    track.anchorX = anchor.x; track.anchorZ = anchor.z; track.anchorH = track.heading; track.hasBlock = true;
    for (const p of roadblockLine(anchor.x, anchor.z, track.heading, count)) if (!this.spawn(t.id, 'block', p.x, p.z)) break;
  }

  /** Has this player escaped (no pursuing unit can see them)? Feeds the wanted decay. The helicopter's spotlight
   *  has a wider sight than a ground unit's, so at wanted 4+ you must lose the chopper to escape. */
  escapedFor(targetId: number, playerXMetres: number, playerZMetres: number): boolean {
    const bucket = this.byTarget.get(targetId);
    if (!bucket) return true;
    const seen = this.seen.get(targetId);
    if (seen !== undefined && this.lastSeenUsesSight) return !seen; // line-of-sight sight (gtasf-abijv)
    for (const u of bucket.values()) {
      const sight = u.role === 'heli' ? HELICOPTER_SIGHT_M : POLICE_SIGHT_M;
      if (distanceTo(u.x, u.z, playerXMetres, playerZMetres) <= sight) return false;
    }
    return true;
  }

  /** Distance (m) from a point to the nearest unit of any role chasing this player (Infinity if none) — outrun test. */
  nearestUnitTo(targetId: number, xMetres: number, zMetres: number): number {
    let best = Infinity;
    for (const u of this.byTarget.get(targetId)?.values() ?? []) best = Math.min(best, distanceTo(u.x, u.z, xMetres, zMetres));
    return best;
  }

  /** Where the units last saw this player (metres), for the radar search circle. */
  lastSeenOf(targetId: number): { x: number; z: number } | undefined { return this.lastSeen.get(targetId); }

  /** Remove every unit chasing a player (on disconnect / wanted cleared). */
  forget(targetId: number): void {
    this.dropBucket(targetId);
    this.tracks.delete(targetId);
    this.lastSeen.delete(targetId); this.seen.delete(targetId); this.sightedOnce.delete(targetId);
    this.dispatch.delete(targetId);
  }

  get count(): number { return this.total; }

  /** The ground units (not the helicopter) chasing one player — the ones that shoot at them (policeFire). */
  *groundUnitsChasing(targetId: number): Iterable<{ id: number; x: number; y: number; z: number }> {
    const bucket = this.byTarget.get(targetId);
    if (bucket) for (const u of bucket.values()) if (u.role !== 'heli') yield u;
  }

  /** Ground units (cars + officers, never the helicopter) within `radiusM` of a point — the bust candidates. */
  *groundUnitsNear(xMetres: number, zMetres: number, radiusM: number): Iterable<{ x: number; y: number; z: number }> {
    for (const bucket of this.byTarget.values()) for (const u of bucket.values()) {
      if (u.role !== 'heli' && distanceTo(u.x, u.z, xMetres, zMetres) <= radiusM) yield u;
    }
  }

  /** Distance (metres) from a point to the nearest GROUND unit (helicopters never bust), or Infinity. */
  nearestGroundM(xMetres: number, zMetres: number): number {
    let best = Infinity;
    for (const bucket of this.byTarget.values()) for (const u of bucket.values()) {
      if (u.role !== 'heli') best = Math.min(best, distanceTo(u.x, u.z, xMetres, zMetres));
    }
    return best;
  }

  /** Every live unit (metres; y is its road/air y) within `radiusM` of a point — the street-crime shot test. */
  *unitsNear(xMetres: number, zMetres: number, radiusM: number): Iterable<{ x: number; y: number; z: number }> {
    for (const bucket of this.byTarget.values()) for (const u of bucket.values()) {
      if (distanceTo(u.x, u.z, xMetres, zMetres) <= radiusM) yield u;
    }
  }

  /** Officers on foot near a point (metres) — for the client render (sfpdOnFoot slice 2). */
  *officersNear(xMetres: number, zMetres: number, radiusM: number): Iterable<{ id: number; x: number; y: number; z: number; yaw: number; speedMps: number }> {
    for (const bucket of this.byTarget.values()) for (const u of bucket.values()) {
      if (u.role === 'foot' && distanceTo(u.x, u.z, xMetres, zMetres) <= radiusM) yield u;
    }
  }

  /** Police units near a viewer (cm), as police-flagged NPC-car VehicleEntries for the vehicle snapshot. */
  entriesNear(viewerXcm: number, viewerZcm: number, radiusCm = 40_000): VehicleEntry[] {
    const out: VehicleEntry[] = [];
    for (const bucket of this.byTarget.values()) for (const u of bucket.values()) {
      if (u.role === 'foot') continue; // officers on foot are not vehicles (officersNear; rendered as people)
      if (Math.hypot(Math.round(u.x * 100) - viewerXcm, Math.round(u.z * 100) - viewerZcm) > radiusCm) continue;
      out.push(this.toEntry(u));
    }
    return out;
  }

  private toEntry(u: Unit): VehicleEntry {
    // Stand-in GLBs until lane-A art: cruiser/roadblock = subaru, SWAT van = bus, helicopter = supercar (at altitude).
    const kind: VehicleKind = u.role === 'heli' ? 'supercar' : u.role === 'swat' ? 'bus' : 'subaru';
    return {
      id: u.id, x: Math.round(u.x * 100), y: Math.round(u.y * 100), z: Math.round(u.z * 100),
      yaw: ((Math.round(u.yaw) % 256) + 256) % 256, // already a 0–255 byte from the road snap
      flags: 0x20 | POLICE_FLAG, // TRAFFIC_FLAG so it's an NPC car + POLICE_FLAG for the light bar
      kind, driverId: 0, speedCmps: Math.round(u.speedMps * 100),
    };
  }

  /** A police VEHICLE (not an officer on foot) as a snapshot entry, by id. */
  entryById(id: number): VehicleEntry | undefined {
    for (const bucket of this.byTarget.values()) { const u = bucket.get(id); if (u && u.role !== 'foot') return this.toEntry(u); }
    return undefined;
  }

  /** Remove one unit (its vehicle exploded — vehicleDamage). The pursuit tops itself back up as usual. */
  destroyUnit(id: number): boolean {
    for (const bucket of this.byTarget.values()) if (bucket.has(id)) { this.deleteUnit(bucket, id); return true; }
    return false;
  }
}
