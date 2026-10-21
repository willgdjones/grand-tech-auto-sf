/**
 * GTA V pivot — LANE B (combat & police): every SFPD fairness knob in ONE place (founder 2026-10-17: "the police are
 * too good" + "there must be a clear way to escape"). [gtasf-66lvh]
 *
 * The pursuit (police.ts), return fire (policeFire.ts), ramming (policeRam.ts), wanted decay (wanted.ts) and the
 * escape rules (escape.ts) all read their numbers from here, re-exported under their historical names so call sites
 * and the client keep compiling. Server-authoritative: the worker decides; the client only mirrors sight ranges and
 * the ram shove. Comments give the previous value (old → new) so a playtest can dial back quickly.
 *
 * Gated (reviewer 1.2): flag sfpdFairness picks SFPD_FAIR; off, SFPD_CLASSIC keeps the pre-gtasf-66lvh numbers
 * byte-for-byte, so prod (wanted/policeFire/policeRam live) is unchanged until the flag is reviewed into prepare.ts.
 */
import { flags } from '@gtasf/shared/flags';

const fair = {
  // --- Reaction / dispatch (worker/src/world/police.ts) ------------------------------------------------------------
  /** Delay from the first star to the first cruiser being dispatched (0 → 3000 ms: the cops aren't already there). */
  dispatchDelayMs: 3_000,
  /** One reinforcement per target per interval, so a pursuit builds up instead of arriving at once (0 → 4000 ms). */
  dispatchIntervalMs: 4_000,
  /** Pursuit cars kept on a player per star level 0–5 ([0,1,2,3,4,5] → [0,1,1,2,3,3]). */
  pursuitCarsByStar: [0, 1, 1, 2, 3, 3] as readonly number[],
  /** Cruiser pursuit speed (16 → 13 m/s; a decent getaway car now pulls away on a straight). */
  chaseSpeedMps: 13,

  // --- Sight (line-of-sight escape) --------------------------------------------------------------------------------
  /** A ground unit sees the player within this range, given a clear line (70 → 55 m). */
  sightM: 55,
  /** Helicopter spotlight range — no line needed outside cover (130 → 90 m). */
  helicopterSightM: 90,

  // --- Escalation: cars → roadblocks → helicopter → SWAT -----------------------------------------------------------
  /** Roadblocks only form/re-form while a unit can see the player (old: planted ahead of a hidden player too). */
  roadblockNeedsSight: true,
  /** Cars per roadblock by star level ([0,0,0,2,3,3] → [0,0,0,2,2,2]). */
  roadblockCarsByStar: [0, 0, 0, 2, 2, 2] as readonly number[],
  /** Time at 3★+ before the first roadblock forms (0 → 10 s). */
  roadblockDelayMs: 10_000,
  /** Time at 4★+ before the helicopter is scrambled (0 → 15 s). */
  helicopterDelayMs: 15_000,
  /** Time at 5★ before SWAT rolls (0 → 20 s). */
  swatDelayMs: 20_000,
  /** SWAT vans at 5★ (2 → 1). */
  swatVans: 1,
  /** Helicopter follow speed (20 → 14 m/s: a car outruns it; on foot you need cover). */
  helicopterSpeedMps: 14,
  /** SWAT van speed (13 → 11 m/s). */
  swatSpeedMps: 11,

  // --- Return fire (shared/combat/policeFire.ts) -------------------------------------------------------------------
  /** Max firing range (35 → 30 m). */
  fireRangeM: 30,
  /** Per-unit time between shots (1500 → 2200 ms). */
  fireIntervalMs: 2_200,
  /** Damage per hit (9 → 6 of 100 health). */
  shotDamage: 6,
  /** Hit chance at point-blank (0.6 → 0.4) and at max range (0.12 → 0.06), linear between. */
  hitChanceNear: 0.4,
  hitChanceFar: 0.06,

  // --- Pursuit / ramming / PIT (shared/combat/policeRam.ts) --------------------------------------------------------
  /** Stars before cruisers ram a driving player (2 → 3). */
  ramMinLevel: 3,
  /** Rammers' speed multiplier over the pursuit speed (1.25 → 1.1). */
  ramSpeedBonus: 1.1,
  /** Per-unit time between rams (3000 → 6000 ms). */
  ramCooldownMs: 6_000,
  /** Vehicle HP per ram of a 1000 HP car (180 → 120: smoking after 5 rams, not 3). */
  ramDamage: 120,
  /** Client sideways shove per ram (7 → 5 m/s). */
  ramShoveMps: 5,

  // --- Wanted decay (shared/combat/wanted.ts) ----------------------------------------------------------------------
  /** Time after the last crime before heat may bleed (15 → 10 s). */
  wantedCooldownMs: 10_000,
  /** Heat bled per second while escaped + past the cooldown (4 → 6). */
  wantedDecayPerSec: 6,

  // --- Escape rules (shared/combat/escape.ts) ----------------------------------------------------------------------
  /** Out of sight this long → the SFPD switch to SEARCHING (by star 0–5; new). */
  evadeMsByStar: [0, 3_000, 5_000, 7_000, 9_000, 12_000] as readonly number[],
  /** Then stay unseen this long while they search → wanted CLEARED (by star 0–5; new). */
  searchMsByStar: [0, 6_000, 9_000, 13_000, 18_000, 24_000] as readonly number[],
  /** Hideouts (parking garages): radius of cover around each (m). */
  hideoutRadiusM: 30,
  /** In a hideout, a ground unit only spots you this close (m); the helicopter never does. */
  hideoutSpotM: 12,
  /** In a hideout the escape clock runs this much faster. */
  hideoutRate: 2,
  /** Further than this from every pursuer (m) counts as outrunning them: the escape clock runs faster. */
  outrunM: 200,
  outrunRate: 1.5,
  /** Respray shop: a driver inside this radius (m), unseen, has the wanted level cleared. */
  resprayRadiusM: 12,
  /** One respray per player per this long (ms). */
  resprayCooldownMs: 60_000,
};
export type SfpdTuning = Readonly<typeof fair>;
/** The fairer SFPD (flag sfpdFairness). */
export const SFPD_FAIR: SfpdTuning = Object.freeze(fair);

/** The pre-gtasf-66lvh SFPD (flag sfpdFairness off). Escape knobs are shared: they only act under wantedEscape. */
export const SFPD_CLASSIC: SfpdTuning = Object.freeze({
  ...SFPD_FAIR,
  dispatchDelayMs: 0, dispatchIntervalMs: 0, pursuitCarsByStar: [0, 1, 2, 3, 4, 5], chaseSpeedMps: 16,
  sightM: 70, helicopterSightM: 130,
  roadblockNeedsSight: false, roadblockCarsByStar: [0, 0, 0, 2, 3, 3], roadblockDelayMs: 0, helicopterDelayMs: 0, swatDelayMs: 0,
  swatVans: 2, helicopterSpeedMps: 20, swatSpeedMps: 13,
  fireRangeM: 35, fireIntervalMs: 1_500, shotDamage: 9, hitChanceNear: 0.6, hitChanceFar: 0.12,
  ramMinLevel: 2, ramSpeedBonus: 1.25, ramCooldownMs: 3_000, ramDamage: 180, ramShoveMps: 7,
  wantedCooldownMs: 15_000, wantedDecayPerSec: 4,
});

/** The live SFPD numbers for this build. */
/** escapeOwnsClear (critic 12:1x, 10-20): with the escape clock as the only clear, its length scales harder with stars —
 *  ~12 / 18 / 30 s unseen at 1-3 stars (fair: 9 / 14 / 20), so 3 stars with SWAT and the helicopter in play aren't a
 *  10 s garage stop. A garage still halves it. Evade : search kept at ~1 : 2. */
export const ESCAPE_OWNS_EVADE_MS: readonly number[] = [0, 4_000, 6_000, 10_000, 13_000, 17_000];
export const ESCAPE_OWNS_SEARCH_MS: readonly number[] = [0, 8_000, 12_000, 20_000, 27_000, 33_000];
export const SFPD_TUNING: SfpdTuning = flags.sfpdFairness ? SFPD_FAIR : SFPD_CLASSIC;
