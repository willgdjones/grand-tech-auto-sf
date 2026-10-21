import { afterEach, describe, expect, it } from 'vitest';
import { createRenderDebug, wantsRenderDebug, type RenderDebugInfo } from './renderDebug';

const REALISTIC: RenderDebugInfo = {
  active: 'realistic', preset: 'hd', toneMapping: 'ACESFilmic', outputColorSpace: 'sRGB',
  shadows: true, ibl: true, iblSource: 'procedural (golden)', realisticFacades: true, storefronts: true,
  post: 'realistic/hd: SSAO+bloom+ACES+SMAA',
};
const PS2: RenderDebugInfo = {
  active: 'ps2', preset: 'hd', toneMapping: 'None', outputColorSpace: 'sRGB',
  shadows: false, ibl: false, iblSource: 'none', realisticFacades: false, storefronts: false,
  post: 'ps2 post (bloom+grade)',
};

describe('wantsRenderDebug', () => {
  it('is true only for ?debug=render', () => {
    expect(wantsRenderDebug('?debug=render')).toBe(true);
    expect(wantsRenderDebug('?gfx=hd&debug=render&time=golden')).toBe(true);
    expect(wantsRenderDebug('?debug=perf')).toBe(false);
    expect(wantsRenderDebug('?gfx=hd')).toBe(false);
    expect(wantsRenderDebug('')).toBe(false);
  });
});

// Minimal DOM stub covering exactly what the overlay touches (createElement/id/setAttribute/style/
// textContent/appendChild/remove). Keeps the test off a browser per the lane check budget; the
// on-screen look is verified in-browser by pane 6.
function withStubDom<T>(run: () => T): T {
  const saved = (globalThis as { document?: unknown }).document;
  const body = { children: [] as unknown[], appendChild(n: unknown) { this.children.push(n); } };
  const makeEl = () => ({
    id: '', textContent: '', style: {} as Record<string, string>,
    setAttribute() {}, remove() { body.children = body.children.filter(c => c !== this); },
  });
  (globalThis as { document?: unknown }).document = { body, createElement: () => makeEl() };
  try { return run(); } finally {
    if (saved === undefined) delete (globalThis as { document?: unknown }).document;
    else (globalThis as { document?: unknown }).document = saved;
  }
}

describe('createRenderDebug', () => {
  afterEach(() => { /* withStubDom restores document itself */ });

  it('returns null when disabled (no overlay, zero cost)', () => {
    expect(createRenderDebug(false, () => REALISTIC)).toBeNull();
  });

  it('mounts an overlay showing the active renderer, and removes it on dispose', () => {
    withStubDom(() => {
      const body = (globalThis as unknown as { document: { body: { children: { textContent: string }[] } } }).document.body;
      const dbg = createRenderDebug(true, () => REALISTIC);
      expect(dbg).not.toBeNull();
      expect(body.children).toHaveLength(1);
      expect(body.children[0]!.textContent).toContain('RENDERER: REALISTIC');
      expect(body.children[0]!.textContent).toContain('ACESFilmic');
      expect(body.children[0]!.textContent).toContain('SSAO+bloom+ACES+SMAA');
      dbg!.dispose();
      expect(body.children).toHaveLength(0);
    });
  });

  it('labels a ps2 fallback distinctly (so a silent fallback is obvious)', () => {
    withStubDom(() => {
      const body = (globalThis as unknown as { document: { body: { children: { textContent: string }[] } } }).document.body;
      createRenderDebug(true, () => PS2);
      expect(body.children[0]!.textContent).toContain('RENDERER: PS2');
      expect(body.children[0]!.textContent).not.toContain('REALISTIC');
    });
  });
});
