// Adapted from WebStarter src/input/touch.js: joystick, action buttons and independent look drag.
import type { InputAction, Vector2 } from './input';
import { flags } from '@gtasf/shared/flags';
import { STICK_DEAD_ZONE, STICK_RUN_THRESHOLD } from './touch/joystick';
import { createActions } from './actions';
import { TouchGestures } from './touch/gestures';
export interface TouchFrame {
  active: boolean; move: Vector2; look: Vector2; zoom: number; actions: InputAction[];
  /** Fresh discrete touches, distinct from actions held in the previous poll. */
  pressed: InputAction[];
}
const RADIUS = 56, LOOK_SPEED = 0.006;
const TAP_ACTIONS = new Set<InputAction>(['enter-exit', 'hail', 'horn', 'map', 'ride']);
const BUTTONS = [
  ['throttle', 'Go'], ['brake', 'Brake'], ['handbrake', 'H-brake'],
  ['enter-exit', 'Enter / exit'], ['hail', 'Hail'], ['ride', 'Ride / hop off'], ['horn', 'Horn'], ['map', 'Map'],
] as const;
const CSS = `
.gtasf-touch{position:fixed;inset:0;z-index:50;pointer-events:none;user-select:none;-webkit-user-select:none;display:none}
.gtasf-touch.on{display:block}.gtasf-touch .stick{position:absolute;left:calc(24px + env(safe-area-inset-left));bottom:calc(28px + env(safe-area-inset-bottom));width:144px;height:144px;border-radius:50%;border:2px solid #e0e7de99;background:#15201b70;pointer-events:auto;touch-action:none}
.gtasf-touch .knob{position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px;border-radius:50%;background:#e0e7debb;border:2px solid #17241d;box-sizing:border-box}
.gtasf-touch .stick-hint{position:absolute;bottom:12px;left:0;right:0;text-align:center;color:#fff;font:600 10px system-ui;text-shadow:0 1px 2px #000;pointer-events:none}
.gtasf-touch .buttons{position:absolute;right:calc(16px + env(safe-area-inset-right));bottom:calc(24px + env(safe-area-inset-bottom));display:grid;grid-template-columns:repeat(2,66px);gap:8px}
.gtasf-touch button{min-height:44px;padding:8px 3px;color:#fff;background:#17241ddb;border:1px solid #d9e1d0;border-radius:10px;font:600 12px system-ui;pointer-events:auto;touch-action:none}
.gtasf-touch button.down{background:#687756}.gtasf-touch button[data-action=map]{grid-column:span 2}
.gtasf-touch [hidden]{display:none!important}
.gtasf-touch .ride-hint{position:absolute;right:calc(16px + env(safe-area-inset-right));bottom:calc(136px + env(safe-area-inset-bottom));max-width:210px;padding:7px 10px;border-radius:6px;color:#fff;background:#17241ddb;font:600 12px system-ui;text-align:right}
@media(max-height:460px){.gtasf-touch .buttons{grid-template-columns:repeat(4,60px)}.gtasf-touch button[data-action=map]{grid-column:auto}}
/* Keep the full movement hit area clear of the action column on narrow phones. */
@media(max-width:360px){.gtasf-touch .stick{left:calc(16px + env(safe-area-inset-left));width:128px;height:128px}.gtasf-touch .buttons{grid-template-columns:repeat(2,66px)}.gtasf-touch button[data-action=map]{grid-column:span 2}}
`;
export class TouchControls {
  visible: boolean;
  readonly root: HTMLDivElement;
  private style: HTMLStyleElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private move: Vector2 = { x: 0, y: 0 };
  private look: Vector2 = { x: 0, y: 0 };
  private stickId: number | null = null;
  private readonly cameraGestures: TouchGestures;
  private zoom = 0;
  private mode: 'on-foot' | 'driver' | 'passenger' | null = null;
  private cableCar = false;
  private rideHint: HTMLElement;
  private actionButtons: HTMLButtonElement[];
  private buttons = new Map<number, { action: InputAction; element: HTMLElement }>();
  private queued = new Map<number, InputAction>();
  private completed = new Set<InputAction>();
  private cleanups: (() => void)[] = [];
  private priorTouchAction: { value: string; priority: string } | null = null;
  constructor(private surface: HTMLCanvasElement, visible?: boolean) {
    const doc = surface.ownerDocument, win = doc.defaultView!;
    const setting = new URLSearchParams(win.location.search).get('touch');
    this.visible = flags.mobile && (visible ?? (setting === '1' || setting !== '0' && (win.matchMedia('(pointer: coarse)').matches || win.navigator.maxTouchPoints > 0)));
    this.style = doc.createElement('style'); this.style.textContent = CSS; doc.head.append(this.style);
    this.root = doc.createElement('div'); this.root.className = `gtasf-touch${this.visible ? ' on' : ''}`;
    this.root.innerHTML = `<div class="stick" aria-label="Move and steer; push fully to run"><div class="knob"></div><span class="stick-hint" aria-hidden="true">Push to run</span></div><div class="ride-hint" hidden></div><div class="buttons">${BUTTONS.map(([a, label]) => `<button type="button" tabindex="-1" data-action="${a}" aria-label="${label}">${label}</button>`).join('')}</div>`;
    doc.body.append(this.root);
    this.stick = this.root.querySelector('.stick')!; this.knob = this.root.querySelector('.knob')!;
    this.rideHint = this.root.querySelector('.ride-hint')!;
    this.actionButtons = [...this.root.querySelectorAll<HTMLButtonElement>('button[data-action]')];
    const on = (el: HTMLElement | Window, type: string, handler: (event: PointerEvent) => void) => {
      el.addEventListener(type, handler as EventListener, { passive: false });
      this.cleanups.push(() => el.removeEventListener(type, handler as EventListener));
    };
    const capture = (el: HTMLElement, id: number) => { try { el.setPointerCapture(id); } catch { /* Synthetic test events. */ } };
    const cameraActions = createActions();
    this.cameraGestures = new TouchGestures({
      actions: cameraActions,
      capture: id => { try { surface.setPointerCapture(id); return true; } catch { return false; } },
      release: id => { if (surface.hasPointerCapture(id)) surface.releasePointerCapture(id); },
      // Camera fingers never own movement: the visible stick remains independent.
      releaseMovement: () => {},
      orbitThresholdPx: 0,
    });
    // Non-inverted look (founder): drag up looks up. The gesture dy is screen-space (down positive), so negate
    // the vertical so touch agrees with the mouse/arrows/gamepad; the "Invert look" toggle flips it at the camera.
    cameraActions.on('look', p => { this.look.x += p.dx * LOOK_SPEED; this.look.y += -p.dy * LOOK_SPEED; });
    cameraActions.on('zoom', value => { this.zoom += value; });
    this.cleanups.push(cameraActions.dispose);
    on(this.stick, 'pointerdown', e => {
      if (!this.visible || this.mode === 'passenger' || this.stickId !== null) return;
      e.preventDefault(); this.stickId = e.pointerId; capture(this.stick, e.pointerId); this.steer(e.clientX, e.clientY);
    });
    for (const button of this.actionButtons) on(button, 'pointerdown', e => {
      if (!this.visible || button.hidden) return;
      e.preventDefault(); e.stopPropagation(); capture(button, e.pointerId);
      const action = button.dataset.action as InputAction;
      const alreadyHeld = [...this.buttons.values()].some(held => held.action === action);
      this.buttons.set(e.pointerId, { action, element: button }); button.classList.add('down');
      // Preserve short taps between simulation polls; driving pedals remain held controls.
      if (TAP_ACTIONS.has(action) && !alreadyHeld) this.queued.set(e.pointerId, action);
    });
    on(surface, 'pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      if (setting !== '0' && visible !== false) this.show(true);
      if (!this.visible) return;
      if (!flags.touchCameraZoom && this.cameraGestures.state !== 'idle') return;
      if (this.cameraGestures.down({ id: e.pointerId, x: e.clientX, y: e.clientY, at: e.timeStamp }, false)) e.preventDefault();
    });
    on(win, 'pointermove', e => {
      if (e.pointerId === this.stickId) { e.preventDefault(); this.steer(e.clientX, e.clientY); }
      if (this.cameraGestures.owns(e.pointerId)) {
        e.preventDefault(); this.cameraGestures.move(e.pointerId, e.clientX, e.clientY);
      }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.stickId) this.releaseStick();
      if (this.cameraGestures.owns(e.pointerId)) {
        if (e.type === 'pointerup') this.cameraGestures.up({ id: e.pointerId, x: e.clientX, y: e.clientY, at: e.timeStamp });
        else this.cameraGestures.cancel();
      }
      const button = this.buttons.get(e.pointerId);
      // Capture loss after pointerup must not erase a completed tap.
      const action = this.queued.get(e.pointerId);
      if (action && e.type === 'pointerup') this.completed.add(action);
      this.queued.delete(e.pointerId);
      this.buttons.delete(e.pointerId);
      if (button && ![...this.buttons.values()].some(b => b.element === button.element)) button.element.classList.remove('down');
    };
    on(win, 'pointerup', end); on(win, 'pointercancel', end); on(win, 'lostpointercapture', end);
    const blur = () => this.reset(); win.addEventListener('blur', blur); this.cleanups.push(() => win.removeEventListener('blur', blur));
    this.show(this.visible);
    this.setMode('on-foot');
  }
  /** Pass the authoritative seat mode before polling; unchanged frames do no DOM work. */
  setMode(mode: 'on-foot' | 'driver' | 'passenger', cableCar = false): void {
    cableCar = mode === 'passenger' && cableCar;
    if (this.mode === mode && this.cableCar === cableCar) return;
    this.reset(); this.mode = mode; this.cableCar = cableCar;
    const passenger = mode === 'passenger';
    this.root.dataset.mode = mode;
    this.stick.hidden = passenger;
    this.stick.setAttribute('aria-label', mode === 'driver' ? 'Steer' : 'Move; push fully to run');
    this.root.querySelector<HTMLElement>('.stick-hint')!.hidden = mode !== 'on-foot';
    this.rideHint.hidden = !passenger;
    this.rideHint.textContent = cableCar ? 'Cable car ride · drag to look' : 'Autonomous ride · drag to look';
    for (const button of this.actionButtons) {
      const action = button.dataset.action;
      button.hidden = action === 'ride' ? mode !== 'on-foot' || !flags.personalRides : mode === 'on-foot'
        ? action !== 'enter-exit' && action !== 'hail' && action !== 'map'
        : passenger && action !== 'enter-exit' && action !== 'map' && !(cableCar && action === 'horn');
      const label = action === 'horn' ? cableCar ? 'Bell' : 'Horn' : action === 'enter-exit' ? passenger ? 'Exit ride' : 'Enter / exit' : null;
      if (label) { button.textContent = label; button.setAttribute('aria-label', label); }
    }
  }
  show(on: boolean): void {
    this.visible = flags.mobile && on;
    this.root.classList.toggle('on', this.visible);
    // PointerEvent.preventDefault alone does not stop the browser cancelling a drag to pan/zoom.
    // Own only the active game canvas; menus keep their normal scrolling and browser gestures.
    if (this.visible) {
      this.priorTouchAction ??= { value: this.surface.style.getPropertyValue('touch-action'), priority: this.surface.style.getPropertyPriority('touch-action') };
      this.surface.style.setProperty('touch-action', 'none');
    } else {
      if (this.priorTouchAction) {
        this.surface.style.setProperty('touch-action', this.priorTouchAction.value, this.priorTouchAction.priority);
        this.priorTouchAction = null;
      }
      this.reset();
    }
  }
  private steer(x: number, y: number): void {
    const box = this.stick.getBoundingClientRect(); let dx = x - box.left - box.width / 2, dy = y - box.top - box.height / 2;
    const length = Math.hypot(dx, dy); if (length > RADIUS) { dx *= RADIUS / length; dy *= RADIUS / length; }
    const moving = length / RADIUS > STICK_DEAD_ZONE;
    this.move.x = moving ? dx / RADIUS : 0; this.move.y = moving ? -dy / RADIUS : 0;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  private releaseStick(): void { this.stickId = null; this.move.x = this.move.y = 0; this.knob.style.transform = ''; }
  /** With no output argument, return an independent snapshot; the frame loop may reuse its own buffer. */
  read(out: TouchFrame = { active: false, move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, zoom: 0, actions: [], pressed: [] }): TouchFrame {
    this.cameraGestures.flush();
    out.look.x = this.look.x; out.look.y = this.look.y; this.look.x = this.look.y = 0;
    out.zoom = flags.touchCameraZoom ? this.zoom : 0; this.zoom = 0;
    out.move.x = this.move.x; out.move.y = this.move.y;
    const actions = out.actions, pressed = out.pressed; actions.length = pressed.length = 0;
    for (const action of this.completed) { actions.push(action); pressed.push(action); }
    for (const action of this.queued.values()) if (!actions.includes(action)) { actions.push(action); pressed.push(action); }
    for (const button of this.buttons.values()) if (!actions.includes(button.action)) actions.push(button.action);
    // Running only changes the on-foot action; vehicle steer/throttle retain the same analog values.
    if (Math.hypot(this.move.x, this.move.y) > STICK_RUN_THRESHOLD) actions.push('run');
    this.queued.clear(); this.completed.clear();
    out.active = this.visible && !!(out.move.x || out.move.y || out.look.x || out.look.y || out.zoom || actions.length);
    return out;
  }
  reset(): void { this.releaseStick(); this.cameraGestures.cancel(); this.look.x = this.look.y = this.zoom = 0; for (const b of this.buttons.values()) b.element.classList.remove('down'); this.buttons.clear(); this.queued.clear(); this.completed.clear(); }
  dispose(): void { this.show(false); for (const off of this.cleanups.splice(0)) off(); this.root.remove(); this.style.remove(); }
}
