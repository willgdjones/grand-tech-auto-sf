/**
 * GTA V pivot — LANE B (combat & police): SFPD return fire (flag policeFire).
 *
 * Pure, shared, SERVER-authoritative. From 2 stars, each ground unit chasing a player shoots at them while in range
 * and line of sight, once per POLICE_FIRE_INTERVAL_MS. A shot hits with a chance that falls with distance and with
 * how fast the player is moving (a sprint or a car makes you harder to hit); a hit deals POLICE_SHOT_DAMAGE through
 * the server's health, so armour, spawn protection and the normal WASTED path all apply.
 */
import { SFPD_TUNING } from './sfpdTuning';

export const POLICE_FIRE_MIN_LEVEL = 2;
export const POLICE_FIRE_RANGE_M = SFPD_TUNING.fireRangeM;
export const POLICE_FIRE_INTERVAL_MS = SFPD_TUNING.fireIntervalMs;
export const POLICE_SHOT_DAMAGE = SFPD_TUNING.shotDamage;
/** Hit chance at point-blank and at max range (linear between). */
export const POLICE_HIT_CHANCE_NEAR = SFPD_TUNING.hitChanceNear;
export const POLICE_HIT_CHANCE_FAR = SFPD_TUNING.hitChanceFar;

/** Whether a unit may fire this tick. */
export function unitMayFire(level: number, distM: number, lastFireMs: number, now: number): boolean {
  return level >= POLICE_FIRE_MIN_LEVEL && distM <= POLICE_FIRE_RANGE_M && now - lastFireMs >= POLICE_FIRE_INTERVAL_MS;
}

/** Probability that a police shot hits a player `distM` away moving at `speedMps` (in a vehicle: halved). */
export function policeHitChance(distM: number, speedMps: number, inVehicle: boolean): number {
  const t = Math.max(0, Math.min(1, distM / POLICE_FIRE_RANGE_M));
  let p = POLICE_HIT_CHANCE_NEAR + (POLICE_HIT_CHANCE_FAR - POLICE_HIT_CHANCE_NEAR) * t;
  if (speedMps > 4) p *= 0.5; // sprinting / driving fast
  if (inVehicle) p *= 0.5;    // the car body takes most rounds
  return p;
}
