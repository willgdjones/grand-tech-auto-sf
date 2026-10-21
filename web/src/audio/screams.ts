// GTA V pivot — LANE B sampled SFX (flag sampledAudio, critique #8): pedestrians scream when gunfire panics them.
// CC0 recordings (PROVENANCE.md): two female screams (WuxiaScrub) and two male yells (HaelDB). Rate-limited so a
// firefight is punctuated by screams, not a wall of them; distance-attenuated from the listener. Client-only.
import { flags } from '@gtasf/shared/flags';
import { playSample, type SampleName } from './samples';

const VOICES: readonly SampleName[] = ['scream-f1', 'scream-f2', 'scream-m1', 'scream-m2'];
const SHARE = 0.35, GAP_MS = 700, AUDIBLE_M = 45;
let lastAt = -Infinity, lastVoice: SampleName | undefined;

/** A walker at (x, z) just started panicking; maybe scream (listener = the local player). */
export function pedScream(x: number, z: number, listener: { x: number; z: number }, now = performance.now()): boolean {
  if (!flags.sampledAudio || now - lastAt < GAP_MS || Math.random() >= SHARE) return false;
  const distance = Math.hypot(x - listener.x, z - listener.z);
  if (distance > AUDIBLE_M) return false;
  const options = VOICES.filter(voice => voice !== lastVoice), voice = options[Math.floor(Math.random() * options.length)]!;
  if (!playSample(voice, { volume: 0.15 + 0.4 * (1 - distance / AUDIBLE_M), rate: 0.94 + Math.random() * 0.12 })) return false;
  lastAt = now; lastVoice = voice;
  return true;
}
