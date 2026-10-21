import { flags } from '@gtasf/shared/flags';
import { BILLBOARD_SURFACES, BILLBOARD_PRICE_TIERS } from '@gtasf/shared/content/billboards';
import { SKY_AD_CRAFT } from '@gtasf/shared/content/skyAds';
import './adSlotPage.css';

/**
 * "Buy this billboard / sky-ad slot" page (founder feedback, gtasf-buy-ad-slot-page-yxua). Clicking a
 * billboard (or opening a sky-ad slot) shows the slot's id, location, size and starting weekly price,
 * with a **gated** Buy CTA: checkout stays off until the founder enables it (flags.rentals + stripe)
 * and is wired to pane 7's ledger — this page never fabricates a purchase or touches ownership.
 *
 * Returns null when flagged off.
 */
export type AdSlotTarget = { kind: 'billboard'; id: string } | { kind: 'sky'; id: string };

export interface AdSlotInfo { title: string; subtitle: string; priceLabel: string; lines: string[]; slotId: string; }

/** USD/week from integer cents, e.g. 25000 → "$250/week". */
function usdPerWeek(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}/week`;
}

/** Pure: resolve a clicked slot to display info from the shared catalogues. Null for unknown ids. */
export function adSlotInfo(target: AdSlotTarget): AdSlotInfo | null {
  if (target.kind === 'billboard') {
    const surface = BILLBOARD_SURFACES.find(board => board.id === target.id);
    if (!surface) return null;
    const tier = BILLBOARD_PRICE_TIERS[surface.baseWeeklyPriceTier];
    return {
      title: surface.name, slotId: surface.id,
      subtitle: `${surface.district.toUpperCase()} · ${surface.mount} board`,
      priceLabel: `${tier.label} · from ${usdPerWeek(tier.baseWeeklyCents)}`,
      lines: [`${surface.widthMetres}×${surface.heightMetres} m`, 'Your reviewed creative runs here all Tech Week.'],
    };
  }
  const craft = SKY_AD_CRAFT.find(c => c.id === target.id || c.slotId === target.id);
  if (!craft) return null;
  return {
    title: craft.kind === 'blimp' ? 'Bay blimp banner' : 'Banner-plane flyover', slotId: craft.slotId,
    subtitle: craft.kind === 'blimp' ? 'Loops over the Bay & Financial District' : 'Flies the Embarcadero / SoMa',
    priceLabel: 'Flyover slot · from $500/slot',
    lines: ['Your banner trails across the Tech Week skyline.'],
  };
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el;
}

export function createAdSlotPage(options: { onModalChange?(open: boolean): void } = {}) {
  if (!flags.adSlots) return null;
  const checkoutLive = Boolean((flags as Record<string, boolean>).rentals && (flags as Record<string, boolean>).stripe);

  const dialog = node('dialog', '', 'gt-adslot');
  dialog.setAttribute('aria-label', 'Buy this ad slot');
  const eyebrow = node('p', 'AD SLOT', 'gt-adslot-eyebrow');
  const title = node('h2', '', 'gt-adslot-title');
  const subtitle = node('p', '', 'gt-adslot-sub');
  const price = node('p', '', 'gt-adslot-price');
  const list = node('ul', '', 'gt-adslot-list');
  const idLine = node('p', '', 'gt-adslot-id');
  const status = node('p', '', 'gt-adslot-status'); status.setAttribute('role', 'status');
  const actions = node('div', '', 'gt-adslot-actions');
  const close = node('button', 'Close'); close.type = 'button'; close.className = 'gt-adslot-close';
  const buy = node('button', checkoutLive ? 'Buy this slot' : 'Buy this slot · checkout opens soon');
  buy.type = 'button'; buy.className = 'gt-adslot-buy'; buy.disabled = !checkoutLive;
  actions.append(close, buy);
  dialog.append(eyebrow, title, subtitle, price, list, idLine, status, actions);
  document.body.append(dialog);

  let disposed = false, announced = false;
  function settleClosed() { if (dialog.open || !announced) return; announced = false; options.onModalChange?.(false); }

  function open(target: AdSlotTarget) {
    if (disposed) return;
    const info = adSlotInfo(target);
    if (!info) return;
    title.textContent = info.title; subtitle.textContent = info.subtitle; price.textContent = info.priceLabel;
    list.replaceChildren(...info.lines.map(line => node('li', line)));
    idLine.textContent = `Slot ${info.slotId}`;
    status.textContent = checkoutLive ? '' : 'Checkout opens once the founder enables live payments. Until then, slots show parody ads.';
    if (!dialog.open) { announced = true; options.onModalChange?.(true); dialog.showModal(); }
    close.focus({ preventScroll: true });
  }
  function closePanel() { if (dialog.open) dialog.close(); settleClosed(); }

  close.addEventListener('click', closePanel);
  // When checkout is live this will hand off to pane 7's buy flow; gated for now.
  buy.addEventListener('click', () => { if (checkoutLive) status.textContent = 'Opening checkout…'; });
  dialog.addEventListener('close', settleClosed);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closePanel(); });

  return {
    element: dialog,
    get isOpen() { return dialog.open; },
    open,
    close: closePanel,
    destroy() { if (disposed) return; disposed = true; closePanel(); dialog.remove(); },
  };
}
