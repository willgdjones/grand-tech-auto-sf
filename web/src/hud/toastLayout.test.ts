import { afterEach, expect, test, vi } from 'vitest';
import { layoutToasts } from './toastLayout';

// Exercise observer scheduling without starting a browser or measuring performance.
class AttributeNode {
  readonly attributes = new Map<string, string>();
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
}

function setup() {
  const callbacks = new Map<number, FrameRequestCallback>();
  const mutations: Observer[] = [];
  let serial = 0;
  class Observer {
    readonly targets = new Map<AttributeNode, MutationObserverInit>();
    constructor(readonly callback: MutationCallback) { mutations.push(this); }
    observe(target: AttributeNode, options: MutationObserverInit) { this.targets.set(target, options); }
    disconnect() { this.targets.clear(); }
  }
  const resizes: Resize[] = [];
  class Resize {
    active = true;
    constructor(readonly callback: ResizeObserverCallback) { resizes.push(this); }
    observe() {}
    disconnect() { this.active = false; }
  }
  const body = new AttributeNode(), hud = new AttributeNode();
  hud.attributes.set('hidden', '');
  body.attributes.set('class', 'gt-phone-hud');
  body.attributes.set('style', '--gt-phone-notice-height:0px');
  Object.assign(hud, {
    checkVisibility: () => hud.getAttribute('hidden') === null,
    getBoundingClientRect: () => ({ left: 0, right: 800, top: 0, bottom: 200, width: 800, height: 200 }),
  });
  const toast = {
    childElementCount: 1, dataset: {} as Record<string, string>, style: {} as Record<string, string>,
    getBoundingClientRect: () => ({ height: 44 }),
  };
  const query = vi.fn(() => [hud]);
  const viewport = new EventTarget();
  vi.stubGlobal('MutationObserver', Observer);
  vi.stubGlobal('ResizeObserver', Resize);
  vi.stubGlobal('document', { body, querySelectorAll: query });
  vi.stubGlobal('window', viewport);
  vi.stubGlobal('innerWidth', 800); vi.stubGlobal('innerHeight', 600);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++serial, callback); return serial; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  const layout = layoutToasts(toast as unknown as HTMLElement);
  const mutate = (target: AttributeNode, name: string, value: string | null) => {
    const previous = target.getAttribute(name);
    if (value === null) target.attributes.delete(name); else target.attributes.set(name, value);
    for (const observer of mutations) {
      const options = observer.targets.get(target);
      if (!options?.attributeFilter?.includes(name)) continue;
      const record = { type: 'attributes', target, attributeName: name,
        oldValue: options.attributeOldValue ? previous : null } as unknown as MutationRecord;
      observer.callback([record], observer as unknown as MutationObserver);
    }
  };
  const frame = () => { const pending = [...callbacks.values()]; callbacks.clear(); for (const callback of pending) callback(16); };
  const resize = () => { for (const observer of resizes) if (observer.active) observer.callback([], observer as unknown as ResizeObserver); };
  return { layout, body, hud, toast, query, callbacks, viewport, mutate, frame, resize };
}

afterEach(() => vi.unstubAllGlobals());

test('repeated hidden/body values leave an award in place; revealing an obstacle still repositions it', () => {
  const ui = setup();
  try {
    ui.layout.update(); ui.frame();
    expect(ui.toast.dataset.placed).toBe('true');
    const initial = { ...ui.toast.style };
    for (let frame = 0; frame < 120; frame++) {
      ui.mutate(ui.hud, 'hidden', '');
      ui.mutate(ui.body, 'class', 'gt-phone-hud');
      ui.mutate(ui.body, 'style', '--gt-phone-notice-height:0px');
      ui.frame();
    }
    expect(ui.query).toHaveBeenCalledTimes(1);
    expect(ui.toast.style).toEqual(initial);
    ui.mutate(ui.hud, 'hidden', null);
    expect(ui.callbacks.size).toBe(1); ui.frame();
    expect(ui.query).toHaveBeenCalledTimes(2);
    expect(ui.toast.dataset.placed).toBe('true');
    expect(Number.parseFloat(ui.toast.style.top!)).toBeGreaterThanOrEqual(200);
  } finally { ui.layout.dispose(); }
});

test('real body changes and resize remain batched, and disposal cancels pending placement', () => {
  const ui = setup();
  ui.layout.update(); ui.frame();
  ui.mutate(ui.body, 'style', '--gt-phone-notice-height:60px');
  ui.mutate(ui.body, 'class', 'gt-phone-hud gt-compact-hud');
  ui.resize(); ui.viewport.dispatchEvent(new Event('resize'));
  expect(ui.callbacks.size).toBe(1); ui.frame();
  expect(ui.query).toHaveBeenCalledTimes(2);
  ui.mutate(ui.hud, 'hidden', null);
  expect(ui.callbacks.size).toBe(1);
  ui.layout.dispose();
  expect(ui.callbacks.size).toBe(0);
  ui.resize(); ui.viewport.dispatchEvent(new Event('resize'));
  ui.mutate(ui.body, 'class', 'gt-phone-hud'); ui.frame();
  expect(ui.query).toHaveBeenCalledTimes(2);
});
