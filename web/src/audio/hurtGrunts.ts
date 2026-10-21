// GTA V pivot — LANE B sampled SFX (flag hurtGrunts, needs sampledAudio): a short pain grunt when a bullet or punch lands
// (critique: "on the receiving end there is ... no grunt"). Three CC0 grunts (HaelDB, PROVENANCE.md). Your own hurt grunt
// plays at full level; another player's or an officer's is distance-attenuated from the hit point. Client-only.
import { flags } from '@gtasf/shared/flags';
import { playSample, type SampleName } from './samples';

export const HURT_VOICES: readonly SampleName[] = ['hurt-1', 'hurt-2', 'hurt-3'];
const SELF_GAP_MS = 350, OTHER_GAP_MS = 250, AUDIBLE_M = 35;
let selfAt = -Infinity, otherAt = -Infinity, lastVoice: SampleName | undefined;

function grunt(volume: number): boolean {
  const options = HURT_VOICES.filter(voice => voice !== lastVoice), voice = options[Math.floor(Math.random() * options.length)]!;
  if (!playSample(voice, { volume, rate: 0.93 + Math.random() * 0.14 })) return false;
  lastVoice = voice;
  return true;
}

/** The local player took damage. */
export function selfHurtGrunt(damage: number, now = performance.now()): boolean {
  if (!flags.hurtGrunts || !flags.sampledAudio || damage <= 0 || now - selfAt < SELF_GAP_MS) return false;
  if (!grunt(Math.min(0.85, 0.55 + damage / 100))) return false;
  selfAt = now;
  return true;
}

/** Someone else (a player or an SFPD officer) was hit at (x, z); the listener is the local player. */
export function otherHurtGrunt(x: number, z: number, listener: { x: number; z: number }, now = performance.now()): boolean {
  if (!flags.hurtGrunts || !flags.sampledAudio || now - otherAt < OTHER_GAP_MS) return false;
  const distance = Math.hypot(x - listener.x, z - listener.z);
  if (distance > AUDIBLE_M) return false;
  if (!grunt(0.12 + 0.43 * (1 - distance / AUDIBLE_M))) return false;
  otherAt = now;
  return true;
}
