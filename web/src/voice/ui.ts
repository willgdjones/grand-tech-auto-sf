import { flags } from '@gtasf/shared/flags';
import { holdFreeCursor } from '../input/cursor';
import type { createProximityVoice } from './client';
import { voiceGateOpen } from './gate';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '') {
  const element = document.createElement(tag); element.textContent = text; return element;
}
type Voice = NonNullable<ReturnType<typeof createProximityVoice>>;

/** Voice opt-in and player actions use the same client state; no storage or automatic permission. */
export function createVoiceUi(options: {
  parent: HTMLElement;
  voice: Voice;
  onModalChange(open: boolean): void;
  openCapTable(id: number): void;
  report(id: number, signal: AbortSignal): Promise<void>;
}) {
  if (!voiceGateOpen()) return null;
  const section = node('section'); section.className = 'gt-voice-options';
  const heading = node('h3', 'Proximity voice'), toggle = node('button', 'Enable voice'); toggle.type = 'button';
  const detail = node('p', 'Off by default. Enable to hear nearby players, your vehicle and your event. Hold V or the mic button to talk; only email-verified founders can transmit.');
  // Spoken bubbles change the privacy story (gtasf-qjja): clips are transcribed server-side, never stored.
  const privacy = node('p', flags.voiceCaptions
    ? 'Voice audio is never stored. Held clips are transcribed (ElevenLabs) into a chat bubble for nearby players; a transcript is kept only if you are reported (your last 2 minutes, deleted after 7 days). Microphone access is requested only when you hold to talk.'
    : 'Voice audio is not recorded or transcribed. Microphone access is requested only when you hold to talk after enabling voice.');
  const status = node('p'); status.setAttribute('role', 'status');
  section.append(heading, detail, toggle, privacy, status); options.parent.append(section);
  const unsubscribe = options.voice.subscribe(state => {
    toggle.textContent = state.enabled ? (state.pending ? 'Cancel voice connection' : 'Turn voice off') : 'Enable voice';
    toggle.setAttribute('aria-pressed', String(state.enabled)); status.textContent = state.status;
  });
  toggle.addEventListener('click', () => { void options.voice.setEnabled(!options.voice.state.enabled); });

  const dialog = node('dialog'); dialog.className = 'gt-voice-player'; dialog.setAttribute('aria-label', 'Player voice controls');
  const header = node('header'), title = node('h2'), close = node('button', 'Close ×'); close.type = 'button';
  header.append(title, close);
  const mute = node('button'), cap = node('button', 'View cap table'); mute.type = cap.type = 'button';
  const form = node('form'), explanation = node('p', 'Report recent voice abuse. Sending a report also mutes this player; no audio is recorded or attached.');
  const report = node('button', 'Report voice abuse and mute'); report.type = 'submit';
  const result = node('p'); result.setAttribute('role', 'status');
  form.append(explanation, report); dialog.append(header, mute, cap, form, result); document.body.append(dialog);
  let disposed = false, announced = false, target = 0, pending = false, generation = 0;
  let releaseCursor: (() => void) | undefined, priorFocus: HTMLElement | null = null, request: AbortController | undefined;
  function renderMute() { mute.textContent = options.voice.isMuted(target) ? 'Unmute player' : 'Mute player'; mute.setAttribute('aria-pressed', String(options.voice.isMuted(target))); }
  function settle() {
    if (dialog.open || !announced) return;
    announced = false; generation++; request?.abort(); request = undefined; pending = false;
    releaseCursor?.(); releaseCursor = undefined; options.onModalChange(false);
    if (priorFocus?.isConnected) priorFocus.focus({ preventScroll: true }); priorFocus = null;
  }
  function hide() { if (dialog.open) dialog.close(); settle(); }
  close.addEventListener('click', hide); dialog.addEventListener('close', settle);
  dialog.addEventListener('cancel', event => { event.preventDefault(); hide(); });
  mute.addEventListener('click', () => { options.voice.setMuted(target, !options.voice.isMuted(target)); renderMute(); });
  cap.addEventListener('click', () => { const id = target; hide(); options.openCapTable(id); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (disposed || pending || !dialog.open) return;
    pending = true; const current = generation, id = target; request = new AbortController();
    const controller = request, timeout = setTimeout(() => controller.abort(), 15_000);
    report.disabled = true; result.textContent = 'Sending report…';
    options.voice.setMuted(id, true); renderMute();
    void options.report(id, request.signal).then(() => {
      if (disposed || current !== generation) return;
      result.textContent = 'Report sent. This player is muted.'; report.textContent = 'Report sent';
    }).catch(error => {
      if (disposed || current !== generation) return;
      result.textContent = error instanceof Error && error.name !== 'AbortError' ? error.message : 'Report could not be sent. The player is still muted; try again.';
      pending = false; report.disabled = false;
    }).finally(() => clearTimeout(timeout));
  });
  return {
    get isOpen() { return dialog.open; },
    open(id: number, name: string) {
      if (disposed) return;
      hide(); target = id; title.textContent = name.trim() || 'Founder';
      report.disabled = false; report.textContent = 'Report voice abuse and mute'; result.textContent = ''; renderMute();
      priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      announced = true; options.onModalChange(true); releaseCursor = holdFreeCursor();
      if (document.pointerLockElement) document.exitPointerLock();
      dialog.showModal(); close.focus({ preventScroll: true });
    },
    hide,
    playerLeft(id: number) { if (dialog.open && target === id) hide(); },
    destroy() { if (disposed) return; hide(); disposed = true; unsubscribe(); section.remove(); dialog.remove(); },
  };
}
