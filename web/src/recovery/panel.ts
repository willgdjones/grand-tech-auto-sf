import { isRecoveryCode } from '@gtasf/shared/recovery';
import { recoveryStatus, saveRecoveryCode, restoreRecovery } from './client';
import { qrSvg } from './qr';
import { holdFreeCursor } from '../input/cursor';
import { renderChannel } from '../render/events';
import './panel.css';

/**
 * Account-recovery UI (gtasf-17df): "Save your startup" (show the GTASF-XXXX-XXXX code, copy + QR)
 * and "I already have a startup" (enter a code to restore). Self-contained <dialog>s so they can be
 * opened from Game options, the post-first-round prompt, or the onboarding screen. All text is set
 * via textContent; the only innerHTML is our own generated QR SVG string.
 */

const activeDialogs = new Map<HTMLDialogElement, () => void>();
const dialogChanges = renderChannel<boolean>();
export const isRecoveryDialogOpen = (): boolean => activeDialogs.size > 0;
export const onRecoveryDialogChange = (listener: (open: boolean) => void): (() => void) => dialogChanges.on(listener);
export function closeRecoveryDialogs(): void { for (const close of [...activeDialogs.values()]) close(); }

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}
function button(label: string, className = ''): HTMLButtonElement {
  const element = node('button', className, label); element.type = 'button'; return element;
}
function openDialog(body: HTMLElement, label: string): HTMLDialogElement {
  const dialog = node('dialog', 'gt-recovery'); dialog.setAttribute('aria-label', label);
  const close = button('Close ×', 'gt-recovery-close'); close.setAttribute('aria-label', 'Close');
  let releaseCursor: (() => void) | undefined;
  function settleClosed() {
    if (dialog.open || !activeDialogs.delete(dialog)) return;
    releaseCursor?.(); releaseCursor = undefined;
    dialog.remove(); dialogChanges.emit(isRecoveryDialogOpen());
  }
  function closeDialog() { if (dialog.open) dialog.close(); settleClosed(); }
  close.onclick = closeDialog;
  dialog.append(close, body); document.body.append(dialog);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener('close', settleClosed);
  dialog.showModal();
  activeDialogs.set(dialog, closeDialog); releaseCursor = holdFreeCursor();
  if (document.pointerLockElement) document.exitPointerLock();
  dialogChanges.emit(true);
  return dialog;
}

/** Save-your-startup dialog: generate/regenerate and show the recovery code with copy + QR. */
export function openSaveStartup(options: { getOutfit?: () => string | undefined } = {}): void {
  const body = node('div', 'gt-recovery-body');
  body.append(node('h2', 'gt-recovery-title', 'Save your startup'));
  const blurb = node('p', 'gt-recovery-blurb',
    'Your startup lives on this device. Save a recovery code to get it back on a new phone or browser — your name, funding, cap table and referral link all come with it.');
  const status = node('p', 'gt-recovery-status'); status.setAttribute('role', 'status'); status.hidden = true;
  const action = node('div', 'gt-recovery-action');
  const result = node('div', 'gt-recovery-result'); result.hidden = true;
  body.append(blurb, action, result, status);
  const dialog = openDialog(body, 'Save your startup');
  let generating = false;

  const setStatus = (text: string, tone = 'idle') => { status.textContent = text; status.dataset.tone = tone; status.hidden = !text; };
  function showCode(code: string) {
    action.hidden = true; result.hidden = false; result.replaceChildren();
    const code4 = node('p', 'gt-recovery-code', code);
    const row = node('div', 'gt-recovery-code-row');
    const copy = button('Copy code', 'gt-recovery-copy');
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(code); copy.textContent = 'Copied ✓'; }
      catch {
        if (!dialog.open || !code4.isConnected) return;
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange(); range.selectNodeContents(code4);
          selection.removeAllRanges(); selection.addRange(range);
          copy.textContent = 'Code selected · press ⌘/Ctrl-C';
        } else copy.textContent = 'Select the code above to copy';
      }
    };
    row.append(copy);
    const qr = node('div', 'gt-recovery-qr');
    try { qr.innerHTML = qrSvg(code, { moduleSize: 5, margin: 3 }); qr.setAttribute('aria-label', 'Recovery code QR'); }
    catch { qr.hidden = true; }
    const warn = node('p', 'gt-recovery-warn', 'Write it down or screenshot it now — we only show it once. Anyone with this code can load your startup.');
    const regen = button('Generate a new code', 'gt-recovery-regen');
    regen.onclick = () => void generate();
    result.append(code4, row, qr, warn, regen);
  }
  async function generate() {
    if (generating || !dialog.open) return;
    generating = true;
    const controls = body.querySelectorAll<HTMLButtonElement>('button');
    for (const control of controls) control.disabled = true;
    setStatus('Generating…', 'working'); result.hidden = true; action.hidden = false;
    try {
      const code = await saveRecoveryCode(options.getOutfit?.());
      if (!dialog.open || !dialog.isConnected) return;
      showCode(code); setStatus('');
    } catch { if (dialog.open) setStatus('Could not generate a code. Try again.', 'error'); }
    finally { generating = false; for (const control of controls) control.disabled = false; }
  }

  setStatus('Checking…', 'working');
  recoveryStatus().then(state => {
    if (!dialog.open || !dialog.isConnected) return;
    setStatus('');
    const generate0 = button(state.hasCode ? 'Show a new code' : 'Generate my recovery code', 'gt-recovery-primary');
    generate0.onclick = () => void generate();
    action.append(generate0);
    if (state.hasCode) action.append(node('p', 'gt-recovery-note',
      'You already saved a code. We can’t show the old one again; generating a new one replaces it.'));
    setTimeout(() => { if (dialog.open) generate0.focus(); }, 0);
  }).catch(() => { if (dialog.open) setStatus('Recovery is unavailable right now.', 'error'); });
}

/** Restore dialog: enter a code to rebind this device to an existing startup. */
export function openRestoreStartup(options: { onRestored?: () => void } = {}): void {
  const body = node('div', 'gt-recovery-body');
  body.append(node('h2', 'gt-recovery-title', 'I already have a startup'));
  body.append(node('p', 'gt-recovery-blurb', 'Enter your recovery code to load your startup onto this device.'));
  const form = node('form', 'gt-recovery-form');
  const input = node('input', 'gt-recovery-input'); input.type = 'text'; input.placeholder = 'GTASF-XXXX-XXXX';
  input.autocomplete = 'off'; input.spellcheck = false; input.setAttribute('aria-label', 'Recovery code');
  const submit = button('Restore my startup', 'gt-recovery-primary'); (submit as HTMLButtonElement).type = 'submit';
  form.append(input, submit);
  const status = node('p', 'gt-recovery-status'); status.setAttribute('role', 'status'); status.hidden = true;
  body.append(form, status);
  const dialog = openDialog(body, 'Restore your startup');
  setTimeout(() => { if (dialog.open) input.focus(); }, 0);
  const setStatus = (text: string, tone = 'idle') => { status.textContent = text; status.dataset.tone = tone; status.hidden = !text; };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const code = input.value.trim();
    if (!isRecoveryCode(code)) { setStatus('That doesn’t look like a GTASF-XXXX-XXXX code.', 'error'); return; }
    submit.disabled = true; setStatus('Restoring…', 'working');
    try {
      const result = await restoreRecovery(code);
      try { if (result.outfit) localStorage.setItem('gtasf.outfit', result.outfit); } catch { /* storage optional */ }
      setStatus(`Welcome back, ${result.profile.startupName || 'founder'}! Reloading…`, 'ok');
      if (options.onRestored) options.onRestored();
      else setTimeout(() => location.reload(), 700); // Re-init the game as the recovered profile.
    } catch (error) {
      submit.disabled = false;
      setStatus(error instanceof Error ? error.message : 'Could not restore that code.', 'error');
    }
  });
}
