/**
 * GTA V pivot — LANE B (combat & police): the SFPD bust (flag policeBust).
 *
 * Pure, shared, SERVER-authoritative. A wanted player who lets the police catch them on foot — slower than a run,
 * within BUST_RADIUS_M of a ground unit — for BUST_HOLD_MS continuously is BUSTED (−5% valuation, wanted cleared,
 * respawn). Breaking away (distance, speed, or getting in a car) resets the timer, so a sprint or a getaway car
 * always escapes the cuffs. The helicopter never busts.
 */

/** Units are road-snapped cars, so this spans lane centre → the far edge of a typical sidewalk. Players deep in a
 * plaza or park can't be busted until officers can leave their cars (follow-up). */
export const BUST_RADIUS_M = 7;
export const BUST_HOLD_MS = 4_000; // QA #6.16: 2.5 s busted a standing player moments after a cruiser rolled up
/** With officers on foot (sfpdOnFoot) only an OFFICER makes the arrest, and only within arm's reach. */
export const BUST_OFFICER_RADIUS_M = 3;
/** A player who fired within this long is resisting: police shoot them (policeFire), they don't cuff them. */
export const BUST_RESIST_MS = 3_000;
/** Review FB-L1: shooting only counts as resisting where police actually return fire (2★+, POLICE_FIRE_MIN_LEVEL) —
 *  otherwise a 1★ player could fire into the air every few seconds and be neither busted nor shot. */
export const BUST_RESIST_MIN_LEVEL = 2;
export function resistingArrest(level: number, sinceLastShotMs: number): boolean {
  return level >= BUST_RESIST_MIN_LEVEL && sinceLastShotMs < BUST_RESIST_MS;
}
/** A walk or a jog gets you cuffed; a sprint (the on-foot run is well above this) breaks away. */
export const BUST_MAX_SPEED_MPS = 3;
/** Review D-M1: a unit on a freeway deck above (or the street below) is not 'within reach' — the radius is 3D-ish. */
export const BUST_MAX_DY_M = 3;
/** Review D-L1: one tick adds at most this much hold, so a server stall can't complete a bust in a single step. */
export const BUST_MAX_STEP_MS = 250;

export interface BustState { holdMs: number; lastX: number; lastZ: number; lastAt: number }

export function freshBust(x: number, z: number, now: number): BustState {
  return { holdMs: 0, lastX: x, lastZ: z, lastAt: now };
}

export interface BustInput {
  /** Current wanted level (stars). */
  level: number;
  /** Not driving or riding a vehicle. */
  onFoot: boolean;
  /** Alive (health > 0). A player already WASTED (death debit in flight) can never also be BUSTED. Default true. */
  alive?: boolean;
  /** Distance (metres) to the nearest ground SFPD unit, or Infinity when none. */
  nearestUnitM: number;
  /** The player fired a weapon within BUST_RESIST_MS (resisting arrest). Default false. */
  resisting?: boolean;
  /** Player position (metres) this tick. */
  x: number;
  z: number;
  now: number;
}

/** Advance the bust timer by one server tick. Returns the next state and whether the player is busted now. */
export function stepBust(state: BustState, input: BustInput): { state: BustState; busted: boolean } {
  const dtMs = Math.max(0, input.now - state.lastAt);
  const speed = dtMs > 0 ? Math.hypot(input.x - state.lastX, input.z - state.lastZ) / (dtMs / 1000) : 0;
  const caught = input.alive !== false && !input.resisting && input.level >= 1 && input.onFoot && input.nearestUnitM <= BUST_RADIUS_M && speed <= BUST_MAX_SPEED_MPS;
  const holdMs = caught ? state.holdMs + Math.min(dtMs, BUST_MAX_STEP_MS) : 0;
  const next = { holdMs, lastX: input.x, lastZ: input.z, lastAt: input.now };
  if (holdMs >= BUST_HOLD_MS) return { state: { ...next, holdMs: 0 }, busted: true };
  return { state: next, busted: false };
}
