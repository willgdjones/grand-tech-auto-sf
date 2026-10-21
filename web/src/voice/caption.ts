import { flags } from '@gtasf/shared/flags';
import { createPushToTalk, talkLabel } from './ptt';
import { VOICE_GATE_HEADER } from './gate';
import { track } from '../analytics';

/** Spoken bubbles, client half (gtasf-gc9q, docs/engineering/spoken-bubbles.md). Hold V or the mic button: a short
 *  clip is recorded (MediaRecorder, 8 s max) and POSTed to /api/voice/caption; the server transcribes, moderates and
 *  broadcasts a 🎙 chat bubble. The transcript never comes from the client. No audio is kept anywhere. */
export const CAPTION_MAX_MS = 8_000, CAPTION_MIN_MS = 400;
/** Pitch clips (flags.pitching, next to an angel/VC): up to 15 s, matching the server's PITCH_MAX_SECONDS. */
export const PITCH_MAX_MS = 15_000;
/** A press whose mic opened late (cold first press) and captured less than this is discarded, never sent. */
export const CAPTION_LATE_MIN_MS = 1_500;
const LATE_MIC_MS = 250;
export type CaptionResult = 'sent' | 'empty' | 'rejected' | 'paused' | 'busy' | 'error';
/** Server pitch outcome riding on a caption response (worker/src/pitch/pitch.ts PitchOutcome, + 'unnamed'). */
export type CaptionPitch =
  | { status: 'judged'; credited: boolean; score: number; verdict: string; amountCents: string; judge: 'ai' | 'fallback' }
  | { status: 'blocked'; reason: 'moderation' | 'cooldown' } | { status: 'unnamed' };

/** Captions follow voicePublic, or this tab's ?voice=1, independently of the proximity-voice opt-in. */
export function captionGateOpen(): boolean {
  if (!flags.voiceCaptions) return false;
  if (flags.voicePublic) return true;
  try {
    if (new URLSearchParams(location.search).get('voice') === '1') sessionStorage.setItem('gtasf.voice', '1');
    return sessionStorage.getItem('gtasf.voice') === '1';
  } catch { return new URLSearchParams(location.search).get('voice') === '1'; }
}

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'])
    if (MediaRecorder.isTypeSupported?.(type)) return type;
  return undefined;
}

export function createSpokenCaptions(options: {
  /** Proximity voice is enabled: its own push-to-talk owns V/the button and calls hold() for us. */
  voiceActive(): boolean;
  canTalk(): boolean;
  connected(): boolean;
  /** This tab's player id (WELCOME), so the server attributes the clip to this tab, not another tab of this browser. */
  playerId?(): number;
  /** Speaker's own bubble: '…' while transcribing, or a short status. */
  showSpeaking(text: string, ms: number): void;
  /** showSpeaking unless the speaker's real (server) bubble is already showing. */
  showSpeakingIfPending?(text: string, ms: number): void;
  clearSpeaking(): void;
  /** Living map pitching (flag pitching): the server judged this caption as a pitch to a nearby angel/VC. */
  onPitch?(pitch: CaptionPitch): void;
  /** True while the player stands next to a pitchable investor: the hold may run 15 s and is sent as a pitch. */
  pitchReady?(): boolean;
  parent?: HTMLElement;
}) {
  if (!captionGateOpen() || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return null;
  const gated = !flags.voicePublic;
  let stream: MediaStream | undefined, recorder: MediaRecorder | undefined, startedAt = 0, autoStop: ReturnType<typeof setTimeout> | undefined;
  let lateStart = false, discard = false;
  let uploading = false, disposed = false, generation = 0, clipPitch = false;
  // Our own V / mic button while voice is off. With voice on, its PTT stops V first and forwards via hold().
  const ptt = createPushToTalk({ canStart: () => !disposed && !options.voiceActive() && options.canTalk() && options.connected(),
    onPress: () => { void begin(); }, onRelease: () => end() });
  ptt.button.textContent = talkLabel(false); ptt.button.classList.add('gt-caption-ptt');
  ptt.button.setAttribute('aria-label', 'Hold to say something to nearby players');
  const sync = () => ptt.setEnabled(!disposed && !options.voiceActive());
  sync();

  // The mic is opened once (first press) and then kept for the tab's life with its tracks disabled between holds, like
  // proximity voice: on live, getUserMedia took ~5 s, and reopening it per hold ate most of every hold. One in-flight
  // request is shared by every press, so a hold during the prompt waits for it instead of doing nothing.
  let micRequest: Promise<MediaStream | undefined> | undefined;
  const liveMic = () => stream?.getAudioTracks().some(track => track.readyState === 'live') ? stream : undefined;
  const setMicEnabled = (enabled: boolean) => { for (const track of stream?.getAudioTracks() ?? []) track.enabled = enabled; };
  function micStream(): Promise<MediaStream | undefined> {
    const open = liveMic();
    if (open) return Promise.resolve(open);
    micRequest ??= (async () => {
      try {
        const opened = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        if (disposed) { for (const track of opened.getTracks()) track.stop(); return undefined; }
        stream = opened; setMicEnabled(false); return opened;
      } catch { options.showSpeaking('Allow the microphone to talk.', 3500); return undefined; }
      finally { micRequest = undefined; }
    })();
    return micRequest;
  }
  async function begin(): Promise<void> {
    if (disposed || recorder || uploading) return;
    const press = ++generation, pressedAt = performance.now();
    if (!liveMic()) options.showSpeaking('Mic warming up…', 6000);
    const mic = await micStream();
    // The press may already be over (permission prompt, quick tap): don't start a stale recording, but say so.
    if (mic && !disposed && press !== generation && !recorder) { options.showSpeaking('Mic ready: hold V again to talk.', 3000); return; }
    if (!mic || disposed || press !== generation || recorder) return;
    const mimeType = pickMime();
    const current = new MediaRecorder(mic, mimeType ? { mimeType, audioBitsPerSecond: 32_000 } : { audioBitsPerSecond: 32_000 });
    const chunks: Blob[] = [];
    current.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    current.onstop = () => { if (discard) { discard = false; options.showSpeaking('Mic ready: hold V again to talk.', 3000); return; } void upload(new Blob(chunks, { type: current.mimeType || mimeType || 'audio/webm' }), performance.now() - startedAt); };
    setMicEnabled(true);
    recorder = current; startedAt = performance.now(); lateStart = startedAt - pressedAt > LATE_MIC_MS; current.start();
    clipPitch = flags.pitching && (options.pitchReady?.() ?? false);
    const maxMs = clipPitch ? PITCH_MAX_MS : CAPTION_MAX_MS;
    options.showSpeaking('…', maxMs + 4000);
    autoStop = setTimeout(() => { ptt.release(); end(); }, maxMs); // 8 s max (15 s for a pitch), then it sends
  }
  function stopRecording(): void {
    if (autoStop !== undefined) clearTimeout(autoStop); autoStop = undefined;
    const current = recorder; recorder = undefined;
    if (current && current.state !== 'inactive') current.stop();
    setMicEnabled(false);
  }
  function end(): void {
    generation++;
    if (!recorder) return;
    // Cold first press: the mic opened late, so most of the hold was lost. Never record past release (privacy);
    // a too-short late clip is dropped with 'hold V again' instead of sending audio that transcribes to nothing.
    discard = lateStart && performance.now() - startedAt < CAPTION_LATE_MIN_MS;
    stopRecording();
  }
  async function upload(blob: Blob, clipMs: number): Promise<void> {
    if (disposed) return;
    if (clipMs < CAPTION_MIN_MS || blob.size === 0) { options.clearSpeaking(); return; }
    uploading = true;
    let result: CaptionResult = 'error';
    try {
      const response = await fetch('/api/voice/caption', { method: 'POST', body: blob, credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': blob.type, 'X-GTASF-Clip-Ms': String(Math.round(Math.min(clipMs, clipPitch ? PITCH_MAX_MS : CAPTION_MAX_MS))), ...(gated ? { [VOICE_GATE_HEADER]: '1' } : {}),
          ...(clipPitch ? { 'X-GTASF-Pitch': '1' } : {}),
          ...(options.playerId?.() ? { 'X-GTASF-Player': String(options.playerId()) } : {}) },
        signal: AbortSignal.timeout(15_000) });
      const body = await response.json().catch(() => ({})) as { status?: string; error?: string; pitch?: CaptionPitch };
      if (flags.pitching && body.pitch && typeof body.pitch === 'object') options.onPitch?.(body.pitch);
      result = body.status === 'sent' ? 'sent' : body.status === 'empty' ? 'empty' : body.status === 'rejected' ? 'rejected'
        : body.error === 'captions-paused' ? 'paused' : body.error === 'rate' ? 'busy' : 'error';
    } catch { result = 'error'; }
    finally { uploading = false; }
    if (disposed) return;
    // 'sent': the server's CHAT_BROADCAST replaces the placeholder; if it never arrives, clear after a short grace.
    // 'sent': the broadcast usually beat this 200; never cover the real bubble with a placeholder.
    track('voice_caption', { outcome: result }); // consent-gated; outcome only (no audio or text)
    if (result === 'sent') (options.showSpeakingIfPending ?? options.showSpeaking)('…', 2500);
    else if (result === 'empty') options.showSpeaking("Didn't catch that. Hold V while you talk.", 3000);
    else options.showSpeaking({ rejected: 'Not shown (moderation).', paused: 'Spoken bubbles are paused right now.', busy: 'Slow down a moment.', error: "Couldn't send that." }[result], 3000);
  }
  return {
    /** Proximity voice's push-to-talk hold/release (voice on): record the same hold as a caption. */
    hold(held: boolean) { if (held) { if (options.canTalk() && options.connected()) void begin(); } else end(); },
    /** Call when the voice opt-in changes so only one hold-to-talk button shows. */
    sync,
    destroy() { disposed = true; stopRecording(); ptt.destroy(); for (const track of stream?.getTracks() ?? []) track.stop(); stream = undefined; },
  };
}
