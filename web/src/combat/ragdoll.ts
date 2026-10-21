/**
 * GTA V pivot — LANE B (combat & police): ragdoll-lite. No physics engine — a canned pose blend that topples an
 * avatar root flat and settles it into the ground over ~half a second, so a wasted ped/NPC reads as down rather
 * than frozen mid-stride. The caller freezes the skeletal animation (avatar.update with dt≈0) while this drives
 * the root transform. Pure + reusable (peds now; the local player's WASTED moment can reuse it later).
 */
import type { Object3D } from 'three';
import { flags } from '@gtasf/shared/flags';

const HALF_PI = Math.PI / 2;
/** Seconds to fully topple. */
export const WASTED_FALL_S = 0.55;
// Lying flat pivoted at the feet puts the spine at ground level, so half the body's thickness was under the pavement
// (phone captures: only an arm showed). Lift as it goes flat so the body lies ON the ground.
const LIE_LIFT_M = 0.12;

/** easeOutCubic on a clamped 0..1. */
function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

/**
 * Blend `root` toward a fallen pose. `baseY` is the standing ground height; `fallSeconds` is time since death.
 * Keeps the root's yaw (rotation.y) — only tips the pitch over and settles. Idempotent per frame.
 */
export function applyWastedPose(root: Object3D, baseY: number, fallSeconds: number): void {
  const e = ease(fallSeconds / WASTED_FALL_S);
  root.rotation.x = -HALF_PI * e;        // topple backward to lie face-up (pivoting at the feet)
  root.position.y = baseY + LIE_LIFT_M * e;  // rest on top of the ground, not half inside it
}

/** A downed avatar: anything with a root and the rigged update/pose API (riggedAvatar's AvatarInstance or a VAT actor). */
export interface DownedAvatar { root: Object3D; update(dt: number, clip: 'idle', opacity?: number): void; pose?(clip: string, seconds: number, opacity?: number): boolean }

/**
 * meshyDeathClips (lane D, GTA V critic #9): play the body's real death fall (Meshy 'Shot and Fall Forward/Backward',
 * shared meshy-clips.glb) when it has one; otherwise (CC0/hoodie/VAT bodies, flag off) the plank topple above with a
 * frozen skeleton. `opacity` lets a caller fade the body out.
 */
export function applyDeathPose(avatar: DownedAvatar, baseY: number, fallSeconds: number, variant: 'dieforward' | 'diebackward', opacity = 1): void {
  if (flags.meshyDeathClips && avatar.pose?.(variant, fallSeconds, opacity)) { avatar.root.rotation.x = 0; avatar.root.position.y = baseY; return; }
  applyWastedPose(avatar.root, baseY, fallSeconds);
  avatar.update(0, 'idle', opacity); // dt 0 freezes the skeleton while the root tips over
}

/** Reset a root that was posed by applyWastedPose back to standing (on recycle/reuse). */
export function clearWastedPose(root: Object3D, baseY: number): void {
  root.rotation.x = 0;
  root.position.y = baseY;
}
