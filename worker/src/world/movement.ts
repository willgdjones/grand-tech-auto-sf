import { seqNewer16 } from '@gtasf/shared/protocol/serial';
import { validPose } from '@gtasf/shared/protocol/pose';
import type { MoveMessage, Pose } from '@gtasf/shared/protocol/types';
/** Adapted BDTS elapsed-credit guard. Track C/D installs vehicle modes and terrain collision. */
export interface MovementState { pose: Pose; seq: number; lastAt: number; carryCm: number; accepted: boolean }
export const MOVE_BURST_CM = 75;
/** On-foot MOVE speed cap (m/s). v2.1 (gtasf-v21-walk-sprint): sprint is 8 m/s, so the cap carries that
 *  plus 3D-hill (downhill adds vertical travel to the guard's distance) and jitter slack — a legit
 *  sprint, even downhill, never rubber-bands. Personal rides raise this further per stage (v21-personal-rides). */
export const ON_FOOT_CAP_MPS = 11;
export function checkMovement(state: MovementState, move: MoveMessage, now: number, maxSpeedMps = 6): boolean {
  if (!validPose(move) || !Number.isFinite(now) || now < state.lastAt) return false;
  if (state.accepted && !seqNewer16(state.seq, move.seq)) return false;
  const elapsed = Math.min(1000, now - state.lastAt);
  const available = state.carryCm + maxSpeedMps * 100 * elapsed / 1000;
  const distance = Math.hypot(move.x - state.pose.x, move.y - state.pose.y, move.z - state.pose.z);
  if (distance > available + 1) return false;
  state.pose = { x: move.x, y: move.y, z: move.z, yaw: move.yaw, flags: move.flags & 0x3f };
  state.seq = move.seq; state.accepted = true; state.lastAt = now;
  // MOVE is sent at 10 Hz. A delayed packet followed immediately by the next
  // legitimate ride packet can cover 1.4–1.7 m with no server time between them.
  // Keep one send interval of credit at ride caps; the walking/default allowance
  // remains 75 cm. Credit still comes only from elapsed server time and cannot
  // accumulate beyond this bounded jitter window or fund sustained overspeed.
  const burstCm = maxSpeedMps > ON_FOOT_CAP_MPS ? Math.max(MOVE_BURST_CM, maxSpeedMps * 10) : MOVE_BURST_CM;
  // Preserve signed epsilon debt: clamping to zero permits repeated 1 cm moves with no elapsed time.
  state.carryCm = Math.min(burstCm, available - distance);
  return true;
}
