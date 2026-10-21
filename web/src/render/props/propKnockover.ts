/**
 * Pure knock-over state machine for cosmetic street props (gtasf-arcade-props-knockover-30v0, part 3
 * of loose-arcade-physics). The driver's car topples a nearby small prop (hydrant, newspaper box,
 * sign, meter); it falls flat, lies there for a beat, then rises back on its own. No gameplay effect
 * and no bandwidth — purely local cosmetic, phone-identical.
 *
 * There is no three.js here on purpose: streetProps.ts turns a prop's `lean()` into an instance-matrix
 * overlay, so all the timing and branching below is deterministic and fully unit-testable. The whole
 * system sits behind flags.propKnockover (OFF) and only runs once pane 1 feeds the driving car's
 * position into createStreetProps().update(); until then nothing calls bump() and every prop stands.
 */

export interface KnockoverConfig {
  /** Car centre within this distance of a prop (metres) topples it. Coordinate with CAR_BUMP_RADIUS_M. */
  readonly bumpRadiusM: number;
  /** Seconds to fall from upright to flat. */
  readonly toppleSeconds: number;
  /** Seconds a prop lies flat before it starts to rise. */
  readonly holdSeconds: number;
  /** Seconds to rise from flat back to upright (after which it is forgotten/standing). */
  readonly resetSeconds: number;
}

export const DEFAULT_KNOCKOVER: KnockoverConfig = Object.freeze({
  bumpRadiusM: 2.1, // mirrors CAR_BUMP_RADIUS_M in web/src/vehicles/driving/controller.ts
  toppleSeconds: 0.35,
  holdSeconds: 3.5,
  resetSeconds: 0.8,
});

type Phase = 'toppling' | 'held' | 'resetting';
interface Topple { phase: Phase; t: number; fallYaw: number; }

export interface PropLean {
  /** 0 = upright, 1 = flat on the ground; eased for a readable fall/rise. */
  readonly amount: number;
  /** World heading (radians) the prop's top falls toward — away from the car. Fall direction is
   *  (sin(fallYaw), 0, cos(fallYaw)), matching the project's yaw convention. */
  readonly fallYaw: number;
}

export interface Knockover {
  /** Advance every tracked prop by dt seconds (clamped against long frames). Call once per frame. */
  tick(dtSeconds: number): void;
  /** Topple an upright prop if the car centre is within bumpRadius; it falls away from the car. Returns
   *  true only on the frame it STARTS a new topple (for one-shot effects like a hydrant spray); false if
   *  the prop is already toppled/resetting or out of range. */
  bump(siteId: number, propX: number, propZ: number, carX: number, carZ: number): boolean;
  /** Current lean for a prop, or null when it is upright/untracked (the common case — no overlay). */
  lean(siteId: number): PropLean | null;
  /** Drop a prop's state (e.g. it scrolled out of view) so stale leans never reappear on reuse. */
  forget(siteId: number): void;
  /** Props currently leaning — lets the renderer skip the overlay entirely when zero. */
  readonly activeCount: number;
}

function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }
function easeInOutQuad(x: number): number { return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2; }

export function createKnockover(config: KnockoverConfig = DEFAULT_KNOCKOVER): Knockover {
  const states = new Map<number, Topple>();
  return {
    tick(dtSeconds) {
      const dt = Math.max(0, Math.min(dtSeconds, 0.1)); // a long/background frame can't skip the fall
      if (dt === 0) return;
      // Each phase is longer than the 0.1 s clamp, so a tick crosses at most one boundary; carry the
      // overshoot into the next phase instead of dropping it, so total fall/hold/rise time is exact.
      for (const [id, s] of states) {
        s.t += dt;
        if (s.phase === 'toppling') { if (s.t >= config.toppleSeconds) { s.phase = 'held'; s.t -= config.toppleSeconds; } }
        else if (s.phase === 'held') { if (s.t >= config.holdSeconds) { s.phase = 'resetting'; s.t -= config.holdSeconds; } }
        else if (s.t >= config.resetSeconds) { states.delete(id); } // resetting -> upright, forgotten
      }
    },
    bump(siteId, propX, propZ, carX, carZ) {
      if (states.has(siteId)) return false; // already toppled or rising — don't restart
      const dx = propX - carX, dz = propZ - carZ;
      if (dx * dx + dz * dz > config.bumpRadiusM * config.bumpRadiusM) return false;
      const fallYaw = (dx === 0 && dz === 0) ? 0 : Math.atan2(dx, dz); // away from the car; +z if dead-centre
      states.set(siteId, { phase: 'toppling', t: 0, fallYaw });
      return true; // newly toppled this frame
    },
    lean(siteId) {
      const s = states.get(siteId);
      if (!s) return null;
      let p: number;
      if (s.phase === 'toppling') p = config.toppleSeconds <= 0 ? 1 : s.t / config.toppleSeconds;
      else if (s.phase === 'held') p = 1;
      else p = config.resetSeconds <= 0 ? 0 : 1 - s.t / config.resetSeconds; // resetting: 1 -> 0
      return { amount: easeInOutQuad(clamp01(p)), fallYaw: s.fallYaw };
    },
    forget(siteId) { states.delete(siteId); },
    get activeCount() { return states.size; },
  };
}
