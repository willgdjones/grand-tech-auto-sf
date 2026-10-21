import { flags } from '@gtasf/shared/flags';
import { playSample } from './samples';
import { audioContext } from './context';
/** Car-vs-car crunch (carCollisions). No asset: a short band-passed noise burst, a low body thump and a brief
 *  detuned metallic ring, synthesised on first use. Volume scales with the closing speed. */
let context: AudioContext | undefined, noise: AudioBuffer | undefined;
export function playCrunch(volume = .5): void {
  if (flags.sampledAudio && playSample('crash', { volume: Math.min(1, Math.max(.05, volume)) * .9, rate: .9 + Math.random() * .2 })) return; // critique #8
  try {
    context ??= audioContext();
    if (context.state === 'suspended') void context.resume();
    const ctx = context, now = ctx.currentTime, v = Math.min(1, Math.max(.05, volume));
    if (!noise) {
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * .35), ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 1.5;
    }
    const out = ctx.createGain(); out.gain.value = .7; out.connect(ctx.destination);
    const source = ctx.createBufferSource(); source.buffer = noise; source.playbackRate.value = .75 + Math.random() * .3;
    const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.Q.value = .8;
    band.frequency.setValueAtTime(1400, now); band.frequency.exponentialRampToValueAtTime(420, now + .28);
    const noiseGain = ctx.createGain(); noiseGain.gain.setValueAtTime(v, now); noiseGain.gain.exponentialRampToValueAtTime(.001, now + .32);
    source.connect(band).connect(noiseGain).connect(out);
    const thump = ctx.createOscillator(); thump.frequency.setValueAtTime(110, now); thump.frequency.exponentialRampToValueAtTime(42, now + .14);
    const thumpGain = ctx.createGain(); thumpGain.gain.setValueAtTime(v * .9, now); thumpGain.gain.exponentialRampToValueAtTime(.001, now + .18);
    thump.connect(thumpGain).connect(out);
    for (const hz of [430, 667]) {
      const ring = ctx.createOscillator(); ring.type = 'square'; ring.frequency.value = hz * (.95 + Math.random() * .1);
      const ringGain = ctx.createGain(); ringGain.gain.setValueAtTime(v * .05, now); ringGain.gain.exponentialRampToValueAtTime(.0005, now + .22);
      ring.connect(ringGain).connect(out); ring.start(now); ring.stop(now + .23);
    }
    source.start(now); source.stop(now + .34); thump.start(now); thump.stop(now + .19);
  } catch { /* audio unavailable: the shove and shake still land */ }
}
