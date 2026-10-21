import { flags } from '@gtasf/shared/flags';
import { FUND_DROP_SPONSOR_NAME_MAX } from '@gtasf/shared/drops';
import './sponsor.css';

/**
 * "Sponsor a VC fund drop" HUD (PLAN-v2 decision 3; bead gtasf-v2-drop-sponsor-checkout-c41g). A real
 * VC/startup buys an upcoming "come pitch!" drop and renames it under its real name for that window.
 * Talks only to /api/drops/sponsor/{offer,checkout}; the server runs the Stripe Checkout + webhook.
 * Returns null when the feature is flagged off (it stays off for launch; a Stripe-gated ad product).
 *
 * Contract for pane 1 (main.ts, owner of the loop): `const dropSponsor = createDropSponsor({
 * onModalChange(open){ ...same input-mask + close-others as becomeAnAngel/feedback... } });` then add a
 * HUD entry (e.g. a "Sponsor a drop" button in Game options, shown only when flags.fundDropSponsors) that
 * calls `dropSponsor?.open()`, include `Boolean(dropSponsor?.isOpen)` in hasModal(), and
 * `dropSponsor?.close()` / `dropSponsor?.destroy()` alongside the other panels. No game-loop hook needed.
 */
export interface DropSponsorOptions { onModalChange?(open: boolean): void }

interface OfferSlot { slot: number; opensAt: number; defaultFund: string; location: { label: string }; sponsored: boolean; sponsorName?: string }
interface OfferDto { priceUsdCents: string; checkoutAvailable: boolean; serverNow: number; upcoming: OfferSlot[] }

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el;
}
function slotLabel(s: OfferSlot): string {
  const when = new Date(s.opensAt).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return `${when} · ${s.location.label} (was “${s.defaultFund}”)`;
}

export function createDropSponsor(options: DropSponsorOptions = {}) {
  if (!flags.fundDropSponsors) return null;

  const dialog = node('dialog', '', 'gt-dropsponsor'); dialog.setAttribute('aria-label', 'Sponsor a VC fund drop');
  const close = node('button', 'Close ×', 'gt-dropsponsor-close'); close.type = 'button';
  dialog.append(close, node('div', 'TECH WEEK · AD PRODUCT', 'gt-dropsponsor-eyebrow'), node('h2', 'Sponsor a fund drop'));
  const price = node('p', '', 'gt-dropsponsor-price');
  dialog.append(node('p', 'Rename an upcoming “come pitch!” drop under your real name. Your name shows on the banner, the N/50 counter and the radar blip for that drop’s window.', 'gt-dropsponsor-desc'), price);

  const form = node('form', '', 'gt-dropsponsor-form');
  const slotLabelEl = node('label', 'Upcoming drop'); const slot = node('select'); slot.required = true; slotLabelEl.append(slot);
  const nameLabel = node('label', 'Your fund’s name'); const name = node('input'); name.required = true; name.maxLength = FUND_DROP_SPONSOR_NAME_MAX; name.placeholder = 'Your VC / startup name'; nameLabel.append(name);
  const urlLabel = node('label', 'Link (optional, https)'); const url = node('input'); url.type = 'url'; url.placeholder = 'https://yourfund.com'; urlLabel.append(url);
  const logoLabel = node('label', 'Logo URL (optional, https)'); const logo = node('input'); logo.type = 'url'; logo.placeholder = 'https://yourfund.com/logo.png'; logoLabel.append(logo);
  const status = node('p', '', 'gt-dropsponsor-status'); status.setAttribute('role', 'status');
  const submit = node('button', 'Sponsor this drop', 'gt-dropsponsor-submit'); submit.type = 'submit';
  form.append(slotLabelEl, nameLabel, urlLabel, logoLabel, status, submit);
  dialog.append(form);
  document.body.append(dialog);

  let disposed = false, announced = false, submitting = false;
  function settleClosed() { if (!announced) return; announced = false; options.onModalChange?.(false); }
  function setStatus(text: string, kind: 'ok' | 'error' | '' = '') { status.textContent = text; status.dataset.kind = kind; }

  async function loadOffer() {
    slot.innerHTML = '';
    try {
      const res = await fetch('/api/drops/sponsor/offer', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) throw new Error('offer');
      const data = await res.json() as OfferDto;
      const dollars = (Number(data.priceUsdCents) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
      price.textContent = `${dollars} per drop.`;
      submit.textContent = `Sponsor this drop · ${dollars}`;
      const open = data.upcoming.filter(s => !s.sponsored);
      if (!data.checkoutAvailable) { setStatus('Sponsor checkout isn’t enabled yet — check back soon.', 'error'); submit.disabled = true; }
      else if (!open.length) { setStatus('Every upcoming drop is taken right now — check back soon.', 'error'); submit.disabled = true; }
      else { setStatus(''); submit.disabled = false; }
      for (const s of open) { const opt = node('option', slotLabel(s)); opt.value = String(s.slot); slot.append(opt); }
    } catch { setStatus('Could not load upcoming drops. Try again shortly.', 'error'); submit.disabled = true; }
  }

  async function send(event: Event) {
    event.preventDefault();
    if (disposed || submitting || !form.reportValidity()) return;
    submitting = true; submit.disabled = true; setStatus('Starting secure checkout…');
    const payload = { slot: Number(slot.value), name: name.value, url: url.value || undefined, logoUrl: logo.value || undefined };
    try {
      const res = await fetch('/api/drops/sponsor/checkout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({})) as { checkoutUrl?: string; error?: string };
      if (res.ok && data.checkoutUrl) { setStatus('Redirecting to secure checkout…', 'ok'); location.href = data.checkoutUrl; return; }
      setStatus(data.error ?? 'Could not start checkout. Please try again.', 'error');
      if (res.status === 409) void loadOffer(); // the slot was taken; refresh the picker
    } catch { setStatus('Network error — please try again.', 'error'); }
    submitting = false; submit.disabled = false;
  }

  form.addEventListener('submit', send);
  close.addEventListener('click', () => hide());
  dialog.addEventListener('close', settleClosed);
  dialog.addEventListener('cancel', event => { event.preventDefault(); hide(); });

  function open() {
    if (disposed || dialog.open) return;
    announced = true; options.onModalChange?.(true);
    setStatus(''); submitting = false; submit.disabled = false; name.value = ''; url.value = ''; logo.value = '';
    dialog.showModal(); name.focus({ preventScroll: true });
    void loadOffer();
  }
  function hide() { if (dialog.open) dialog.close(); else settleClosed(); }

  return {
    element: dialog,
    open,
    close: hide,
    get isOpen() { return dialog.open; },
    destroy() { if (disposed) return; disposed = true; if (dialog.open) dialog.close(); dialog.remove(); },
  };
}
export type DropSponsor = NonNullable<ReturnType<typeof createDropSponsor>>;
