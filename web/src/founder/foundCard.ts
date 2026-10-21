/**
 * The found-your-startup card (PLAN step 2: "a full-screen card rolls a name with 🎲 reroll and
 * ✅ found. The stage is set to Idea, at a $0 valuation"). Generated names only — no typing, no
 * moderation risk. A <dialog> so it traps focus and the controller can pause movement while it is up.
 */
import { IDEA_STAGE } from '@gtasf/shared/founder/ladder';
import { lettermark } from './logo';
import { rerollStartupName, rollStartupName } from './rollName';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node;
}

export interface FoundCardOptions {
  parent?: HTMLElement;
  /** Persist the chosen name (funding profile save). Resolves once the startup is founded. */
  onFound(startupName: string): Promise<void> | void;
  /** Injectable for tests/determinism; defaults to Math.random. */
  rng?: () => number;
}

export interface FoundCard {
  readonly element: HTMLDialogElement;
  readonly name: string;
  readonly isOpen: boolean;
  show(): void;
  destroy(): void;
}

export function createFoundCard(options: FoundCardOptions): FoundCard {
  const parent = options.parent ?? document.body;
  const rng = options.rng ?? Math.random;
  const dialog = el('dialog', 'gt-founder-found');
  dialog.setAttribute('aria-labelledby', 'gt-founder-found-title');

  const badge = el('div', 'gt-founder-found-badge');
  const name = el('h2', 'gt-founder-found-name'); name.id = 'gt-founder-found-title';
  const stage = el('p', 'gt-founder-found-stage');
  const actions = el('div', 'gt-founder-found-actions');
  const reroll = el('button', 'gt-founder-found-reroll', '🎲 Reroll'); reroll.type = 'button';
  const found = el('button', 'gt-founder-found-go', '✅ Found it'); found.type = 'button';
  const status = el('p', 'gt-founder-found-status'); status.setAttribute('role', 'status');
  actions.append(reroll, found);
  dialog.append(
    el('div', 'gt-founder-found-kicker', 'FOUND YOUR STARTUP'),
    badge, name, stage, actions, status,
  );
  parent.append(dialog);

  let current = rollStartupName(rng);
  let saving = false, disposed = false;
  function paint(): void {
    const mark = lettermark(current);
    badge.textContent = mark.initials;
    badge.style.background = mark.bg;
    badge.style.color = mark.fg;
    name.textContent = current;
    stage.textContent = `Stage: ${IDEA_STAGE.label} · $0 valuation`;
  }
  paint();

  reroll.addEventListener('click', () => {
    if (saving || disposed) return;
    current = rerollStartupName(current, rng);
    paint();
  });
  found.addEventListener('click', async () => {
    if (saving || disposed) return;
    saving = true; reroll.disabled = found.disabled = true; status.textContent = 'Founding your startup…';
    try {
      await options.onFound(current);
      if (!disposed && dialog.open) dialog.close();
    } catch (error) {
      if (!disposed) {
        status.textContent = error instanceof Error ? error.message : 'Could not found your startup. Try again.';
        reroll.disabled = found.disabled = false;
      }
    } finally { saving = false; }
  });
  // No cancel: founding is the one required step before the game opens.
  dialog.addEventListener('cancel', event => event.preventDefault());

  return {
    element: dialog,
    get name() { return current; },
    get isOpen() { return dialog.open; },
    show() { if (!disposed && !dialog.open) { dialog.showModal(); found.focus({ preventScroll: true }); } },
    destroy() { if (disposed) return; disposed = true; if (dialog.open) dialog.close(); dialog.remove(); },
  };
}
