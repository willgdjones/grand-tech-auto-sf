/**
 * GTA V pivot — LANE B (combat & police): the WASTED / BUSTED screen.
 *
 * A full-screen tint + big centred word, GTA-style: red "WASTED" when killed, blue "BUSTED" when arrested.
 * `play(kind)` fades it in and resolves once the screen is fully covered (the moment the caller respawns the
 * player, unseen); `dismiss()` fades it back out over the respawned world.
 */
import './combat.css';
import type { DeathKind } from '@gtasf/shared/combat/economy';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export interface WastedOverlay {
  readonly active: boolean;
  /** Fade in; resolves when the screen is fully covered (respawn here). */
  play(kind: DeathKind): Promise<void>;
  /** Fade back out over the respawned world. */
  dismiss(): void;
  destroy(): void;
}

const COVER_MS = 2200; // fade-in + hold before the caller respawns under the cover
const FADE_OUT_MS = 700;

export function createWastedOverlay(parent: HTMLElement = document.body): WastedOverlay {
  const root = el('div', 'gt-wasted');
  root.hidden = true;
  root.setAttribute('role', 'status');
  const word = el('div', 'gt-wasted-word');
  root.append(word);
  parent.append(root);

  let coverTimer: number | undefined;
  let hideTimer: number | undefined;
  let active = false;

  return {
    get active() { return active; },
    play(kind: DeathKind): Promise<void> {
      active = true;
      window.clearTimeout(hideTimer);
      word.textContent = kind === 'busted' ? 'BUSTED' : 'WASTED';
      root.classList.toggle('gt-wasted-busted', kind === 'busted');
      root.hidden = false;
      void root.offsetWidth; // force reflow so the transition runs from the hidden state
      root.classList.add('gt-wasted-on');
      return new Promise<void>(resolve => { coverTimer = window.setTimeout(resolve, COVER_MS); });
    },
    dismiss() {
      window.clearTimeout(coverTimer);
      root.classList.remove('gt-wasted-on');
      hideTimer = window.setTimeout(() => { root.hidden = true; active = false; }, FADE_OUT_MS);
    },
    destroy() {
      window.clearTimeout(coverTimer);
      window.clearTimeout(hideTimer);
      root.remove();
      active = false;
    },
  };
}
