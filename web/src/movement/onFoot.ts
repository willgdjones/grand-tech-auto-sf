import { flags } from '@gtasf/shared/flags';
import { moveOnGround } from './world';
import type { GroundPose, MovementWorld } from './world';

export interface OnFootInput {
  x: number; z: number; run: boolean;
  /** When >0 the player is on a personal ride (gtasf-v21-personal-rides): move at this m/s instead of
   *  walk/sprint. The game loop sets it from the mounted ride's speed; unset/0 = on foot. */
  mountSpeedMps?: number;
  /** Multiplier on the final speed (gtasf-playful-mayhem water-balloon slow): <1 briefly slows the
   *  player after a water hit. Unset/0 = full speed. Applies to walk, sprint and rides alike. */
  speedScale?: number;
}
// On-foot speeds (m/s). v2.1 founder retune (gtasf-v21-walk-sprint): a brisker walk and a proper
// sprint, no stamina gate. Personal rides (gtasf-v21-personal-rides) run ~2x sprint on top of this.
export const WALK_SPEED_MPS = 4;
export const SPRINT_SPEED_MPS = 8;
// onFootInertia (docs/critique/2026-10-15-gta-v-gap.md FEEL): GTA V's on-foot feel is mostly inertia — you lean into a
// start, carry a step after you let go, and a reversal swings through rather than snapping 180°. Ramp the planar
// velocity toward the input with a short time constant instead of applying full speed on the first frame. The yaw
// still follows the actual motion, so turns sweep with the velocity. Rides keep their instant response.
const ACCEL_TAU_S = 0.13, DECEL_TAU_S = 0.09, STOP_MPS = 0.06;
const inertia = new WeakMap<GroundPose, { vx: number; vz: number }>();

/** Mutates a ground pose; input z=-1 is forward relative to the orbit camera. */
export function updateOnFoot(pose: GroundPose, input: OnFootInput, cameraYaw: number, dt: number, world: MovementWorld): number {
  if (!flags.onFoot || !Number.isFinite(dt) || dt <= 0) return 0;
  const x = Number.isFinite(input.x) ? input.x : 0, z = Number.isFinite(input.z) ? input.z : 0;
  const length = Math.hypot(x, z), step = Math.min(.1, dt);
  const ride = input.mountSpeedMps && input.mountSpeedMps > 0 ? input.mountSpeedMps : 0;
  const smooth = flags.onFootInertia && !ride;
  let state = smooth ? inertia.get(pose) : undefined;
  if (smooth && !state) { state = { vx: 0, vz: 0 }; inertia.set(pose, state); }
  if (!length && !(state && Math.hypot(state.vx, state.vz) > STOP_MPS)) {
    if (state) { state.vx = 0; state.vz = 0; }
    const height = world.heightAt(pose.x, pose.z);
    if (height !== null && Number.isFinite(height) && Math.abs(height - pose.y) < .4) pose.y = height;
    return 0;
  }
  const scaleFactor = input.speedScale && input.speedScale > 0 ? input.speedScale : 1; // water-balloon slow
  const speed = (ride || (input.run ? SPRINT_SPEED_MPS : WALK_SPEED_MPS)) * scaleFactor;
  const sin = Math.sin(cameraYaw), cos = Math.cos(cameraYaw), scale = speed / Math.max(1, length);
  // Target planar velocity (m/s) in world space.
  let vx = (x * cos + z * sin) * scale, vz = (-x * sin + z * cos) * scale;
  if (state) {
    const tau = length ? ACCEL_TAU_S : DECEL_TAU_S, blend = 1 - Math.exp(-step / tau);
    state.vx += (vx - state.vx) * blend; state.vz += (vz - state.vz) * blend;
    vx = state.vx; vz = state.vz;
  }
  const beforeX = pose.x, beforeZ = pose.z;
  moveOnGround(pose, vx * step, vz * step, world, .3, true);
  const moved = Math.hypot(pose.x - beforeX, pose.z - beforeZ);
  if (moved > .0001) pose.yaw = Math.atan2(pose.x - beforeX, pose.z - beforeZ);
  else if (state) { state.vx = 0; state.vz = 0; } // blocked: don't keep "pushing" into the wall after release
  return moved / step;
}
