/**
 * Speech-to-text adapter for proximity voice chat (FB2 gtasf-slzj). The client transcribes with the
 * free browser Web Speech API first; this is the server fallback for browsers without it (e.g. some
 * mobile). The ElevenLabs Scribe key (ELEVENLABS_API_KEY) is not provisioned yet, so createSttAdapter
 * returns null until it is — callers then fall back to "voice unavailable" and the player types.
 *
 * Whatever transcript comes back is treated exactly like a typed message: it goes through the same Jev
 * chat moderation before broadcast. This module only turns audio into text; it never broadcasts.
 */
export interface SttResult {
  ok: boolean;
  /** The recognized transcript, or null when nothing usable was heard. */
  transcript: string | null;
  reason?: string;
  /** Audio length the provider processed (end of the last recognised word/sound), for billing reconciliation. */
  durationSeconds?: number;
}

/** Transcribe a short audio clip. `mimeType` is the clip's container (e.g. audio/webm). */
export type SttAdapter = (audio: ArrayBuffer, opts: { mimeType: string; language?: string }) => Promise<SttResult>;

const ELEVENLABS_SCRIBE_URL = 'https://api.elevenlabs.io/v1/speech-to-text';
/** ElevenLabs batch speech-to-text model (spoken bubbles). Verify against the current model list when the key lands. */
export const SCRIBE_MODEL_ID = 'scribe_v1';
const MAX_CLIP_BYTES = 1_000_000; // ~a few seconds of compressed speech; reject larger uploads.

/** ElevenLabs Scribe adapter. Fail-closed: any error returns ok:false with no transcript. */
export function createElevenLabsStt(apiKey: string, fetcher: typeof fetch = fetch): SttAdapter {
  if (!apiKey.trim()) throw new Error('ELEVENLABS_API_KEY required for the STT adapter');
  return async (audio, opts) => {
    if (audio.byteLength === 0 || audio.byteLength > MAX_CLIP_BYTES) return { ok: false, transcript: null, reason: 'Clip missing or too large.' };
    try {
      const form = new FormData();
      form.append('model_id', SCRIBE_MODEL_ID); // no language_code: Scribe auto-detects
      if (opts.language) form.append('language_code', opts.language);
      form.append('file', new Blob([audio], { type: opts.mimeType || 'audio/webm' }), 'clip');
      const response = await fetcher(ELEVENLABS_SCRIBE_URL, { method: 'POST', headers: { 'xi-api-key': apiKey }, body: form });
      if (!response.ok) {
        // Provider error status code only (e.g. 'detected_unusual_activity', 'invalid_api_key'), never content.
        const detail = await response.json().then(body => String((body as { detail?: { status?: unknown } })?.detail?.status ?? ''), () => '').catch(() => '');
        return { ok: false, transcript: null, reason: `Transcription failed (${response.status}${detail ? ` ${detail.slice(0, 60)}` : ''}).` };
      }
      const data = await response.json() as { text?: unknown; words?: unknown };
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      // Scribe returns per-word timings; the last end is a lower bound on the billed audio duration.
      const ends = Array.isArray(data.words) ? data.words.map(word => Number((word as { end?: unknown })?.end)).filter(Number.isFinite) : [];
      return { ok: true, transcript: text || null, ...(ends.length ? { durationSeconds: Math.max(...ends) } : {}) };
    } catch {
      return { ok: false, transcript: null, reason: 'Transcription temporarily unavailable.' };
    }
  };
}

/** Cloudflare Workers AI speech-to-text model (no third-party account; billed on the Cloudflare plan). */
export const WORKERS_AI_STT_MODEL = '@cf/openai/whisper-large-v3-turbo';
type WorkersAi = { run(model: string, input: { audio: string; task?: string; vad_filter?: boolean }): Promise<unknown> };

/** Workers AI Whisper adapter (auto language). Same contract as Scribe: fail closed, duration for billing. */
export function createWorkersAiStt(ai: WorkersAi): SttAdapter {
  return async audio => {
    if (audio.byteLength === 0 || audio.byteLength > MAX_CLIP_BYTES) return { ok: false, transcript: null, reason: 'Clip missing or too large.' };
    try {
      let binary = ''; const bytes = new Uint8Array(audio);
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const data = await ai.run(WORKERS_AI_STT_MODEL, { audio: btoa(binary), task: 'transcribe', vad_filter: true }) as
        { text?: unknown; transcription_info?: { duration?: unknown } } | null;
      const text = typeof data?.text === 'string' ? data.text.trim() : '';
      const duration = Number(data?.transcription_info?.duration);
      return { ok: true, transcript: text || null, ...(Number.isFinite(duration) ? { durationSeconds: duration } : {}) };
    } catch (error) {
      return { ok: false, transcript: null, reason: `Workers AI transcription failed (${error instanceof Error ? error.name : 'error'}).` };
    }
  };
}

/** Select the server STT adapter: Cloudflare Workers AI Whisper whenever the AI binding exists (founder, Oct 6:
 *  ElevenLabs is no longer used); the Scribe adapter remains only as a dormant fallback if a key is ever set. */
export function createSttAdapter(env: { ELEVENLABS_API_KEY?: string; AI?: unknown }, fetcher: typeof fetch = fetch): SttAdapter | null {
  if (env.AI) return createWorkersAiStt(env.AI as WorkersAi);
  return env.ELEVENLABS_API_KEY?.trim() ? createElevenLabsStt(env.ELEVENLABS_API_KEY, fetcher) : null;
}
