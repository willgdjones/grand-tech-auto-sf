import { flags } from '@gtasf/shared/flags';
import './eventSubmit.css';

/** The worker rejects anything that is not a supported public provider with its own reason; this is the client hint. */
const SUPPORTED_HINT = 'Paste a public lu.ma, Partiful or Eventbrite event link.';

export type SubmitClientResult =
  | { ok: true; status: 'stored' | 'updated'; title: string }
  | { ok: false; reason: string };

/**
 * POST one pasted public event link to the worker (PLAN-v2 decision 9). DOM-free and
 * fetcher-injectable so it can be unit-tested without a browser. The worker owns the
 * authoritative provider/geocode/Jev checks; this does only cheap client-side pre-validation
 * and surfaces the worker's clear rejection reason verbatim.
 */
export async function submitEventLink(rawUrl: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<SubmitClientResult> {
  const url = rawUrl.trim();
  if (!url) return { ok: false, reason: SUPPORTED_HINT };
  if (url.length > 2048) return { ok: false, reason: 'That link is too long.' };
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, reason: SUPPORTED_HINT }; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { ok: false, reason: SUPPORTED_HINT };

  let response: Response;
  try {
    response = await fetcher('/api/events/submit', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }),
    });
  } catch {
    return { ok: false, reason: 'Could not reach the server. Check your connection and try again.' };
  }

  let data: { ok?: boolean; status?: string; error?: string; event?: { title?: string } } = {};
  try { data = (await response.json()) as typeof data; } catch { /* a non-JSON error body falls through to the generic reason */ }
  if (response.ok && data.ok) {
    const status = data.status === 'updated' ? 'updated' : 'stored';
    const title = typeof data.event?.title === 'string' && data.event.title.trim() ? data.event.title.trim() : 'Your event';
    return { ok: true, status, title };
  }
  return { ok: false, reason: typeof data.error === 'string' && data.error.trim() ? data.error.trim() : 'That event could not be added right now.' };
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag); if (className) el.className = className; if (text) el.textContent = text; return el;
}

export interface EventSubmitPanel {
  readonly element: HTMLDialogElement;
  /** An "Add event" trigger the integrator can place in the HUD, or ignore in favour of open(). */
  readonly button: HTMLButtonElement;
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  toggle(force?: boolean): void;
  destroy(): void;
}

/**
 * "Add an event" panel (PLAN-v2 decision 9, UI half). A self-contained <dialog> that pastes a
 * public lu.ma/Partiful link, POSTs it to /api/events/submit, and shows pending / accepted /
 * rejected states with the worker's own reason. Flag-gated on eventSubmission. The integrator
 * (pane 1) places `button` (or binds a key to `open()`), closes other panels on `onModalChange`,
 * folds `isOpen` into hasModal(), and can refresh the event feed from `onSubmitted` so the new
 * community event appears on the map.
 */
export function createEventSubmit(options: {
  parent?: HTMLElement;
  buttonParent?: HTMLElement;
  onModalChange?(open: boolean): void;
  onSubmitted?(result: { title: string; status: 'stored' | 'updated' }): void;
  /** Injectable for tests; defaults to the real endpoint. */
  submit?(url: string, signal?: AbortSignal): Promise<SubmitClientResult>;
} = {}): EventSubmitPanel | null {
  if (!flags.eventSubmission || !flags.hud) return null;
  const submit = options.submit ?? ((url, signal) => submitEventLink(url, fetch, signal));

  const dialog = node('dialog', 'gt-eventsubmit');
  dialog.setAttribute('aria-label', 'Add an event to the map');
  const eyebrow = node('p', 'gt-eventsubmit-eyebrow', 'ADD AN EVENT');
  const heading = node('h2', '', 'Put your event on the map');
  const blurb = node('p', 'gt-eventsubmit-blurb',
    "Paste a public lu.ma, Partiful or Eventbrite link. We check it's a real public SF event, then it appears as a community event within minutes.");

  const form = node('form', 'gt-eventsubmit-form');
  const field = node('input', 'gt-eventsubmit-input');
  field.type = 'url'; field.name = 'eventUrl'; field.placeholder = 'https://lu.ma/your-event';
  field.autocomplete = 'off'; field.spellcheck = false; field.setAttribute('aria-label', 'Public event link');
  const add = node('button', 'gt-eventsubmit-add', 'Add event'); add.type = 'submit';
  form.append(field, add);

  const status = node('p', 'gt-eventsubmit-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const stopWaiting = node('button', 'gt-eventsubmit-close', 'Stop waiting'); stopWaiting.type = 'button'; stopWaiting.hidden = true;
  const foot = node('p', 'gt-eventsubmit-foot', 'Community events are labelled and reviewed; spam and non-SF events are removed.');
  const closeButton = node('button', 'gt-eventsubmit-close', 'Close'); closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close add event');

  dialog.append(eyebrow, heading, blurb, form, status, stopWaiting, foot, closeButton);
  (options.parent ?? document.body).append(dialog);

  const button = node('button', 'gt-eventsubmit-open', '+ Add event'); button.type = 'button';
  button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
  if (options.buttonParent) options.buttonParent.append(button);

  let disposed = false, announced = false, pending = false;
  let request: AbortController | undefined, generation = 0;

  function setPending(value: boolean) {
    pending = value; add.disabled = value; field.disabled = value; stopWaiting.hidden = !value;
  }

  function setStatus(text: string, tone: 'idle' | 'working' | 'ok' | 'error') {
    status.textContent = text;
    status.dataset.tone = tone;
  }
  function settleClosed() {
    // Native close events are queued and can arrive after this panel reopens.
    if (dialog.open) return;
    button.setAttribute('aria-expanded', 'false');
    if (!announced) return; announced = false; options.onModalChange?.(false);
  }
  function open() {
    if (disposed || dialog.open) return;
    announced = true; button.setAttribute('aria-expanded', 'true'); options.onModalChange?.(true);
    setStatus(pending ? 'Checking your link…' : '', pending ? 'working' : 'idle');
    dialog.showModal();
    (pending ? stopWaiting : field).focus({ preventScroll: true });
  }
  function close() { if (dialog.open) dialog.close(); settleClosed(); }
  function toggle(force?: boolean) { const next = force ?? !dialog.open; if (next) open(); else close(); }

  async function onSubmit(event: Event) {
    event.preventDefault();
    if (disposed || pending) return;
    const value = field.value;
    const current = ++generation, controller = new AbortController(); request = controller;
    setPending(true);
    setStatus('Checking your link…', 'working');
    let result: SubmitClientResult;
    try { result = await submit(value, controller.signal); }
    catch { result = { ok: false, reason: 'That event could not be added right now.' }; }
    if (disposed || current !== generation) return;
    request = undefined; setPending(false);
    if (result.ok) {
      setStatus(result.status === 'updated'
        ? `Updated "${result.title}". It stays on the map as a community event.`
        : `Added "${result.title}". It will appear on the map shortly as a community event.`, 'ok');
      field.value = '';
      options.onSubmitted?.({ title: result.title, status: result.status });
    } else {
      setStatus(result.reason, 'error');
      if (dialog.open) field.focus({ preventScroll: true });
    }
  }

  form.addEventListener('submit', onSubmit);
  stopWaiting.addEventListener('click', () => {
    if (disposed || !pending) return;
    generation++; request?.abort(); request = undefined; setPending(false);
    setStatus('Stopped waiting. Your link is kept. The server may still add the event; check the calendar before retrying.', 'idle');
    if (dialog.open) field.focus({ preventScroll: true });
  });
  button.addEventListener('click', () => toggle());
  closeButton.addEventListener('click', () => close());
  dialog.addEventListener('close', settleClosed);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });

  return {
    element: dialog,
    button,
    get isOpen() { return dialog.open; },
    open, close, toggle,
    destroy() {
      if (disposed) return; disposed = true;
      generation++; request?.abort(); request = undefined;
      form.removeEventListener('submit', onSubmit);
      close();
      dialog.remove(); button.remove();
    },
  };
}
