/**
 * Mission start-marker NPCs (docs/PLAN-gta-pivot.md LANE C). A finished rigged avatar (not a capsule) stands at
 * each mission's start — e.g. the rival SoMa office for "Steal the Pitch Deck" — with a floating label, so the
 * start reads IN-WORLD, not only as a minimap letter. Render-only: the E-interaction + the server-validated flow
 * live in main.ts / the mission runner (the start coord is walkable-verified, so the player can stand on it and
 * press E). Mounted behind flags.missions; inert otherwise.
 */
import { type Camera, CanvasTexture, Frustum, LinearFilter, Matrix4, type Object3D, Sphere, Sprite, SpriteMaterial, SRGBColorSpace, Vector3 } from 'three';
import type { AvatarTemplate } from '../avatar/riggedAvatar';
import { MISSIONS, missionEnabled } from '@gtasf/shared/founder/missions';
import { flags } from '@gtasf/shared/flags';
import { createGroundNpc, type GroundNpc } from './groundNpc';
import { placePoint } from '../spawn/locations';
import { centerSlot, centerSlotLabelFade } from '../hud/centerSlot';

/** Rust (appearance.ts index 6) — a gritty tone so a mission marker reads apart from the Ink VC investor + the
 *  casual peer founders. */
const GIVER_OUTFIT = 6;

/** Build the floating "<Mission> · START THE JOB" label (same tech-noir sprite as the plaza investor / demo-day MC). */
function label(title: string, touch: boolean, done = false): Sprite {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  paintLabel(canvas, title, touch, done);
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.magFilter = LinearFilter;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.scale.set(3.2, 0.8, 1); sprite.position.set(0, 2.55, 0); sprite.renderOrder = 10;
  return sprite;
}

/** giverDoneToday: a job already run today says so instead of inviting 'PRESS E TO START' (the start is refused until the
 *  next SF day anyway). Repaints the same canvas. */
function paintLabel(canvas: HTMLCanvasElement, title: string, touch: boolean, done: boolean): void {
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0c1813e6'; ctx.beginPath(); ctx.roundRect(8, 8, 496, 112, 20); ctx.fill();
    ctx.strokeStyle = '#f0b429'; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(8, 8, 496, 112, 20); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f6edda'; ctx.font = `700 32px Arial, sans-serif`;
    ctx.fillText(title.length > 22 ? title.slice(0, 21) + '…' : title, 256, 48);
    ctx.fillStyle = '#f0b429'; ctx.font = `900 28px Haettenschweiler, 'Arial Narrow Bold', Impact, sans-serif`;
    if (done) { ctx.fillStyle = '#9fb3a8'; ctx.fillText('DONE FOR TODAY · BACK TOMORROW', 256, 90); }
    else ctx.fillText(touch ? 'TAP ENTER / EXIT TO START' : 'PRESS E TO START', 256, 90); // touch has no E (critic N9)
  }
}

export interface FounderMissionGiversDeps {
  template: AvatarTemplate;
  root: Object3D;
  world: { surfaceHeightAt(x: number, z: number): number | null; ensureAround(point: { x: number; z: number }): Promise<void> };
  /** giverFrustumCull: the render camera. Avatar meshes are frustumCulled=false (bind-pose bounds; avatarPoseBounds isn't in
   *  prod), so every giver was skinned + drawn every frame even behind the camera: the taxi-stand giver behind the Ferry
   *  spawn cost ~2 fps on the phone idle gate (10-19). Outside the view = hidden and not animated. */
  camera?: () => Camera;
}

// Covers the figure in any idle pose (riggedAvatar POSE_RADIUS 2.4 from 0.8 m) and the label at 2.55 m (3.2 m wide).
const CULL_RADIUS = 3, CULL_LIFT = 1.4;
const _frustum = new Frustum(), _viewProj = new Matrix4(), _sphere = new Sphere(new Vector3(), CULL_RADIUS);

export interface FounderMissionGivers {
  /** `runningMissionId`: the job in progress — its giver's 'PRESS E TO START' label hides until it ends (#6.23 phone). */
  update(dt: number, runningMissionId?: string | null): void;
  /** giverDoneToday: the jobs already paid today (from /api/funding/missions, or a MISSION PASSED). */
  setDone(done: ReadonlySet<string>): void;
  dispose(): void;
}

/** Mount a marker NPC at each mission start (async per NPC; the handle updates them each frame + disposes on
 *  teardown). The E-interaction is main.ts's (proximity to the mission.start coord), so this is purely the
 *  in-world marker. */
export function createFounderMissionGivers(deps: FounderMissionGiversDeps): FounderMissionGivers {
  const npcs: GroundNpc[] = [];
  const labels = new Map<string, Sprite>();
  const doneShown = new Set<string>();
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  let disposed = false;
  for (const mission of MISSIONS.filter(m => missionEnabled(m, flags))) {
    const p = placePoint(mission.start), sign = label(mission.title, touch);
    labels.set(mission.id, sign);
    void createGroundNpc({
      template: deps.template, root: deps.root, world: deps.world,
      target: { lat: mission.start.lat, lon: mission.start.lon }, faceToward: { x: p.x, z: p.z + 15 },
      outfit: GIVER_OUTFIT, label: sign, name: `Mission giver: ${mission.id}`,
    }).then(npc => { if (disposed) npc.dispose(); else npcs.push(npc); })
      .catch(err => console.warn('Mission giver could not load.', err));
  }
  return {
    update(dt, runningMissionId = null) {
      if (disposed) return;
      const camera = flags.giverFrustumCull ? deps.camera?.() : undefined;
      if (camera) { camera.updateMatrixWorld(); _frustum.setFromProjectionMatrix(_viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)); }
      for (const npc of npcs) {
        if (camera) {
          _sphere.center.set(npc.position.x, npc.y, npc.position.z); _sphere.center.y += CULL_LIFT;
          const out = !_frustum.intersectsSphere(_sphere); npc.setCulled(out); if (out) continue;
        }
        npc.update(dt);
      }
      const fade = flags.plazaLabelFade ? centerSlotLabelFade() : 1; // critic 20f: stand aside for centre moments
      // A just-done giver's DONE FOR TODAY waits out the MISSION PASSED band (critic 10-20: two signs at once).
      const holdDone = flags.giverDoneToday && centerSlot.busy;
      for (const [id, sign] of labels) { sign.visible = id !== runningMissionId && !(holdDone && doneShown.has(id)); sign.material.opacity = fade; }
    },
    setDone(done) {
      if (disposed || !flags.giverDoneToday) return;
      for (const mission of MISSIONS) {
        const sign = labels.get(mission.id), isDone = done.has(mission.id);
        if (!sign || doneShown.has(mission.id) === isDone) continue;
        if (isDone) doneShown.add(mission.id); else doneShown.delete(mission.id);
        const map = sign.material.map as CanvasTexture | null, canvas = map?.image as HTMLCanvasElement | undefined;
        if (canvas) { paintLabel(canvas, mission.title, touch, isDone); map!.needsUpdate = true; }
      }
    },
    dispose() { if (disposed) return; disposed = true; for (const npc of npcs) npc.dispose(); npcs.length = 0; },
  };
}
