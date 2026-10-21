import { flags } from '@gtasf/shared/flags';
import { audioContext, releaseAudioContext } from './context';

/**
 * Procedural street SFX (gtasf-bigk): on-foot footfalls plus a low city ambience bed, synthesised with
 * Web Audio. No audio downloads. The car crunch (crunch.ts), paint splat (splat.ts) and engines
 * (vehicles.ts) are the other procedural voices; this module adds the footsteps and the ambient city hush.
 * Gated by flags.proceduralSfx.
 *
 * One shared AudioContext for both voices. To stay within the browser autoplay policy (and avoid a
 * pre-gesture "AudioContext was not allowed to start" warning) the context is not created until the first
 * update that reports real movement — on foot that needs a key/touch gesture, and entering a vehicle is a
 * gesture too — so creation always follows a user gesture.
 */
export interface ProceduralSfxState {
  /** Listener (local player) world x/z in metres — reserved for future spatialisation. */
  x: number;
  z: number;
  /** Current speed in metres/second (walk speed on foot, vehicle speed otherwise). */
  speed: number;
  /** Movement mode; only 'on-foot' produces footsteps. */
  mode: string;
  /** Frame delta in seconds. */
  dt: number;
}

/** One footfall per this many metres travelled; running (higher speed) naturally quickens the cadence. */
const STRIDE_M = 0.82;

export function createProceduralSfx(options: { enabled?: boolean } = {}) {
  if (options.enabled === false || !flags.proceduralSfx) return null;

  let context: AudioContext | undefined;
  let master: GainNode | undefined;
  let ambienceGain: GainNode | undefined;
  let stepNoise: AudioBuffer | undefined;
  let disposed = false;
  let activated = false;      // a user gesture (movement) has happened; safe to touch audio
  let ambienceStarted = false;
  let strideDist = 0;         // metres accumulated since the last footfall
  let leftFoot = false;       // alternate the footfall colour

  function ensureContext(): AudioContext | undefined {
    if (disposed) return undefined;
    try {
      context ??= audioContext();
      if (context.state === 'suspended') void context.resume();
      if (!master) { master = context.createGain(); master.gain.value = 1; master.connect(context.destination); }
      return context;
    } catch { return undefined; }
  }

  function footstep(volume: number): void {
    const ctx = ensureContext(); if (!ctx || !master) return;
    try {
      const now = ctx.currentTime;
      if (!stepNoise) {
        // Short, front-loaded noise burst: a soft heel scuff rather than a sharp click.
        stepNoise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * .12), ctx.sampleRate);
        const data = stepNoise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
      }
      const src = ctx.createBufferSource();
      src.buffer = stepNoise; src.playbackRate.value = (leftFoot ? .9 : 1.08) + Math.random() * .08;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = .6;
      lp.frequency.value = leftFoot ? 520 : 600;
      const g = ctx.createGain();
      g.gain.setValueAtTime(Math.min(.5, volume), now); g.gain.exponentialRampToValueAtTime(.0005, now + .11);
      src.connect(lp).connect(g).connect(master);
      src.start(now); src.stop(now + .13);
      leftFoot = !leftFoot;
    } catch { /* a dropped footfall is inaudible; keep moving */ }
  }

  /**
   * Cash-register "cha-ching" for a cheque (funding award). Two bright bell dings — a lower "cha" then a
   * higher "ching" with a longer tail — each built from a fundamental plus two inharmonic partials for a
   * metallic shimmer. One-shot, through the shared master; a cheque always follows gameplay gestures.
   */
  function chaChing(volume = .5): void {
    const ctx = ensureContext(); if (!ctx || !master) return;
    try {
      const now = ctx.currentTime, v = Math.min(.6, Math.max(.05, volume));
      const ding = (t0: number, freq: number, level: number, dur: number): void => {
        for (const [mult, g] of [[1, 1], [2.76, .42], [5.4, .2]] as const) {
          const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq * mult;
          const eg = ctx.createGain();
          eg.gain.setValueAtTime(.0001, t0);
          eg.gain.exponentialRampToValueAtTime(v * level * g, t0 + .005);
          eg.gain.exponentialRampToValueAtTime(.0004, t0 + dur);
          osc.connect(eg).connect(master!);
          osc.start(t0); osc.stop(t0 + dur + .02);
        }
      };
      ding(now, 1046.5, .5, .13);        // "cha" — C6, short
      ding(now + .085, 1568, .6, .42);   // "ching" — G6, brighter with a longer tail
    } catch { /* a missed cha-ching is inaudible; the cheque toast still shows */ }
  }

  function startAmbience(ctx: AudioContext): void {
    if (ambienceStarted || !master) return;
    try {
      // Brown-ish noise bed (a 2 s loop) for the distant city hush, band-limited low, plus a faint drone.
      const len = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + .02 * w) / 1.02; d[i] = last * 3.5; }
      ambienceGain = ctx.createGain(); ambienceGain.gain.value = 0;
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 480; lp.Q.value = .3;
      src.connect(hp).connect(lp).connect(ambienceGain).connect(master);
      const drone = ctx.createOscillator(); drone.type = 'sine'; drone.frequency.value = 56;
      const droneGain = ctx.createGain(); droneGain.gain.value = .015;
      drone.connect(droneGain).connect(ambienceGain);
      src.start(); drone.start();
      ambienceStarted = true;
    } catch { /* no ambience is fine; the one-shot voices still play */ }
  }

  return {
    /** Fire a single footfall directly (e.g. a scripted step). Cadence is normally driven by update(). */
    footstep,
    /** Cash-register "cha-ching" for a cheque/funding award. */
    chaChing,
    update(state: ProceduralSfxState): void {
      if (disposed) return;
      // Wait for the first real movement (a user gesture) before creating/resuming the context.
      if (!activated) { if (state.speed <= .1 && state.mode === 'on-foot') return; activated = true; }
      const ctx = ensureContext(); if (!ctx) return;
      if (!ambienceStarted) startAmbience(ctx);
      // Ambience sits under everything; a touch quieter in a vehicle where the engine leads.
      if (ambienceGain) ambienceGain.gain.setTargetAtTime(state.mode === 'on-foot' ? .09 : .05, ctx.currentTime, .6);
      // Footsteps: distance-paced, on foot only, above a slow-walk threshold.
      if (state.mode === 'on-foot' && state.speed > .6) {
        strideDist += state.speed * state.dt;
        if (strideDist >= STRIDE_M) { strideDist = 0; footstep(.22 + Math.min(.18, state.speed * .03)); }
      } else {
        strideDist = STRIDE_M; // the next step lands promptly when movement resumes
      }
    },
    destroy(): void {
      if (disposed) return; disposed = true;
      master?.disconnect(); ambienceGain?.disconnect(); releaseAudioContext(context); // shared context: disconnect, don't close
      context = undefined; master = undefined; ambienceGain = undefined;
    },
  };
}

export type ProceduralSfx = NonNullable<ReturnType<typeof createProceduralSfx>>;
