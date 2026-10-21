import { describe, expect, it } from 'vitest';
import { createElevenLabsStt, createSttAdapter, createWorkersAiStt, WORKERS_AI_STT_MODEL } from './stt';

function okFetcher(text: string): typeof fetch {
  return (async () => Response.json({ text })) as typeof fetch;
}

describe('createSttAdapter', () => {
  it('returns null when no ELEVENLABS_API_KEY is configured (fallback unavailable)', () => {
    expect(createSttAdapter({})).toBeNull();
    expect(createSttAdapter({ ELEVENLABS_API_KEY: '  ' })).toBeNull();
  });
  it('returns an adapter when the key is set', () => {
    expect(typeof createSttAdapter({ ELEVENLABS_API_KEY: 'k' })).toBe('function');
  });
});

describe('createElevenLabsStt', () => {
  it('returns the trimmed transcript on success', async () => {
    const stt = createElevenLabsStt('k', okFetcher('  hello there  '));
    expect(await stt(new ArrayBuffer(16), { mimeType: 'audio/webm' })).toEqual({ ok: true, transcript: 'hello there' });
  });
  it('reports the provider-measured duration from the last word end (billing reconciliation)', async () => {
    const stt = createElevenLabsStt('k', (async () => Response.json({ text: 'hi there', words: [{ text: 'hi', start: 0.1, end: 0.4 }, { text: 'there', start: 0.5, end: 6.25 }] })) as unknown as typeof fetch);
    expect(await stt(new ArrayBuffer(10), { mimeType: 'audio/webm' })).toEqual({ ok: true, transcript: 'hi there', durationSeconds: 6.25 });
  });
  it('maps empty text to a null transcript', async () => {
    const stt = createElevenLabsStt('k', okFetcher('   '));
    expect((await stt(new ArrayBuffer(16), { mimeType: 'audio/webm' })).transcript).toBeNull();
  });
  it('rejects empty or oversized clips without calling the provider', async () => {
    let called = false;
    const stt = createElevenLabsStt('k', (async () => { called = true; return Response.json({ text: 'x' }); }) as typeof fetch);
    expect((await stt(new ArrayBuffer(0), { mimeType: 'audio/webm' })).ok).toBe(false);
    expect((await stt(new ArrayBuffer(2_000_000), { mimeType: 'audio/webm' })).ok).toBe(false);
    expect(called).toBe(false);
  });
  it('fails closed on a provider error', async () => {
    const stt = createElevenLabsStt('k', (async () => new Response('nope', { status: 500 })) as typeof fetch);
    expect((await stt(new ArrayBuffer(16), { mimeType: 'audio/webm' })).ok).toBe(false);
  });
  it('throws if constructed without a key', () => {
    expect(() => createElevenLabsStt('')).toThrow(/ELEVENLABS_API_KEY/);
  });

  it('Workers AI adapter: sends base64 audio to Whisper turbo, returns text + duration, fails closed', async () => {
    const calls: { model: string; input: { audio: string } }[] = [];
    const ai = { run: async (model: string, input: { audio: string }) => { calls.push({ model, input }); return { text: ' hello world ', transcription_info: { duration: 2.4 } }; } };
    const stt = createWorkersAiStt(ai);
    expect(await stt(new Uint8Array([104, 105]).buffer, { mimeType: 'audio/webm' })).toEqual({ ok: true, transcript: 'hello world', durationSeconds: 2.4 });
    expect(calls[0]!.model).toBe(WORKERS_AI_STT_MODEL); expect(calls[0]!.input.audio).toBe(btoa('hi'));
    const broken = createWorkersAiStt({ run: async () => { throw new Error('boom'); } });
    expect((await broken(new ArrayBuffer(4), { mimeType: 'audio/webm' })).ok).toBe(false);
    expect((await stt(new ArrayBuffer(0), { mimeType: 'audio/webm' })).ok).toBe(false);
  });
  it('prefers Workers AI whenever the AI binding exists (founder: ElevenLabs no longer used)', () => {
    expect(createSttAdapter({ AI: { run: async () => ({}) } })).not.toBeNull();
    expect(createSttAdapter({})).toBeNull();
  });
});
