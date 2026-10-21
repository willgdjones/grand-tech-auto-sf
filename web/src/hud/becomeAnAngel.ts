import { flags } from '@gtasf/shared/flags';
import { SPONSOR_LINE_MAX } from '@gtasf/shared/sponsoredAngels';
import './becomeAnAngel.css';

/**
 * "Become an angel" HUD (docs/engineering/become-an-angel.md). A player self-sponsors an angel NPC:
 * display name, a one-line pitch reply, an optional avatar colour, and a spot from the allow-list.
 * Talks only to /api/angels/* (spots, submit, mine); the server runs Jev + checkout. Returns null
 * when the feature is flagged off.
 *
 * Contract for pane 1 (main.ts, owner of the loop): `const becomeAnAngel = createBecomeAnAngel({
 * onModalChange(open){ ... same input-mask + close-others as feedback/whatsNew ... } });` then add a
 * HUD entry (e.g. a "Become an angel" button in Game options) that calls `becomeAnAngel?.open()`,
 * include `Boolean(becomeAnAngel?.isOpen)` in hasModal(), and `becomeAnAngel?.close()` /
 * `becomeAnAngel?.destroy()` alongside the other panels.
 */
export interface BecomeAnAngelOptions {
  onModalChange?(open: boolean): void;
}

interface SpotDto { id: string; label: string }
interface MineDto { id: string; displayName: string; line: string; spotId: string; status: string; pitchCount: number }

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el;
}

export function createBecomeAnAngel(options: BecomeAnAngelOptions = {}) {
  if (!flags.becomeAnAngel) return null;

  const dialog = node('dialog', '', 'gt-angel'); dialog.setAttribute('aria-label', 'Become an angel');
  const close = node('button', 'Close ×', 'gt-angel-close'); close.type = 'button';
  dialog.append(close, node('div', 'TECH WEEK · AD PRODUCT', 'gt-angel-eyebrow'), node('h2', 'Become an angel'));
  const price = node('p', '', 'gt-angel-price');
  dialog.append(node('p', 'Place your own parody “angel investor” in the city. Founders who find and pitch you get a cheque; you’ll see how many pitched you. Shown as “Angel (player-sponsored)”.', 'gt-angel-desc'), price);

  const form = node('form', '', 'gt-angel-form');
  const nameLabel = node('label', 'Your angel’s name'); const name = node('input'); name.required = true; name.maxLength = 48; name.placeholder = 'Your name or brand'; nameLabel.append(name);
  const lineLabel = node('label', 'One-line pitch reply'); const line = node('textarea'); line.required = true; line.maxLength = SPONSOR_LINE_MAX; line.rows = 2; line.placeholder = 'Something friendly — no real people or brands'; lineLabel.append(line);
  const spotLabel = node('label', 'Hidden spot'); const spot = node('select'); spot.required = true; spotLabel.append(spot);
  const colourLabel = node('label', '', 'gt-angel-colour');
  const useColour = node('input'); useColour.type = 'checkbox';
  const colour = node('input'); colour.type = 'color'; colour.value = '#4f7cff'; colour.disabled = true;
  colourLabel.append(useColour, document.createTextNode(' Custom colour '), colour);
  const status = node('p', '', 'gt-angel-status'); status.setAttribute('role', 'status');
  const submit = node('button', 'Sponsor an angel', 'gt-angel-submit'); submit.type = 'submit';
  form.append(nameLabel, lineLabel, spotLabel, colourLabel, status, submit);
  dialog.append(form);

  const mineTitle = node('h3', 'Your angels', 'gt-angel-mine-title');
  const mine = node('ul', '', 'gt-angel-mine'); const mineEmpty = node('p', 'You have not sponsored an angel yet.', 'gt-angel-mine-empty');
  dialog.append(mineTitle, mine, mineEmpty);
  document.body.append(dialog);

  let disposed = false, announced = false, submitting = false;
  function settleClosed() { if (!announced) return; announced = false; options.onModalChange?.(false); }
  function setStatus(text: string, kind: 'ok' | 'error' | '' = '') { status.textContent = text; status.dataset.kind = kind; }

  async function loadSpots() {
    spot.innerHTML = '';
    try {
      const res = await fetch('/api/angels/spots');
      if (!res.ok) throw new Error('spots');
      const data = await res.json() as { spots: SpotDto[]; priceUsdCents: string };
      const dollars = (Number(data.priceUsdCents) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
      price.textContent = `${dollars} — your angel appears until you remove it.`;
      submit.textContent = `Sponsor an angel · ${dollars}`;
      if (!data.spots.length) { setStatus('Every spot is taken right now — check back soon.', 'error'); submit.disabled = true; return; }
      submit.disabled = false;
      for (const s of data.spots) { const opt = node('option', s.label); opt.value = s.id; spot.append(opt); }
    } catch { setStatus('Could not load spots. Try again shortly.', 'error'); submit.disabled = true; }
  }

  async function loadMine() {
    try {
      const res = await fetch('/api/angels/mine');
      if (!res.ok) throw new Error('mine');
      const data = await res.json() as { angels: MineDto[] };
      mine.innerHTML = '';
      mineEmpty.hidden = data.angels.length > 0;
      for (const a of data.angels) {
        const li = node('li');
        li.append(node('strong', a.displayName), node('span', ` · ${a.status}`, 'gt-angel-mine-status'),
          node('span', ` · ${a.pitchCount} pitched`, 'gt-angel-mine-count'));
        if (a.status !== 'removed') {
          const rm = node('button', 'Remove', 'gt-angel-remove'); rm.type = 'button';
          rm.addEventListener('click', () => void removeAngel(a.id));
          li.append(rm);
        }
        mine.append(li);
      }
    } catch { /* dashboard is best-effort; the form still works. */ }
  }

  async function removeAngel(id: string) {
    try {
      const res = await fetch('/api/angels/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (res.ok) { void loadMine(); void loadSpots(); return; } // the freed spot returns to the picker
      const data = await res.json().catch(() => ({})) as { error?: string };
      setStatus(data.error ?? 'Could not remove that angel.', 'error');
    } catch { setStatus('Network error removing your angel.', 'error'); }
  }

  async function send(event: Event) {
    event.preventDefault();
    if (disposed || submitting || !form.reportValidity()) return;
    submitting = true; submit.disabled = true; setStatus('Checking…');
    const payload = { displayName: name.value, line: line.value, avatarColor: useColour.checked ? colour.value : null, spotId: spot.value };
    try {
      const res = await fetch('/api/angels/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({})) as { checkoutUrl?: string; error?: string };
      if (res.ok && data.checkoutUrl) { setStatus('Redirecting to secure checkout…', 'ok'); location.href = data.checkoutUrl; return; }
      setStatus(data.error ?? 'Could not start your sponsorship. Please try again.', 'error');
    } catch { setStatus('Network error — please try again.', 'error'); }
    submitting = false; submit.disabled = false;
  }

  useColour.addEventListener('change', () => { colour.disabled = !useColour.checked; });
  form.addEventListener('submit', send);
  close.addEventListener('click', () => hide());
  dialog.addEventListener('close', settleClosed);
  dialog.addEventListener('cancel', event => { event.preventDefault(); hide(); });

  function open() {
    if (disposed || dialog.open) return;
    announced = true; options.onModalChange?.(true);
    setStatus(''); submitting = false; submit.disabled = false; name.value = ''; line.value = ''; useColour.checked = false; colour.disabled = true;
    dialog.showModal(); name.focus({ preventScroll: true });
    void loadSpots(); void loadMine();
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
