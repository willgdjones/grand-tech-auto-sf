import { flags } from '@gtasf/shared/flags';
import { latestSignature, releasedEntries, type ChangelogEntry } from '../changelog/data';
import { renderInline } from '../changelog/inline';
import './whatsNew.css';

const SEEN_KEY = 'gtasf:changelog:seen';
const MAX_BULLETS = 5;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el;
}
function readSeen(): string | null { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } }
function writeSeen(version: string): void { try { localStorage.setItem(SEEN_KEY, version); } catch { /* private mode: it may show again next load. */ } }

/**
 * The "What's new" card (PLAN-v2 §11). Shows the newest shipped changelog entry's
 * 3–5 bullets once per deploy to returning players, keyed by the entry version in
 * localStorage. Returns null when the feature is flagged off or there is nothing to show.
 */
export function createWhatsNew(options: { onModalChange?(open: boolean): void } = {}) {
  if (!flags.changelog) return null;
  const entry: ChangelogEntry | undefined = releasedEntries[0];
  if (!entry || !latestSignature) return null;

  const dialog = node('dialog', '', 'gt-whatsnew'); dialog.setAttribute('aria-label', "What's new in GTASF");
  const eyebrow = node('p', "WHAT'S NEW", 'gt-whatsnew-eyebrow');
  const heading = node('h2', entry.title || 'Fresh updates');
  const when = node('p', entry.date ?? '', 'gt-whatsnew-date');
  const list = node('ul', '', 'gt-whatsnew-list');
  for (const bullet of entry.bullets.slice(0, MAX_BULLETS)) { const li = node('li'); renderInline(li, bullet); list.append(li); }
  const actions = node('div', '', 'gt-whatsnew-actions');
  const more = node('a', 'Full changelog'); more.className = 'gt-whatsnew-more';
  more.href = '/changelog'; more.target = '_blank'; more.rel = 'noopener';
  const go = node('button', "Let's go"); go.type = 'button'; go.className = 'gt-whatsnew-go';
  actions.append(more, go);
  dialog.append(eyebrow, heading, ...(entry.date ? [when] : []), list, actions);
  document.body.append(dialog);

  let disposed = false, announced = false;
  // Other panels call close() even before this card has ever been presented.
  function markSeen() { if (announced) writeSeen(latestSignature!); }
  function settleClosed() { if (!announced) return; announced = false; options.onModalChange?.(false); }
  function open() {
    if (disposed || dialog.open) return;
    announced = true; options.onModalChange?.(true); dialog.showModal(); go.focus({ preventScroll: true });
  }
  function close() { markSeen(); if (dialog.open) dialog.close(); settleClosed(); showLatest(); }
  // Latest-update card vs. the full scrollable history (opened from the ☰ menu / Game options).
  const history = node('div', '', 'gt-whatsnew-history'); history.hidden = true;
  for (const item of releasedEntries) {
    const section = node('section', '', 'gt-whatsnew-entry');
    const title = node('h3', item.title || 'Update');
    const items = node('ul', '', 'gt-whatsnew-list');
    for (const bullet of item.bullets) { const li = node('li'); renderInline(li, bullet); items.append(li); }
    section.append(title, ...(item.date ? [node('p', item.date, 'gt-whatsnew-date')] : []), items); history.append(section);
  }
  dialog.insertBefore(history, actions);
  function showLatest() { history.hidden = true; heading.textContent = entry!.title || 'Fresh updates'; when.hidden = false; list.hidden = false; dialog.classList.remove('gt-whatsnew--history'); }
  function openHistory() {
    if (disposed) return;
    history.hidden = false; heading.textContent = 'Changelog'; when.hidden = true; list.hidden = true;
    dialog.classList.add('gt-whatsnew--history'); open(); history.scrollTop = 0;
  }
  go.addEventListener('click', close);
  dialog.addEventListener('close', () => {
    // Native close events are queued: an older event must not release a reopened card.
    if (dialog.open) return;
    markSeen(); settleClosed();
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });

  return {
    element: dialog,
    get isOpen() { return dialog.open; },
    /** Show the card if this deploy's newest entry has not been seen. Returns whether it opened. */
    showOnce() {
      if (disposed || dialog.open) return false;
      const seen = readSeen();
      // No record = first visit in this browser: nothing is "new" to them. Mark it seen silently.
      if (seen === null) { writeSeen(latestSignature!); return false; }
      if (seen === latestSignature) return false;
      open(); return true;
    },
    /** Reopen on demand (e.g. a menu action) regardless of the seen marker. */
    open,
    /** Every dated update, newest first, in a scrollable panel. */
    openHistory,
    close,
    destroy() {
      if (disposed) return;
      close(); disposed = true;
      dialog.remove();
    },
  };
}
