// `?debug=render` on-screen readout: makes the ACTIVE renderer and its passes visible, so you can
// tell at a glance whether realisticRender actually engaged (PBR + IBL + ACES + SSAO/SMAA/shadows on
// HD) or silently fell back to the ps2 path. Built for the deploy-#6 verification (orchestrator): a
// real-GPU before/after looked near-identical, and this removes the guesswork. Purely gated on the
// URL param — `createRenderDebug` returns null (zero cost) unless `?debug=render` is present.

export interface RenderDebugInfo {
  active: 'realistic' | 'ps2';
  preset: string;
  toneMapping: string;
  outputColorSpace: string;
  shadows: boolean;
  ibl: boolean;
  iblSource: string;
  realisticFacades: boolean;
  storefronts: boolean;
  post: string;
}

export interface RenderDebug {
  /** Refresh the overlay from the current render state. Throttled; safe to call every frame. */
  update(): void;
  dispose(): void;
}

/** True when the page asked for the render debug overlay (`?debug=render`). */
export function wantsRenderDebug(search = typeof location === 'undefined' ? '' : location.search): boolean {
  try { return new URLSearchParams(search).get('debug') === 'render'; } catch { return false; }
}

export function createRenderDebug(enabled: boolean, get: () => RenderDebugInfo): RenderDebug | null {
  if (!enabled || typeof document === 'undefined' || !document.body) return null;
  const el = document.createElement('div');
  el.id = 'gt-render-debug';
  el.setAttribute('style', [
    'position:fixed', 'left:12px', 'bottom:12px', 'z-index:9999',
    'font:11px/1.55 ui-monospace,Menlo,Consolas,monospace',
    'background:rgba(0,0,0,.82)', 'border:1px solid #2c7', 'border-radius:4px',
    'padding:8px 11px', 'white-space:pre', 'pointer-events:none', 'max-width:52vw',
    'letter-spacing:.2px',
  ].join(';'));
  document.body.appendChild(el);
  const yn = (b: boolean) => (b ? 'ON ' : 'off');
  let last = -Infinity;
  function paint(): void {
    const i = get();
    const realistic = i.active === 'realistic';
    el.textContent = [
      `RENDERER: ${i.active.toUpperCase()}   preset=${i.preset}`,
      `  tonemap    ${i.toneMapping}`,
      `  colorspace ${i.outputColorSpace}`,
      `  IBL env    ${yn(i.ibl)} (${i.iblSource})`,
      `  shadows    ${yn(i.shadows)}`,
      `  post       ${i.post}`,
      `  facades    ${yn(i.realisticFacades)}  storefronts ${yn(i.storefronts)}`,
    ].join('\n');
    el.style.borderColor = realistic ? '#2c7' : '#d86';
    el.style.color = realistic ? '#bdf5c8' : '#f3cba6';
  }
  paint();
  return {
    update(): void {
      const now = typeof performance === 'undefined' ? Date.now() : performance.now();
      if (now - last < 500) return;
      last = now;
      paint();
    },
    dispose(): void { el.remove(); },
  };
}
