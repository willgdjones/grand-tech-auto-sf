/**
 * GTA V pivot — LANE B (combat): melee takedowns + peds that fight back (flag pedMelee).
 *
 * Fists / bat on a pedestrian knock it DOWN (a knockout: it gets back up after KNOCKOUT_GETUP_S) instead of wasting
 * it, and it's confessed as an 'assault' (COMBAT_CRIME kind 3), not a kill. When the local player knocks someone out,
 * a bystander sometimes squares up (FIGHT_BACK_CHANCE): it runs at the player and swings. A landed swing is a C2S
 * PED_PUNCH — self-damage only, so the server trusts it but rate-limits it and owns the amount (PED_PUNCH_DAMAGE),
 * and it goes through armour, spawn protection and the normal WASTED path.
 */
export const KNOCKOUT_GETUP_S = 5;
export const FIGHT_BACK_CHANCE = 0.4;
export const FIGHT_BACK_RADIUS_M = 14;
export const FIGHTER_GIVE_UP_S = 18;
export const PED_SWING_RANGE_M = 1.3;
export const PED_PUNCH_DAMAGE = 7;
export const PED_PUNCH_INTERVAL_MS = 1_000;

/** Server rate gate for a PED_PUNCH: one landed swing per PED_PUNCH_INTERVAL_MS per player. */
export function pedPunchAllowed(lastMs: number, now: number): boolean {
  return now - lastMs >= PED_PUNCH_INTERVAL_MS;
}
