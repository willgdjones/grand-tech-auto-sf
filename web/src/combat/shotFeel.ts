// GTA V pivot — LANE B shooting feel (flag shootingFeel, critique #7): the feedback layer that turns clicking into
// shooting. Crosshair bloom + a recoil camera kick on every shot, a white hit-marker X with a tick on a server-confirmed
// hit (red on a kill), a red hurt vignette + camera jolt when you take damage, and a flinch on the player you hit.
// Client-only and cosmetic: the server still owns every hit. Gun meshes + the aim clip are lane D's (see the hooks).
import type { WeaponSpec } from '@gtasf/shared/combat/weapons';
import { audioContext, releaseAudioContext } from '../audio/context';

export interface ShotFeel {
  /** A local shot left the gun: bloom the crosshair and kick the camera. */
  fired(spec: WeaponSpec, now: number): void;
  /** The server confirmed one of MY shots hit a player. */
  hitConfirmed(killed: boolean, now: number): void;
  /** I took `damage` (server-owned): red vignette + jolt. */
  hurt(damage: number, now: number): void;
  /** A remote player I (or anyone) hit: start their flinch. */
  flinch(playerId: number, now: number): void;
  /** Camera recoil (radians of upward pitch) to apply to this frame's render. */
  recoilPitch(now: number): number;
  /** Backward tilt (radians) for a remote player's avatar this frame (0 when not flinching). */
  flinchTilt(playerId: number, now: number): number;
  update(now: number): void;
  dispose(): void;
}

const KICK_DECAY_MS = 120, BLOOM_DECAY_MS = 220, MARKER_MS = 170, HURT_MS = 450, FLINCH_MS = 260;

export function createShotFeel(options: { parent: HTMLElement; crosshair: () => HTMLElement | null }): ShotFeel {
  const marker = document.createElement('div'); marker.className = 'gt-hitmarker'; marker.hidden = true;
  const vignette = document.createElement('div'); vignette.className = 'gt-hurt-vignette';
  options.parent.append(marker, vignette);
  let kick = 0, kickAt = -Infinity, bloom = 0, bloomAt = -Infinity, markerUntil = 0, hurtAmount = 0, hurtAt = -Infinity;
  const flinches = new Map<number, number>();
  let audio: AudioContext | undefined;
  function tick(killed: boolean): void { // a short bright click, a little lower on a kill
    try {
      audio ??= audioContext();
      const t = audio.currentTime, osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = 'square'; osc.frequency.setValueAtTime(killed ? 1400 : 2200, t);
      gain.gain.setValueAtTime(0.08, t); gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      osc.connect(gain).connect(audio.destination); osc.start(t); osc.stop(t + 0.07);
    } catch { /* no audio */ }
  }
  const decay = (value: number, since: number, ms: number) => (since >= ms ? 0 : value * (1 - since / ms));
  // Perf (QA #6.20: phone firefight 28.8-30.4 fps, was 40): update() runs every frame, so cache the crosshair element and
  // write a style only when its 2-decimal value changes; at rest nothing is written (no per-frame style invalidation).
  let crosshairEl: HTMLElement | null = null, lastBloom = '', lastVignette = '';
  return {
    fired(spec, now) {
      // Heavier guns kick and bloom more; melee neither.
      if (spec.melee) return;
      const weight = Math.min(1, spec.damage / 34);
      kick = 0.012 + weight * 0.025; kickAt = now;
      bloom = Math.min(1, decay(bloom, now - bloomAt, BLOOM_DECAY_MS) + 0.35 + weight * 0.25); bloomAt = now;
    },
    hitConfirmed(killed, now) {
      markerUntil = now + MARKER_MS; marker.hidden = false; marker.classList.toggle('kill', killed); tick(killed);
    },
    hurt(damage, now) {
      hurtAmount = Math.min(1, decay(hurtAmount, now - hurtAt, HURT_MS) + 0.25 + damage / 40); hurtAt = now;
    },
    flinch(playerId, now) { flinches.set(playerId, now); },
    recoilPitch(now) {
      const since = now - kickAt; if (since >= KICK_DECAY_MS) return 0;
      return kick * Math.sin(Math.PI * Math.min(1, since / KICK_DECAY_MS)) * (since < 30 ? since / 30 : 1);
    },
    flinchTilt(playerId, now) {
      const at = flinches.get(playerId); if (at === undefined) return 0;
      const since = now - at; if (since >= FLINCH_MS) { flinches.delete(playerId); return 0; }
      return -0.22 * Math.sin(Math.PI * since / FLINCH_MS); // lean back, then recover
    },
    update(now) {
      const bloomValue = (1 + decay(bloom, now - bloomAt, BLOOM_DECAY_MS) * 1.4).toFixed(2);
      if (bloomValue !== lastBloom) {
        if (!crosshairEl?.isConnected) crosshairEl = options.crosshair();
        if (crosshairEl) { crosshairEl.style.setProperty('--gt-bloom', bloomValue); lastBloom = bloomValue; }
      }
      if (!marker.hidden && now >= markerUntil) marker.hidden = true;
      const vignetteValue = decay(hurtAmount, now - hurtAt, HURT_MS).toFixed(2);
      if (vignetteValue !== lastVignette) { vignette.style.opacity = vignetteValue; lastVignette = vignetteValue; }
    },
    dispose() { marker.remove(); vignette.remove(); releaseAudioContext(audio); },
  };
}
