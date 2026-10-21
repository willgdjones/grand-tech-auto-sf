/**
 * Founder-ladder valuation pill (PLAN step 5: "Valuation as the score in the HUD. It is revealed
 * when it first becomes non-zero"). A small pinned readout of the startup's valuation + its ladder
 * stage. Its own element (never the playableHud money block), so it is independent of the funding
 * HUD's animation and visible while the rest of the status block stays locked.
 */
import { formatFunding, fundingRound } from '@gtasf/shared/funding';
import { parseValuationCents } from '@gtasf/shared/founder/ladder';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node;
}

export interface ValuationHud {
  readonly element: HTMLElement;
  /** Update from a cents value; reveals the pill the first time the valuation is non-zero. */
  set(cents: string | bigint): void;
  destroy(): void;
}

export function createValuationHud(parent: HTMLElement = document.body): ValuationHud {
  const root = el('section', 'gt-founder-valuation'); root.hidden = true;
  root.setAttribute('aria-live', 'polite');
  const label = el('span', 'gt-founder-valuation-label', 'VALUATION');
  const value = el('strong', 'gt-founder-valuation-value', '$0');
  const stage = el('span', 'gt-founder-valuation-stage', '');
  root.append(label, value, stage);
  parent.append(root);
  let revealed = false;
  return {
    element: root,
    set(input) {
      const cents = parseValuationCents(input);
      if (cents === null) return;
      value.textContent = formatFunding(cents.toString());
      // Stage text = the ECONOMY round for this valuation (single source of truth; orchestrator 2026-10-13),
      // so the pill agrees with the funding round pill + the billboard tier instead of the old FOUNDER_STAGES ladder.
      stage.textContent = fundingRound(cents).label;
      // Revealed the first time the valuation is non-zero; it then stays visible (PLAN "first reveal").
      if (!revealed && cents > 0n) { revealed = true; root.hidden = false; }
    },
    destroy() { root.remove(); },
  };
}
