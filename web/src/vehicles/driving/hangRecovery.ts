/** Hang recovery (gtasf hanging-car fix, @ktwu01): a driven car that ends up stuck in mid-air — hovering
 * above the rooftops, or sitting over an unloaded/void tile with no ground under it — must recover to the
 * nearest road instead of floating there. The controller's no-ground gravity fix (controller.ts) prevents
 * the common case (a car over an unloaded chunk now falls), and the roof guard (roofGuard.ts) catches a car
 * perched on a roof; this is the general safety net that also covers hovering with no footprint beneath, and
 * fires only once the car has hung continuously for `holdMs` so a legitimate jump or a one-frame sampling gap
 * never triggers it. Pure logic (no three.js / world deps) so the trigger is unit-tested directly.
 */
export interface HangSample {
  /** Is there a ground/road height sample under the car right now? (false = unloaded chunk / void). */
  groundSampled: boolean;
  /** Car y minus the ground height under it, in metres. Only meaningful when `groundSampled`. */
  heightAboveGround: number;
  /** Car vertical velocity, m/s (near zero = not actively rising or falling). */
  verticalSpeed: number;
}

export interface HangConfig {
  /** A car this far above the ground counts as hovering (m). */
  hoverHeight: number;
  /** "~zero" vertical velocity: at or below this magnitude the car is not falling/rising (m/s). */
  stillSpeed: number;
  /** The hang must persist at least this long before recovering (ms). */
  holdMs: number;
}

export const HANG_RECOVERY: HangConfig = { hoverHeight: 4, stillSpeed: 0.5, holdMs: 1500 };

/** Cap on how much a single frame can add to the hang timer, so one long frame (a tab stall / GC pause)
 *  cannot trip recovery on its own — recovery needs the hang to persist across several real frames. */
const MAX_STEP_MS = 100;

/**
 * True when the car looks stuck in the air this frame: either there is no ground sample under it at all, or
 * it hovers more than `hoverHeight` above the ground while barely moving vertically (not mid-fall / mid-jump).
 */
export function carIsHanging(sample: HangSample, cfg: HangConfig = HANG_RECOVERY): boolean {
  if (!Number.isFinite(sample.verticalSpeed)) return true; // NaN/Infinite physics state is itself a stuck car
  if (!sample.groundSampled) return true;
  return sample.heightAboveGround > cfg.hoverHeight && Math.abs(sample.verticalSpeed) <= cfg.stillSpeed;
}

/**
 * Accumulate the hang timer. While the car is hanging, add `dtMs`; otherwise reset to 0. When the accumulated
 * time reaches `holdMs`, return `recover: true` and reset the timer (the caller recovers to the nearest road
 * and the timer starts fresh). `dtMs` is clamped so a long frame / tab stall can't instantly trip recovery.
 */
export function advanceHangRecovery(hangMs: number, dtMs: number, sample: HangSample,
  cfg: HangConfig = HANG_RECOVERY): { hangMs: number; recover: boolean } {
  if (!carIsHanging(sample, cfg)) return { hangMs: 0, recover: false };
  const next = hangMs + Math.min(Math.max(0, dtMs), MAX_STEP_MS);
  if (next >= cfg.holdMs) return { hangMs: 0, recover: true };
  return { hangMs: next, recover: false };
}
