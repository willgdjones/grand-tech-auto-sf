/**
 * Shared city billboards (docs/PLAN-founder-ladder.md): other founders' startups rotate through the
 * city's billboard surfaces, so San Francisco fills up with players' startups. Server-authoritative via
 * the funding leaderboard (the startup list) + the pure time-rotation in shared/founder/billboardRotation
 * — no new protocol, every client agrees. A small pool of nearest-N unlit CanvasTexture boards (HD 6 /
 * Low 3) is repositioned + repainted only when the nearest set or the rotation changes (never per frame).
 */
import {
  CanvasTexture, DoubleSide, Group, LinearFilter, Mesh, MeshBasicMaterial, type Object3D,
  PlaneGeometry, SRGBColorSpace,
} from 'three';
import { BILLBOARD_SURFACES, DISTRICT_BILLBOARD_RANK, type BillboardSurface } from '@gtasf/shared/content/billboards';
import { assignBillboardSlots, type BillboardStartup } from '@gtasf/shared/founder/billboardRotation';
import { geodeticToWorld } from '../../../tools/map/src/geo';
import { SF_FRAME } from '../../../tools/map/src/config';
import { FOUNDER_BILLBOARD, paintFounderBillboard } from './billboard';

interface Positioned { surface: BillboardSurface; x: number; z: number }
interface Slot {
  group: Group; face: Mesh; canvas: HTMLCanvasElement; texture: CanvasTexture;
  frameMaterial: MeshBasicMaterial; faceMaterial: MeshBasicMaterial; key: string;
}

export interface FounderCityBillboardsDeps {
  root: Object3D;
  world: { surfaceHeightAt(x: number, z: number): number | null };
  /** The current startup list (a projection of the funding leaderboard). */
  getStartups(): readonly BillboardStartup[];
  low?: boolean;
}

export interface FounderCityBillboards {
  update(focus: { x: number; z: number }, now?: number): void;
  dispose(): void;
}

export function createFounderCityBillboards(deps: FounderCityBillboardsDeps): FounderCityBillboards {
  // Candidate surfaces: real SF faces, minus the one the player's own hero board stands at.
  const candidates: Positioned[] = BILLBOARD_SURFACES
    .filter(s => s.coverage === 'sf' && s.id !== FOUNDER_BILLBOARD.id)
    .map(s => { const [x, z] = geodeticToWorld(s.lat, s.lon, SF_FRAME); return { surface: s, x, z }; });

  const poolSize = deps.low ? 3 : 6;
  const root = new Group(); root.name = 'Shared founder city billboards';
  const slots: Slot[] = [];
  for (let i = 0; i < poolSize; i++) {
    const group = new Group(); group.visible = false;
    const canvas = document.createElement('canvas');
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.magFilter = LinearFilter;
    const faceMaterial = new MeshBasicMaterial({ map: texture, toneMapped: false, side: DoubleSide });
    faceMaterial.userData.gtasfUnlit = true;
    const face = new Mesh(new PlaneGeometry(1, 1), faceMaterial);
    const frameMaterial = new MeshBasicMaterial({ color: '#0c1813' }); frameMaterial.userData.gtasfUnlit = true;
    const frame = new Mesh(new PlaneGeometry(1, 1), frameMaterial); frame.position.z = -0.05; frame.scale.setScalar(1.04);
    group.add(frame, face);
    root.add(group);
    slots.push({ group, face, canvas, texture, frameMaterial, faceMaterial, key: '' });
  }
  deps.root.add(root);

  let disposed = false, lastX = Infinity, lastZ = Infinity, lastEpoch = -1, lastCount = -1;

  function update(focus: { x: number; z: number }, now = Date.now()): void {
    if (disposed) return;
    const startups = deps.getStartups();
    const epoch = Math.floor(now / (20 * 60_000));
    // Rebuild only when the player moved, the rotation advanced, or the startup list size changed.
    if (startups.length === lastCount && epoch === lastEpoch && Math.hypot(focus.x - lastX, focus.z - lastZ) < 40) return;
    lastX = focus.x; lastZ = focus.z; lastEpoch = epoch; lastCount = startups.length;

    if (startups.length === 0) { for (const slot of slots) slot.group.visible = false; return; }

    const nearest = [...candidates]
      .sort((a, b) => (a.x - focus.x) ** 2 + (a.z - focus.z) ** 2 - ((b.x - focus.x) ** 2 + (b.z - focus.z) ** 2))
      .slice(0, poolSize);
    // Tier-gate prominent surfaces by district rank (Seed unlocks Market St, Series A the Bay Bridge, …);
    // startupForSlot falls back to the full list so a board is never blank while the city is early-stage.
    const assigned = assignBillboardSlots(
      nearest.map(n => ({ id: n.surface.id, minRank: DISTRICT_BILLBOARD_RANK[n.surface.district] })), startups, now);

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!, placed = nearest[i];
      const startup = placed ? assigned.get(placed.surface.id) : undefined;
      if (!placed || !startup) { slot.group.visible = false; slot.key = ''; continue; }
      const key = `${placed.surface.id}|${startup.id}|${startup.startupName}`;
      if (key === slot.key) { slot.group.visible = true; continue; }
      slot.key = key;
      // Position at the surface, facing its outward normal (yaw = PI - headingDeg), nudged a few metres
      // along that normal so a wall/rooftop surface stands clear of its building instead of embedded in it.
      const ground = deps.world.surfaceHeightAt(placed.x, placed.z) ?? 0;
      const heading = placed.surface.headingDeg * Math.PI / 180;
      const nx = Math.sin(heading), nz = -Math.cos(heading), nudge = 3.5;
      slot.group.position.set(placed.x + nx * nudge, ground + placed.surface.centerHeightAboveGroundMetres, placed.z + nz * nudge);
      slot.group.rotation.y = Math.PI - heading;
      // Unit planes scaled to the surface size (no geometry churn).
      slot.face.scale.set(placed.surface.widthMetres, placed.surface.heightMetres, 1);
      (slot.group.children[0] as Mesh).scale.set(placed.surface.widthMetres * 1.04, placed.surface.heightMetres * 1.04, 1);
      paintFounderBillboard(slot.canvas, startup.startupName, startup.stageLabel ? `${startup.stageLabel} · San Francisco` : undefined);
      slot.texture.needsUpdate = true;
      slot.group.visible = true;
    }
  }

  return {
    update,
    dispose() {
      if (disposed) return; disposed = true;
      root.removeFromParent();
      for (const slot of slots) {
        slot.face.geometry.dispose(); slot.faceMaterial.dispose(); slot.texture.dispose();
        (slot.group.children[0] as Mesh).geometry.dispose(); slot.frameMaterial.dispose();
      }
    },
  };
}
