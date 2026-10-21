import { flags } from '@gtasf/shared/flags';
import { formatCapTableTotal, type CapTable } from '@gtasf/shared/captable';
import './capTable.css';

/**
 * Read-only player cap table (PLAN-v2 decision 5, gtasf-2r5r). Clicking a player/nameplate
 * opens this panel listing who funded their startup — events, VC fund drops, parody celebrity
 * angels and warm intros — grouped with subtotals, plus their stage and total raised. It fetches
 * the public `/api/funding/captable` endpoint (own table with no device, another player's with
 * `?device=` or `?nick=`); the server returns only public funding fields. No awards are fabricated client-side.
 *
 * Returns null when flagged off.
 */
export interface CapTableTarget { deviceId?: string | null; startup?: string | null; nick?: string | null; self?: boolean }

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el;
}

export function createCapTable(options: { parent?: HTMLElement; endpoint?: string; onModalChange?(open: boolean): void } = {}) {
  if (!flags.capTable) return null;
  const endpoint = options.endpoint ?? '/api/funding/captable';

  const dialog = node('dialog', '', 'gt-captable');
  dialog.setAttribute('aria-label', 'Player cap table');
  const header = node('div', '', 'gt-captable-head');
  const eyebrow = node('p', 'CAP TABLE', 'gt-captable-eyebrow');
  const startupEl = node('h2', '', 'gt-captable-startup');
  const sub = node('p', '', 'gt-captable-sub');
  header.append(eyebrow, startupEl, sub);
  const body = node('div', '', 'gt-captable-body');
  const status = node('p', '', 'gt-captable-status'); status.setAttribute('role', 'status');
  const close = node('button', 'Close'); close.type = 'button'; close.className = 'gt-captable-close';
  dialog.append(header, status, body, close);
  document.body.append(dialog);
  // Tappable launcher so a solo/mobile player can open their OWN cap table (no peer nameplate to click).
  let button: HTMLButtonElement | null = null;
  if (options.parent) {
    button = document.createElement('button'); button.type = 'button';
    button.className = 'gt-captable-launch'; button.textContent = 'My cap table';
    button.addEventListener('click', () => open({ self: true }));
    options.parent.append(button);
  }

  let disposed = false, announced = false, requestId = 0;
  let controller: AbortController | null = null;

  function settleClosed() { if (dialog.open || !announced) return; announced = false; options.onModalChange?.(false); }
  function setStatus(text: string, kind: '' | 'error' | 'empty' = '') { status.textContent = text; status.dataset.kind = kind; status.hidden = !text; }

  function renderHint(target: CapTableTarget) {
    startupEl.textContent = target.startup?.trim() || (target.self ? 'Your startup' : 'Founder');
    sub.textContent = target.nick?.trim() ? `@${target.nick.trim()}` : '';
  }

  function renderTable(data: CapTable) {
    startupEl.textContent = data.startupName?.trim() || 'Stealth startup';
    const bits = [data.nickname?.trim() ? `@${data.nickname.trim()}` : '', data.round?.label, formatCapTableTotal(data.totalCents) + ' raised'].filter(Boolean);
    sub.textContent = bits.join(' · ');
    body.replaceChildren();
    if (!data.groups.length) { setStatus('No backers yet — this founder is still bootstrapping.', 'empty'); return; }
    setStatus('');
    for (const group of data.groups) {
      const section = node('section', '', 'gt-captable-group');
      const gh = node('div', '', 'gt-captable-group-head');
      gh.append(node('h3', group.title), node('span', formatCapTableTotal(group.totalCents), 'gt-captable-group-total'));
      section.append(gh);
      const list = node('ul', '', 'gt-captable-list');
      for (const entry of group.entries) {
        const li = node('li');
        li.append(node('span', entry.label, 'gt-captable-entry-label'), node('span', formatCapTableTotal(entry.amountCents), 'gt-captable-entry-amount'));
        list.append(li);
      }
      section.append(list);
      if (group.count > group.entries.length) section.append(node('p', `+${group.count - group.entries.length} more`, 'gt-captable-more'));
      body.append(section);
    }
  }

  async function load(target: CapTableTarget) {
    const id = ++requestId;
    controller?.abort(); controller = new AbortController();
    const query = target.self ? '' : target.deviceId ? `device=${encodeURIComponent(target.deviceId)}`
      : target.nick?.trim() ? `nick=${encodeURIComponent(target.nick.trim())}` : '';
    const url = query ? `${endpoint}${endpoint.includes('?') ? '&' : '?'}${query}` : endpoint;
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
      if (id !== requestId || disposed) return;
      if (response.status === 404) { setStatus("This founder hasn't raised anything yet.", 'empty'); body.replaceChildren(); return; }
      if (!response.ok) { setStatus('Could not load this cap table. Please try again.', 'error'); return; }
      const data = await response.json() as CapTable;
      if (id !== requestId || disposed) return;
      renderTable(data);
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError' || id !== requestId || disposed) return;
      setStatus('Network error loading the cap table.', 'error');
    }
  }

  function open(target: CapTableTarget = { self: true }) {
    if (disposed) return;
    if (!dialog.open) { announced = true; options.onModalChange?.(true); dialog.showModal(); }
    close.focus({ preventScroll: true });
    renderHint(target); body.replaceChildren(); setStatus('Loading…');
    void load(target);
  }

  function closePanel() { requestId++; controller?.abort(); controller = null; if (dialog.open) dialog.close(); settleClosed(); }

  close.addEventListener('click', closePanel);
  dialog.addEventListener('close', settleClosed);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closePanel(); });

  return {
    element: dialog,
    button,
    get isOpen() { return dialog.open; },
    open,
    close: closePanel,
    destroy() {
      if (disposed) return; disposed = true; closePanel();
      button?.remove();
      dialog.remove();
    },
  };
}
