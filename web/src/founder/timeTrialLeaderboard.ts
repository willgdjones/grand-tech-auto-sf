/**
 * GTASF time-trial daily leaderboard panel (docs/PLAN-gta-pivot.md LANE C). A self-contained board surface: give
 * it a route title + the day's TimeTrialRecords and it renders the ranked best times (fastest first), highlighting
 * the viewer's row. Headless of the 3D scene + the server — main.ts fetches the board (the WorldDO handler reads
 * the daily D1 table) and calls setBoard; this module only renders. Shown after a run or toggled on demand.
 * Mounted behind flags.timeTrials; hidden otherwise.
 */
import type { TimeTrialRecord } from '@gtasf/shared/founder/timeTrials';
import './timeTrialLeaderboard.css';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node;
}

/** mm:ss.cs — matches the race HUD clock. */
function formatClock(ms: number): string {
  const totalCs = Math.floor(Math.max(0, ms) / 10);
  const cs = totalCs % 100, totalS = Math.floor(totalCs / 100), s = totalS % 60, m = Math.floor(totalS / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${m}:${pad(s)}.${pad(cs)}`;
}

export interface TimeTrialLeaderboard {
  readonly element: HTMLElement;
  readonly isOpen: boolean;
  /** Render the daily board for a route. Records need not be pre-sorted; `youDeviceId` highlights the viewer. */
  setBoard(routeTitle: string, records: readonly TimeTrialRecord[], youDeviceId?: string): void;
  show(): void;
  hide(): void;
  toggle(): void;
  dispose(): void;
}

export function createTimeTrialLeaderboard(deps: { parent?: HTMLElement; limit?: number; autoHideMs?: number } = {}): TimeTrialLeaderboard {
  const parent = deps.parent ?? document.body;
  const limit = deps.limit ?? 10;
  const root = el('section', 'gt-tt-board'); root.hidden = true;
  root.setAttribute('aria-label', 'Time trial leaderboard');
  const header = el('div', 'gt-tt-board-header', 'DAILY BEST');
  const list = el('ul', 'gt-tt-board-list');
  const close = el('button', 'gt-tt-board-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close leaderboard');
  root.append(close, header, list);
  parent.append(root);

  function setBoard(routeTitle: string, records: readonly TimeTrialRecord[], youDeviceId?: string): void {
    header.textContent = `Daily Best — ${routeTitle}`;
    list.replaceChildren();
    const ranked = [...records].sort((a, b) => a.ms - b.ms).slice(0, limit);
    if (ranked.length === 0) {
      list.append(el('li', 'gt-tt-board-empty', 'No times yet today — set the pace.'));
      return;
    }
    ranked.forEach((rec, i) => {
      const row = el('li', 'gt-tt-board-row');
      if (youDeviceId && rec.deviceId === youDeviceId) row.classList.add('is-you');
      row.append(
        el('span', 'gt-tt-board-rank', String(i + 1)),
        el('span', 'gt-tt-board-name', rec.name || 'Anon'),
        el('span', 'gt-tt-board-time', formatClock(rec.ms)),
      );
      list.append(row);
    });
  }
  // The post-run board is a result card, not a permanent panel: it auto-hides so it never parks over the HUD. [gtasf-qa]
  const autoHideMs = deps.autoHideMs ?? 20_000;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  function show(): void {
    root.hidden = false;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = autoHideMs > 0 ? setTimeout(hide, autoHideMs) : null;
  }
  function hide(): void { root.hidden = true; if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } }
  close.addEventListener('click', hide);

  let disposed = false;
  return {
    element: root,
    get isOpen() { return !root.hidden; },
    setBoard, show, hide,
    toggle() { if (root.hidden) show(); else hide(); },
    dispose() { if (disposed) return; disposed = true; hide(); root.remove(); },
  };
}
