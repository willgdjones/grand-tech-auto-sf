import './toast.css';
import { layoutToasts } from './toastLayout';

/**
 * A non-modal SA-style HUD toast stack (founder playtest 2026-10-03: **notifications must never
 * block movement**). The container is `pointer-events: none`, so it can never capture input; it
 * never touches pointer lock, never opens a dialog, and is fully decoupled from the game loop —
 * each toast auto-dismisses after `durationMs` via a CSS fade. Awards stack (newest at the bottom),
 * capped at `max`, oldest dropped first. Used for drive-through event payouts, VC fund-drop cheques
 * and celebrity-angel pitches so passing through a marker never stops the player.
 */
export interface ToastInput {
  /** Big readable line: the event/fund name, or "<name> (parody)". */
  readonly title: string;
  /** Optional amount line, e.g. "+$2.0M". */
  readonly amount?: string;
  /** Visual accent only. 'downround' is the red demotion accent (economy v3 down rounds). */
  readonly tone?: 'award' | 'event' | 'drop' | 'info' | 'downround';
  /** Optional sub-line (e.g. a parody quip or "SERIES C CLOSED"). */
  readonly detail?: string;
}

export interface Toasts {
  readonly element: HTMLElement;
  /** Show a toast. Never captures input, pauses the loop, or opens a dialog. De-dupes a rapid repeat. */
  show(toast: ToastInput): void;
  /** Transient action feedback: replace the previous notice, preserve award cards. */
  notice(text: string, durationMs?: number): void;
  /** Fade out the current action notice if it is still showing `text` (critic N15: the shoot hint after the first shot). */
  dismissNotice(text: string): void;
  clear(): void;
  dispose(): void;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (className) el.className = className;
  return el;
}

export function createToasts(options: { parent?: HTMLElement; durationMs?: number; max?: number } = {}): Toasts {
  const parent = options.parent ?? document.body;
  const durationMs = Math.max(1000, options.durationMs ?? 3000);
  const max = Math.max(1, options.max ?? 4);

  const element = node('div', '', 'gt-toasts');
  // Announce politely for screen readers, but never steal focus/input.
  element.setAttribute('aria-live', 'polite');
  element.setAttribute('aria-atomic', 'false');
  parent.append(element);
  const layout = layoutToasts(element);

  let disposed = false;
  let notice: HTMLElement | undefined;
  let lastKey = '';
  let lastAt = -Infinity;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function dismiss(el: HTMLElement) {
    if (!el.isConnected) return;
    el.classList.remove('gt-toast-in');
    el.classList.add('gt-toast-out');
    const done = setTimeout(() => { el.remove(); timers.delete(done); layout.update(); }, 440);
    timers.add(done);
  }

  function show(toast: ToastInput, actionNotice = false, lifetime = durationMs): void {
    if (disposed) return;
    const title = (toast.title ?? '').trim();
    if (!title) return;
    const now = performance.now();
    // De-dupe an identical toast fired within ~800 ms (e.g. a double award callback).
    const key = `${actionNotice}|${title}|${toast.amount ?? ''}|${toast.detail ?? ''}`;
    if (key === lastKey && now - lastAt < 800) return;
    lastKey = key; lastAt = now;

    if (actionNotice) notice?.remove();
    const el = node('div', '', `gt-toast gt-toast-${toast.tone ?? 'info'}${actionNotice ? ' gt-toast-notice' : ''}`);
    if (actionNotice) notice = el;
    el.append(node('p', title, 'gt-toast-title'));
    if (toast.amount) el.append(node('p', toast.amount, 'gt-toast-amount'));
    if (toast.detail) el.append(node('p', toast.detail, 'gt-toast-detail'));
    element.append(el);
    // Cap the stack, dropping the oldest first.
    while (element.childElementCount > max) element.firstElementChild?.remove();
    layout.update();
    // Enter on the next frame so the transition runs; fall back to an immediate class if rAF is unavailable.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => el.classList.add('gt-toast-in'));
    else el.classList.add('gt-toast-in');
    const life = setTimeout(() => { dismiss(el); timers.delete(life); }, Math.max(1000, lifetime));
    timers.add(life);
  }

  return {
    element,
    show,
    notice(text, milliseconds) { show({ title: text, tone: 'info' }, true, milliseconds ?? durationMs); },
    dismissNotice(text) { if (notice?.isConnected && notice.querySelector('.gt-toast-title')?.textContent === text) dismiss(notice); },
    clear() { for (const t of timers) clearTimeout(t); timers.clear(); element.replaceChildren(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      layout.dispose();
      element.remove();
    },
  };
}
