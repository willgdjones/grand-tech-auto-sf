/**
 * Graphics quality preset (pane 9, founder realistic-renderer direction).
 *
 * Two presets drive the renderer: `hd` (realistic — shadows, PBR, SSAO, full resolution) and `low`
 * (fast — no shadows/SSAO, lower resolution, simpler materials; still tone-mapped and colourful).
 * The player's choice is one of three modes: `auto` (default — pick from the device, and auto-downgrade
 * to `low` if the measured FPS stays low), `hd`, or `low`. The effective preset is resolved from, in
 * priority: the `?gfx=hd|low` URL override (for testing), then the stored mode (device-remembered),
 * then — in `auto` — a device heuristic. Nothing here renders; the renderer and the Game-options
 * toggle read these.
 */
export type GraphicsPreset = 'hd' | 'low';
export type GraphicsMode = 'auto' | 'hd' | 'low';

const STORAGE_KEY = 'gtasf.gfx';

function parseGfx(raw: string | null | undefined): GraphicsPreset | undefined {
  const key = raw?.trim().toLowerCase();
  return key === 'hd' || key === 'low' ? key : undefined;
}

/** Device heuristic for Auto: phones / small or coarse-pointer screens / weak devices → Low, else HD. */
export function detectAutoPreset(): GraphicsPreset {
  try {
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    const smallest = typeof screen !== 'undefined' ? Math.min(screen.width || 9999, screen.height || 9999) : 9999;
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 8 : 8;
    const mem = typeof navigator !== 'undefined' ? ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) : 8;
    return (coarse || smallest <= 820 || cores <= 4 || mem <= 4) ? 'low' : 'hd';
  } catch { return 'hd'; }
}

/** The player's stored Graphics mode ('auto' by default / when unset or storage unavailable). */
export function graphicsMode(): GraphicsMode {
  try { const v = localStorage.getItem(STORAGE_KEY); return v === 'hd' || v === 'low' || v === 'auto' ? v : 'auto'; } catch { return 'auto'; }
}

/** Persist the Graphics choice per device ('auto' clears to re-detect). */
export function setGraphics(mode: GraphicsMode): void {
  try { if (mode === 'auto') localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, mode); } catch { /* storage unavailable */ }
}

function urlPreset(search: string): GraphicsPreset | undefined {
  try {
    const params = new URLSearchParams(search);
    return parseGfx(params.get('gfx')) ?? (params.get('preset') === 'low' ? 'low' : undefined);
  } catch { return undefined; }
}

/** Menu mode reflects an explicit URL quality choice, while preserving Auto otherwise. */
export function activeGraphicsMode(): GraphicsMode {
  return urlPreset(typeof location !== 'undefined' ? location.search : '') ?? graphicsMode();
}

/** URL gfx choice > legacy preset=low > stored choice > Auto device heuristic. */
export function graphicsPreset(search: string = typeof location !== 'undefined' ? location.search : ''): GraphicsPreset {
  const fromUrl = urlPreset(search);
  if (fromUrl) return fromUrl;
  const mode = graphicsMode();
  return mode === 'auto' ? detectAutoPreset() : mode;
}

/**
 * Watches real frame times; while in **Auto** mode and currently resolving to **HD**, if the smoothed
 * FPS stays under `threshold` (~40) for `windowMs` (~5 s), it persists `low` and calls `onDowngrade`
 * once (the caller shows the toast and applies — typically a reload). An explicit HD/Low choice or a
 * URL `?gfx=` override is respected (no auto-downgrade). Self-contained requestAnimationFrame loop.
 */
export function createGraphicsAutoDowngrade(
  onDowngrade: () => void,
  opts: { threshold?: number; windowMs?: number; now?: () => number } = {},
): { stop(): void } {
  const threshold = opts.threshold ?? 40, windowMs = opts.windowMs ?? 5000;
  if (typeof requestAnimationFrame === 'undefined') return { stop() {} };
  // A reload cannot override an explicit URL choice. Leave both the preset and
  // the saved preference alone instead of reloading straight back into HD.
  if (urlPreset(typeof location !== 'undefined' ? location.search : '')) return { stop() {} };
  let last = 0, emaDt = 0, belowSince = 0, raf = 0, stopped = false, fired = false;
  // Background RAF is paused/throttled, not evidence of slow rendering. Reset on
  // both transitions so the first visible frame starts a fresh measurement window.
  const visibility = typeof document !== 'undefined' ? document : undefined;
  const resetTiming = () => { last = 0; emaDt = 0; belowSince = 0; };
  visibility?.addEventListener('visibilitychange', resetTiming);
  // Only meaningful when the player opted into Auto and it currently runs HD.
  const watching = () => !fired && graphicsMode() === 'auto' && graphicsPreset() === 'hd';
  const frame = (t: number) => {
    if (stopped) return;
    if (visibility?.hidden) {
      resetTiming();
      raf = requestAnimationFrame(frame);
      return;
    }
    if (last && watching()) {
      const dt = t - last;
      emaDt = emaDt ? emaDt + (dt - emaDt) * 0.1 : dt;
      const fps = 1000 / Math.max(1, emaDt);
      if (fps < threshold) {
        if (!belowSince) belowSince = t;
        else if (t - belowSince >= windowMs) { fired = true; setGraphics('low'); onDowngrade(); }
      } else belowSince = 0;
    } else { belowSince = 0; emaDt = 0; }
    last = t;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return { stop() {
    stopped = true; cancelAnimationFrame(raf);
    visibility?.removeEventListener('visibilitychange', resetTiming);
  } };
}
