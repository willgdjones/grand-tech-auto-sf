import type { MovementInput } from '../actions';

export const STICK_RADIUS_PX = 60;
export const STICK_DEAD_ZONE = 0.12;
export const STICK_RUN_THRESHOLD = 0.85;

/** Camera-relative input; the existing LocalPlayer still owns acceleration and collision. */
export class Joystick {
  readonly movement: MovementInput = { x: 0, z: 0, run: false };
  active = false;
  originX = 0;
  originY = 0;
  knobX = 0;
  knobY = 0;
  deflection = 0;

  start(x: number, y: number): void {
    this.release();
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.active = true;
    this.originX = x;
    this.originY = y;
  }

  /** @hot Borrow the same movement record for every pointer event. */
  move(x: number, y: number): void {
    if (!this.active || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const dx = x - this.originX;
    const dy = y - this.originY;
    const distance = Math.hypot(dx, dy);
    if (!Number.isFinite(distance)) return;
    this.deflection = Math.min(1, distance / STICK_RADIUS_PX);
    const factor = distance ? Math.min(1, STICK_RADIUS_PX / distance) : 0;
    this.knobX = dx * factor;
    this.knobY = dy * factor;
    this.movement.run = this.deflection > STICK_RUN_THRESHOLD;
    // Running has full 4.2 m/s target speed even at 0.86 deflection; walking retains 1.6*d.
    const speedFraction = this.movement.run ? 1 : this.deflection > STICK_DEAD_ZONE ? this.deflection : 0;
    this.movement.x = distance ? (dx / distance) * speedFraction : 0;
    this.movement.z = distance ? (dy / distance) * speedFraction : 0;
  }

  release(): void {
    this.active = false;
    this.knobX = this.knobY = this.deflection = 0;
    this.movement.x = this.movement.z = 0;
    this.movement.run = false;
  }
}
