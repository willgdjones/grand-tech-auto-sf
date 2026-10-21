/**
 * Founder-ladder phase 6 — the Series A Demo Day venue (flags.seriesAQuest; docs/PLAN-founder-ladder-phase6.md).
 * A FICTIONAL hacker-house MC stands at FOUNDER_SERIES_A_PLACE (never a real accelerator/person). A returning
 * player who has closed Seed walks up and pitches on stage; a credited pitch floors the valuation to the
 * Series A round threshold (server: handlePitchTap vcId=FOUNDER_SERIES_A_ID + founderSeriesAFloor, stage-gated).
 *
 * This module is RENDER + proximity only: it mounts the MC via createGroundNpc (finished rigged avatar + label
 * + walkable-ground placement, so not a capsule) and reports the nearest hit for the E-interaction. main.ts
 * opens the pitch card by REUSING the existing ladder pitch flow (no parallel pitch/judge path) and gates the
 * interaction on seriesAQuestReady. Inert unless flags.seriesAQuest mounts it, so prod is unaffected with the
 * flag off. The audience + the cosmetic follower teammates land in follow-up slices.
 */
import { CanvasTexture, LinearFilter, Sprite, SpriteMaterial, SRGBColorSpace, type Object3D } from 'three';
import { defaultAppearance, resolveLook, type FounderArchetype } from '@gtasf/shared/content/cosmetics';
import type { AvatarTemplate } from '../avatar/riggedAvatar';
import { FOUNDER_SERIES_A_FACE, FOUNDER_SERIES_A_PLACE } from '@gtasf/shared/founder/pitch';
import { placePoint } from '../spawn/locations';
import { createGroundNpc, type GroundNpc } from './groundNpc';

/** A small Demo Day audience: cosmetic ground NPCs fanned in front of the stage, all FACING the MC (they share
 *  faceToward = the stage, so createGroundNpc stands each along its bearing within ~8 m of the stage, facing it).
 *  Offsets are degrees from FOUNDER_SERIES_A_PLACE (~0.000009°/m lat, ~0.0000114°/m lon at SF). Cosmetic only. */
const AUDIENCE: readonly { dLat: number; dLon: number; sex: 'male' | 'female'; archetype: FounderArchetype; outfit: number }[] = [
  { dLat: -0.00012, dLon: -0.00007, sex: 'male', archetype: 'hacker', outfit: 1 },
  { dLat: -0.00013, dLon: 0.00000, sex: 'female', archetype: 'ai-researcher', outfit: 2 },
  { dLat: -0.00012, dLon: +0.00007, sex: 'male', archetype: 'crypto', outfit: 1 },
  { dLat: -0.00009, dLon: -0.00012, sex: 'female', archetype: 'consumer', outfit: 3 },
  { dLat: -0.00009, dLon: +0.00012, sex: 'male', archetype: 'dropout', outfit: 0 },
];

/** The MC's floating "Demo Day · PITCH ON STAGE" label (mirrors the meme-NPC / plaza-investor label style). */
function demoDayLabel(title: string, sub: string): Sprite {
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

export interface FounderDemoDayDeps {
  template: AvatarTemplate;
  root: Object3D;
  world: { surfaceHeightAt(x: number, z: number): number | null; ensureAround(point: { x: number; z: number }): Promise<void> };
}

/** How close (metres) the player must be for the Demo Day MC's pitch prompt + E-interaction to fire. */
export const DEMO_DAY_RANGE_M = 4;

export interface FounderDemoDay {
  update(dt: number): void;
  /** The MC's world position when within DEMO_DAY_RANGE_M of `foot`, else undefined (for the E-interaction). */
  nearest(foot: { x: number; z: number }): { x: number; z: number } | undefined;
  /** The MC's resolved world position once mounted (e.g. for a radar/minimap marker), else undefined. */
  position(): { x: number; z: number } | undefined;
  dispose(): void;
}

/** Mount the Demo Day MC (async); returns a handle to update each frame, find it for the E-interaction, and
 *  dispose on teardown. A presentable fictional MC (serial-founder blazer), distinct from the meme NPCs. */
export function createFounderDemoDay(deps: FounderDemoDayDeps): FounderDemoDay {
  let mc: GroundNpc | null = null;
  const audience: GroundNpc[] = [];
  let disposed = false;
  const look = resolveLook({ ...defaultAppearance('female', 'serial'), outfit: 4, accessory: 0 });
  void createGroundNpc({
    template: deps.template, root: deps.root, world: deps.world,
    target: FOUNDER_SERIES_A_PLACE, faceToward: placePoint(FOUNDER_SERIES_A_FACE),
    outfit: 4, look, label: demoDayLabel('Demo Day', 'PITCH ON STAGE'), name: 'Founder-ladder Series A Demo Day MC',
  }).then(npc => { if (disposed) npc.dispose(); else mc = npc; })
    .catch(err => console.warn('Demo Day MC could not load.', err));
  // A small cosmetic audience fanned in front of the stage, each facing the MC (faceToward = the stage spot).
  const stage = placePoint(FOUNDER_SERIES_A_PLACE);
  for (const a of AUDIENCE) {
    void createGroundNpc({
      template: deps.template, root: deps.root, world: deps.world,
      target: { lat: FOUNDER_SERIES_A_PLACE.lat + a.dLat, lon: FOUNDER_SERIES_A_PLACE.lon + a.dLon }, faceToward: stage,
      outfit: a.outfit, look: resolveLook({ ...defaultAppearance(a.sex, a.archetype), outfit: a.outfit, accessory: 0 }),
      name: 'Founder-ladder Demo Day audience',
    }).then(npc => { if (disposed) npc.dispose(); else audience.push(npc); })
      .catch(() => { /* a single audience member failing to load is cosmetic — ignore */ });
  }
  return {
    update(dt) { if (disposed) return; mc?.update(dt); for (const npc of audience) npc.update(dt); },
    nearest(foot) {
      if (disposed || !mc) return undefined;
      const dx = mc.position.x - foot.x, dz = mc.position.z - foot.z;
      return dx * dx + dz * dz < DEMO_DAY_RANGE_M * DEMO_DAY_RANGE_M ? { x: mc.position.x, z: mc.position.z } : undefined;
    },
    position() { return mc ? { x: mc.position.x, z: mc.position.z } : undefined; },
    dispose() { if (disposed) return; disposed = true; mc?.dispose(); mc = null; for (const npc of audience) npc.dispose(); audience.length = 0; },
  };
}
