/**
 * GTA V pivot — LANE B (combat & police): synthesised gunshot / melee-swing audio. No asset — a one-shot
 * Web Audio synth created on first fire (which is a user gesture), matching the house pattern
 * (web/src/audio/splat.ts, crunch.ts). A gun is a sharp high-passed noise crack + a short low thump; a melee
 * swing is a softer band-passed whoosh. Fires only when the weapon system fires, so it needs no extra flag.
 */
import { flags } from '@gtasf/shared/flags';
import type { WeaponId } from '@gtasf/shared/combat/weapons';
import { playSample } from '../audio/samples';
import { audioContext } from '../audio/context';

let context: AudioContext | undefined;
let noise: AudioBuffer | undefined;

export interface GunshotOptions {
  /** Melee weapons get a whoosh instead of a crack. */
  melee?: boolean;
  volume?: number;
  /** sampledAudio: which gun, for its recorded shot (pistol/smg/rifle); melee uses the punch sample. */
  weapon?: WeaponId;
}

export function playGunshot(options: GunshotOptions = {}): void {
  const { melee = false, volume = 0.4 } = options;
  // sampledAudio (critique #8): a CC0 recording with its tail when loaded; otherwise the synth below.
  if (flags.sampledAudio) {
    const w = options.weapon, sample = melee ? 'punch' : w === 'smg' ? 'smg' : w === 'rifle' ? 'rifle' : 'pistol';
    if (playSample(sample, { volume: Math.min(1, volume * (melee ? 1.6 : 1.4)) })) return;
  }
  try {
    context ??= audioContext();
    if (context.state === 'suspended') void context.resume();
    const ctx = context, now = ctx.currentTime;
    if (!noise) {
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.3), ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    if (melee) {
      source.playbackRate.value = 0.9 + Math.random() * 0.3;
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(900, now);
      filter.frequency.exponentialRampToValueAtTime(220, now + 0.18);
      filter.Q.value = 1.1;
      gain.gain.setValueAtTime(volume * 0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      source.connect(filter).connect(gain).connect(ctx.destination);
      source.start(now); source.stop(now + 0.22);
      return;
    }

    // Gunshot: a sharp high-passed noise crack...
    source.playbackRate.value = 0.9 + Math.random() * 0.2;
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(700, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    // ...plus a short low thump for the body.
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(120, now);
    thump.frequency.exponentialRampToValueAtTime(42, now + 0.08);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(volume * 0.8, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    source.connect(filter).connect(gain).connect(ctx.destination);
    thump.connect(thumpGain).connect(ctx.destination);
    source.start(now); source.stop(now + 0.1);
    thump.start(now); thump.stop(now + 0.12);
  } catch {
    /* audio unavailable: firing still works visually */
  }
}
