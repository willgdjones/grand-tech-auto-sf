/**
 * GTASF time-trial HUD (docs/PLAN-gta-pivot.md LANE C). A self-contained race-timer banner, shown only while a
 * trial runs. It subscribes to the runner's `onState`: main.ts forwards each state here and the HUD does the rest
 * — it re-syncs its clock to the run's `elapsedMs` on every state and ticks it live on its own interval, so
 * main.ts never has to drive the timer per frame. The clock reads gold while still under par, red once over.
 * Mounted behind flags.timeTrials; hidden (and the tick stopped) whenever there's no active run.
 */
import type { TimeTrialState } from './timeTrialRunner';
import './timeTrialHud.css';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node;
}

/** mm:ss.cs (centiseconds) — a tight race clock. */
function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalCs = Math.floor(clamped / 10);
  const cs = totalCs % 100;
  const totalS = Math.floor(totalCs / 100);
  const s = totalS % 60;
  const m = Math.floor(totalS / 60);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${m}:${pad(s)}.${pad(cs)}`;
}

export interface TimeTrialHud {
  readonly element: HTMLElement;
  /** Show + update for an active run, or hide + stop the clock when `null`. */
  setState(state: TimeTrialState | null): void;
  /** The live "vs best" gap to the personal-best ghost (ms; + behind, − ahead), or null to hide it. */
  setDelta(deltaMs: number | null): void;
  dispose(): void;
}

export function createTimeTrialHud(opts: { parent?: HTMLElement; now?: () => number; onCancel?: () => void } = {}): TimeTrialHud {
  const parent = opts.parent ?? document.body;
  const now = opts.now ?? (() => performance.now());
  const root = el('section', 'gt-tt-hud'); root.hidden = true;
  root.setAttribute('aria-label', 'Time trial');
  const title = el('div', 'gt-tt-hud-title');
  const clock = el('div', 'gt-tt-hud-clock', '0:00.00');
  const meta = el('div', 'gt-tt-hud-meta');
  const delta = el('div', 'gt-tt-hud-delta'); delta.hidden = true; // "vs best" gap against the personal-best ghost
  // Abandon button: the banner itself is pointer-events:none so it never eats game input, but this button opts
  // back in (CSS) so a player can quit a run they started — the only clean way out otherwise is to finish or
  // change mode. Most needed on touch (no keyboard, and an accidental Interact near a 'T' marker starts a run).
  const cancel = el('button', 'gt-tt-hud-cancel', 'Abandon run'); cancel.type = 'button';
  cancel.setAttribute('aria-label', 'Abandon this time trial');
  cancel.addEventListener('click', event => { event.stopPropagation(); opts.onCancel?.(); });
  root.append(title, clock, meta, delta, cancel);
  parent.append(root);

  let state: TimeTrialState | null = null;
  let startRef = 0;         // now() value the run's clock is zeroed at (re-synced each setState)
  let tick: number | undefined;

  function render(): void {
    if (!state) return;
    const elapsed = now() - startRef;
    clock.textContent = formatClock(elapsed);
    const over = elapsed > state.parMs;
    clock.classList.toggle('is-under', !over);
    clock.classList.toggle('is-over', over);
  }
  function stopTick(): void { if (tick !== undefined) { clearInterval(tick); tick = undefined; } }

  return {
    element: root,
    setState(next) {
      if (!next) { state = null; stopTick(); root.hidden = true; return; }
      state = next;
      // Re-sync the local clock to the runner's authoritative elapsed (handles gate crossings + any drift).
      startRef = now() - next.elapsedMs;
      title.textContent = next.spec.title;
      meta.innerHTML = `Gate <b>${Math.min(next.gateIndex + 1, next.gatesTotal)}/${next.gatesTotal}</b> · par ${formatClock(next.parMs)}`;
      delta.hidden = true; // reset per run; main.ts feeds the live "vs best" via setDelta when a ghost exists
      root.hidden = false;
      render();
      if (tick === undefined) tick = window.setInterval(render, 60);
    },
    setDelta(deltaMs) {
      if (deltaMs == null) { delta.hidden = true; return; }
      const behind = deltaMs > 0;
      delta.hidden = false;
      delta.textContent = `vs best ${behind ? '+' : '−'}${formatClock(Math.abs(deltaMs))}`;
      delta.classList.toggle('is-behind', behind);
      delta.classList.toggle('is-ahead', !behind);
    },
    dispose() { stopTick(); root.remove(); },
  };
}
