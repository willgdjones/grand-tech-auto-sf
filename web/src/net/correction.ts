import { CORRECTION_FREEZE_MS, CORRECTION_LERP_MS } from '@gtasf/shared/constants';

/**
 * M6.11b CORRECTION (0x89, §4.7): the sole owner of correction maths. The displayed pose lerps from the
 * current displayed pose to the corrected one over 100 ms; movement input is frozen for 200 ms; at the end
 * of the lerp the solver restarts at the corrected pose with zero velocity (M5.2 `resetSolver`), so the next
 * MOVE starts there. A second CORRECTION during a lerp restarts from the displayed pose. There is no replay
 * of unacknowledged inputs; SNAPSHOT `ackMoveSeq` only feeds a debug ring for the perf overlay.
 */
export interface Pose {
  x: number;
  z: number;
  yaw: number;
}
export interface CorrectionState {
  readonly from: Readonly<Pose>;
  readonly to: Readonly<Pose>;
  readonly startMono: number;
  readonly reason: number;
}
/** Wire reasons (§4.5.2). */
export const CORRECTION_REASONS = { 1: 'speed', 2: 'notWalkable', 3: 'spawn' } as const;

export function applyCorrection(
  current: Readonly<Pose>,
  corrected: Readonly<Pose>,
  reason: number,
  nowMono: number,
): CorrectionState {
  return { from: { ...current }, to: { ...corrected }, startMono: nowMono, reason };
}

/** Shortest-arc yaw interpolation in radians. */
function lerpYaw(a: number, b: number, f: number): number {
  const turn = Math.PI * 2;
  const d = ((((b - a + Math.PI) % turn) + turn) % turn) - Math.PI;
  return a + d * f;
}

/** The displayed pose at `nowMono`, whether the lerp has finished and whether input is still frozen. */
export function correctionPose(
  state: CorrectionState,
  nowMono: number,
  out: Pose,
): { lerpDone: boolean; frozen: boolean } {
  const f = Math.max(0, Math.min(1, (nowMono - state.startMono) / CORRECTION_LERP_MS));
  out.x = state.from.x + (state.to.x - state.from.x) * f;
  out.z = state.from.z + (state.to.z - state.from.z) * f;
  out.yaw = f >= 1 ? state.to.yaw : lerpYaw(state.from.yaw, state.to.yaw, f);
  return { lerpDone: f >= 1, frozen: nowMono - state.startMono < CORRECTION_FREEZE_MS };
}

/** The M5.2 local-player hooks this drives (metres and radians). */
export interface CorrectablePlayer {
  readonly display: Readonly<Pose>;
  applyCorrection(pose: Readonly<Pose>): void;
  resetSolver(pose: Readonly<Pose>): void;
  setInputFrozen(frozen: boolean): void;
}

const ACK_RING = 32;

export function createCorrectionDriver(options: { player: CorrectablePlayer; mono(): number }) {
  const { player } = options;
  let state: CorrectionState | undefined;
  let solverReset = true;
  let frozen = false;
  const pose: Pose = { x: 0, z: 0, yaw: 0 };
  const counts = { speed: 0, notWalkable: 0, spawn: 0, unknown: 0 };
  const acks = new Uint32Array(ACK_RING);
  let ackHead = 0;
  function tick(): void {
    if (!state) return;
    const now = options.mono();
    const result = correctionPose(state, now, pose);
    if (!result.lerpDone) player.applyCorrection(pose);
    else if (!solverReset) {
      solverReset = true; // once, even if M5.2 rejects the pose
      player.resetSolver(state.to);
    }
    if (frozen && !result.frozen) {
      frozen = false;
      player.setInputFrozen(false);
    }
    if (result.lerpDone && !frozen) state = undefined;
  }
  return {
    /** M6.11a CORRECTION event: wire centimetres and u8 yaw (v·2π/256). */
    onCorrection(message: { x: number; z: number; yaw: number; reason: number }): void {
      const corrected = { x: message.x / 100, z: message.z / 100, yaw: (message.yaw * Math.PI * 2) / 256 };
      const name = CORRECTION_REASONS[message.reason as keyof typeof CORRECTION_REASONS] ?? 'unknown';
      counts[name]++;
      // Restart from what is displayed now (mid-lerp included), never from the solver's last position.
      const now = options.mono();
      if (state) tick();
      state = applyCorrection(player.display, corrected, message.reason, now);
      solverReset = false;
      frozen = true;
      player.setInputFrozen(true);
      tick();
    },
    /** Call once per frame (render loop `localPlayer` phase) until the correction completes. */
    tick,
    /** SNAPSHOT `ackMoveSeq` for the perf overlay; never used to replay inputs. */
    recordAck(seq: number): void {
      acks[ackHead] = seq >>> 0;
      ackHead = (ackHead + 1) % ACK_RING;
    },
    acks: () => Array.from({ length: ACK_RING }, (_, i) => acks[(ackHead + i) % ACK_RING]!),
    counts: counts as Readonly<typeof counts>,
    get active() {
      return state !== undefined;
    },
  };
}
export type CorrectionDriver = ReturnType<typeof createCorrectionDriver>;
