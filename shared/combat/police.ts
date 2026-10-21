/**
 * GTA V pivot — LANE B (combat & police): the SFPD pursuit logic (flag wanted).
 *
 * Pure, shared, SERVER-authoritative decisions for the police chase. WorldDO owns the live units (poses, road
 * snapping); this module decides how many units a wanted level should field, how a unit seeks the player, and
 * whether the player has escaped line of sight (which gates wanted decay in shared/combat/wanted.ts).
 *
 * Movement is arcade-grade by design (no physics / full lane pathfinding): units seek straight toward the
 * player and the caller snaps the result onto the road graph. Escalation tiers come from wantedResponse.
 */
import { SFPD_TUNING } from './sfpdTuning';
import { pursuitCars, WANTED_MAX } from './wanted';

/** Reserved id band for SFPD units, well above civilian traffic (TRAFFIC_ID_BASE = 1,000,000). */
export const POLICE_ID_BASE = 1_500_000;
/** VehicleEntry.flags bit marking an SFPD car (in addition to TRAFFIC_FLAG 0x20), so the client adds a light bar. */
export const POLICE_FLAG = 0x40;
/** An officer can see the player within this range (metres) — gates escape. */
export const POLICE_SIGHT_M = SFPD_TUNING.sightM;
/** Pursuit drive speed (m/s). */
export const POLICE_CHASE_SPEED = SFPD_TUNING.chaseSpeedMps;
/** New units appear on a ring this far from the player (metres). */
export const POLICE_SPAWN_MIN_M = 75;
export const POLICE_SPAWN_MAX_M = 140;
/** World-wide cap on live SFPD units across ALL players (review fix 3), so a crowd of wanted players can't
 *  blow up the per-tick pursuit work. Units are also bucketed per player so the loops are O(total), not O(players x units). */
export const MAX_POLICE_UNITS = 60;

/** How many pursuit cars a wanted level should keep on the player (0–5). */
export function desiredUnits(level: number): number {
  return pursuitCars(level);
}

/** Move a unit toward the target by up to speed·dt (2D). Road snapping is the caller's job. */
export function seek(ux: number, uz: number, tx: number, tz: number, speedMps: number, dt: number): { x: number; z: number } {
  const dx = tx - ux, dz = tz - uz;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return { x: ux, z: uz };
  const step = Math.min(d, Math.max(0, speedMps) * Math.max(0, dt));
  return { x: ux + (dx / d) * step, z: uz + (dz / d) * step };
}

/** SFPD on foot (flag sfpdOnFoot): a cruiser that stalls this long, while further than the bust radius from the
 *  player, deploys officers on foot (they reach plazas/parks the road-bound cars can't). */
export const OFFICER_STALL_MS = 2_000;
export const OFFICER_DEPLOY_MIN_M = 7;   // = the bust radius: closer than this the car already does the job
export const OFFICER_DEPLOY_MAX_M = 60;  // officers don't run marathons
export const OFFICER_SPEED = 5;          // m/s — a jog that a sprinting player (≥ 6 m/s on foot) can outrun
export const OFFICER_STANDOFF_M = 1.5;   // hands-on distance
export const OFFICERS_MAX_PER_TARGET = 2;
export const OFFICER_LEASH_M = 150;      // an officer this far behind gives up (despawns)
/** policePresence (critique #16): from POLICE_FIRE_MIN_LEVEL, an officer who stepped out of a parked cruiser holds at
 *  its door (cover) and fires from there while the player is within this range; further away they give chase. */
export const OFFICER_COVER_HOLD_M = 30;
/** The cover only counts while its cruiser is still parked within this distance of the door spot. */
export const OFFICER_COVER_CAR_M = 3.5;
/** sfpdCover (gtasf-ex3nf): an officer within this of a player who is SHOOTING breaks for cover instead of charging. */
export const OFFICER_TAKE_COVER_M = 25;
/** sfpdCover: how far an officer will run to a stopped cruiser to use it as cover. */
export const OFFICER_COVER_SEARCH_M = 18;
/** sfpdCover: the cover spot sits this far beyond the cruiser on the side away from the player (inside OFFICER_COVER_CAR_M). */
export const OFFICER_COVER_OFFSET_M = 1.8;
/** sfpdCover: a player who fired within this window counts as 'firing' for the police. */
export const SFPD_FIRING_WINDOW_MS = 3000;

/** Officers a pursuit should field: none until a car has stalled, then one per star up to the cap. */
export function officersWanted(level: number, anyCarStalled: boolean): number {
  return anyCarStalled ? Math.max(0, Math.min(OFFICERS_MAX_PER_TARGET, Math.floor(level))) : 0;
}

/** Ground units stop this far from the player (park beside them, never on top of them). */
export const POLICE_STANDOFF_M = 4;
/** Founder playtest: cruisers chasing a player ON FOOT hold a pursuit distance instead of parking on top of them
 *  (officers on foot, sfpdOnFoot, close the rest). */
export const POLICE_FOOT_STANDOFF_M = 10;

/** Distance (m) from a unit to the player. */
export function distanceTo(ux: number, uz: number, px: number, pz: number): number {
  return Math.hypot(px - ux, pz - uz);
}

/** Does any unit have the player in sight (within range)? */
export function anySight(units: readonly { x: number; z: number }[], px: number, pz: number, sightM = POLICE_SIGHT_M): boolean {
  return units.some(u => distanceTo(u.x, u.z, px, pz) <= sightM);
}

/** The player has escaped when no unit can see them. Feeds wanted decay (tickWanted's escapedLoS). */
export function escapedLoS(units: readonly { x: number; z: number }[], px: number, pz: number, sightM = POLICE_SIGHT_M): boolean {
  return !anySight(units, px, pz, sightM);
}

/** A spawn position on a ring around the player (the caller snaps it to the nearest road). */
export function spawnPoint(px: number, pz: number, angle: number, distM: number): { x: number; z: number } {
  return { x: px + Math.cos(angle) * distM, z: pz + Math.sin(angle) * distM };
}

/** Whether the pursuit includes a helicopter / SWAT at this level (drives extra spawns later). */
export function hasHelicopter(level: number): boolean {
  return Math.min(WANTED_MAX, Math.floor(level)) >= 4;
}
export function hasSwat(level: number): boolean {
  return Math.min(WANTED_MAX, Math.floor(level)) >= 5;
}

// --- Air + SWAT escalation (Combat 5b, flag policeAir) ---------------------------------------------
// At wanted 4 a helicopter joins (hovers at altitude, follows in 2D, a wide "spotlight" sight that makes escape
// harder); at wanted 5 SWAT vans join (slower, heavier ground units). Car GLBs stand in until lane-A art lands.
/** Helicopter hover height above the player's ground (metres). */
export const HELICOPTER_ALTITUDE_M = 60;
/** The helicopter's spotlight sight radius (metres) — wider than a cruiser's, so you must lose it to escape. */
export const HELICOPTER_SIGHT_M = SFPD_TUNING.helicopterSightM;
/** Helicopter follow speed (m/s): faster than a cruiser, but a fast car can still open the sight gap. */
export const HELICOPTER_SPEED = SFPD_TUNING.helicopterSpeedMps;
/** SWAT van drive speed (m/s): slower + heavier than a cruiser. */
export const SWAT_SPEED = SFPD_TUNING.swatSpeedMps;

/** SWAT vans fielded at this level (0 below wanted 5). */
export function swatCount(level: number): number {
  return hasSwat(level) ? SFPD_TUNING.swatVans : 0;
}
/** Helicopters fielded at this level (0 below wanted 4, 1 at 4+). */
export function helicopterCount(level: number): number {
  return hasHelicopter(level) ? 1 : 0;
}

// --- Roadblocks (wanted level ≥ 3) -------------------------------------------------------------------
// A roadblock is a line of stationary SFPD cars dropped across the road AHEAD of a fleeing player. Reuses
// the existing subaru kind + light bar — no new vehicle kind / art needed (helicopter + SWAT vans wait on
// lane-A art). The caller (WorldPolice) estimates the player's heading and snaps each car onto the road.

/** Minimum wanted level that fields roadblocks. */
export const ROADBLOCK_LEVEL = 3;
/** How far ahead of the player (metres) a roadblock forms. */
export const ROADBLOCK_AHEAD_M = 70;
/** Lateral spacing between roadblock cars (metres). */
export const ROADBLOCK_SPREAD_M = 7;

/** Cars in a roadblock at this wanted level (0 below ROADBLOCK_LEVEL). */
export function roadblockCount(level: number): number {
  return SFPD_TUNING.roadblockCarsByStar[Math.max(0, Math.min(WANTED_MAX, Math.floor(level)))] ?? 0;
}

/** Centre of the roadblock: `aheadM` ahead of the player along their heading (radians, 0 = +x). */
export function roadblockAnchor(px: number, pz: number, headingRad: number, aheadM = ROADBLOCK_AHEAD_M): { x: number; z: number } {
  return { x: px + Math.cos(headingRad) * aheadM, z: pz + Math.sin(headingRad) * aheadM };
}

/** `count` car positions in a line across the road (perpendicular to heading), centred on (cx,cz). */
export function roadblockLine(cx: number, cz: number, headingRad: number, count: number, spreadM = ROADBLOCK_SPREAD_M): { x: number; z: number }[] {
  const px = -Math.sin(headingRad), pz = Math.cos(headingRad); // unit perpendicular (left of heading)
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * spreadM;
    out.push({ x: cx + px * off, z: cz + pz * off });
  }
  return out;
}

/** Has the player driven past (behind) a roadblock anchored at (ax,az) with the given heading? */
export function passedRoadblock(px: number, pz: number, ax: number, az: number, headingRad: number): boolean {
  return (px - ax) * Math.cos(headingRad) + (pz - az) * Math.sin(headingRad) > 0;
}
