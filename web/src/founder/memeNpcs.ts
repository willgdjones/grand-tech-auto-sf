/**
 * Founder-ladder phase 5 — meme-NPC side quests (docs/PLAN-founder-ladder-phase5.md). Free-roam quest
 * givers standing around the city: FICTIONAL archetypes (never real people, never real quotes), each
 * offering an optional side quest that pays valuation. Reuses createGroundNpc for the finished rigged
 * avatar + floating label + walkable-ground placement, so these are not capsules.
 *
 * This module is RENDER-ONLY for now — the NPCs stand with their hook label; the quest interaction
 * (proximity prompt -> quest/pitch card -> cheque) lands in a follow-up with its reviewed money path.
 * Flag-gated behind `memeQuests` (off by default); mounted once, updated each frame for the idle sway.
 *
 * Placement note: createGroundNpc stands the NPC within ~8 m of `faceToward` (see its header), so for now
 * the MVP archetype stands near the spawn plaza on a distinct bearing from the Pear VC plaza investor.
 * Distributed city stops (reusing the curated angel-stops) are a later refinement.
 */
import { BoxGeometry, CanvasTexture, ConeGeometry, CylinderGeometry, Group, LinearFilter, Mesh, MeshLambertMaterial, type Object3D, Sprite, SpriteMaterial, SRGBColorSpace } from 'three';
import { defaultAppearance, resolveLook } from '@gtasf/shared/content/cosmetics';
import type { AvatarTemplate } from '../avatar/riggedAvatar';
import { flags } from '@gtasf/shared/flags';
import { driveCopyOf, MEME_NPCS, memeNpcEnabled, type MemeNpcSpec } from '@gtasf/shared/founder/memeQuests';
import { placePoint } from '../spawn/locations';
import { createGroundNpc, type GroundNpc } from './groundNpc';

/** Draw a meme NPC's floating "<archetype> · <hook>" label onto a sprite (mirrors the plaza investor's). */
function memeLabel(title: string, sub: string): Sprite {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0c1813e6'; ctx.beginPath(); ctx.roundRect(8, 8, 496, 112, 20); ctx.fill();
    ctx.strokeStyle = '#f0b429'; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(8, 8, 496, 112, 20); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f6edda'; ctx.font = `700 34px Arial, sans-serif`;
    ctx.fillText(title, 256, 48);
    ctx.fillStyle = '#f0b429'; ctx.font = `900 30px Haettenschweiler, 'Arial Narrow Bold', Impact, sans-serif`;
    ctx.fillText(sub, 256, 90);
  }
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.magFilter = LinearFilter;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.scale.set(3.2, 0.8, 1); sprite.position.set(0, 2.55, 0); sprite.renderOrder = 10;
  return sprite;
}

export interface FounderMemeNpcsDeps {
  template: AvatarTemplate;
  root: Object3D;
  world: { surfaceHeightAt(x: number, z: number): number | null; ensureAround(point: { x: number; z: number }): Promise<void> };
}

/** How close (metres) the player must be for a meme NPC's pitch prompt + E-interaction to fire. */
export const MEME_PITCH_RANGE_M = 4;

export interface FounderMemeNpcs {
  update(dt: number): void;
  /** The nearest mounted meme NPC within MEME_PITCH_RANGE_M of `foot`, or undefined. */
  nearest(foot: { x: number; z: number }): { spec: MemeNpcSpec; x: number; z: number } | undefined;
  /** All mounted meme NPCs with their resolved world positions (e.g. for a radar/minimap marker). */
  all(): { spec: MemeNpcSpec; x: number; z: number }[];
  dispose(): void;
}

/** A small low-poly traffic cone (orange body + white band + dark base), dropped by the Robotaxi protester
 *  so the "escape the cone" drive quest reads at a glance. Owns its geometry/materials; dispose on teardown.
 *  [gtasf-ldlm phase-5.1] */
function createTrafficCone(x: number, y: number, z: number): { root: Object3D; dispose(): void } {
  const root = new Group(); root.name = 'founder-drive-cone'; root.position.set(x, y, z);
  const orange = new MeshLambertMaterial({ color: 0xe8602c }), white = new MeshLambertMaterial({ color: 0xf2ece0 }), dark = new MeshLambertMaterial({ color: 0x2b2b2b });
  const body = new Mesh(new ConeGeometry(0.2, 0.62, 12), orange); body.position.y = 0.33;
  const band = new Mesh(new CylinderGeometry(0.135, 0.15, 0.07, 12), white); band.position.y = 0.24; // proud white stripe
  const base = new Mesh(new BoxGeometry(0.42, 0.06, 0.42), dark); base.position.y = 0.03;
  root.add(base, body, band);
  return { root, dispose() { root.removeFromParent(); for (const m of [body, band, base]) m.geometry.dispose(); orange.dispose(); white.dispose(); dark.dispose(); } };
}

/** Mount the meme NPCs (async per NPC); returns a handle to update each frame, find the nearest one for
 *  the E-interaction, and dispose on teardown. */
export function createFounderMemeNpcs(deps: FounderMemeNpcsDeps): FounderMemeNpcs {
  const mounted: { spec: MemeNpcSpec; npc: GroundNpc }[] = [];
  const props: { dispose(): void }[] = []; // drive-quest cones (disposed with the NPCs)
  let disposed = false;
  for (const spec of MEME_NPCS) {
    // Per-quest sub-gate: the drive NPC only renders under its own flag (its cone + HUD + escape flow land
    // with it), so it stays out of prod while memeQuests ships the pitch quests. [gtasf-ldlm phase-5.1]
    if (spec.questKind === 'drive' && !flags.driveQuest) continue;
    if (spec.questKind === 'share' && !flags.shareQuest) continue;
    if (!memeNpcEnabled(spec, flags)) continue; // per-NPC switch (e.g. doomerQuest)
    const look = resolveLook({ ...defaultAppearance(spec.look.sex, spec.look.archetype), outfit: spec.look.outfit, accessory: spec.look.accessory });
    void createGroundNpc({
      template: deps.template, root: deps.root, world: deps.world,
      target: spec.target, faceToward: placePoint(spec.face),
      outfit: spec.look.outfit, look, label: memeLabel(spec.archetype, spec.hook), name: `Founder-ladder meme NPC: ${spec.id}`,
    }).then(npc => {
      if (disposed) { npc.dispose(); return; }
      mounted.push({ spec, npc });
      // Drop the protester's traffic cone just in front of them (toward the arriving player), on the ground.
      if (spec.questKind === 'drive' && driveCopyOf(spec).cone) {
        const face = placePoint(spec.face), dx = face.x - npc.position.x, dz = face.z - npc.position.z, dd = Math.hypot(dx, dz) || 1;
        const cx = npc.position.x + (dx / dd) * 0.9, cz = npc.position.z + (dz / dd) * 0.9;
        const y = deps.world.surfaceHeightAt(cx, cz) ?? deps.world.surfaceHeightAt(npc.position.x, npc.position.z) ?? 0;
        const cone = createTrafficCone(cx, y, cz); deps.root.add(cone.root); props.push(cone);
      }
    }).catch(err => console.warn(`Meme NPC ${spec.id} could not load.`, err));
  }
  return {
    update(dt) { if (disposed) return; for (const { npc } of mounted) npc.update(dt); },
    nearest(foot) {
      if (disposed) return undefined;
      let best: { spec: MemeNpcSpec; x: number; z: number } | undefined;
      let bestSq = MEME_PITCH_RANGE_M * MEME_PITCH_RANGE_M;
      for (const { spec, npc } of mounted) {
        const dx = npc.position.x - foot.x, dz = npc.position.z - foot.z, dSq = dx * dx + dz * dz;
        if (dSq < bestSq) { bestSq = dSq; best = { spec, x: npc.position.x, z: npc.position.z }; }
      }
      return best;
    },
    all() { return mounted.map(({ spec, npc }) => ({ spec, x: npc.position.x, z: npc.position.z })); },
    dispose() { if (disposed) return; disposed = true; for (const { npc } of mounted) npc.dispose(); for (const p of props) p.dispose(); mounted.length = 0; props.length = 0; },
  };
}
