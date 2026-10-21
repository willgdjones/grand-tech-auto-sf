/**
 * GTA V pivot — LANE B (combat & police): the wanted-level state machine (flag wanted).
 *
 * Pure, shared, SERVER-authoritative: WorldDO owns each player's wanted state; this module only computes it.
 * Crimes add "heat"; heat maps to 1–5 stars. Heat decays only once the player has broken line of sight from
 * the police AND a cooldown has elapsed (founder: "line-of-sight escape plus a cooldown"). The star level
 * drives SFPD escalation (cars → roadblocks → helicopter → SWAT), computed by `wantedResponse`.
 */
import { SFPD_TUNING } from './sfpdTuning';

export const WANTED_MAX = 5;

export type Crime =
  | 'assault'        // hit a pedestrian
  | 'ped-kill'       // killed a pedestrian
  | 'cop-hit'        // hit an SFPD officer
  | 'cop-kill'       // killed an SFPD officer
  | 'car-theft'      // carjack / steal a car
  | 'mayhem'         // reckless driving into people/props
  | 'store-robbery'  // hold up a store (founder: instant 2 stars)
  | 'heist';         // pull off a heist grab, e.g. the pitch-deck heist (lane C) — instant 3 stars

/** Heat each crime adds (0–100 scale). Tuned so a store robbery lands at 2 stars and cop-kills escalate fast. */
export const CRIME_HEAT: Readonly<Record<Crime, number>> = Object.freeze({
  assault: 8,
  'ped-kill': 18,
  'cop-hit': 24,
  'cop-kill': 42,
  'car-theft': 14,
  mayhem: 5,
  'store-robbery': 24,
  heist: 50, // >= WANTED_THRESHOLDS[2] (42) → 3 stars the moment you grab
});

/** Minimum heat for each star (index 0 → 1 star, …, index 4 → 5 stars). */
export const WANTED_THRESHOLDS: readonly number[] = [1, 22, 42, 65, 90];

/** review fix 5: a device's wanted level may only be raised (incl. the cross-lane heist hook) when combat AND
 *  wanted are both on — the wanted system doesn't exist without combat, so the hook must require both. */
export function wantedRaiseAllowed(flags: { combat: boolean; wanted: boolean }): boolean {
  return flags.combat && flags.wanted;
}

/** How long after the last crime before heat can start decaying (ms). */
export const WANTED_COOLDOWN_MS = SFPD_TUNING.wantedCooldownMs;
/** Heat bled per second once escaped + past the cooldown (the search-phase clear in escape.ts is the main escape). */
export const WANTED_DECAY_PER_SEC = SFPD_TUNING.wantedDecayPerSec;
export const HEAT_MAX = 100;

export interface WantedState {
  /** 0–100. */
  heat: number;
  /** Server clock (ms) of the most recent crime. */
  lastCrimeMs: number;
}

export function freshWanted(): WantedState {
  return { heat: 0, lastCrimeMs: 0 };
}

/** Stars (0–5) for a heat value. */
export function wantedLevel(heat: number): number {
  let level = 0;
  for (const t of WANTED_THRESHOLDS) if (heat >= t) level++;
  return level;
}

/** Add a crime's heat (clamped to 100) and stamp the time; returns a new state. */
export function addHeat(state: WantedState, crime: Crime, now: number): WantedState {
  return { heat: Math.min(HEAT_MAX, state.heat + CRIME_HEAT[crime]), lastCrimeMs: now };
}

export interface DecayConfig {
  cooldownMs?: number;
  decayPerSec?: number;
}

/**
 * Advance the wanted state by `dtSeconds`. Heat decays only when the player has escaped line of sight from
 * every pursuing officer (`escapedLoS`) AND the cooldown since the last crime has elapsed. In sight, or within
 * the cooldown, heat holds. Returns a new state.
 */
export function tickWanted(state: WantedState, dtSeconds: number, escapedLoS: boolean, now: number, config: DecayConfig = {}): WantedState {
  if (state.heat <= 0) return state.heat === 0 ? state : { ...state, heat: 0 };
  const cooldownMs = config.cooldownMs ?? WANTED_COOLDOWN_MS;
  const decayPerSec = config.decayPerSec ?? WANTED_DECAY_PER_SEC;
  if (!escapedLoS || now - state.lastCrimeMs < cooldownMs) return state;
  const dt = dtSeconds > 0 ? dtSeconds : 0;
  return { ...state, heat: Math.max(0, state.heat - decayPerSec * dt) };
}

export type WantedResponse = 'none' | 'patrol' | 'pursuit' | 'roadblock' | 'helicopter' | 'swat';

/** The SFPD response tier for a star level (drives what the traffic sim spawns). */
export function wantedResponse(level: number): WantedResponse {
  switch (Math.max(0, Math.min(WANTED_MAX, Math.floor(level)))) {
    case 0: return 'none';
    case 1: return 'patrol';     // a cruiser or two
    case 2: return 'pursuit';    // active chase
    case 3: return 'roadblock';  // cars + roadblocks
    case 4: return 'helicopter'; // + chopper spotlight
    default: return 'swat';      // 5: + SWAT vans
  }
}

/** How many SFPD pursuit cars the traffic sim should try to keep on the player at a level. */
export function pursuitCars(level: number): number {
  return SFPD_TUNING.pursuitCarsByStar[Math.max(0, Math.min(WANTED_MAX, Math.floor(level)))] ?? 0;
}
