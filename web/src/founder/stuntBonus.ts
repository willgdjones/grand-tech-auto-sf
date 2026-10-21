/**
 * Stunt bonus (flag stuntBonus; GTA V critique "cheap GTA staples": hillJumps is the best feel in the game). Real hill
 * air in a car (the driving controller's `airborne` / `landed`, flag hillJumps) that lasts at least STUNT_MIN_AIR_MS and
 * covers STUNT_MIN_DISTANCE_M becomes a GTA-style "STUNT BONUS" splash with the jump's distance and air time; the
 * device's best jump is kept in localStorage ("NEW BEST"). Client-only, no money, no server. The distance floor keeps a
 * fall through a streaming void at spawn (also `airborne`) from counting.
 */
export const STUNT_MIN_AIR_MS = 1000, STUNT_MIN_DISTANCE_M = 12;
const BEST_KEY = 'gtasf.stunt.best', STREETS_KEY = 'gtasf.stunt.streets';

export interface StuntJump { distanceM: number; airMs: number; best: boolean; from: { x: number; z: number } }
export interface StuntTracker {
  /** Per driving frame (metres + the controller flags); returns a jump on the landing frame of a qualifying one. */
  update(state: { readonly x: number; readonly z: number; readonly airborne: boolean; readonly landed: boolean }, nowMs: number): StuntJump | null;
  readonly best: { distanceM: number; airMs: number } | null;
  /** GTA's "unique stunt": the first jump off each named street counts once per device. True = a new street. */
  markStreet(street: string): boolean;
  /** How many distinct streets this device has jumped off. */
  readonly streets: number;
}

export function createStuntTracker(storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): StuntTracker {
  let takeoff: { x: number; z: number; t: number } | null = null;
  let best: { distanceM: number; airMs: number } | null = null;
  const streets = new Set<string>();
  try { const raw = storage?.getItem(STREETS_KEY); if (raw) for (const s of JSON.parse(raw) as unknown[]) if (typeof s === 'string') streets.add(s); } catch { /* none yet */ }
  try { const raw = storage?.getItem(BEST_KEY); if (raw) { const v = JSON.parse(raw) as { distanceM?: unknown; airMs?: unknown }; if (typeof v.distanceM === 'number' && typeof v.airMs === 'number') best = { distanceM: v.distanceM, airMs: v.airMs }; } } catch { /* no best yet */ }
  return {
    get best() { return best; },
    get streets() { return streets.size; },
    markStreet(street) {
      const key = street.trim(); if (!key || streets.has(key)) return false;
      streets.add(key); try { storage?.setItem(STREETS_KEY, JSON.stringify([...streets].slice(-200))); } catch { /* this visit only */ }
      return true;
    },
    update(state, nowMs) {
      if (state.airborne && !takeoff) takeoff = { x: state.x, z: state.z, t: nowMs };
      if (!state.landed || !takeoff) { if (!state.airborne) takeoff = null; return null; }
      const airMs = nowMs - takeoff.t, distanceM = Math.hypot(state.x - takeoff.x, state.z - takeoff.z), from = { x: takeoff.x, z: takeoff.z };
      takeoff = null;
      if (airMs < STUNT_MIN_AIR_MS || distanceM < STUNT_MIN_DISTANCE_M) return null;
      const isBest = !best || distanceM > best.distanceM;
      if (isBest) { best = { distanceM, airMs }; try { storage?.setItem(BEST_KEY, JSON.stringify(best)); } catch { /* this visit only */ } }
      return { distanceM, airMs, best: isBest, from };
    },
  };
}
