import { audioContext } from './context';
// GTA V pivot — LANE B sampled SFX (flag sampledAudio, critique #8): CC0 / public-domain recordings in
// web/public/audio/combat (licences in PROVENANCE.md). Lazy fetch + decode, one shared AudioContext; play() returns
// false until a sample is ready so callers keep their synthesised fallback (gunshot.ts, crunch.ts).
export type SampleName = 'pistol' | 'smg' | 'rifle' | 'punch' | 'crash' | 'sirens-distant' | 'siren-wail' | 'siren-yelp' | 'engine'
  | 'bark-hold' | 'bark-getdown' | 'bark-lookout' | 'bark-backup' | 'scream-f1' | 'scream-f2' | 'scream-m1' | 'scream-m2'
  | 'hurt-1' | 'hurt-2' | 'hurt-3';
// Loops that must be gapless ship as WAV (MP3 encoder padding clicks at the loop point); the rest are MP3.
const EXT: Partial<Record<SampleName, string>> = { engine: 'wav' };

let context: AudioContext | undefined;
const buffers = new Map<SampleName, AudioBuffer>();
const loading = new Map<SampleName, Promise<void>>();

function ctx(): AudioContext {
  context ??= audioContext();
  if (context.state === 'suspended') void context.resume();
  return context;
}

/** Start fetching + decoding (idempotent). Call on a user gesture (combat start) so the first shot is sampled. */
export function preloadSamples(names: readonly SampleName[]): void {
  for (const name of names) {
    if (buffers.has(name) || loading.has(name)) continue;
    loading.set(name, fetch(`/audio/combat/${name}.${EXT[name] ?? 'mp3'}`).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then(bytes => ctx().decodeAudioData(bytes)).then(buffer => { buffers.set(name, buffer); })
      .catch(() => { loading.delete(name); })); // a failed load leaves the synth fallback in place; a later preload retries
  }
}

/** Play a one-shot; false when it isn't loaded yet (use the synth). `rate` jitters pitch so repeats don't machine-gun. */
export function playSample(name: SampleName, options: { volume?: number; rate?: number } = {}): boolean {
  const buffer = buffers.get(name);
  if (!buffer) { preloadSamples([name]); return false; }
  try {
    const audio = ctx(), source = audio.createBufferSource(), gain = audio.createGain();
    source.buffer = buffer; source.playbackRate.value = options.rate ?? 0.96 + Math.random() * 0.08;
    gain.gain.value = options.volume ?? 0.5;
    source.connect(gain).connect(audio.destination); source.start();
    return true;
  } catch { return false; }
}

/** Loop a bed (e.g. distant sirens while wanted); returns a stop function. No-op until loaded. */
export function loopSample(name: SampleName, volume: number): () => void {
  const buffer = buffers.get(name);
  if (!buffer) { preloadSamples([name]); return () => undefined; }
  try {
    const audio = ctx(), source = audio.createBufferSource(), gain = audio.createGain();
    source.buffer = buffer; source.loop = true; gain.gain.setValueAtTime(0, audio.currentTime);
    gain.gain.linearRampToValueAtTime(volume, audio.currentTime + 1.5); // fade in
    source.connect(gain).connect(audio.destination); source.start();
    return () => {
      try { const t = audio.currentTime; gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(gain.gain.value, t); gain.gain.linearRampToValueAtTime(0, t + 1.2); source.stop(t + 1.3); } catch { /* already stopped */ }
    };
  } catch { return () => undefined; }
}

/** A looping voice driven by a level (0 = silent): starts the moment its sample is decoded, then only the gain moves
 *  (no start/stop clicks). For the SFPD siren's wail/yelp crossfade. */
function audibleSpan(buffer: AudioBuffer): [number, number] { // skip codec padding/silence so a loop doesn't gap
  const data = buffer.getChannelData(0); let a = 0, b = data.length - 1;
  while (a < b && Math.abs(data[a]!) < 0.003) a++;
  while (b > a && Math.abs(data[b]!) < 0.003) b--;
  return [a / buffer.sampleRate, (b + 1) / buffer.sampleRate];
}

/** RPM-ish playback rate for the engine loop from speed (m/s): climbs through four fake gears, dropping at each shift. */
export function engineRate(speed: number): number {
  const v = Math.min(45, Math.abs(Number.isFinite(speed) ? speed : 0)), tops = [9, 17, 26, 45];
  let low = 0;
  for (const [gear, top] of tops.entries()) {
    if (v <= top) return 0.7 + gear * 0.08 + ((v - low) / (top - low)) * 0.75;
    low = top;
  }
  return 1.69;
}

export function createLoopVoice(name: SampleName): { setLevel(level: number, rate?: number): boolean; dispose(): void } {
  let source: AudioBufferSourceNode | undefined, gain: GainNode | undefined;
  return {
    setLevel(level, rate) {
      if (!source) {
        const buffer = buffers.get(name);
        if (!buffer) { if (level > 0) preloadSamples([name]); return false; }
        try {
          const audio = ctx(); gain = audio.createGain(); gain.gain.value = 0;
          source = audio.createBufferSource(); source.buffer = buffer; source.loop = true;
          [source.loopStart, source.loopEnd] = audibleSpan(buffer);
          source.connect(gain).connect(audio.destination); source.start();
        } catch { return false; }
      }
      try {
        const t = ctx().currentTime; gain!.gain.setTargetAtTime(Math.max(0, level), t, 0.12);
        if (rate !== undefined) source.playbackRate.setTargetAtTime(rate, t, 0.08);
      } catch { /* ignore */ }
      return true;
    },
    dispose() { try { source?.stop(); } catch { /* already stopped */ } source = undefined; },
  };
}
