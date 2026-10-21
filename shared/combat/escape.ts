/**
 * GTA V pivot — LANE B (combat & police): how you LOSE the SFPD (flag wantedEscape). [gtasf-66lvh]
 *
 * Pure, shared, SERVER-authoritative (WorldDO steps it per wanted player each tick; the client only draws the HUD):
 *
 *  1. SEEN — any unit has you in sight. The clock is reset.
 *  2. EVADING — out of sight for less than evadeMsByStar[stars] (3 s at 1★ … 12 s at 5★). Units drive to your last
 *     known position.
 *  3. SEARCHING — out of sight longer than that. If you stay unseen for searchMsByStar[stars] more (6 s at 1★ …
 *     24 s at 5★), the wanted level is CLEARED. Being spotted again starts over at SEEN; a new crime resets the clock.
 *
 * The clock runs faster in a HIDEOUT (parking garage: ×2, and cover — units must be within hideoutSpotM to spot you,
 * the helicopter can't see in) and when you have OUTRUN every pursuer (> outrunM from all of them: ×1.5). Swapping to a
 * different vehicle while unseen skips straight to SEARCHING (they're looking for the old car). A RESPRAY shop clears
 * the wanted level outright for an unseen driver (once per resprayCooldownMs).
 */
import { flags } from '@gtasf/shared/flags';
import { ESCAPE_OWNS_EVADE_MS, ESCAPE_OWNS_SEARCH_MS, SFPD_TUNING } from './sfpdTuning';
import { WANTED_MAX } from './wanted';

export type EscapePhase = 'seen' | 'evading' | 'searching';
/** Wire order for the S2C WANTED_ESCAPE phase byte. */
export const ESCAPE_PHASES: readonly EscapePhase[] = ['seen', 'evading', 'searching'];

export interface EscapeState {
  /** Escape-clock ms accumulated while unseen (scaled by hideout / outrun rates). */
  hiddenMs: number;
  /** lastCrimeMs the clock was started against (a new crime resets it). */
  crimeMs: number;
  /** Vehicle the player was in when last seen (0 = on foot). */
  seenVehicle: number;
  /** A car swap while unseen already skipped evading. */
  swapped: boolean;
  /** A unit has seen the player at least once this pursuit (the outrun bonus needs someone to outrun). */
  sighted: boolean;
  /** ms in a row with no unit active (the no-unit grace, escapeOwnsClear). */
  noUnitMs?: number;
}

export function freshEscape(crimeMs = 0, vehicle = 0): EscapeState {
  return { hiddenMs: 0, crimeMs, seenVehicle: vehicle, swapped: false, sighted: false };
}

const star = (level: number) => Math.max(0, Math.min(WANTED_MAX, Math.floor(level)));
export const evadeMs = (level: number): number => (flags.escapeOwnsClear ? ESCAPE_OWNS_EVADE_MS : SFPD_TUNING.evadeMsByStar)[star(level)] ?? 0;
export const searchMs = (level: number): number => (flags.escapeOwnsClear ? ESCAPE_OWNS_SEARCH_MS : SFPD_TUNING.searchMsByStar)[star(level)] ?? 0;
/** Total unseen time (unscaled) to lose the police at a star level. */
export const escapeTotalMs = (level: number): number => evadeMs(level) + searchMs(level);

export interface EscapeInput {
  level: number;
  /** Any unit sees the player (server line of sight). */
  seen: boolean;
  dtMs: number;
  /** The wanted state's lastCrimeMs (a fresh crime resets the clock). */
  lastCrimeMs: number;
  inHideout: boolean;
  /** Distance (m) to the nearest pursuing unit (any role), or Infinity. */
  nearestUnitM: number;
  /** Vehicle id the player is in now (0 = on foot). */
  vehicle: number;
  /** Any unit is dispatched on this player. Review 1.2: with none yet (the dispatch delay) the clock holds — no free
   *  escape before the police have even arrived. Default true. */
  unitsActive?: boolean;
  /** escapeOwnsClear (review 1.2 HIGH): after this long with no unit active the clock runs anyway, so a wanted player whose
   *  units never come (world cap full, a spawn that can't snap to a road, a DO reset) isn't pinned at their stars. Default
   *  Infinity (hold for as long as there's no unit: the legacy decay is the backstop then). */
  noUnitGraceMs?: number;
}

export interface EscapeStep {
  state: EscapeState;
  phase: EscapePhase;
  /** 0–1 progress through the whole escape (evade + search). */
  progress: number;
  /** Unscaled ms of unseen time still needed. */
  remainingMs: number;
  /** Lost them: clear the wanted level now. */
  cleared: boolean;
  /** Clock multiplier this tick (1, hideout and/or outrun). */
  rate: number;
}

/** The escape clock multiplier for where the player is (outrunning only counts once they've been sighted). */
export function escapeRate(inHideout: boolean, nearestUnitM: number, sighted = true): number {
  return Math.max(1, inHideout ? SFPD_TUNING.hideoutRate : 1, sighted && nearestUnitM > SFPD_TUNING.outrunM ? SFPD_TUNING.outrunRate : 1);
}

/** Advance one player's escape by one server tick. */
export function stepEscape(prev: EscapeState, input: EscapeInput): EscapeStep {
  const total = escapeTotalMs(input.level), evade = evadeMs(input.level);
  if (input.level <= 0 || total <= 0) return { state: freshEscape(input.lastCrimeMs, input.vehicle), phase: 'seen', progress: 0, remainingMs: 0, cleared: false, rate: 1 };
  let state = prev.crimeMs !== input.lastCrimeMs ? { ...freshEscape(input.lastCrimeMs, prev.seenVehicle), sighted: prev.sighted } : prev;
  if (input.seen) {
    state = { ...freshEscape(input.lastCrimeMs, input.vehicle), sighted: true };
    return { state, phase: 'seen', progress: 0, remainingMs: total, cleared: false, rate: 1 };
  }
  if (input.unitsActive === false) { // nobody dispatched yet: hold the clock (for up to noUnitGraceMs)
    const noUnitMs = (state.noUnitMs ?? 0) + Math.max(0, input.dtMs);
    state = { ...state, noUnitMs };
    if (noUnitMs < (input.noUnitGraceMs ?? Infinity)) return { state, phase: state.hiddenMs >= evade ? 'searching' : 'evading',
      progress: Math.min(1, state.hiddenMs / total), remainingMs: Math.max(0, total - state.hiddenMs), cleared: false, rate: 0 };
  } else if (state.noUnitMs) state = { ...state, noUnitMs: 0 };
  const rate = escapeRate(input.inHideout, input.nearestUnitM, state.sighted);
  let hiddenMs = state.hiddenMs + Math.max(0, input.dtMs) * rate;
  let swapped = state.swapped;
  // A different car than the one they saw you in (unseen): they lose your description → straight to searching.
  if (!swapped && input.vehicle !== 0 && input.vehicle !== state.seenVehicle) { swapped = true; hiddenMs = Math.max(hiddenMs, evade); }
  state = { ...state, hiddenMs, swapped };
  const cleared = hiddenMs >= total;
  return {
    state, cleared, rate,
    phase: hiddenMs >= evade ? 'searching' : 'evading',
    progress: Math.min(1, hiddenMs / total),
    remainingMs: Math.max(0, total - hiddenMs),
  };
}

// --- escapeWaitsForSighting (critic N38) ----------------------------------------------------------------------------
/** Prod: 1 crime in ~10 the stars bled away (24 s, nearest cruiser 70 m) before any unit got near — the police never
 *  arrived. Until a unit has sighted the player in this pursuit, BOTH clocks (the escape clock and the legacy heat decay)
 *  hold. The hold ends when a unit sees them, when a unit gets within sight range without seeing them (they arrived and
 *  you're hidden: a real evasion), or after UNSIGHTED_HOLD_MS in total. The cap counts from the first tick, dispatch delay
 *  included, so nobody stays wanted forever when no unit is dispatched or none can get there. */
export const UNSIGHTED_HOLD_MS = 30_000;
/** escapeOwnsClear: the escape clock runs after this long with no unit at all (review 1.2 HIGH). */
export const NO_UNIT_GRACE_MS = 30_000;
export interface SightingHold { sighted: boolean; arrived: boolean; heldMs: number }
export interface SightingHoldInput { seen: boolean; nearestUnitM: number; dtMs: number; sightM: number; holdMs?: number }
export function stepSightingHold(prev: SightingHold | undefined, input: SightingHoldInput): { state: SightingHold; holding: boolean } {
  const state = { ...(prev ?? { sighted: false, arrived: false, heldMs: 0 }) };
  if (input.seen) state.sighted = true;
  if (input.nearestUnitM <= input.sightM) state.arrived = true;
  if (!state.sighted && !state.arrived) state.heldMs += Math.max(0, input.dtMs);
  const holding = !state.sighted && !state.arrived && state.heldMs < (input.holdMs ?? UNSIGHTED_HOLD_MS);
  return { state, holding };
}

// --- Places -------------------------------------------------------------------------------------------------------
export interface EscapePlace { id: string; name: string; lat: number; lon: number }

/** Parking garages to duck into along the Ferry → Lombard corridor. Coords approximate (walkable-verify like stores). */
export const HIDEOUTS: readonly EscapePlace[] = Object.freeze([
  { id: 'golden-gateway-garage', name: 'Golden Gateway Garage', lat: 37.79530, lon: -122.39870 },
  { id: 'portsmouth-square-garage', name: 'Portsmouth Square Garage', lat: 37.79480, lon: -122.40490 },
  { id: 'vallejo-street-garage', name: 'Vallejo Street Garage', lat: 37.79870, lon: -122.40870 },
  { id: 'pier-39-garage', name: 'Pier 39 Garage', lat: 37.80720, lon: -122.41070 },
]);

/** Respray shops (fictional names). Drive in unseen and the paint job clears your wanted level. */
export const RESPRAY_SHOPS: readonly EscapePlace[] = Object.freeze([
  { id: 'jackson-square-respray', name: 'Jackson Square Respray', lat: 37.79850, lon: -122.40100 },
  { id: 'polk-gulch-respray', name: 'Polk Gulch Respray', lat: 37.80050, lon: -122.42150 },
]);

/** Positions in world metres for a projector (lat, lon) → {x, z}. */
export function placePositions(places: readonly EscapePlace[], project: (lat: number, lon: number) => { x: number; z: number }): { x: number; z: number }[] {
  return places.map(p => { const q = project(p.lat, p.lon); return { x: q.x, z: q.z }; });
}

export function withinAny(spots: readonly { x: number; z: number }[], x: number, z: number, radiusM: number): boolean {
  return spots.some(s => Math.hypot(s.x - x, s.z - z) <= radiusM);
}

/** Whether a respray clears this player now: driving, wanted, unseen, inside a shop, off cooldown. */
export function resprayClears(input: { level: number; driving: boolean; seen: boolean; inShop: boolean; now: number; lastResprayMs: number }): boolean {
  return input.level > 0 && input.driving && !input.seen && input.inShop && input.now - input.lastResprayMs >= SFPD_TUNING.resprayCooldownMs;
}
