/**
 * GTA V pivot — LANE B (combat & police): synthesised SFPD siren. No asset — a Web Audio two-tone "wail":
 * a sawtooth tone bandpassed around ~700–1300 Hz, swept by a slow LFO, matching the house synth pattern
 * (gunshot.ts, web/src/audio/splat.ts). The caller feeds a 0..1 intensity each frame (from how near the
 * nearest pursuit car is); 0 fades it out. Oscillators start lazily on the first non-zero intensity (by then
 * the chase is on and the page has had a user gesture) and keep running — only the master gain is driven, so
 * there are no start/stop clicks. Gated by the ragdollAudio flag at the call site, so it needs no gesture gate.
 */
import { flags } from '@gtasf/shared/flags';
import { createLoopVoice } from '../audio/samples';
import { audioContext, releaseAudioContext } from '../audio/context';

const MAX_GAIN = 0.16;      // ceiling so the siren sits under gunfire/engine, not over it
const SWEEP_HZ = 0.9;       // wail sweeps ~0.9 times/sec
const CENTER_HZ = 1000, SWEEP_RANGE_HZ = 320;

export interface Siren {
  /** 0 = silent, 1 = right on top of you. Smoothed internally. */
  setIntensity(level: number): void;
  dispose(): void;
}

export function createSiren(): Siren {
  let ctx: AudioContext | undefined;
  let master: GainNode | undefined;
  let started = false;
  let disposed = false;
  const nodes: { osc: OscillatorNode; lfo: OscillatorNode }[] = [];

  function ensure(): boolean {
    if (disposed) return false;
    try {
      ctx ??= audioContext();
      if (ctx.state === 'suspended') void ctx.resume();
      if (!started) {
        const c = ctx;
        master = c.createGain();
        master.gain.value = 0;
        master.connect(c.destination);
        // Two slightly detuned wail voices for a fuller American-style siren.
        for (const detune of [0, -7]) {
          const osc = c.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.value = CENTER_HZ;
          osc.detune.value = detune;
          const band = c.createBiquadFilter();
          band.type = 'bandpass';
          band.frequency.value = CENTER_HZ;
          band.Q.value = 6;
          // LFO sweeps the oscillator frequency up and down (the "wail").
          const lfo = c.createOscillator();
          lfo.type = 'sine';
          lfo.frequency.value = SWEEP_HZ;
          const lfoGain = c.createGain();
          lfoGain.gain.value = SWEEP_RANGE_HZ;
          lfo.connect(lfoGain).connect(osc.frequency);
          osc.connect(band).connect(master);
          osc.start(); lfo.start();
          nodes.push({ osc, lfo });
        }
        started = true;
      }
      return true;
    } catch {
      return false; // audio unavailable: the chase still works, just silent
    }
  }

  // sampledAudio (critique #8): the CC0 Whelen recording — the WAIL while the cruiser is further off, crossfading to
  // the YELP as it closes in (GTA-style). Falls back to the synth below until both loops are decoded.
  const wail = flags.sampledAudio ? createLoopVoice('siren-wail') : null, yelp = flags.sampledAudio ? createLoopVoice('siren-yelp') : null;
  const SAMPLED_MAX = 0.32;
  let sampledOn = false; // once a sampled voice runs, keep driving it (so it fades out at 0)
  return {
    setIntensity(level: number): void {
      const l = Math.max(0, Math.min(1, level));
      if (wail && yelp && (l > 0 || sampledOn)) {
        const close = Math.max(0, Math.min(1, (l - 0.55) / 0.3));
        const okWail = wail.setLevel(l * SAMPLED_MAX * (1 - close)), okYelp = yelp.setLevel(l * SAMPLED_MAX * close);
        if (okWail && okYelp) { sampledOn = true; if (master && ctx) try { master.gain.setTargetAtTime(0, ctx.currentTime, 0.12); } catch { /* ignore */ } return; } // synth muted
      }
      if (l <= 0 && !started) return; // nothing to do before the first chase
      if (!ensure() || !ctx || !master) return;
      // Short ramp so proximity changes glide rather than step.
      try { master.gain.setTargetAtTime(l * MAX_GAIN, ctx.currentTime, 0.12); } catch { /* ignore */ }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      wail?.dispose(); yelp?.dispose();
      for (const { osc, lfo } of nodes) { try { osc.stop(); lfo.stop(); } catch { /* already stopped */ } }
      nodes.length = 0;
      master?.disconnect(); releaseAudioContext(ctx); // shared context: disconnect, don't close
    },
  };
}
