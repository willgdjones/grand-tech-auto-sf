/**
 * Persistent controls panel (flag guidedOpener, gtasf-dzrrn). A small key-cap legend — WASD move, Shift run, E enter /
 * talk, and the combat keys (F fire, right mouse aim, Z lock) when those features are on — shown every session until
 * the player dismisses it (remembered per device under DISMISS_KEY). Touch devices get the touch equivalents.
 * Pure DOM; it is not part of the founder HUD lock, so it stays visible through the first-run spine.
 */
import './controlsPanel.css';

export const CONTROLS_DISMISS_KEY = 'gtasf.controlsPanel.dismissed.v1';

export interface ControlsPanelDeps {
  parent?: HTMLElement;
  isTouch: boolean;
  /** Show the combat rows (F / right mouse / Z). The caller passes its combat flags; the panel doesn't depend on them. */
  combat: boolean;
  /** Show the Z lock-on row (aimControls). */
  lockOn: boolean;
}

export interface ControlsPanel {
  readonly element: HTMLElement;
  readonly visible: boolean;
  destroy(): void;
}

function dismissed(): boolean {
  try { return localStorage.getItem(CONTROLS_DISMISS_KEY) !== null; } catch { return false; }
}

export function createControlsPanel(deps: ControlsPanelDeps): ControlsPanel | null {
  if (dismissed()) return null;
  // A div, not <aside>: style.css styles every aside as a fixed flex row with an outline text-shadow.
  const root = document.createElement('div'); root.className = 'gt-controls-panel';
  root.setAttribute('role', 'complementary'); root.setAttribute('aria-label', 'Controls');
  const head = document.createElement('div'); head.className = 'gt-controls-panel-head';
  const title = document.createElement('span'); title.textContent = 'CONTROLS';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'gt-controls-panel-close';
  close.textContent = '×'; close.title = 'Hide controls'; close.setAttribute('aria-label', 'Hide controls');
  head.append(title, close);
  const list = document.createElement('dl'); list.className = 'gt-controls-panel-list';
  const rows: [string[], string][] = deps.isTouch
    ? [[['Stick'], 'Move'], [['Drag'], 'Look'], [['Enter / exit'], 'Get in · talk'], ...(deps.combat ? [[['FIRE'], 'Shoot (drag to aim)']] as [string[], string][] : [])]
    : [[['W', 'A', 'S', 'D'], 'Move · drive'], [['Shift'], 'Run'], [['E'], 'Enter car · talk'], [['Space'], 'Handbrake'],
      ...(deps.combat ? [[['F'], 'Fire'], [['Right mouse'], 'Aim']] as [string[], string][] : []),
      ...(deps.combat && deps.lockOn ? [[['Z'], 'Lock target']] as [string[], string][] : [])];
  for (const [keys, label] of rows) {
    const dt = document.createElement('dt');
    for (const k of keys) { const kbd = document.createElement('kbd'); kbd.textContent = k; dt.append(kbd); }
    const dd = document.createElement('dd'); dd.textContent = label;
    list.append(dt, dd);
  }
  root.append(head, list);
  (deps.parent ?? document.body).append(root);
  let gone = false;
  close.addEventListener('click', () => {
    try { localStorage.setItem(CONTROLS_DISMISS_KEY, String(Date.now())); } catch { /* best effort */ }
    gone = true; root.remove();
  });
  return {
    element: root,
    get visible() { return !gone; },
    destroy() { gone = true; root.remove(); },
  };
}
