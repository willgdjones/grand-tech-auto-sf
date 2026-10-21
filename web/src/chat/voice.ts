import { flags } from '@gtasf/shared/flags';
import './voice.css';

/**
 * Hold-to-talk proximity voice chat (FB2 gtasf-slzj). Uses the free browser Web Speech API to
 * transcribe locally, then posts the transcript through the caller's `sendText` — i.e. the exact same
 * CHAT path + server Jev moderation as typed chat. A server ElevenLabs STT adapter (worker/src/voice)
 * is the fallback for browsers without Web Speech. Flagged off (voiceChat) until browser/mic QA.
 *
 * Returns null when flagged off. When the browser lacks speech recognition, the button is shown
 * disabled with an explanation rather than silently missing.
 */
interface SpeechRecognitionLike {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort?(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function createVoiceChat(options: {
  parent?: HTMLElement; sendText(text: string): boolean; setStatus?(message: string): void; enabled?: boolean;
}) {
  if (!(options.enabled ?? ('voiceChat' in flags && Boolean((flags as Record<string, boolean>).voiceChat)))) return null;
  const Ctor = ((window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor })
    .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition);

  const button = document.createElement('button');
  button.type = 'button'; button.className = 'gt-chat-mic';
  button.textContent = '🎤 Hold to talk'; button.setAttribute('aria-label', 'Hold to talk (voice chat)');
  (options.parent ?? document.body).append(button);

  if (!Ctor) {
    button.disabled = true;
    button.title = 'Voice chat needs a browser with speech recognition (e.g. Chrome). You can still type.';
    return { button, destroy() { button.remove(); } };
  }

  const Recognition = Ctor; // non-nullable after the guard above (used inside the start() closure)
  let rec: SpeechRecognitionLike | null = null, listening = false;
  function stop() {
    if (rec && listening) { try { rec.stop(); } catch { /* already stopped */ } }
    listening = false; button.dataset.listening = 'false';
  }
  function start() {
    if (listening) return;
    rec = new Recognition(); rec.lang = 'en-US'; rec.interimResults = false; rec.continuous = false; rec.maxAlternatives = 1;
    rec.onresult = event => { const t = event.results?.[0]?.[0]?.transcript?.trim(); if (t) options.sendText(t); };
    rec.onerror = event => options.setStatus?.(event.error === 'not-allowed' ? 'Microphone permission denied.' : 'Voice input error — try typing.');
    rec.onend = () => { listening = false; button.dataset.listening = 'false'; };
    try { rec.start(); listening = true; button.dataset.listening = 'true'; options.setStatus?.('Listening… release to send.'); }
    catch { listening = false; button.dataset.listening = 'false'; }
  }
  // Press-and-hold to talk; release (or leave) to transcribe + send.
  button.addEventListener('pointerdown', event => { event.preventDefault(); start(); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel'] as const) button.addEventListener(ev, stop);

  return { button, destroy() { stop(); rec?.abort?.(); button.remove(); } };
}
