import { flags } from '@gtasf/shared/flags';
import { latestSignature } from '../changelog/data';
import type { Actions } from '../input/actions';
import type { MapFrame } from '../radar/projection';
import './feedback.css';

/** Player state attached to a feedback report. All fields optional; nothing is fabricated. */
export interface FeedbackSnapshot {
  mode?: string | null;
  round?: string | null;
  startup?: string | null;
  nick?: string | null;
  worldX?: number | null;
  worldZ?: number | null;
  lat?: number | null;
  lon?: number | null;
  locationName?: string | null;
}

/**
 * Local linear inverse of radar `projectLocation` around the frame origin. Accurate to
 * well under a metre across the city, which is all the "jump to this spot" link needs.
 */
export function unprojectLocation(x: number, z: number, frame: MapFrame): { lat: number; lon: number } {
  const rad = Math.PI / 180;
  const theta = frame.gridRotationDeg * rad;
  const east = x * Math.cos(theta) - z * Math.sin(theta);
  const north = -x * Math.sin(theta) - z * Math.cos(theta);
  const metresPerDegLat = 111_320;
  const metresPerDegLon = 111_320 * Math.cos(frame.origin.lat * rad);
  return {
    lat: frame.origin.lat + north / metresPerDegLat,
    lon: frame.origin.lon + east / (metresPerDegLon || 1),
  };
}

const MAX_TEXT = 4000;
const SHOT_MAX_EDGE = 960;   // Both orientations stay below 1 MP and keep uploads small.
const SHOT_QUALITY = 0.6;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el;
}

/** Downscale a captured frame data URL to a bounded JPEG; resolves null on any failure. */
function downscale(dataUrl: string): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const width = img.naturalWidth || SHOT_MAX_EDGE;
        const height = img.naturalHeight || SHOT_MAX_EDGE;
        const scale = Math.min(1, SHOT_MAX_EDGE / Math.max(width, height));
        const w = Math.max(1, Math.round(width * scale));
        const h = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', SHOT_QUALITY));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * The K-key feedback dialog (PLAN-v2 §10). Opening it grabs a screenshot of the current
 * frame (via the caller's `capture`), the player's location and bounded game state (via
 * `state`), and posts everything to `/api/feedback`. The module owns no game loop; it
 * self-registers the `feedback` action and holds a free cursor while the box is open.
 *
 * Returns null when the feature is flagged off.
 */
export function createFeedback(options: {
  actions?: Actions;
  parent?: HTMLElement;
  /** Returns a data URL of the current frame, or null. Optional: without it, text-only. */
  capture?: () => Promise<string | null> | string | null;
  /** Read once when the dialog opens, alongside capture; retries retain this state. */
  state?: () => FeedbackSnapshot | null;
  endpoint?: string;
  onModalChange?(open: boolean): void;
}) {
  if (!flags.feedback) return null;
  const endpoint = options.endpoint ?? '/api/feedback';
  const dialog = node('dialog', '', 'gt-feedback');
  dialog.setAttribute('aria-label', 'Send feedback');
  const eyebrow = node('p', 'SEND FEEDBACK', 'gt-feedback-eyebrow');
  const hint = node('p', 'What felt good or bad just now? Bugs, ideas, anything.', 'gt-feedback-hint');
  const textarea = document.createElement('textarea');
  textarea.className = 'gt-feedback-text'; textarea.maxLength = MAX_TEXT; textarea.rows = 5;
  textarea.placeholder = 'Type your feedback…';
  const shotRow = node('div', '', 'gt-feedback-shot');
  const shotImg = document.createElement('img'); shotImg.alt = 'Screenshot attached to this feedback'; shotImg.hidden = true;
  const shotLabel = node('label', '', 'gt-feedback-shot-label');
  const shotToggle = document.createElement('input'); shotToggle.type = 'checkbox'; shotToggle.checked = true;
  shotLabel.append(shotToggle, document.createTextNode(' Attach screenshot'));
  shotRow.append(shotImg, shotLabel);
  const status = node('p', '', 'gt-feedback-status'); status.setAttribute('role', 'status');
  const actionsRow = node('div', '', 'gt-feedback-actions');
  const cancel = node('button', 'Cancel'); cancel.type = 'button'; cancel.className = 'gt-feedback-cancel';
  const submit = node('button', 'Send'); submit.type = 'button'; submit.className = 'gt-feedback-send';
  actionsRow.append(cancel, submit);
  dialog.append(eyebrow, hint, textarea, shotRow, status, actionsRow);
  document.body.append(dialog);
  // Tappable launcher so mobile players (no F key) can open feedback from the host HUD; the F
  // action still works everywhere. No launcher when no parent is given (e.g. unit tests).
  let button: HTMLButtonElement | null = null;
  if (options.parent) {
    button = node('button', 'Send feedback · K', 'gt-feedback-launch');
    button.type = 'button'; options.parent.append(button);
  }

  let disposed = false, announced = false, sending = false, shot: string | null = null;
  let snapshot: FeedbackSnapshot = {};
  let capturedPath = '';
  let opening = 0;
  let closeTimer: number | null = null;
  let request: AbortController | undefined;

  function isCurrent(id: number) { return !disposed && dialog.open && id === opening; }
  function settleClosed() {
    // Native close events are queued; an earlier one may arrive after the next open.
    if (dialog.open || !announced) return;
    announced = false; opening++; sending = false; shot = null;
    request?.abort(); request = undefined;
    snapshot = {}; capturedPath = '';
    if (closeTimer !== null) { window.clearTimeout(closeTimer); closeTimer = null; }
    options.onModalChange?.(false);
  }
  function setStatus(text: string, kind: '' | 'error' | 'ok' = '') {
    status.textContent = text; status.dataset.kind = kind;
  }

  async function open() {
    if (disposed || dialog.open) return;
    const id = ++opening;
    // A taxi can keep moving while the player types. Copy the primitive fields now so
    // the report and any retries describe the captured scene, even if state is reused.
    try { snapshot = { ...options.state?.() }; } catch { snapshot = {}; }
    capturedPath = location.pathname + location.search;
    announced = true; options.onModalChange?.(true);
    textarea.value = ''; textarea.readOnly = false; setStatus(''); sending = false; submit.disabled = false; submit.textContent = 'Send';
    shot = null; shotImg.hidden = true; shotToggle.checked = true; shotToggle.disabled = true;
    shotLabel.lastChild!.textContent = ' Capturing screenshot…';
    dialog.showModal();
    textarea.focus({ preventScroll: true });
    let captured: string | null = null;
    try {
      const raw = await options.capture?.();
      if (!isCurrent(id)) return;
      captured = raw ? await downscale(raw) : null;
    } catch { /* Screenshot capture is optional; text feedback still works. */ }
    if (!isCurrent(id)) return;
    shot = captured;
    if (shot) {
      shotImg.src = shot; shotImg.hidden = false; shotToggle.disabled = false;
      shotLabel.lastChild!.textContent = ' Attach screenshot';
    } else {
      shotToggle.checked = false; shotToggle.disabled = true;
      shotLabel.lastChild!.textContent = ' Screenshot unavailable';
    }
  }

  function close() { if (dialog.open) dialog.close(); settleClosed(); }

  async function send() {
    if (disposed || !dialog.open || sending) return;
    const id = opening;
    const text = textarea.value.trim();
    if (!text) { setStatus('Type a little feedback first.', 'error'); textarea.focus(); return; }
    // Keep the submitted draft selectable, but do not accept edits that success would discard.
    sending = true; textarea.readOnly = true; submit.disabled = true; submit.textContent = 'Sending…'; setStatus('Sending…');
    const payload: Record<string, unknown> = {
      text,
      screenshot: shotToggle.checked ? shot : null,
      path: capturedPath,
      // gtasf-367l: stamp the deploy's changelog version so the founder can triage reports across the
      // day's rapid playtest deploys. Sent only when flags.feedbackBuildTag is on (the server stores it
      // only then too); undefined drops out of the JSON body otherwise.
      build: flags.feedbackBuildTag ? (latestSignature ?? undefined) : undefined,
      ...snapshot,
    };
    const attachedScreenshot = payload.screenshot !== null;
    const controller = new AbortController(); request = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal,
      });
      if (!isCurrent(id)) return;
      if (response.ok) {
        const data = await response.json().catch(() => ({})) as { screenshotStored?: boolean };
        if (!isCurrent(id)) return;
        setStatus(data.screenshotStored === false && attachedScreenshot
          ? 'Thanks! Sent (screenshot was too large to attach).' : 'Thanks! Feedback sent.', 'ok');
        closeTimer = window.setTimeout(() => {
          closeTimer = null;
          if (isCurrent(id)) close();
        }, 1100);
      } else {
        const data = await response.json().catch(() => ({})) as { error?: string };
        if (!isCurrent(id)) return;
        setStatus(data.error ?? 'Could not send feedback. Please try again.', 'error');
        sending = false; textarea.readOnly = false; submit.disabled = false; submit.textContent = 'Send';
      }
    } catch {
      if (!isCurrent(id)) return;
      setStatus(controller.signal.aborted
        ? 'Sending timed out. Your draft is kept; delivery could not be confirmed. Try again.'
        : 'Could not confirm delivery. Your draft is kept; check your connection and try again.', 'error');
      sending = false; textarea.readOnly = false; submit.disabled = false; submit.textContent = 'Send';
    } finally {
      window.clearTimeout(timeout);
      if (request === controller) request = undefined;
    }
  }

  cancel.addEventListener('click', close);
  submit.addEventListener('click', () => { void send(); });
  dialog.addEventListener('close', settleClosed);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  // Ctrl/Cmd+Enter submits from the textarea.
  textarea.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void send(); }
  });
  const offAction = options.actions?.on('feedback', () => { if (dialog.open) close(); else void open(); });
  button?.addEventListener('click', () => { void open(); });

  return {
    element: dialog,
    button,
    get isOpen() { return dialog.open; },
    open,
    close,
    destroy() {
      if (disposed) return; disposed = true;
      offAction?.();
      button?.remove();
      close();
      dialog.remove();
    },
  };
}
