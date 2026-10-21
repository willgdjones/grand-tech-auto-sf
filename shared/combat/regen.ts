/**
 * GTA V pivot — LANE B: health regeneration (flag healthRegen). GTA V refills health slowly up to half once you've
 * stayed out of harm for a few seconds; above half you need a health pickup. Pure + shared; the server owns health.
 */
export const REGEN_CAP = 50;          // health regenerates up to this (of MAX_HEALTH 100)
export const REGEN_DELAY_MS = 5_000;  // ...once no damage has landed for this long
export const REGEN_HP_PER_SEC = 2;    // 25 → 50 takes ~12.5 s

/** Health after `dtMs` of regen (fractional), or unchanged when not eligible. Dead players never regenerate. */
export function regenHealth(health: number, sinceHurtMs: number, dtMs: number): number {
  if (health <= 0 || health >= REGEN_CAP || sinceHurtMs < REGEN_DELAY_MS || dtMs <= 0) return health;
  return Math.min(REGEN_CAP, health + REGEN_HP_PER_SEC * dtMs / 1000);
}
