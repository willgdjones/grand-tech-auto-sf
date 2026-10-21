/**
 * Founder-ladder phase 2 — the first-pitch investor on the Ferry plaza (PLAN step 4: "A meme angel NPC
 * stands 10 m away … 'Got 15 seconds? Pitch me.'"). Per the founder's real-VC decision this is a real
 * SF VC firm partner, so the label reads "A partner at <firm>", never a named individual.
 *
 * A single fixed rigged avatar (reuses the avatar template, so it has a finished silhouette + idle
 * animation — not a capsule) with a floating label, placed at FOUNDER_PLAZA_ANGEL facing the spawn.
 * Flag-gated behind founderLadder && pitching; mounted once, updated each frame for the idle sway.
 */
import { centerSlotLabelFade } from '../hud/centerSlot';
import { CanvasTexture, LinearFilter, type Object3D, Sprite, SpriteMaterial, SRGBColorSpace, Vector3 } from 'three';
import type { AvatarTemplate } from '../avatar/riggedAvatar';
import { flags } from '@gtasf/shared/flags';
import { FOUNDER_OPENER_FACE, FOUNDER_PLAZA_VC_NAME, founderPlazaAngel } from '@gtasf/shared/founder/pitch';
import { placePoint } from '../spawn/locations';
import { createGroundNpc } from './groundNpc';

/** Outfit colour index (appearance.ts: Ocean/Mission red/Golden Gate green/Sunset cream/Ink/Plum/Rust/Fog).
 *  'Ink' (4) — a dark, sharp tone so the VC partner reads as business and pops from the casual, light-dressed
 *  peer founders on the plaza, especially at dusk where the earlier 'Sunset cream' washed out (founder call). */
const INVESTOR_OUTFIT = 4;

export interface FounderPlazaInvestorDeps {
  template: AvatarTemplate;
  root: Object3D;
  world: { surfaceHeightAt(x: number, z: number): number | null; ensureAround(point: { x: number; z: number }): Promise<void> };
  /** A point the investor should face (the spawn/plaza), so they greet arriving players. */
  faceToward: { x: number; z: number };
}

export interface FounderPlazaInvestor {
  /** The investor's resolved walkable position (for the E-interaction proximity + the minimap nudge marker). */
  readonly position: { readonly x: number; readonly z: number };
  update(dt: number): void;
  dispose(): void;
}

/** Draw the floating "A partner at <firm> · Pitch me" label onto a sprite. */
function label(name: string): Sprite {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0c1813e6'; ctx.beginPath(); ctx.roundRect(8, 8, 496, 112, 20); ctx.fill();
    ctx.strokeStyle = '#f0b429'; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(8, 8, 496, 112, 20); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f6edda'; ctx.font = `700 34px Arial, sans-serif`;
    ctx.fillText(`A partner at ${name}`, 256, 48);
    ctx.fillStyle = '#f0b429'; ctx.font = `900 30px Haettenschweiler, 'Arial Narrow Bold', Impact, sans-serif`;
    ctx.fillText('“GOT 15 SECONDS? PITCH ME.”', 256, 90);
  }
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.magFilter = LinearFilter;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.scale.set(3.2, 0.8, 1); sprite.position.set(0, 2.55, 0); sprite.renderOrder = 10;
  // QA #6.20: a 3.2 m world-space card filled the screen and covered the crosshair from up close. Fade it by camera
  // distance (solid from 9 m, gone by 4 m); it's a landmark seen from afar, and the pitch card takes over up close.
  const at = new Vector3(), eye = new Vector3();
  sprite.onBeforeRender = (_r, _s, camera) => {
    const d = eye.setFromMatrixPosition(camera.matrixWorld).distanceTo(sprite.getWorldPosition(at));
    sprite.material.opacity = Math.min(1, Math.max(0, (d - 4) / 5)) * (flags.plazaLabelFade ? centerSlotLabelFade() : 1); // critic 20f: stand aside for centre moments
  };
  return sprite;
}

export async function createFounderPlazaInvestor(deps: FounderPlazaInvestorDeps): Promise<FounderPlazaInvestor> {
  // The placement/avatar/idle/dispose mechanics live in createGroundNpc (shared with phase-5 meme NPCs);
  // the investor just supplies its outfit, label and target — FOUNDER_PLAZA_ANGEL, facing the spawn, so it
  // stands on walkable ground next to the arriving player and greets them.
  return createGroundNpc({
    template: deps.template, root: deps.root, world: deps.world,
    // guidedOpener (gtasf-dzrrn): the partner waits down the Embarcadero, facing the roadway (FACE is beside the target,
    // so the NPC lands within a few metres of it — the Ferry anchor would cap it 8 m from the Ferry instead).
    target: founderPlazaAngel(flags.guidedOpener), faceToward: flags.guidedOpener ? placePoint(FOUNDER_OPENER_FACE) : deps.faceToward,
    outfit: INVESTOR_OUTFIT, label: label(FOUNDER_PLAZA_VC_NAME),
    name: 'Founder-ladder plaza investor',
  });
}
