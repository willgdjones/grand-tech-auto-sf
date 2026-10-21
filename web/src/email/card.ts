import {
  EMAIL_PITCH, EMAIL_CONSENT, EMAIL_RESEND_SEC, isWellFormedEmailCode, isPlausibleEmail, type EmailReward,
} from '@gtasf/shared/email/contract';
import { emailStatus, startEmailCapture, verifyEmailCode } from './client';
import { flags } from '@gtasf/shared/flags';
import { holdFreeCursor } from '../input/cursor';
import { openSaveStartup } from '../recovery/panel';
import { renderChannel } from '../render/events';
import { track } from '../analytics';
import './card.css';

/**
 * Email-capture SA card (emailCapture, gtasf-1aon). Optional "Save your startup" flow: enter an email ->
 * verify with the 6-digit code (or the magic link in the inbox) -> earn the Verified Founder tick + a
 * one-time cheque. Never blocking: "Not now" is as prominent as the primary action. Self-contained <dialog>
 * opened after the first cheque / at the first star (onboarding flow) or from Game options. The caller owns
 * WHEN to show it (markEmailPrompted / emailPromptPending) and gates on emailStatus().available first.
 */

const activeDialogs = new Map<HTMLDialogElement, () => void>();
/** Inline (non-modal) cards, e.g. 'Enter your email to talk': closable like the others but they don't block play. */
const inlineDialogs = new Set<HTMLDialogElement>();
const dialogChanges = renderChannel<boolean>();
export const isEmailDialogOpen = (): boolean => activeDialogs.size > inlineDialogs.size;
export const onEmailDialogChange = (listener: (open: boolean) => void): (() => void) => dialogChanges.on(listener);
export function closeEmailDialogs(): void { for (const close of [...activeDialogs.values()]) close(); }

/** Human label for the HUD / Game-options status line. */
export function emailStatusLabel(verified: boolean): string { return verified ? 'Email: Verified ✓' : 'Email: unverified'; }

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}
function button(label: string, className = ''): HTMLButtonElement {
  const element = node('button', className, label); element.type = 'button'; return element;
}
function dollars(cents: number): string { return `$${Math.round(cents / 100).toLocaleString()}`; }

function openDialog(body: HTMLElement, label: string, inline = false): HTMLDialogElement {
  const dialog = node('dialog', inline ? 'gt-email gt-email-inline' : 'gt-email'); dialog.setAttribute('aria-label', label);
  const close = button('Close ×', 'gt-email-close'); close.setAttribute('aria-label', 'Close');
  let releaseCursor: (() => void) | undefined;
  function settleClosed() {
    if (dialog.open || !activeDialogs.delete(dialog)) return;
    inlineDialogs.delete(dialog);
    releaseCursor?.(); releaseCursor = undefined;
    dialog.remove(); dialogChanges.emit(isEmailDialogOpen());
  }
  function closeDialog() { if (dialog.open) dialog.close(); settleClosed(); }
  close.onclick = closeDialog;
  dialog.append(close, body); document.body.append(dialog);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener('close', settleClosed);
  if (inline) {
    // Non-modal: play continues (one thumb on phone); only a desktop pointer lock is released so you can type.
    dialog.show(); inlineDialogs.add(dialog); activeDialogs.set(dialog, closeDialog);
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    dialog.showModal();
    activeDialogs.set(dialog, closeDialog); releaseCursor = holdFreeCursor();
    if (document.pointerLockElement) document.exitPointerLock();
  }
  dialogChanges.emit(true);
  return dialog;
}

export interface EmailCaptureOptions {
  /** Where the card opened from (analytics + nothing PII): 'onboarding' | 'first_star' | 'game_options'. */
  source?: string;
  /** Called after a successful verification with the granted reward. */
  onVerified?: (reward: EmailReward) => void;
  /** Called when the player dismisses with "Not now" (the caller bumps the prompt count). */
  onDismissed?: () => void;
  /** Non-modal card anchored above the thumb controls, with its own title/blurb (proximity voice). */
  inline?: { title: string; blurb: string };
}

/** Open the optional email-capture card. The caller must have confirmed emailStatus().available first. */
export function openEmailCapture(options: EmailCaptureOptions = {}): void {
  const source = /^[a-zA-Z0-9_.:-]{1,100}$/.test(options.source ?? '') ? options.source : 'onboarding';
  const body = node('div', 'gt-email-body');
  body.append(node('div', 'gt-email-kicker', 'San Francisco · Tech Week'));
  body.append(node('h2', 'gt-email-title', options.inline?.title ?? 'Save your startup'));
  body.append(node('p', 'gt-email-blurb', options.inline?.blurb ?? EMAIL_PITCH));
  const status = node('p', 'gt-email-status'); status.setAttribute('role', 'status'); status.hidden = true;
  const setStatus = (text: string, tone = 'idle') => { status.textContent = text; status.dataset.tone = tone; status.hidden = !text; };

  // --- Step 1: email entry ---
  const emailInput = node('input', 'gt-email-input'); emailInput.type = 'email';
  emailInput.placeholder = 'you@startup.com'; emailInput.autocomplete = 'email'; emailInput.setAttribute('aria-label', 'Email address');
  const actions = node('div', 'gt-email-actions');
  const sendBtn = button('Email me a code', 'gt-email-primary');
  const notNow = button('Not now', 'gt-email-secondary');
  actions.append(sendBtn, notNow);
  const consent = node('p', 'gt-email-consent', EMAIL_CONSENT);
  body.append(emailInput, actions, consent, status);

  const dialog = openDialog(body, options.inline?.title ?? 'Save your startup', Boolean(options.inline));
  let dismissed = true; // closing without verifying counts as "not now" for the caller's prompt count
  dialog.addEventListener('close', () => { if (dismissed) options.onDismissed?.(); }, { once: true });
  setTimeout(() => { if (dialog.open) emailInput.focus(); }, 0);

  notNow.onclick = () => dialog.close();

  emailInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); sendBtn.click(); }
  });
  sendBtn.onclick = async () => {
    if (sendBtn.disabled) return;
    const email = emailInput.value.trim().toLowerCase();
    if (!isPlausibleEmail(email)) { setStatus('Enter a valid email address.', 'error'); return; }
    sendBtn.disabled = true; notNow.disabled = true; setStatus('Sending your code…', 'working');
    try {
      const { resendAfterSec, expiresInMin } = await startEmailCapture(email);
      if (!dialog.open) return;
      showCodeStep(email, resendAfterSec, expiresInMin);
    } catch (error) {
      if (!dialog.open) return;
      sendBtn.disabled = false; notNow.disabled = false;
      setStatus(error instanceof Error ? error.message : 'Could not send. Try again.', 'error');
    }
  };

  // --- Step 2: code entry ---
  function showCodeStep(email: string, resendAfterSec: number, expiresInMin: number): void {
    emailInput.hidden = true; consent.hidden = true; actions.hidden = true;
    body.querySelector('.gt-email-blurb')!.textContent = `We sent a code to ${email}. Enter it below, or tap the link in the email — valid ${expiresInMin} min.`;
    const codeInput = node('input', 'gt-email-input gt-email-code'); codeInput.type = 'text';
    codeInput.inputMode = 'numeric'; codeInput.maxLength = 6; codeInput.placeholder = '000000';
    codeInput.autocomplete = 'one-time-code'; codeInput.setAttribute('aria-label', 'Verification code');
    const step2 = node('div', 'gt-email-actions');
    const verifyBtn = button('Verify', 'gt-email-primary');
    const resendBtn = button(`Resend in ${resendAfterSec}s`, 'gt-email-secondary'); resendBtn.disabled = true;
    const changeEmail = button('Change email', 'gt-email-secondary');
    step2.append(verifyBtn, resendBtn, changeEmail);
    body.insertBefore(codeInput, status); body.insertBefore(step2, status);
    setStatus('Code sent. Not there? Check Spam or Promotions.', 'ok'); setTimeout(() => { if (dialog.open) codeInput.focus(); }, 0);

    let timer: ReturnType<typeof setInterval> | undefined;
    let busy = false, resendDeadline = 0;
    const refreshActions = () => {
      const remaining = Math.max(0, Math.ceil((resendDeadline - Date.now()) / 1000));
      verifyBtn.disabled = busy;
      changeEmail.disabled = busy;
      resendBtn.disabled = busy || remaining > 0;
      codeInput.readOnly = busy;
      resendBtn.textContent = remaining > 0 ? `Resend in ${remaining}s` : 'Resend code';
      return remaining;
    };
    codeInput.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); verifyBtn.click(); }
    });
    const stopCountdown = () => { if (timer !== undefined) clearInterval(timer); timer = undefined; };
    function startCountdown(seconds: number): void {
      stopCountdown();
      resendDeadline = Date.now() + Math.max(0, Number.isFinite(seconds) ? seconds : EMAIL_RESEND_SEC) * 1000;
      const tick = () => {
        if (!dialog.open) { stopCountdown(); return; }
        const remaining = refreshActions();
        if (!remaining) stopCountdown();
      };
      timer = setInterval(tick, 1000); tick();
    }
    startCountdown(resendAfterSec);
    dialog.addEventListener('close', stopCountdown, { once: true });
    changeEmail.onclick = () => {
      if (busy) return;
      stopCountdown();
      dialog.removeEventListener('close', stopCountdown);
      codeInput.remove(); step2.remove();
      emailInput.hidden = false; consent.hidden = false; actions.hidden = false;
      sendBtn.disabled = false; notNow.disabled = false;
      body.querySelector('.gt-email-blurb')!.textContent = EMAIL_PITCH;
      setStatus('');
      emailInput.focus(); emailInput.select();
    };

    resendBtn.onclick = async () => {
      if (busy || Date.now() < resendDeadline) return;
      busy = true; refreshActions(); setStatus('Resending…', 'working');
      try {
        const result = await startEmailCapture(email);
        if (!dialog.open || !dismissed) return;
        startCountdown(result.resendAfterSec);
        setStatus('Code sent. Not there? Check Spam or Promotions.', 'ok');
      } catch {
        if (!dialog.open || !dismissed) return;
        setStatus('Could not resend right now.', 'error');
      } finally {
        busy = false;
        if (dialog.open && dismissed) refreshActions();
      }
    };

    verifyBtn.onclick = async () => {
      if (busy) return;
      const code = codeInput.value.trim();
      if (!isWellFormedEmailCode(code)) { setStatus('Enter the 6-digit code.', 'error'); return; }
      busy = true; refreshActions(); setStatus('Verifying…', 'working');
      try {
        const result = await verifyEmailCode(code);
        if (!dialog.open) return;
        if (result.verified && result.reward) {
          stopCountdown(); dismissed = false;
          track('email_captured', { source });
          showVerified(result.reward); options.onVerified?.(result.reward);
        } else {
          const left = typeof result.attemptsLeft === 'number' ? ` ${result.attemptsLeft} tries left.` : '';
          setStatus((result.error || 'That code is not right.') + left, 'error');
        }
      } catch {
        if (!dialog.open) return;
        setStatus('Could not verify right now. Try again.', 'error');
      } finally {
        busy = false;
        if (dialog.open && dismissed) refreshActions();
      }
    };
  }

  // --- Step 3: verified + reward reveal ---
  function showVerified(reward: EmailReward): void {
    body.replaceChildren();
    body.append(node('div', 'gt-email-kicker', 'Verified founder'));
    body.append(node('h2', 'gt-email-title', 'Email verified'));
    body.append(node('p', 'gt-email-blurb', 'Your email is verified. We’ll send you a Tech Week recap.'));
    const box = node('div', 'gt-email-reward');
    box.append(node('div', 'gt-email-reward-tick', '✓ Verified Founder tick unlocked'));
    if (reward.bonusCents > 0) box.append(node('div', 'gt-email-reward-cheque', `+ ${dollars(reward.bonusCents)} one-time cheque`));
    body.append(box);
    const done = button('Back to the city', 'gt-email-primary');
    done.onclick = () => dialog.close();
    const row = node('div', 'gt-email-actions');
    if (flags.accountRecovery) {
      body.append(node('p', 'gt-email-blurb', 'Save a recovery code to restore your startup on another device.'));
      const save = button('Get recovery code', 'gt-email-secondary');
      save.onclick = () => {
        closeEmailDialogs();
        openSaveStartup({ getOutfit: () => {
          try { return localStorage.getItem('gtasf.outfit') ?? undefined; } catch { return undefined; }
        } });
      };
      row.append(save);
    }
    row.append(done); body.append(row);
    setTimeout(() => { if (dialog.open) done.focus(); }, 0);
  }
}

/** Convenience for Game options / the flow: resolve availability+status, then open if usable. Returns the
 *  status so the caller can also render the "Email: unverified/Verified ✓" label. */
export async function openEmailCaptureIfAvailable(options: EmailCaptureOptions = {}): Promise<{ opened: boolean; verified: boolean }> {
  try {
    const s = await emailStatus();
    if (!s.available || s.verified) return { opened: false, verified: s.verified };
    openEmailCapture(options);
    return { opened: true, verified: false };
  } catch {
    return { opened: false, verified: false };
  }
}
