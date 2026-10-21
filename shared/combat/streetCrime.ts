/**
 * GTA V pivot — LANE B (combat & police): street-crime wanted triggers (flag streetCrimeWanted).
 *
 * Pure, shared, SERVER-authoritative. Pedestrians are client-only cosmetics, so the server can't validate a ped
 * hit — but it does see every COMBAT_FIRE and owns the SFPD unit positions. From those it derives two crimes:
 *   • public gunfire — any non-melee shot is 'mayhem' heat, rate-limited per shooter and capped so gunfire alone
 *     tops out at 2 stars (GTA: shooting in the street draws the police, not the helicopter);
 *   • shooting the police — the server-resolved shot passing within a car's radius of an SFPD unit is 'cop-hit'
 *     (rate-limited so an SMG burst escalates over seconds, not in one frame).
 * A shot that hits another player keeps its existing assault/ped-kill path and raises nothing extra here.
 */
import { addHeat, WANTED_THRESHOLDS, type Crime, type WantedState } from './wanted';

/** Minimum gap between two public-gunfire crimes from one shooter (ms). */
export const GUNFIRE_CRIME_INTERVAL_MS = 2_000;
/** Minimum gap between two cop-hit crimes from one shooter (ms). */
export const COP_HIT_INTERVAL_MS = 1_000;
/** Gunfire alone never pushes heat to 3 stars (the 3-star threshold). */
export const GUNFIRE_HEAT_CAP = WANTED_THRESHOLDS[2]!;
/** A shot "hits" a police unit when it passes this close to the unit's body centre (metres). */
export const POLICE_HIT_RADIUS_M = 2.5;
/** Unit body centre above its road/ground y (metres). */
export const POLICE_BODY_Y_M = 1;

export type Vec3 = readonly [number, number, number];

/** Shortest distance (metres) from point `p` to the segment a→b. */
export function segmentPointDistance(a: Vec3, b: Vec3, p: Vec3): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1], a[2] + dz * t - p[2]);
}

/**
 * Whether the shot a→b passes within POLICE_HIT_RADIUS_M of any unit (unit y is its ground/air y). `visible`
 * is the server's line-of-sight test from the muzzle to the unit's body, so a shot through a building misses.
 */
export function shotHitsPolice(origin: Vec3, to: Vec3, units: Iterable<{ x: number; y: number; z: number }>, visible?: (body: Vec3) => boolean): boolean {
  for (const u of units) {
    const body: Vec3 = [u.x, u.y + POLICE_BODY_Y_M, u.z];
    if (segmentPointDistance(origin, to, body) <= POLICE_HIT_RADIUS_M && (!visible || visible(body))) return true;
  }
  return false;
}

/** Per-shooter timestamps of the last street crimes (server-owned, one per peer). */
export interface StreetCrimeClock { lastGunfireMs: number; lastCopHitMs: number; lastPedKillMs: number }

export function freshStreetCrimeClock(): StreetCrimeClock {
  return { lastGunfireMs: -Infinity, lastCopHitMs: -Infinity, lastPedKillMs: -Infinity };
}

/** Minimum gap between two confessed ped kills from one player (ms) — a crowd mowed down escalates over seconds. */
export const PED_KILL_INTERVAL_MS = 1_000;

/**
 * The crime for a client-confessed ped kill (COMBAT_CRIME: shot or run over), rate-limited per player. Peds are
 * client-only, so the server can't verify the kill — but a confession only ever raises the SENDER's own heat, so
 * trusting it is safe (a cheater can only decline to self-incriminate). Mutates `clock` when a crime is returned.
 */
export function pedCrimeForReport(clock: StreetCrimeClock, now: number): Crime | null {
  if (now - clock.lastPedKillMs < PED_KILL_INTERVAL_MS) return null;
  clock.lastPedKillMs = now;
  return 'ped-kill';
}

export interface ShotFacts {
  /** The weapon is melee (fists/bat): a swing is not gunfire. */
  melee: boolean;
  /** The shot hit another player (already raised via assault/ped-kill). */
  hitPlayer: boolean;
  /** The shot passed through an SFPD unit. */
  hitPolice: boolean;
}

/**
 * The street crime (if any) a shot commits, given the shooter's clock and current heat. Mutates `clock` when a
 * crime is returned so the rate limits hold. Returns null when nothing should be raised.
 */
export function streetCrimeForShot(shot: ShotFacts, clock: StreetCrimeClock, heat: number, now: number): Crime | null {
  if (shot.hitPlayer) return null;
  if (shot.hitPolice) {
    if (now - clock.lastCopHitMs < COP_HIT_INTERVAL_MS) return null;
    clock.lastCopHitMs = now;
    clock.lastGunfireMs = now; // a shot at the police is also gunfire; don't double-count it
    return 'cop-hit';
  }
  if (shot.melee) return null;
  if (now - clock.lastGunfireMs < GUNFIRE_CRIME_INTERVAL_MS) return null;
  if (heat >= GUNFIRE_HEAT_CAP) return null;
  clock.lastGunfireMs = now;
  return 'mayhem';
}

/** Apply a street crime's heat, honouring the gunfire cap (gunfire never lifts heat past GUNFIRE_HEAT_CAP - 1). */
export function applyStreetCrime(state: WantedState, crime: Crime, now: number): WantedState {
  const next = addHeat(state, crime, now);
  if (crime === 'mayhem' && next.heat >= GUNFIRE_HEAT_CAP) return { ...next, heat: Math.max(state.heat, GUNFIRE_HEAT_CAP - 1) };
  return next;
}

/**
 * The crime for any client confession (COMBAT_CRIME): kinds 0/1 (shot / ran over a ped) are a rate-limited
 * 'ped-kill'; kind 2 (rammed a police car) is a 'cop-hit' sharing the shot cop-hit rate limit; kind 3 (knocked a ped
 * out, pedMelee) is a rate-limited 'assault'. Self-incriminating only.
 */
export function crimeForReport(kind: number, clock: StreetCrimeClock, now: number): Crime | null {
  if (kind === 3) { // knocked a ped out (pedMelee): an assault, sharing the ped-crime rate limit
    const crime = pedCrimeForReport(clock, now);
    return crime ? 'assault' : null;
  }
  if (kind === 2) {
    if (now - clock.lastCopHitMs < COP_HIT_INTERVAL_MS) return null;
    clock.lastCopHitMs = now;
    return 'cop-hit';
  }
  return pedCrimeForReport(clock, now);
}
