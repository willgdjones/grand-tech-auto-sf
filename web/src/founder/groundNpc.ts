/**
 * Founder-ladder reusable ground NPC: a single fixed rigged avatar (finished silhouette + idle animation,
 * not a capsule) with a floating label, snapped to walkable ground near a geodetic target and facing a
 * world point. Extracted from the Ferry-plaza investor (phase 2) so phase-5 meme NPCs can stand anywhere
 * in the city the same way; callers supply the outfit, label sprite and target.
 *
 * Placement note: the exact target can overshoot onto a null-surface point (a road/water edge, or just off
 * the walkable mesh), where surfaceHeightAt returns null and the hide-until-ground guard would keep the
 * avatar invisible forever. So walk IN from ~8 m along the bearing from `faceToward` toward the target and
 * take the FARTHEST point whose surface has a height; `faceToward` (a spawn/anchor) always has ground, so a
 * nearer point always resolves. Falls back to `faceToward`'s own ground a couple of metres out.
 */
import type { Object3D, Sprite } from 'three';
import type { ResolvedLook } from '@gtasf/shared/content/cosmetics';
import type { AvatarInstance, AvatarTemplate } from '../avatar/riggedAvatar';
import { placePoint } from '../spawn/locations';

export interface GroundNpcDeps {
  template: AvatarTemplate;
  root: Object3D;
  world: { surfaceHeightAt(x: number, z: number): number | null; ensureAround(point: { x: number; z: number }): Promise<void> };
  /** Geodetic point the NPC should stand at (snapped to walkable ground near it). */
  target: { lat: number; lon: number };
  /** A world point the NPC faces, and searches inward from (toward `target`) for walkable ground. */
  faceToward: { x: number; z: number };
  /** Avatar outfit colour index (appearance.ts). */
  outfit: number;
  /** Optional rich appearance (distinct silhouette: archetype style/prop + accessory). Omitted → the plain
   *  colour-only avatar (the plaza investor keeps its current look). */
  look?: ResolvedLook;
  /** The floating label sprite (the caller builds it; it is added above the avatar and disposed here). Omit for
   *  an unlabelled NPC (e.g. a cosmetic audience member that should not carry a quest nameplate). */
  label?: Sprite;
  /** Object3D name for debugging. */
  name?: string;
}

export interface GroundNpc {
  /** The NPC's resolved horizontal position (snapped to walkable ground; fixed after placement). */
  readonly position: { readonly x: number; readonly z: number };
  /** The standing height (the avatar root's y). */
  readonly y: number;
  update(dt: number): void;
  /** Hidden and not animated while culled (outside the camera view; giverFrustumCull). */
  setCulled(culled: boolean): void;
  dispose(): void;
}

export async function createGroundNpc(deps: GroundNpcDeps): Promise<GroundNpc> {
  const anchor = deps.faceToward, far = placePoint(deps.target);
  const dx = far.x - anchor.x, dz = far.z - anchor.z, dd = Math.hypot(dx, dz) || 1, ux = dx / dd, uz = dz / dd;
  let x = anchor.x + ux * 8, z = anchor.z + uz * 8, groundY: number | null = null;
  for (let reach = Math.min(8, dd); reach >= 2; reach -= 0.5) {
    const px = anchor.x + ux * reach, pz = anchor.z + uz * reach;
    await deps.world.ensureAround({ x: px, z: pz });
    const y = deps.world.surfaceHeightAt(px, pz);
    if (y != null && Number.isFinite(y)) { x = px; z = pz; groundY = y; break; }
  }
  if (groundY == null) {
    const sy = deps.world.surfaceHeightAt(anchor.x, anchor.z);
    if (sy != null && Number.isFinite(sy)) { x = anchor.x + ux * 2; z = anchor.z + uz * 2; groundY = sy; }
  }
  // Force the rich look even with flags.characterLooks off: these are local, non-networked NPCs, so the
  // characterLooks gate (which guards the SET_APPEARANCE wire opcode) does not apply — their distinct
  // silhouettes must render in prod regardless of that separate deploy gate. (No look → plain avatar.)
  const avatar: AvatarInstance = deps.template.createInstance(deps.outfit, deps.look, Boolean(deps.look));
  avatar.root.name = deps.name ?? 'Founder-ladder NPC';
  avatar.root.position.set(x, groundY ?? 0, z);
  // Hide only until ground is first known (avoids a one-frame buried avatar at y=0); re-anchored each frame.
  avatar.root.visible = groundY != null;
  avatar.root.rotation.y = Math.atan2(anchor.x - x, anchor.z - z); // face the anchor (arriving player)
  if (deps.label) avatar.root.add(deps.label);
  deps.root.add(avatar.root);
  let disposed = false, culled = false;
  return {
    position: { x, z },
    get y() { return avatar.root.position.y; },
    setCulled(next) { culled = next; if (next) avatar.root.visible = false; },
    update(dt) {
      if (disposed || culled) return;
      // Re-anchor to the surface each frame (it can finish loading after mount), but once standing on known
      // ground keep it there even if a frame's query briefly returns null — never flicker back to hidden.
      const y = deps.world.surfaceHeightAt(x, z);
      if (y != null && Number.isFinite(y)) { avatar.root.position.y = y; groundY = y; avatar.root.visible = true; }
      else if (groundY != null) avatar.root.visible = true;
      else avatar.root.visible = false;
      avatar.update(dt, 'idle', 1);
    },
    dispose() {
      if (disposed) return; disposed = true;
      avatar.root.removeFromParent(); avatar.dispose();
      deps.label?.material.map?.dispose(); deps.label?.material.dispose();
    },
  };
}
