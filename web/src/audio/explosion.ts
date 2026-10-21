import { audioContext } from './context';
/** Vehicle explosion (vehicleDamage). No asset: a deep sub thump, a long low-passed noise roar and a short bright
 *  crack, synthesised on first use. Volume falls off with distance (caller passes 0..1). */
let context: AudioContext | undefined, noise: AudioBuffer | undefined;
export function playExplosion(volume = 1): void {
  try {
    context ??= audioContext();
    if (context.state === 'suspended') void context.resume();
    const ctx = context, now = ctx.currentTime, v = Math.min(1, Math.max(.03, volume));
    if (!noise) {
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2.2), ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2.2;
    }
    const out = ctx.createGain(); out.gain.value = .9; out.connect(ctx.destination);
    // Roar: low-passed noise sweeping down over ~2 s.
    const roar = ctx.createBufferSource(); roar.buffer = noise; roar.playbackRate.value = .55 + Math.random() * .1;
    const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.Q.value = .7;
    low.frequency.setValueAtTime(2400, now); low.frequency.exponentialRampToValueAtTime(140, now + 1.8);
    const roarGain = ctx.createGain(); roarGain.gain.setValueAtTime(v, now); roarGain.gain.exponentialRampToValueAtTime(.001, now + 2.1);
    roar.connect(low).connect(roarGain).connect(out);
    // Sub thump: the chest hit.
    const thump = ctx.createOscillator(); thump.frequency.setValueAtTime(70, now); thump.frequency.exponentialRampToValueAtTime(24, now + .5);
    const thumpGain = ctx.createGain(); thumpGain.gain.setValueAtTime(v * 1.2, now); thumpGain.gain.exponentialRampToValueAtTime(.001, now + .6);
    thump.connect(thumpGain).connect(out);
    // Crack: a short high-passed burst on top.
    const crack = ctx.createBufferSource(); crack.buffer = noise; crack.playbackRate.value = 1.6;
    const high = ctx.createBiquadFilter(); high.type = 'highpass'; high.frequency.value = 1800;
    const crackGain = ctx.createGain(); crackGain.gain.setValueAtTime(v * .7, now); crackGain.gain.exponentialRampToValueAtTime(.001, now + .12);
    crack.connect(high).connect(crackGain).connect(out);
    roar.start(now); roar.stop(now + 2.2); thump.start(now); thump.stop(now + .62); crack.start(now); crack.stop(now + .14);
  } catch { /* audio unavailable: the fireball still shows */ }
}
