/**
 * GTA V pivot — LANE B (combat & police): vehicle damage + explosions (flag vehicleDamage).
 *
 * Pure, shared, SERVER-authoritative. Every vehicle has VEHICLE_MAX_HP. Crashes (closing speed) and gunfire wear it
 * down; below 50% it smokes, below 25% it burns — and a burning vehicle keeps losing HP until it EXPLODES at 0. The
 * explosion deals blast damage to players in a radius (server-applied, so a kill is the normal WASTED), and the wreck
 * stays for WRECK_MS before it is cleared.
 */

export const VEHICLE_MAX_HP = 1000;
export const SMOKE_BELOW = 0.5;       // fraction of max HP
export const FIRE_BELOW = 0.25;
export const BURN_HP_PER_SEC = 40;    // a burning car (≤250 HP) explodes within ~6 s, GTA-style
export const CRASH_MIN_MPS = 4;       // bumps below this closing speed are free
export const CRASH_MAX_DAMAGE = 600;  // one crash can't destroy a healthy car outright
export const BULLET_MULTIPLIER = 1.5; // weapon damage → vehicle HP per hit
export const EXPLOSION_RADIUS_M = 8;
export const EXPLOSION_MAX_DAMAGE = 120; // > MAX_HEALTH: point-blank (or inside the car) is a kill
export const WRECK_MS = 20_000;
/** A shot hits a vehicle when it passes this close to the body centre (metres). */
export const VEHICLE_HIT_RADIUS_M = 2;
/** Blast damage to a NEARBY VEHICLE = player blast × this — a car right next to an explosion usually goes up too. */
export const CHAIN_BLAST_MULTIPLIER = 6;

export type VehicleState = 'ok' | 'smoking' | 'burning' | 'wrecked';

export function vehicleState(hp: number): VehicleState {
  if (hp <= 0) return 'wrecked';
  if (hp < VEHICLE_MAX_HP * FIRE_BELOW) return 'burning';
  if (hp < VEHICLE_MAX_HP * SMOKE_BELOW) return 'smoking';
  return 'ok';
}

/** HP a crash at `closingMps` costs (quadratic above the threshold, capped). */
export function crashDamage(closingMps: number): number {
  if (!Number.isFinite(closingMps) || closingMps <= CRASH_MIN_MPS) return 0;
  return Math.min(CRASH_MAX_DAMAGE, Math.round((closingMps - CRASH_MIN_MPS) ** 2 * 6));
}

/** HP a hit from a weapon costs a vehicle; melee does nothing to a car. */
export function bulletDamage(weaponDamage: number, melee: boolean): number {
  return melee || !(weaponDamage > 0) ? 0 : Math.round(weaponDamage * BULLET_MULTIPLIER);
}

/** Blast damage to a player `distM` from the explosion (linear falloff to 0 at the radius). */
export function blastDamage(distM: number): number {
  if (!Number.isFinite(distM) || distM >= EXPLOSION_RADIUS_M) return 0;
  return Math.round(EXPLOSION_MAX_DAMAGE * (1 - Math.max(0, distM) / EXPLOSION_RADIUS_M));
}

/** Advance one vehicle's HP by `dtSeconds` (only a burning car changes on its own). */
export function tickVehicleHp(hp: number, dtSeconds: number): number {
  if (vehicleState(hp) !== 'burning') return hp;
  return Math.max(0, hp - BURN_HP_PER_SEC * Math.max(0, dtSeconds));
}

/** Apply damage; returns the new HP and whether this damage made it explode (crossed into 0 this time). */
export function damageVehicle(hp: number, amount: number): { hp: number; exploded: boolean } {
  if (hp <= 0 || !(amount > 0)) return { hp: Math.max(0, hp), exploded: false };
  const next = Math.max(0, hp - amount);
  return { hp: next, exploded: next === 0 };
}

/** Review: a crash can bring a car down to burning (this HP) but never straight to an explosion — the burn timer
 *  then blows it ~6 s later, so the people next to it can run. */
export const CRASH_HP_FLOOR = Math.floor(VEHICLE_MAX_HP * FIRE_BELOW) - 1;
export function crashHpAfter(hp: number, amount: number): number {
  return hp <= CRASH_HP_FLOOR ? hp : Math.max(CRASH_HP_FLOOR, hp - Math.max(0, amount));
}
/** Review: the client's reported closing speed is capped by the SERVER-measured speed of the driver's car. */
export function crashClosingCap(reportedMps: number, measuredPeakMps: number): number {
  return Math.max(0, Math.min(reportedMps, measuredPeakMps * 1.2 + 2));
}

/** Review B-M1: a driver's server-measured speed. A sample only counts when it's SUSTAINED over two consecutive ticks
 *  (min of the two), a jump > DRIVE_TELEPORT_M (server teleport / respawn / reconnect) resets the track, and the peak
 *  is held for DRIVE_PEAK_MS. Pure, so the crash-speed cap can't be inflated by one shuffled pose. */
export const DRIVE_TELEPORT_M = 40;
export const DRIVE_PEAK_MS = 1_500;
export interface DriveTrack { x: number; z: number; at: number; last: number; peak: number; peakAt: number }
export function nextDriveTrack(prev: DriveTrack | undefined, x: number, z: number, now: number): DriveTrack {
  if (!prev || now <= prev.at) return { x, z, at: now, last: 0, peak: 0, peakAt: now };
  const moved = Math.hypot(x - prev.x, z - prev.z);
  if (moved > DRIVE_TELEPORT_M) return { x, z, at: now, last: 0, peak: 0, peakAt: now };
  const speed = moved / ((now - prev.at) / 1000), sustained = Math.min(speed, prev.last);
  const keep = now - prev.peakAt <= DRIVE_PEAK_MS && prev.peak >= sustained;
  return { x, z, at: now, last: speed, peak: keep ? prev.peak : sustained, peakAt: keep ? prev.peakAt : now };
}
export function drivePeak(track: DriveTrack | undefined, now: number): number {
  return track && now - track.peakAt <= DRIVE_PEAK_MS ? track.peak : 0;
}
/** Review B-L2: a vehicle's last attacker is credited with its blast only this long after the hit. */
export const ATTACKER_TTL_MS = 30_000;
