// Adapted from factory-core/templates/WebStarter/src/input/input.js. See PROVENANCE.md.
import { consumesActivationKey, consumesTextKeys, createActions, DESKTOP_ACTIONS } from './actions';
import type { Actions } from './actions';
import { needsFreeCursor, onCursorModeChange } from './cursor';
import { bindPointer } from './pointer';
import { TouchControls, type TouchFrame } from './touch';
import { flags } from '@gtasf/shared/flags';

export type InputAction = 'jump' | 'interact' | 'confirm' | 'back' | 'menu' | 'run'
  | 'steer' | 'throttle' | 'brake' | 'handbrake' | 'enter-exit' | 'hail' | 'map' | 'horn' | 'ride'
  | 'mayhem-fire' | 'mayhem-cycle';
export interface Vector2 { x: number; y: number }
export interface VirtualInput {
  move?: Vector2;
  /** Radians this frame, as with physical input. */
  look?: Vector2;
  actions?: readonly InputAction[];
  steer?: number;
  throttle?: number;
  brake?: number;
}
export interface DeviceFrame {
  move: Vector2; look: Vector2; actions: Set<InputAction>;
  steer: number; throttle: number; brake: number;
}
const KEYS: Readonly<Record<string, readonly InputAction[]>> = {
  Space: ['jump', 'handbrake'], KeyE: ['interact', 'enter-exit'], KeyH: ['hail'], KeyM: ['map'],
  // Feedback is on K via DESKTOP_ACTIONS (F moved to combat's shoot key); the horn remains on gamepad button 4.
  Enter: ['confirm'], NumpadEnter: ['confirm'], Backspace: ['back'],
  // Playful Mayhem: Q fires the selected toy, X cycles it (G=ride, 1-3=emote, scroll=zoom are all taken).
  Escape: ['menu'], ShiftLeft: ['run'], ShiftRight: ['run'], KeyG: ['ride'],
};
const POLLED_ACTIONS = new Set<InputAction>(['enter-exit', 'hail', 'map', 'horn', 'ride', 'mayhem-fire', 'mayhem-cycle']);
const PAD: Readonly<Record<number, readonly InputAction[]>> = {
  0: ['jump', 'handbrake'], 1: ['back'], 2: ['interact', 'enter-exit'], 3: ['hail'],
  4: ['horn'], 5: ['run'], 8: ['map'], 9: ['menu'], 10: ['run'], 11: ['ride'], 7: ['mayhem-fire'], 6: ['mayhem-cycle'],
};
const MOUSE_SPEED = 0.0025, PAD_LOOK_SPEED = 2.6, KEY_LOOK_SPEED = 1.4, DEAD = 0.18;
const finite = (n: number) => Number.isFinite(n) ? n : 0;
const clamp = (n: number, low = -1, high = 1) => Math.max(low, Math.min(high, finite(n)));
export const emptyFrame = (): DeviceFrame => ({ move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, actions: new Set(), steer: 0, throttle: 0, brake: 0 });

function resetFrame(frame: DeviceFrame): DeviceFrame {
  frame.move.x = frame.move.y = frame.look.x = frame.look.y = 0;
  frame.steer = frame.throttle = frame.brake = 0;
  frame.actions.clear();
  return frame;
}

/** An optional caller-owned frame avoids hot allocations; calls without it return independent snapshots. */
export function readGamepads(pads: readonly (Pick<Gamepad, 'connected' | 'axes' | 'buttons'> | null)[], dt: number, out: DeviceFrame = emptyFrame()): DeviceFrame {
  const frame = resetFrame(out);
  for (const pad of pads) {
    if (!pad?.connected) continue;
    const axis = (i: number) => Math.abs(pad.axes[i] ?? 0) > DEAD ? clamp(pad.axes[i]!) : 0;
    const x = axis(0) + Number(!!pad.buttons[15]?.pressed) - Number(!!pad.buttons[14]?.pressed);
    const y = -axis(1) + Number(!!pad.buttons[12]?.pressed) - Number(!!pad.buttons[13]?.pressed);
    frame.move.x += x; frame.move.y += y; frame.steer += x;
    frame.look.x += axis(2) * PAD_LOOK_SPEED * Math.max(0, finite(dt));
    // Right-stick up is a negative axis; negate so "up looks up" like the mouse/arrows/touch (founder).
    frame.look.y += -axis(3) * PAD_LOOK_SPEED * Math.max(0, finite(dt));
    frame.throttle = Math.max(frame.throttle, pad.buttons[7]?.value ?? 0, y);
    frame.brake = Math.max(frame.brake, pad.buttons[6]?.value ?? 0, -y);
    pad.buttons.forEach((button, i) => { if (button.pressed) for (const action of PAD[i] ?? []) frame.actions.add(action); });
  }
  return frame;
}

/** Virtual input replaces ALL physical devices, including held actions, for deterministic tests. */
export function resolveFrame(physical: DeviceFrame, virtual: VirtualInput | null): DeviceFrame {
  const out = virtual ? {
    move: { ...(virtual.move ?? { x: 0, y: 0 }) }, look: { ...(virtual.look ?? { x: 0, y: 0 }) },
    actions: new Set(virtual.actions ?? []),
    steer: virtual.steer ?? virtual.move?.x ?? 0,
    throttle: virtual.throttle ?? Math.max(0, virtual.move?.y ?? 0),
    brake: virtual.brake ?? Math.max(0, -(virtual.move?.y ?? 0)),
  } : physical;
  out.move.x = finite(out.move.x); out.move.y = finite(out.move.y);
  const length = Math.hypot(out.move.x, out.move.y);
  if (length > 1) { out.move.x /= length; out.move.y /= length; }
  out.look.x = finite(out.look.x); out.look.y = finite(out.look.y);
  out.steer = clamp(out.steer); out.throttle = clamp(out.throttle, 0); out.brake = clamp(out.brake, 0);
  if (out.actions.has('throttle')) out.throttle = 1;
  if (out.actions.has('brake')) out.brake = 1;
  if (out.steer) out.actions.add('steer');
  if (out.throttle) out.actions.add('throttle');
  if (out.brake) out.actions.add('brake');
  return out;
}

export class Input {
  readonly move = { x: 0, y: 0 };
  readonly look = { x: 0, y: 0 };
  readonly touch: TouchControls;
  readonly actions: Actions;
  virtual: VirtualInput | null = null;
  source: 'none' | 'keyboard' | 'mouse' | 'gamepad' | 'touch' | 'virtual' = 'none';
  steer = 0; throttle = 0; brake = 0;
  private keys = new Set<string>();
  private queued = new Set<InputAction>();
  private taps = new Set<InputAction>();
  private down = new Set<InputAction>();
  private previous = new Set<InputAction>();
  private mouse = { x: 0, y: 0 };
  private readonly touchFrame: TouchFrame = { active: false, move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, zoom: 0, actions: [], pressed: [] };
  // Rotate physical action Sets so pressed() retains the preceding frame.
  private physicalFrame = emptyFrame();
  private nextPhysicalFrame = emptyFrame();
  private readonly gamepadFrame = emptyFrame();
  private readonly moveEvent = { x: 0, z: 0, run: false };
  private readonly lookEvent = { dx: 0, dy: 0 };
  private cleanup: (() => void)[] = [];
  private disposed = false;
  private suspended = false;
  /** While driving, ArrowLeft/Right steer instead of orbiting the camera (set by main.ts). On foot they look. */
  private readonly inVehicle: () => boolean;

  constructor(readonly surface: HTMLCanvasElement, options: { actions?: Actions; touch?: boolean; inVehicle?: () => boolean } = {}) {
    this.actions = options.actions ?? createActions();
    this.inVehicle = options.inVehicle ?? (() => false);
    const doc = surface.ownerDocument, target = doc.defaultView!;
    this.touch = new TouchControls(surface, options.touch);
    // Retain GTASF's explicit user-gesture lock, refusal handling, drag fallback and free-cursor leases.
    const pointerActions = createActions(), pointer = bindPointer(surface, pointerActions);
    this.cleanup.push(pointer.dispose, pointerActions.dispose);
    this.cleanup.push(pointerActions.on('look', p => { this.mouse.x += p.dx; this.mouse.y += p.dy; this.source = 'mouse'; }));
    this.cleanup.push(pointerActions.on('zoom', n => this.actions.emit('zoom', n)));
    this.cleanup.push(pointerActions.on('interact', p => this.actions.emit('interact', p)));
    this.cleanup.push(pointerActions.on('releaseInput', () => this.release()));
    this.cleanup.push(this.actions.on('pointerLock', () => pointerActions.emit('pointerLock', undefined)));
    this.cleanup.push(this.actions.on('releaseInput', () => { this.release(); pointer.release(); }));
    const down = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || consumesTextKeys(event.target) || consumesActivationKey(event)) return;
      if (needsFreeCursor() && event.code !== 'KeyM' && event.code !== 'Escape') return;
      if (event.repeat && (event.code === 'KeyM' || event.code === 'Escape')) return;
      this.keys.add(event.code); this.source = 'keyboard';
      // Preserve taps whose keydown and keyup both arrive between rendered frames.
      if (!event.repeat) for (const action of KEYS[event.code] ?? []) if (POLLED_ACTIONS.has(action)) this.queued.add(action);
      if (KEYS[event.code] || /^(Key[WASD]|Arrow)/.test(event.code)) event.preventDefault();
      if (!event.repeat && Object.hasOwn(DESKTOP_ACTIONS, event.code) && event.code !== 'KeyM') {
        this.actions.emit(DESKTOP_ACTIONS[event.code as keyof typeof DESKTOP_ACTIONS], undefined);
      }
    };
    const up = (event: KeyboardEvent) => { this.keys.delete(event.code); };
    const blur = () => { this.suspended = true; this.release(); };
    const focus = () => { this.suspended = false; };
    const focusIn = (event: FocusEvent) => { if (consumesTextKeys(event.target)) this.release(); };
    const visibility = () => { if (doc.hidden) blur(); else focus(); };
    target.addEventListener('keydown', down); target.addEventListener('keyup', up);
    target.addEventListener('blur', blur); target.addEventListener('focus', focus);
    doc.addEventListener('focusin', focusIn); doc.addEventListener('visibilitychange', visibility);
    this.cleanup.push(() => {
      target.removeEventListener('keydown', down); target.removeEventListener('keyup', up);
      target.removeEventListener('blur', blur); target.removeEventListener('focus', focus);
      doc.removeEventListener('focusin', focusIn); doc.removeEventListener('visibilitychange', visibility);
    });
    this.cleanup.push(onCursorModeChange(() => { if (needsFreeCursor()) this.release(); }));
    if (!options.actions) this.cleanup.push(this.actions.dispose);
  }

  /** Call once before each simulation update. move.y is forward; Actions.move.z is world-local backward. */
  poll(dt: number): void {
    if (this.disposed) return;
    let frame = this.physicalFrame;
    this.physicalFrame = this.nextPhysicalFrame; this.nextPhysicalFrame = frame;
    resetFrame(frame);
    this.taps.clear();
    const doc = this.surface.ownerDocument;
    const blocked = this.suspended || needsFreeCursor() || consumesTextKeys(doc.activeElement);
    let touchZoom = 0;
    if (!blocked) {
      const k = this.keys;
      frame.move.x = Number(k.has('KeyD')) - Number(k.has('KeyA'));
      frame.move.y = Number(k.has('KeyW')) - Number(k.has('KeyS'));
      // ArrowLeft/Right (founder, GTA-like): ON FOOT they orbit the camera (look.x, same as before); WHILE
      // DRIVING they STEER (a ±1 axis alongside A/D) and do NOT orbit, so they don't double up with the look
      // controls. The driving controller ramps/centres the steer. arrowSteer is harmless in frame.steer on
      // foot (steer is only read while driving).
      const driving = this.inVehicle();
      const arrowSteer = Number(k.has('ArrowRight')) - Number(k.has('ArrowLeft'));
      frame.steer = Math.max(-1, Math.min(1, frame.move.x + arrowSteer));
      frame.throttle = Math.max(0, frame.move.y); frame.brake = Math.max(0, -frame.move.y);
      for (const code of k) for (const action of KEYS[code] ?? []) frame.actions.add(action);
      const lookStep = KEY_LOOK_SPEED * Math.max(0, Math.min(.1, finite(dt)));
      // Non-inverted look (founder): "up looks up" for every source. ArrowUp/Down already use up=+; the mouse's
      // screen-delta (down=+ movementY) is negated here so mouse, arrows, gamepad and touch all agree. The
      // per-device "Invert look" toggle (default off) flips the sign at the camera consumer. ArrowLeft/Right
      // feed look.x on foot, but not while driving (there they steer).
      frame.look.x = this.mouse.x * MOUSE_SPEED + (driving ? 0 : arrowSteer * lookStep);
      frame.look.y = -this.mouse.y * MOUSE_SPEED + (Number(k.has('ArrowUp')) - Number(k.has('ArrowDown'))) * lookStep;
      const pad = readGamepads(doc.defaultView!.navigator.getGamepads?.() ?? [], dt, this.gamepadFrame);
      if (pad.move.x || pad.move.y || pad.look.x || pad.look.y || pad.actions.size || pad.throttle || pad.brake) this.source = 'gamepad';
      frame.move.x += pad.move.x; frame.move.y += pad.move.y; frame.steer += pad.steer;
      frame.look.x += pad.look.x; frame.look.y += pad.look.y;
      frame.throttle = Math.max(frame.throttle, pad.throttle); frame.brake = Math.max(frame.brake, pad.brake);
      for (const action of pad.actions) frame.actions.add(action);
      const touch = this.touch.visible ? this.touch.read(this.touchFrame) : null;
      if (touch?.active) {
        frame.move.x += touch.move.x; frame.move.y += touch.move.y; frame.steer += touch.move.x;
        frame.look.x += touch.look.x; frame.look.y += touch.look.y;
        touchZoom = touch.zoom;
        frame.throttle = Math.max(frame.throttle, touch.move.y); frame.brake = Math.max(frame.brake, -touch.move.y);
        for (const action of touch.actions) frame.actions.add(action);
        if (!this.virtual) for (const action of touch.pressed) this.taps.add(action);
        this.source = 'touch';
      }
    } else {
      this.touch.reset();
      // Map/menu can close free-cursor UI; movement stays released while it owns the cursor.
      if (!this.suspended && !consumesTextKeys(doc.activeElement)) {
        if (this.keys.has('KeyM')) frame.actions.add('map');
        if (this.keys.has('Escape')) frame.actions.add('menu');
      }
    }
    for (const action of this.queued) {
      if (!blocked || (action === 'map' && !this.suspended && !consumesTextKeys(doc.activeElement))) {
        frame.actions.add(action);
        // A new keydown is an edge even if the preceding poll held the same action.
        if (!this.virtual) this.taps.add(action);
      }
    }
    this.queued.clear();
    this.mouse.x = this.mouse.y = 0;
    frame = resolveFrame(frame, this.virtual);
    if (this.virtual) this.source = 'virtual';
    this.previous = this.down; this.down = frame.actions;
    Object.assign(this.move, frame.move); Object.assign(this.look, frame.look);
    this.steer = frame.steer; this.throttle = frame.throttle; this.brake = frame.brake;
    this.moveEvent.x = this.move.x; this.moveEvent.z = -this.move.y; this.moveEvent.run = this.held('run');
    this.actions.emit('move', this.moveEvent);
    if (this.look.x || this.look.y) {
      this.lookEvent.dx = this.look.x / MOUSE_SPEED; this.lookEvent.dy = this.look.y / MOUSE_SPEED;
      this.actions.emit('look', this.lookEvent);
    }
    this.actions.emit('steer', this.steer); this.actions.emit('throttle', this.throttle); this.actions.emit('brake', this.brake);
    this.actions.emit('handbrake', this.held('handbrake'));
    if (touchZoom && flags.touchCameraZoom && !this.virtual) this.actions.emit('zoom', touchZoom);
    for (const action of ['enter-exit', 'hail', 'map', 'horn', 'ride', 'mayhem-fire', 'mayhem-cycle'] as const) if (this.pressed(action)) this.actions.emit(action, undefined);
  }
  held(action: InputAction): boolean { return this.down.has(action); }
  pressed(action: InputAction): boolean { return this.down.has(action) && (this.taps.has(action) || !this.previous.has(action)); }
  value(action: InputAction): number {
    return action === 'steer' ? this.steer : action === 'throttle' ? this.throttle : action === 'brake' ? this.brake : Number(this.held(action));
  }
  release(): void {
    this.keys.clear(); this.queued.clear(); this.taps.clear(); this.down.clear(); this.previous.clear(); this.touch.reset();
    this.move.x = this.move.y = this.look.x = this.look.y = this.mouse.x = this.mouse.y = 0;
    this.steer = this.throttle = this.brake = 0;
    this.actions.emit('move', { x: 0, z: 0, run: false });
    this.actions.emit('steer', 0); this.actions.emit('throttle', 0); this.actions.emit('brake', 0); this.actions.emit('handbrake', false);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.release(); this.touch.dispose();
    for (const off of this.cleanup.splice(0)) off();
  }
}
