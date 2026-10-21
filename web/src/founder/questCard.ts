/**
 * The single founder-ladder quest card (PLAN step 1: the HUD is just a minimap and one quest card).
 * One small card, pinned top-centre, with a kicker, a line of quest text and an optional action
 * button. The controller sets its content as the flow advances; it owns no game logic.
 */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node;
}

export interface QuestStep {
  /** Small eyebrow label, e.g. "YOUR STARTUP". */
  kicker?: string;
  /** The quest line, e.g. "Found your startup →". */
  title: string;
  /** Optional button label; omit for a status-only card. */
  cta?: string;
  onCta?(): void;
}

export interface QuestCard {
  readonly element: HTMLElement;
  set(step: QuestStep): void;
  show(): void;
  hide(): void;
  destroy(): void;
}

export function createQuestCard(parent: HTMLElement = document.body): QuestCard {
  const root = el('section', 'gt-founder-quest');
  root.setAttribute('aria-live', 'polite');
  const kicker = el('div', 'gt-founder-quest-kicker');
  const title = el('div', 'gt-founder-quest-title');
  const cta = el('button', 'gt-founder-quest-cta'); cta.type = 'button'; cta.hidden = true;
  root.append(kicker, title, cta);
  parent.append(root);
  let onCta: (() => void) | undefined;
  cta.addEventListener('click', () => onCta?.());
  // Publish the card's bottom edge (--gt-founder-quest-bottom) so the valuation pill can sit just under it: card
  // height varies with its text, and on phones a fixed offset left the pill hidden behind a 3-line card.
  const publish = () => document.documentElement.style.setProperty('--gt-founder-quest-bottom', root.hidden ? '0px' : `${Math.round(root.getBoundingClientRect().bottom)}px`);
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : null;
  resize?.observe(root);
  return {
    element: root,
    set(step) {
      kicker.textContent = step.kicker ?? '';
      kicker.hidden = !step.kicker;
      title.textContent = step.title;
      onCta = step.onCta;
      cta.hidden = !step.cta;
      if (step.cta) cta.textContent = step.cta;
      publish();
    },
    show() { root.hidden = false; publish(); },
    hide() { root.hidden = true; publish(); },
    destroy() { resize?.disconnect(); root.remove(); document.documentElement.style.removeProperty('--gt-founder-quest-bottom'); },
  };
}
