import { afterEach, expect, test, vi } from 'vitest';
import { Input } from './input';
import { holdFreeCursor } from './cursor';
import { PLAYER_CAMERA_CONFIG } from '../camera/config';

// These input tests dispatch pointer events without starting a browser or renderer.
vi.mock('./pointer', () => ({ bindPointer: () => ({ dispose() {}, release() {} }) }));
const features = vi.hoisted(() => ({ mobile: true, touchCameraZoom: true, personalRides: true }));
vi.mock('@gtasf/shared/flags', () => ({ flags: features }));

function setup() {
  const win = Object.assign(new EventTarget(), {
    location: { search: '' }, navigator: { maxTouchPoints: 5, getGamepads: () => [] },
    matchMedia: () => ({ matches: true }),
  });
  const event = (target: EventTarget, type: string, id: number, x = 0, y = 0) => {
    target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
      pointerType: 'touch', pointerId: id, clientX: x, clientY: y,
    }));
  };
  class Node extends EventTarget {
    hidden = false; className = ''; textContent = ''; dataset: Record<string, string> = {};
    readonly captures = new Set<number>();
    readonly classes = new Set<string>();
    readonly classList = {
      add: (v: string) => this.classes.add(v), remove: (v: string) => this.classes.delete(v),
      toggle: (v: string, on: boolean) => on ? this.classes.add(v) : this.classes.delete(v),
    };
    readonly properties = new Map<string, string>();
    readonly style = {
      transform: '', getPropertyValue: (v: string) => this.properties.get(v) ?? '',
      getPropertyPriority: () => '', setProperty: (k: string, v: string) => this.properties.set(k, v),
    };
    readonly children = new Map<string, Node>();
    buttons: Node[] = [];
    get ownerDocument(): Document { return doc as unknown as Document; }
    set innerHTML(_html: string) {
      for (const selector of ['.stick', '.knob', '.stick-hint', '.ride-hint']) this.children.set(selector, new Node());
      this.buttons = ['throttle', 'brake', 'handbrake', 'enter-exit', 'hail', 'horn', 'map', 'ride'].map(action => {
        const node = new Node(); node.dataset.action = action; return node;
      });
    }
    querySelector(selector: string) { return this.children.get(selector); }
    querySelectorAll() { return this.buttons; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 144, height: 144 }; }
    setPointerCapture(id: number) { this.captures.add(id); }
    hasPointerCapture(id: number) { return this.captures.has(id); }
    releasePointerCapture(id: number) { this.captures.delete(id); event(win, 'lostpointercapture', id); }
    closest() { return null; }
    setAttribute() {}
    append() {}
    remove() {}
  }
  const body = new Node();
  const doc = Object.assign(new EventTarget(), {
    defaultView: win, body, head: new Node(), activeElement: body, hidden: false, createElement: () => new Node(),
  });
  vi.stubGlobal('Element', Node);
  const surface = new Node(), input = new Input(surface as unknown as HTMLCanvasElement, { touch: true });
  const zoom = vi.fn(); input.actions.on('zoom', zoom);
  const frame = () => input.poll(1 / 60);
  const down = (id: number, x: number, y = 200) => event(surface, 'pointerdown', id, x, y);
  const move = (id: number, x: number, y = 200) => event(win, 'pointermove', id, x, y);
  const up = (id: number, x: number, y = 200) => event(win, 'pointerup', id, x, y);
  return { input, surface, win, event, zoom, frame, down, move, up };
}

afterEach(() => { features.touchCameraZoom = true; features.personalRides = true; vi.unstubAllGlobals(); });

test('active phone input orbits with one finger and sends one camera zoom per pinch frame', () => {
  const ui = setup();
  try {
    ui.down(1, 200); ui.move(1, 220); ui.frame();
    expect(ui.input.look.x).toBeCloseTo(.12);
    ui.down(2, 320); ui.move(1, 170); ui.move(2, 370); ui.frame();
    expect(ui.input.look).toEqual({ x: 0, y: 0 });
    expect(ui.zoom).toHaveBeenCalledTimes(1);
    const outward = ui.zoom.mock.calls[0]![0] as number;
    expect(PLAYER_CAMERA_CONFIG.wheelFactor ** outward).toBeCloseTo(.5);
    ui.frame(); expect(ui.zoom).toHaveBeenCalledTimes(1);
    ui.move(2, 270); ui.frame();
    expect(PLAYER_CAMERA_CONFIG.wheelFactor ** ui.zoom.mock.calls[1]![0]).toBeCloseTo(2);
    // Lifting one pinch finger re-anchors the survivor before orbit resumes.
    ui.up(1, 170); ui.move(2, 280); ui.frame();
    expect(ui.input.look).toEqual({ x: 0, y: 0 });
    ui.move(2, 300); ui.frame(); expect(ui.input.look.x).toBeCloseTo(.12);
    ui.input.release();
    ui.down(1, 200); ui.down(2, 300); ui.up(2, 300);
    ui.move(1, 210); ui.frame(); expect(ui.input.look.x).toBe(0);
    ui.move(1, 230); ui.frame(); expect(ui.input.look.x).toBeCloseTo(.12);
  } finally { ui.input.dispose(); }
});

test('the disabled switch keeps immediate single-finger drag and ignores a second camera finger', () => {
  features.touchCameraZoom = false;
  const ui = setup();
  try {
    ui.down(1, 200); ui.down(2, 300); ui.move(1, 201); ui.move(2, 350); ui.frame();
    expect(ui.input.look.x).toBeCloseTo(.006);
    expect(ui.surface.captures.size).toBe(1); expect(ui.zoom).not.toHaveBeenCalled();
    ui.input.release(); features.touchCameraZoom = true; features.personalRides = true;
    ui.down(1, 200); ui.down(2, 300); ui.move(2, 350);
    features.touchCameraZoom = false; ui.frame(); expect(ui.zoom).not.toHaveBeenCalled();
  } finally { ui.input.dispose(); }
});

test('camera pinches preserve the walking stick and short action taps', () => {
  const ui = setup();
  try {
    const stick = ui.input.touch.root.querySelector('.stick')!;
    const hail = [...ui.input.touch.root.querySelectorAll<HTMLButtonElement>('button')].find(b => b.dataset.action === 'hail')!;
    ui.event(stick, 'pointerdown', 3, 72, 16);
    ui.down(1, 200); ui.down(2, 300); ui.move(2, 350);
    ui.event(hail, 'pointerdown', 4); ui.event(ui.win, 'pointerup', 4);
    ui.frame();
    expect(ui.input.move.y).toBe(1); expect(ui.input.held('run')).toBe(true);
    expect(ui.input.pressed('hail')).toBe(true); expect(ui.zoom).toHaveBeenCalledTimes(1);
    ui.event(ui.win, 'pointercancel', 1); ui.frame();
    expect(ui.input.move.y).toBe(1); expect(ui.input.pressed('hail')).toBe(false);
    expect(ui.surface.captures.size).toBe(0);
    ui.event(ui.win, 'pointerup', 3); ui.frame(); expect(ui.input.move.y).toBe(0);
  } finally { ui.input.dispose(); }
});

test('modal, mode, hide and blur cancellation discard pending pinch; virtual input excludes it', () => {
  const ui = setup();
  const pinch = () => { ui.down(1, 200); ui.down(2, 300); ui.move(2, 350); };
  try {
    pinch(); const releaseModal = holdFreeCursor();
    try { ui.frame(); } finally { releaseModal(); }
    expect(ui.surface.captures.size).toBe(0); expect(ui.zoom).not.toHaveBeenCalled();
    pinch(); ui.input.touch.setMode('passenger'); ui.frame();
    expect(ui.surface.captures.size).toBe(0); expect(ui.zoom).not.toHaveBeenCalled();
    pinch(); ui.input.touch.show(false); ui.frame();
    expect(ui.surface.captures.size).toBe(0); expect(ui.zoom).not.toHaveBeenCalled();
    ui.input.touch.show(true); pinch(); ui.win.dispatchEvent(new Event('blur')); ui.frame();
    expect(ui.surface.captures.size).toBe(0); expect(ui.zoom).not.toHaveBeenCalled();
    ui.win.dispatchEvent(new Event('focus'));
    pinch(); ui.input.virtual = {}; ui.frame(); expect(ui.zoom).not.toHaveBeenCalled();
    ui.input.virtual = null; ui.frame(); expect(ui.zoom).not.toHaveBeenCalled();
    ui.input.release(); pinch(); ui.frame(); expect(ui.zoom).toHaveBeenCalledTimes(1);
  } finally { ui.input.dispose(); }
});

test('personal ride touch toggle survives a quick tap and is unavailable in vehicles or with flag off', () => {
  const ui = setup();
  try {
    const ride = [...ui.input.touch.root.querySelectorAll<HTMLButtonElement>('button')].find(b => b.dataset.action === 'ride')!;
    const toggle = vi.fn(); ui.input.actions.on('ride', toggle);
    expect(ride.hidden).toBe(false);
    ui.event(ride, 'pointerdown', 9); ui.event(ui.win, 'pointerup', 9); ui.frame();
    expect(toggle).toHaveBeenCalledOnce(); ui.frame(); expect(toggle).toHaveBeenCalledOnce();
    for (const mode of ['driver', 'passenger'] as const) {
      ui.input.touch.setMode(mode); expect(ride.hidden).toBe(true);
      ui.event(ride, 'pointerdown', 10); ui.event(ui.win, 'pointerup', 10); ui.frame();
      expect(toggle).toHaveBeenCalledOnce();
    }
    ui.input.touch.setMode('on-foot'); expect(ride.hidden).toBe(false);
    features.personalRides = false;
    ui.input.touch.setMode('driver'); ui.input.touch.setMode('on-foot');
    expect(ride.hidden).toBe(true);
  } finally { ui.input.dispose(); }
});
