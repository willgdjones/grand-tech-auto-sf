import type { Actions } from '../actions';
import { PLAYER_CAMERA_CONFIG } from '../../camera/config';
import { Joystick } from './joystick';

export type GestureState =
  'idle' | 'stick' | 'orbit' | 'pinch' | 'stick+orbit' | 'stick+pinch' | 'tapCandidate';
export interface TouchPoint {
  id: number;
  x: number;
  y: number;
  at: number;
}
export interface GestureOptions {
  actions: Actions;
  capture(id: number): boolean;
  release(id: number): void;
  /** Clear the existing player's velocity as well as its input, including on lifecycle cancellation. */
  releaseMovement(): void;
  firstStick?(): void;
  /** Mounted controls already separate taps from camera drag; retain their immediate look. */
  orbitThresholdPx?: number;
}
interface OwnedPointer {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  at: number;
}
const pointer = (): OwnedPointer => ({ id: -1, x: 0, y: 0, startX: 0, startY: 0, at: 0 });
const MIN_DRAG_PX = 8;

/** Three fixed pointer slots: a stick plus at most two orbit fingers. No per-move allocations. */
export class TouchGestures {
  readonly joystick = new Joystick();
  private stickId = -1;
  private readonly a = pointer();
  private readonly b = pointer();
  private readonly look = { dx: 0, dy: 0 };
  private readonly tap = { clientX: 0, clientY: 0 };
  private zoom = 0;
  private pinchDistance = 0;
  private dragged = false;
  private tapAllowed = false;
  private resumeGuard = false;
  private yielded = false;
  private usedStick = false;

  constructor(private readonly options: GestureOptions) {}

  get state(): GestureState {
    if (this.b.id !== -1) return this.stickId === -1 ? 'pinch' : 'stick+pinch';
    if (this.a.id !== -1) {
      if (this.stickId !== -1) return 'stick+orbit';
      return this.tapAllowed && !this.dragged ? 'tapCandidate' : 'orbit';
    }
    return this.stickId === -1 ? 'idle' : 'stick';
  }
  owns(id: number): boolean {
    return id >= 0 && (id === this.stickId || id === this.a.id || id === this.b.id);
  }
  setYielding(value: boolean): void {
    if (value === this.yielded) return;
    this.yielded = value;
    if (value) this.cancel();
  }
  private assign(target: OwnedPointer, p: TouchPoint): void {
    target.id = p.id;
    target.x = target.startX = p.x;
    target.y = target.startY = p.y;
    target.at = p.at;
  }
  down(p: TouchPoint, leftZone: boolean): boolean {
    if (
      this.yielded ||
      this.owns(p.id) ||
      !Number.isSafeInteger(p.id) ||
      p.id < 0 ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      !Number.isFinite(p.at)
    )
      return false;
    // A second finger may join an orbit from either zone only while no stick owns that zone.
    if (this.a.id !== -1 && this.b.id === -1 && (!leftZone || this.stickId === -1)) {
      if (!this.options.capture(p.id)) return false;
      this.assign(this.b, p);
      this.tapAllowed = false;
      this.dragged = false;
      this.resumeGuard = false;
      this.look.dx = this.look.dy = 0;
      this.pinchDistance = Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y);
      return true;
    }
    if (leftZone && this.stickId === -1 && this.a.id === -1) {
      if (!this.options.capture(p.id)) return false;
      this.stickId = p.id;
      this.joystick.start(p.x, p.y);
      this.options.actions.emit('move', this.joystick.movement);
      if (!this.usedStick) {
        this.usedStick = true;
        this.options.firstStick?.();
      }
      return true;
    }
    if (!leftZone && this.a.id === -1) {
      if (!this.options.capture(p.id)) return false;
      this.assign(this.a, p);
      this.dragged = false;
      this.tapAllowed = true;
      this.resumeGuard = false;
      return true;
    }
    return false;
  }
  /** @hot */
  move(id: number, x: number, y: number): void {
    if (this.yielded || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (id === this.stickId && id !== -1) {
      this.joystick.move(x, y);
      this.options.actions.emit('move', this.joystick.movement);
      return;
    }
    const p = id === this.a.id ? this.a : id === this.b.id ? this.b : undefined;
    if (!p || id === -1) return;
    const dx = x - p.x,
      dy = y - p.y;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    p.x = x;
    p.y = y;
    if (this.b.id !== -1) {
      const distance = Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y);
      if (Number.isFinite(distance) && distance > 0) {
        if (this.pinchDistance > 0)
          this.zoom +=
            (Math.log(this.pinchDistance) - Math.log(distance)) / Math.log(PLAYER_CAMERA_CONFIG.wheelFactor);
        this.pinchDistance = distance;
      }
      return;
    }
    const threshold = this.resumeGuard ? MIN_DRAG_PX : this.options.orbitThresholdPx ?? MIN_DRAG_PX;
    if (!this.dragged && Math.hypot(x - p.startX, y - p.startY) >= threshold) {
      this.dragged = true;
      this.tapAllowed = false;
      if (this.resumeGuard) {
        // The remaining pinch finger establishes a new origin before it can orbit.
        this.resumeGuard = false;
        return;
      }
    }
    if (this.dragged) {
      this.look.dx += dx;
      this.look.dy += dy;
    }
  }
  /** Pointer-up coordinates may be newer than the last move event; they still count against tap bounds. */
  up(p: TouchPoint): void {
    if (!this.owns(p.id)) return;
    if (p.id === this.stickId) {
      this.stickId = -1;
      this.joystick.release();
      this.options.actions.emit('move', this.joystick.movement);
      this.options.releaseMovement();
      this.options.release(p.id);
      return;
    }
    if (this.b.id !== -1) {
      if (p.id === this.a.id) {
        this.a.id = this.b.id;
        this.a.x = this.b.x;
        this.a.y = this.b.y;
      }
      this.b.id = -1;
      this.a.startX = this.a.x;
      this.a.startY = this.a.y;
      this.a.at = p.at;
      this.dragged = this.tapAllowed = false;
      this.resumeGuard = true;
      this.pinchDistance = 0;
      this.options.release(p.id);
      return;
    }
    const accept =
      this.tapAllowed &&
      !this.dragged &&
      p.at >= this.a.at &&
      p.at - this.a.at <= 300 &&
      Math.hypot(p.x - this.a.startX, p.y - this.a.startY) < MIN_DRAG_PX;
    this.a.id = -1;
    this.tapAllowed = this.dragged = false;
    this.resumeGuard = false;
    this.options.release(p.id);
    if (accept) {
      this.tap.clientX = p.x;
      this.tap.clientY = p.y;
      this.options.actions.emit('interact', this.tap);
    }
  }
  /** @hot Orbit and zoom publish at most once per input frame. */
  flush(): void {
    if (this.look.dx || this.look.dy) {
      this.options.actions.emit('look', this.look);
      this.look.dx = this.look.dy = 0;
    }
    if (this.zoom) {
      const delta = this.zoom;
      this.zoom = 0;
      this.options.actions.emit('zoom', delta);
    }
  }
  cancel(): void {
    const stick = this.stickId,
      a = this.a.id,
      b = this.b.id;
    // Clear ownership before releasing capture: synchronous lostpointercapture must be harmless.
    this.stickId = this.a.id = this.b.id = -1;
    this.joystick.release();
    this.look.dx = this.look.dy = this.zoom = this.pinchDistance = 0;
    this.tapAllowed = this.dragged = false;
    this.resumeGuard = false;
    this.options.actions.emit('move', this.joystick.movement);
    this.options.releaseMovement();
    if (stick !== -1) this.options.release(stick);
    if (a !== -1) this.options.release(a);
    if (b !== -1) this.options.release(b);
  }
}
