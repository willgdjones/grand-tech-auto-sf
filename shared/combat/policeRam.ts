/**
 * GTA V pivot — LANE B (combat): police PIT / ramming (flag policeRam, needs vehicleDamage).
 *
 * At RAM_MIN_LEVEL+ stars, ground units chasing a player who is DRIVING close right in (instead of parking at the
 * standoff) and ram the car: every contact costs it RAM_DAMAGE vehicle HP (smoke → fire → explosion through the normal
 * vehicle-damage path) and the driver's client is shoved away from the cruiser (S2C POLICE_RAM). A unit then backs
 * off for RAM_COOLDOWN_MS before it can ram again. Server-owned: the client only plays the shove.
 */
import { SFPD_TUNING } from './sfpdTuning';

export const RAM_MIN_LEVEL = SFPD_TUNING.ramMinLevel; // gtasf-66lvh: 2 → 3
export const RAM_CONTACT_M = 3.2;      // cruiser centre → player car centre that counts as a hit
export const RAM_MAX_DY_M = 2.5;       // review C-M1: a cruiser under a freeway deck never 'rams' the car above it
export const RAM_STANDOFF_M = 0.5;     // while ramming, close right in (the parked standoff is POLICE_STANDOFF_M)
export const RAM_SPEED_BONUS = SFPD_TUNING.ramSpeedBonus;   // rammers push a little harder than a plain pursuit
export const RAM_COOLDOWN_MS = SFPD_TUNING.ramCooldownMs;  // per unit, between rams
export const RAM_DAMAGE = SFPD_TUNING.ramDamage;         // vehicle HP per ram (1000 HP car: smoking after 5)
export const RAM_SHOVE_MPS = SFPD_TUNING.ramShoveMps;        // client: sideways velocity the ram adds to the player's car

/** Whether units chasing this target should ram it. */
export function shouldRam(level: number, driving: boolean | undefined): boolean {
  return driving === true && level >= RAM_MIN_LEVEL;
}

/** Unit vector (x, z) from the cruiser toward the player's car — the shove direction. */
export function ramDirection(unitX: number, unitZ: number, carX: number, carZ: number): { x: number; z: number } {
  const dx = carX - unitX, dz = carZ - unitZ, d = Math.hypot(dx, dz);
  return d < 1e-3 ? { x: 1, z: 0 } : { x: dx / d, z: dz / d };
}
