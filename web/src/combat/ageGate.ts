/**
 * GTA V pivot — LANE B (combat & police), step 1: the 18+ click-through gate and the gore toggle.
 *
 * Founder (2026-10-13): real guns, GTA-level blood, behind an 18+ click-through AND a gore toggle.
 *
 * The gate is a ONE-TIME pre-game blocking overlay shown the first time a player loads with the
 * `combat` flag on and has not yet acknowledged they are 18+. It is a plain fixed <div>, fully
 * removed from the DOM on accept — deliberately NOT a <dialog>/showModal(), because a modal dialog
 * that gets display:none'd makes the whole page unclickable (see memory: modal-dialog-inert-trap /
 * the DIALOG-LIFECYCLE hazards). A pre-game consent screen has no reason to persist in the DOM.
 *
 * Acknowledgement and the gore toggle are per-device localStorage, matching the founder-ladder
 * bucket/session convention (best-effort, survives a blocked/throwing Storage).
 */
import { flags } from '@gtasf/shared/flags';
import './combat.css';

// 'ok' = confirmed 18+ (combat shown) · 'declined' = said no (combat hidden, base game untouched).
const AGE_KEY = 'gtasf.combat.age18.v1';
const GORE_KEY = 'gtasf.combat.gore.v1';

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* per-session best effort */ }
}

/** True once the player has clicked through the 18+ gate on this device. */
export function isAgeAcknowledged(): boolean {
  return read(AGE_KEY) === 'ok';
}

/** True if the player declined the 18+ gate on this device (combat stays hidden; base game is unaffected). */
export function isAgeDeclined(): boolean {
  return read(AGE_KEY) === 'declined';
}

/** Forget the stored 18+ choice so the gate shows again (Game Options "Enable mature content"). */
export function resetAgeChoice(): void {
  try { localStorage.removeItem(AGE_KEY); } catch { /* per-session best effort */ }
}

/**
 * Whether blood/gore visuals should render. Requires BOTH the `gore` subsystem flag and the
 * per-device toggle. Default ON once the subsystem is enabled (GTA-level blood is the default
 * past the 18+ gate); the player can turn it off in Game Options.
 */
export function isGoreEnabled(): boolean {
  if (!flags.gore) return false;
  const v = read(GORE_KEY);
  return v === null ? true : v === 'on';
}

/** Persist the gore toggle (Game Options checkbox). */
export function setGoreEnabled(on: boolean): void {
  write(GORE_KEY, on ? 'on' : 'off');
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

export interface AgeGateHandle {
  /** Open while the player still has to click through. */
  isOpen(): boolean;
  /** Remove the overlay and release listeners (idempotent). */
  destroy(): void;
}

export interface AgeGateOptions {
  parent?: HTMLElement;
  /** Called once the player has confirmed 18+ (or immediately if combat is off / already acknowledged). */
  onAccept(): void;
  /**
   * Called when the player declines (or on load if they previously declined). The gate removes itself
   * either way — declining NEVER blocks the base game, it just leaves combat uninitialised. `explicit`
   * is true only for a fresh click on "Leave" (so callers can toast once, but stay quiet on reload).
   */
  onDecline?(explicit: boolean): void;
}

/**
 * Show the 18+ gate if needed. If the `combat` flag is off or the player has already acknowledged,
 * this is a no-op that resolves `onAccept` on the next microtask so callers can treat it uniformly.
 */
export function createAgeGate(options: AgeGateOptions): AgeGateHandle {
  const parent = options.parent ?? document.body;

  if (!flags.combat || isAgeAcknowledged()) {
    queueMicrotask(() => options.onAccept());
    return { isOpen: () => false, destroy() { /* nothing mounted */ } };
  }
  if (isAgeDeclined()) {
    // Previously declined on this device: keep combat hidden, leave the rest of the game fully playable.
    queueMicrotask(() => options.onDecline?.(false));
    return { isOpen: () => false, destroy() { /* nothing mounted */ } };
  }

  let open = true;
  const overlay = el('div', 'gt-age-gate');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'gt-age-gate-title');

  const card = el('div', 'gt-age-gate-card');
  const kicker = el('div', 'gt-age-gate-kicker', 'MATURE CONTENT · 18+');
  const title = el('h2', 'gt-age-gate-title', 'Grand Tech Auto contains violence');
  title.id = 'gt-age-gate-title';
  const body = el('p', 'gt-age-gate-body',
    'This game features firearms, gunfights and realistic blood. Please confirm you are 18 or older to continue.');

  const goreRow = el('label', 'gt-age-gate-gore');
  const goreBox = el('input', 'gt-age-gate-gore-box');
  goreBox.type = 'checkbox';
  goreBox.checked = true;
  const goreText = el('span', 'gt-age-gate-gore-text', 'Show blood and gore (you can change this later in Game Options)');
  goreRow.append(goreBox, goreText);

  const actions = el('div', 'gt-age-gate-actions');
  const enter = el('button', 'gt-age-gate-enter', 'I am 18 or older — Enter');
  enter.type = 'button';
  const leave = el('button', 'gt-age-gate-leave', 'Play without combat');
  leave.type = 'button';
  actions.append(enter, leave);

  card.append(kicker, title, body, goreRow, actions);
  overlay.append(card);
  parent.append(overlay);

  function destroy(): void {
    if (!open) return;
    open = false;
    enter.removeEventListener('click', onEnter);
    leave.removeEventListener('click', onLeave);
    overlay.remove();
  }

  function onEnter(): void {
    write(AGE_KEY, 'ok');
    setGoreEnabled(goreBox.checked);
    destroy();
    options.onAccept();
  }

  function onLeave(): void {
    // Declining must NEVER trap the player in the mature-content wall: remember the choice, remove the
    // overlay, and hand back to the caller, which leaves combat uninitialised and the base game running.
    write(AGE_KEY, 'declined');
    destroy();
    options.onDecline?.(true);
  }

  enter.addEventListener('click', onEnter);
  leave.addEventListener('click', onLeave);
  // Focus the primary action for keyboard/switch users.
  queueMicrotask(() => { try { enter.focus(); } catch { /* not focusable yet */ } });

  return { isOpen: () => open, destroy };
}
