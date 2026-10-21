import { flags } from '@gtasf/shared/flags';

/**
 * gtasf-3k35 (part b): serialise the heavy whole-city mount stages so they never share a frame.
 *
 * The main loop calls streetProps/parodyBillboards/roadDetails builds and the radar canvas redraw every
 * frame. During the post-READY mount burst each wants to do a heavy slice at once, and they pile into a
 * single 300-800 ms frame (profiled). This hands out ONE "heavy" grant per rendered frame: the first
 * stage to claim it wins, the rest defer their expensive work to a later frame (doing only cheap
 * bookkeeping meanwhile). First-come order follows the main loop's call order, so the most visible stage
 * (street props) is never starved. A no-op (every claim granted) when flags.sequencedMount is off.
 */
let owner: string | null = null;

/** Call once at the top of each rendered game-loop frame, before the stage updates. */
export function beginHeavyFrame(): void { owner = null; }

/** True if `id` may run its heavy build/redraw this frame. Always true when the flag is off. */
export function claimHeavyFrame(id: string): boolean {
  if (!flags.sequencedMount) return true;
  if (owner === null || owner === id) { owner = id; return true; }
  return false;
}
