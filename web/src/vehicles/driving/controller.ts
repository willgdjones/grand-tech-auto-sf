import { flags } from '@gtasf/shared/flags';
import { availableHeight } from '../../movement/world';
import type { GroundPose, MovementWorld } from '../../movement/world';

export interface DrivingState extends GroundPose { speed: number; pitch: number; roll: number; steering: number; slip: number; visualY: number;
  /** Short-lived external shove from car-vs-car bumps (world m/s) and a yaw kick (rad/s); both decay fast. */
  bumpVx: number; bumpVz: number; bumpSpin: number;
  /** Real hill air (flag hillJumps): vertical velocity, whether the car is off the ground, and a one-frame
   *  flag set on the frame it touches back down (for the camera shake + suspension squash). */
  vy: number; airborne: boolean; landed: boolean;
  /** drivingFeel: the speed (m/s, signed) at which the car hit a wall THIS frame; 0 otherwise. */
  wallHit?: number }
/** Rough car half-extent for the soft car-vs-car overlap (fun arcade value, not a real collision hull). */
export const CAR_BUMP_RADIUS_M = 2.1;
export interface DrivingInput { steer: number; throttle: number; brake: number; handbrake: boolean }
export interface DrivingTuning {
  maxSpeed: number; reverseSpeed: number; acceleration: number; braking: number;
  wheelbase: number; halfWidth: number; maxSteering: number;
}
// Arcade feel (founder public playtest): ~173 km/h top speed, quick acceleration, strong brakes.
export const defaultDrivingTuning: Readonly<DrivingTuning> = Object.freeze({
  maxSpeed: 48, reverseSpeed: 8, acceleration: 16, braking: 30,
  wheelbase: 2.8, halfWidth: .92, maxSteering: .62,
});
export function createDrivingState(pose: GroundPose): DrivingState {
  return { ...pose, speed: 0, pitch: 0, roll: 0, steering: 0, slip: 0, visualY: pose.y, bumpVx: 0, bumpVz: 0, bumpSpin: 0,
    vy: 0, airborne: false, landed: false };
}

/**
 * Soft car-vs-car bump (PLAN loose-arcade, multiplayer-safe): each client owns its car and pushes
 * ITSELF away from any overlapping car, so both owners separate symmetrically with no bump message or
 * server physics. `others` are nearby car centres in metres (own car excluded). Returns true on contact
 * so the caller can honk/sfx. Never tunnels: the shove is a bounded velocity applied+validated next tick.
 */
export function applyCarBumps(state: DrivingState, others: readonly { x: number; z: number }[], dt: number): boolean {
  if (!flags.driving || !Number.isFinite(dt) || dt <= 0) return false;
  let bumped = false;
  let vx = 0, vz = 0, spin = 0;
  for (const other of others) {
    const dx = state.x - other.x, dz = state.z - other.z, dist = Math.hypot(dx, dz);
    const overlap = CAR_BUMP_RADIUS_M * 2 - dist;
    if (!Number.isFinite(dist) || overlap <= 0 || dist < 1e-3) continue;
    bumped = true;
    const nx = dx / dist, nz = dz / dist; // unit vector pointing away from the other car
    const push = Math.min(7, overlap * 9 + Math.abs(state.speed) * .45); // soft, scales with overlap + closing speed
    vx += nx * push; vz += nz * push;
    // A glancing (side-on) hit adds a little spin; a head-on/rear hit barely spins. Fun, not realistic.
    spin += (nx * Math.cos(state.yaw) - nz * Math.sin(state.yaw)) * push * .12;
  }
  if (bumped) {
    // Sustained contact refreshes a velocity, rather than adding another impulse every frame.
    // Cap the combined response too, so a pile-up cannot multiply the maximum shove.
    const scale = Math.min(1, 7 / Math.max(1e-6, Math.hypot(vx, vz)));
    state.bumpVx = vx * scale; state.bumpVz = vz * scale;
    state.bumpSpin = clamp(spin, -1.6, 1.6);
  }
  return bumped;
}
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : 0));
const approach = (value: number, target: number, delta: number) => value < target ? Math.min(target, value + delta) : Math.max(target, value - delta);

type VisualGroundPose = GroundPose & { pitch: number; roll: number };
/** Eases pitch/roll to the ground slope and RETURNS the ground height (the caller decides whether to
 *  ground-lock state.y — grounded driving does; a car in the air keeps its ballistic height). */
function contactPose(state: VisualGroundPose, step: number, tuning: Readonly<DrivingTuning>, centre: number, front: number, back: number, left: number, right: number): number {
  // For rotation order YXZ: front up is negative X; right up is positive Z.
  const pitch = clamp(-Math.atan2(front - back, tuning.wheelbase), -.6, .6);
  const roll = clamp(Math.atan2(right - left, tuning.halfWidth * 2), -.45, .45);
  const blend = 1 - Math.exp(-12 * step);
  state.pitch += (pitch - state.pitch) * blend;
  state.roll += (roll - state.roll) * blend;
  return Math.max(centre, (front + back) / 2, (left + right) / 2);
}

/** Visual-only ground contact for server-driven taxis/remotes: never changes x/z/yaw or sends a move. */
export function alignVehicleToGround(state: VisualGroundPose, dt: number, world: MovementWorld, tuning: Readonly<DrivingTuning> = defaultDrivingTuning): boolean {
  const sin = Math.sin(state.yaw), cos = Math.cos(state.yaw), half = tuning.wheelbase / 2;
  const centre = world.heightAt(state.x, state.z);
  const front = world.heightAt(state.x + sin * half, state.z + cos * half);
  const back = world.heightAt(state.x - sin * half, state.z - cos * half);
  const left = world.heightAt(state.x - cos * tuning.halfWidth, state.z + sin * tuning.halfWidth);
  const right = world.heightAt(state.x + cos * tuning.halfWidth, state.z - sin * tuning.halfWidth);
  if (centre === null || front === null || back === null || left === null || right === null ||
    !Number.isFinite(centre + front + back + left + right) || !Number.isFinite(dt) || dt < 0) return false;
  state.y = contactPose(state, Math.min(.1, dt), tuning, centre, front, back, left, right);
  return true;
}

/** Arcade bicycle model, bounded sweeps and strong brakes; never called for autonomous taxis. */
export function updateDriving(state: DrivingState, input: DrivingInput, dt: number, world: MovementWorld, tuning: Readonly<DrivingTuning> = defaultDrivingTuning): void {
  if (!flags.driving || !Number.isFinite(dt) || dt <= 0) return;
  const step = Math.min(.1, dt), throttle = clamp(input.throttle, 0, 1), brake = clamp(input.brake, 0, 1);
  // Positive input is the driver's right. Positive Y rotation turns +Z toward +X (left).
  // Punchier steering that stays responsive at speed (gentler high-speed falloff, faster wheel response).
  // Speed-sensitive steering (founder car-handling): near-full lock when parking, much calmer at speed so
  // the car is not twitchy on the highway. Then SMOOTH it to the target over ~0.2s so keyboard taps and
  // the phone joystick ramp up and back instead of snapping.
  const steeringTarget = -clamp(input.steer, -1, 1) * tuning.maxSteering / (1 + Math.abs(state.speed) * .05);
  // Ramp toward the target over ~0.17 s (time constant 1/6 s, founder: GTA-like, not snapping to full lock).
  // Keyboard taps (A/D and ArrowLeft/Right) ease in and self-centre on release; analog stick/touch stay
  // proportional (the target scales with |input.steer|). Was 11 (~0.09 s) — too twitchy on the arrow keys.
  state.steering += (steeringTarget - state.steering) * (1 - Math.exp(-6 * step));
  const braking = flags.arcadeHandling ? tuning.braking : tuning === defaultDrivingTuning ? 14 : tuning.braking;
  if (input.handbrake) state.speed = approach(state.speed, 0, braking * step);
  else if (brake > .01 && state.speed > .2) state.speed = approach(state.speed, 0, braking * brake * step);
  else if (throttle > .01 && state.speed < -.2) state.speed = approach(state.speed, 0, braking * throttle * step);
  else if (throttle > .01 || brake > .01) state.speed += (throttle - brake) * tuning.acceleration * step;
  else state.speed = approach(state.speed, 0, (.8 + .018 * state.speed * state.speed) * step);
  state.speed = clamp(state.speed, -tuning.reverseSpeed, tuning.maxSpeed);
  // Brief outward slip on a handbrake turn. Release restores >99% grip in 0.4 s.
  const drifting = flags.arcadeHandling && input.handbrake && state.speed > 4;
  const slipTarget = drifting ? clamp(-state.steering * .55, -.18, .18) : 0;
  state.slip = flags.arcadeHandling ? state.slip + (slipTarget - state.slip) * (1 - Math.exp(-(drifting ? 7 : 12) * step)) : 0;
  if (Math.abs(state.speed) < .2) state.slip = 0;
  const distance = state.speed * step;
  const airborneNow = flags.hillJumps && state.airborne; // was airborne entering this frame
  // Mild air control: steering still bites a little in flight, not full grip.
  const yawDelta = state.speed / tuning.wheelbase * Math.tan(state.steering) * step * (airborneNow ? .35 : 1);
  const steps = Math.max(1, Math.ceil(Math.abs(distance) / .2));
  const travel = distance / steps;
  const startY = state.y; // height entering the frame, for the ballistic launch/land test below
  state.wallHit = 0;
  let groundY = state.y;
  for (let i = 0; i < steps; i++) {
    const yaw = state.yaw + yawDelta / steps;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const x = state.x + Math.sin(yaw + state.slip) * travel, z = state.z + Math.cos(yaw + state.slip) * travel;
    const half = tuning.wheelbase / 2;
    const centre = availableHeight(world, x, z, tuning.halfWidth);
    const front = availableHeight(world, x + sin * half, z + cos * half, tuning.halfWidth);
    const back = availableHeight(world, x - sin * half, z - cos * half, tuning.halfWidth);
    const left = world.heightAt(x - cos * tuning.halfWidth, z + sin * tuning.halfWidth);
    const right = world.heightAt(x + cos * tuning.halfWidth, z - sin * tuning.halfWidth);
    // A blocked tile (null) is a real wall and always stops the car. A step-up in ground height stops it
    // only while grounded; airborne, the car flies over bumps/gaps/seams without a lurch.
    if (centre === null || front === null || back === null || left === null || right === null ||
      !Number.isFinite(left) || !Number.isFinite(right) ||
      (!airborneNow && Math.abs(centre - state.y) > 1.0 + Math.abs(travel) * 2)) {
      // drivingFeel (critique #10): a wall bounces the car back with 30% of its speed (capped at reverse speed) and,
      // when only one side clipped, yaws it away from that side — instead of a dead stop in one frame.
      if (flags.drivingFeel && Math.abs(state.speed) > 3) {
        state.wallHit = state.speed;
        const back = -Math.sign(state.speed) * Math.min(Math.abs(state.speed) * .3, tuning.reverseSpeed);
        const leftHit = left === null || !Number.isFinite(left), rightHit = right === null || !Number.isFinite(right);
        state.bumpSpin += leftHit === rightHit ? 0 : (leftHit ? 1 : -1) * Math.min(1.2, Math.abs(state.speed) * .05);
        state.speed = back; state.slip = 0; break;
      }
      state.speed = 0; state.slip = 0; break;
    }
    state.x = x; state.z = z; state.yaw = Math.atan2(sin, cos);
    groundY = contactPose(state, step / steps, tuning, centre, front, back, left, right);
    if (!airborneNow) state.y = groundY; // ground-lock while grounded (flag-off path is unchanged)
  }
  // Car-vs-car bump shove: apply on top of driving, validate against the road (never tunnel), then decay.
  if (state.bumpVx || state.bumpVz || state.bumpSpin) {
    const dx = state.bumpVx * step, dz = state.bumpVz * step;
    const bumpSteps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .2));
    const travel = Math.hypot(dx, dz) / bumpSteps;
    for (let i = 0; i < bumpSteps; i++) {
      const x = state.x + dx / bumpSteps, z = state.z + dz / bumpSteps;
      const yaw = state.yaw + state.bumpSpin * step / bumpSteps;
      const sin = Math.sin(yaw), cos = Math.cos(yaw), half = tuning.wheelbase / 2;
      const centre = availableHeight(world, x, z, tuning.halfWidth);
      const front = availableHeight(world, x + sin * half, z + cos * half, tuning.halfWidth);
      const back = availableHeight(world, x - sin * half, z - cos * half, tuning.halfWidth);
      const left = world.heightAt(x - cos * tuning.halfWidth, z + sin * tuning.halfWidth);
      const right = world.heightAt(x + cos * tuning.halfWidth, z - sin * tuning.halfWidth);
      if (centre === null || front === null || back === null || left === null || right === null ||
        !Number.isFinite(left) || !Number.isFinite(right) ||
        (!airborneNow && Math.abs(centre - state.y) > 1 + travel * 2)) {
        state.bumpVx = 0; state.bumpVz = 0; state.bumpSpin = 0; break;
      }
      state.x = x; state.z = z; state.yaw = Math.atan2(sin, cos);
      groundY = contactPose(state, step / bumpSteps, tuning, centre, front, back, left, right);
      if (!airborneNow) state.y = groundY;
    }
    const decay = Math.exp(-6 * step);
    state.bumpVx *= decay; state.bumpVz *= decay; state.bumpSpin *= decay;
    if (Math.hypot(state.bumpVx, state.bumpVz) < .05) { state.bumpVx = 0; state.bumpVz = 0; }
    if (Math.abs(state.bumpSpin) < .03) state.bumpSpin = 0;
  }
  // Real hill air (flag hillJumps, founder car-handling): if the car's vertical momentum carries it above
  // the ground (a crest dropping away faster than gravity pulls it down), it leaves the road and flies
  // ballistically — keeping the forward momentum moved above, with mild air control — then falls under
  // gravity and lands forgivingly. The ground-lock + discontinuity guard above ran only while grounded.
  // Flag off => a no-op: state.y stays ground-locked exactly as before.
  state.landed = false;
  const g = 22;
  // Hanging-car root cause (gtasf carHangRecovery, @ktwu01): when there is no terrain sample under the car —
  // an unloaded chunk or a void (common while a new player's spawn chunk is still streaming) — the movement
  // loop above left `groundY` equal to the car's own height, so the ground-lock / ballistic-landing below
  // "landed" it on itself and it hung in mid-air. Detect no-ground directly and keep applying gravity so it
  // falls; then, once terrain streams in below it, finish the fall and LAND on that real terrain (the loop's
  // step-discontinuity guard reads the big drop as a wall and keeps groundY stale, so we land on the direct
  // terrain sample, bypassing it). A car over a building footprint still reads street-level terrain here, so
  // the roof case is unchanged and owned by the roof guard; the hangRecovery net catches a persistent void.
  const underCar = world.heightAt(state.x, state.z);
  const noGround = underCar === null || !Number.isFinite(underCar);
  if (flags.carHangRecovery && noGround) {
    // No terrain at all: fall freely under gravity rather than freezing at our own height.
    state.y = startY + state.vy * step - 0.5 * g * step * step; state.vy -= g * step; state.airborne = true;
  } else if (flags.hillJumps) {
    const by = startY + state.vy * step - 0.5 * g * step * step; // ballistic continuation of vertical momentum
    if (by > groundY + 0.03) {
      state.y = by; state.vy -= g * step; state.airborne = true;
      const airPitch = clamp(-state.vy * 0.03, -.5, .5);            // nose tracks the arc a little
      state.pitch += (airPitch - state.pitch) * (1 - Math.exp(-6 * step));
      state.roll += (0 - state.roll) * (1 - Math.exp(-6 * step));   // level out in flight (auto-upright; never flips)
    } else {
      if (state.airborne) state.landed = true;                      // touched down this frame -> squash + camera shake
      state.y = groundY; state.vy = (groundY - startY) / step; state.airborne = false;
    }
  } else if (flags.carHangRecovery && state.airborne) {
    // We were falling through a void (hillJumps off) and real terrain is back below us: continue falling and
    // land on it. Use the direct terrain sample (underCar), not the loop's groundY which the step guard froze.
    const by = startY + state.vy * step - 0.5 * g * step * step;
    if (by > (underCar as number) + 0.03) { state.y = by; state.vy -= g * step; state.airborne = true; }
    else { state.landed = true; state.y = underCar as number; state.vy = 0; state.airborne = false; }
  } else { state.y = groundY; state.vy = 0; state.airborne = false; }
  // Render/camera follow a smoothed height so terrain/road sampling jitter never judders the car; the rate
  // adapts to the gap (small = jitter, smooth; large = a real slope or a landing, track fast) so the car
  // never floats, and the brief lag on touchdown reads as a little suspension squash. Snap on a big jump.
  const gap = Math.abs(state.y - state.visualY);
  if (!Number.isFinite(state.visualY) || gap > 2) state.visualY = state.y;
  else state.visualY += (state.y - state.visualY) * (1 - Math.exp(-(14 + Math.min(50, gap * 40)) * step));
}
