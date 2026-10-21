import { audioContext } from './context';
/** Wet paint "splat" for the local player's paintball hits (gtasf founder: juicier hit). No asset: a ~0.18 s
 *  low-passed noise burst with a quick pitch-dropping thump, synthesised on first use (fire is a user gesture). */
let context: AudioContext | undefined, noise: AudioBuffer | undefined;
export function playSplat(volume = .5): void {
  try {
    context ??= audioContext();
    if (context.state === 'suspended') void context.resume();
    const ctx = context, now = ctx.currentTime;
    if (!noise) {
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * .2), ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    }
    const source = ctx.createBufferSource(); source.buffer = noise; source.playbackRate.value = .8 + Math.random() * .4;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.setValueAtTime(2200, now); filter.frequency.exponentialRampToValueAtTime(380, now + .16);
    const gain = ctx.createGain(); gain.gain.setValueAtTime(volume, now); gain.gain.exponentialRampToValueAtTime(.001, now + .18);
    const thump = ctx.createOscillator(); thump.frequency.setValueAtTime(170, now); thump.frequency.exponentialRampToValueAtTime(55, now + .1);
    const thumpGain = ctx.createGain(); thumpGain.gain.setValueAtTime(volume * .6, now); thumpGain.gain.exponentialRampToValueAtTime(.001, now + .12);
    source.connect(filter).connect(gain).connect(ctx.destination); thump.connect(thumpGain).connect(ctx.destination);
    source.start(now); source.stop(now + .2); thump.start(now); thump.stop(now + .13);
  } catch { /* audio unavailable: the visual splat still lands */ }
}
