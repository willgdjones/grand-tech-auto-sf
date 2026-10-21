/**
 * cofounderRecruits (critic 10-19 night item, "Find Your Co-founders"): the three recruits are PEOPLE, not only minimap
 * letters. While the job runs, each pending recruit waits at their spot (a finished rigged avatar with a name label, idling
 * on the pavement beside the road-snapped objective point). Reaching them hires them: they trail the player in the Series A
 * crew's loose formation (followers.ts) and ride along, hidden, while the player drives. Delivered at the hacker house,
 * they stop there and idle, and are cleared once the player has left. Purely cosmetic and local: the server still validates
 * every checkpoint from the authoritative pose. Mounted behind flags.cofounderRecruits; inert otherwise.
 */
import { CanvasTexture, LinearFilter, type Object3D, Sprite, SpriteMaterial, SRGBColorSpace } from 'three';
import { defaultAppearance, resolveLook, type AvatarSex, type FounderArchetype } from '@gtasf/shared/content/cosmetics';
import type { MissionSpec } from '@gtasf/shared/founder/missions';
import type { AvatarInstance, AvatarTemplate } from '../avatar/riggedAvatar';
import { placePoint } from '../spawn/locations';

export const COFOUNDER_MISSION_ID = 'cofounder-hunt';

/** One look per recruit objective id (shared/founder/missions.ts 'cofounder-hunt'), matching the Series A crew's trio. */
const RECRUITS: Readonly<Record<string, { name: string; sex: AvatarSex; archetype: FounderArchetype; outfit: number; back: number; side: number }>> = {
  rust: { name: 'The Rust prodigy', sex: 'male', archetype: 'dropout', outfit: 1, back: 2.4, side: -1.3 },
  designer: { name: 'The designer', sex: 'female', archetype: 'design', outfit: 2, back: 3.2, side: 0 },
  'staff-eng': { name: 'The staff engineer', sex: 'male', archetype: 'ex-faang', outfit: 3, back: 2.4, side: 1.3 },
};

const FOLLOW_SPEED_MPS = 5.2;  // a jog at the leash; further back they speed up (catch-up = 1.6 x the gap, up to a sprint)
const FOLLOW_MAX_MPS = 9;
const CATCH_UP_M = 25;         // further than this (a run, a respawn) → snap back into formation
const ARRIVE_M = 0.35;
const WAIT_SCAN_M = [6, 22];            // scan outward from the road centreline to the first building front
const WAIT_FALLBACK_M = 9;               // no building found within the scan: this far out
const CLEAR_HOME_M = 120;      // delivered recruits are cleared once the player is this far from them
const WAIT_DRAW_M = 150;       // a waiting recruit further than this is hidden and not animated (rigged avatars aren't free)

export interface CofounderRecruitsDeps {
  template: AvatarTemplate;
  root: Object3D;
  world: {
    surfaceHeightAt(x: number, z: number): number | null;
    nearestRoad(x: number, z: number, maxDistance?: number): { x: number; z: number; yaw: number } | null;
    collides(x: number, y: number, z: number, radius?: number, height?: number): boolean;
  };
}

export interface CofounderRecruits {
  /** The mission runner's objective changed (null = the job ended: passed, failed or abandoned). */
  objective(state: { mission: MissionSpec; index: number } | null): void;
  /** The job was passed: the crew stays at the hacker house instead of vanishing. */
  passed(): void;
  update(player: { x: number; z: number; yaw: number }, dt: number, inVehicle: boolean): void;
  readonly following: number;
  /** QA: each recruit's phase / placement (tools/_job-playthrough.mjs reads it via window.__gtasfRecruits). */
  debug(): { id: string; phase: Phase; placed: boolean; visible: boolean; x: number; z: number; spotX: number; spotZ: number }[];
  dispose(): void;
}

type Phase = 'waiting' | 'following' | 'home';
interface Recruit { id: string; avatar: AvatarInstance; label: Sprite; phase: Phase; x: number; z: number; placed: boolean;
  spot: { x: number; z: number }; back: number; side: number;
  /** 'home': where they settle at the hacker house (beside the player once they stand still), set then. */
  home?: { x: number; z: number } }

function nameLabel(name: string): Sprite {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 112;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0c1813e6'; ctx.beginPath(); ctx.roundRect(8, 8, 496, 96, 18); ctx.fill();
    ctx.strokeStyle = '#7fd3ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(8, 8, 496, 96, 18); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f6edda'; ctx.font = '700 30px Arial, sans-serif'; ctx.fillText(name, 256, 42);
    ctx.fillStyle = '#7fd3ff'; ctx.font = `900 24px Haettenschweiler, 'Arial Narrow Bold', Impact, sans-serif`;
    ctx.fillText('WALK UP TO RECRUIT', 256, 80);
  }
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.magFilter = LinearFilter;
  // depthTest off: a quest marker, readable through the street trees and parked cars that hid it (final run 10-20).
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
  sprite.scale.set(2.8, 0.62, 1); sprite.position.set(0, 2.45, 0); sprite.renderOrder = 10;
  return sprite;
}

export function createCofounderRecruits(deps: CofounderRecruitsDeps): CofounderRecruits {
  let crew: Recruit[] = [], disposed = false, passed = false;
  let lastPlayer: { x: number; z: number } | null = null, settleStill = 0; // the crew settles once the player stands still

  const clear = () => {
    for (const r of crew) { r.avatar.root.removeFromParent(); r.avatar.dispose(); r.label.removeFromParent(); r.label.material.map?.dispose(); r.label.material.dispose(); }
    crew = []; passed = false;
  };
  const mount = (mission: MissionSpec) => {
    clear();
    crew = mission.objectives.flatMap(o => {
      const spec = RECRUITS[o.id];
      if (!spec || !o.at) return [];
      const look = resolveLook({ ...defaultAppearance(spec.sex, spec.archetype), outfit: spec.outfit, accessory: 0 });
      // Local, non-networked NPCs: force the rich look (as groundNpc does), so they read as distinct people in prod.
      const avatar = deps.template.createInstance(spec.outfit, look, true);
      avatar.root.name = `Co-founder recruit (${o.id})`;
      avatar.root.visible = false; // placed once its ground is known
      // The label lives beside the avatar, not under its root: a forced look rebuilds the root's children, which dropped it
      // (final2 run 10-20: no label at any approach). Positioned over the recruit each frame.
      const label = nameLabel(spec.name); label.visible = false; deps.root.add(label);
      deps.root.add(avatar.root);
      return [{ id: o.id, avatar, label, phase: 'waiting' as Phase, x: 0, z: 0, placed: false, spot: placePoint(o.at), back: spec.back, side: spec.side }];
    });
  };
  /** Stand a waiting recruit on the pavement beside the road point, once that ground is loaded: scan out perpendicular to the
   *  road until the first building front and stand 1.5 m off it (a fixed 5-9 m offset was the parking lane, behind parked
   *  cars; final run 10-20). The nearer side wins; no building within 22 m either side = 9 m out on walkable ground. */
  /** The pavement by the road point (cx, cz): scan out perpendicular to the road to the first building front and stand 1.5 m off
   *  it, nearer side first; none within 22 m either side = 9 m out. Also returns the road's direction (to line people up along
   *  the kerb). null until that ground is loaded. */
  const sidewalkBy = (sx0: number, sz0: number): { x: number; z: number; ux: number; uz: number } | null => {
    const road = deps.world.nearestRoad(sx0, sz0, 30);
    const cx = road?.x ?? sx0, cz = road?.z ?? sz0, yaw = road?.yaw ?? 0;
    const px = Math.cos(yaw), pz = -Math.sin(yaw); // ⟂ to the road's forward (sin yaw, cos yaw)
    const ux = Math.sin(yaw), uz = Math.cos(yaw);
    if (deps.world.surfaceHeightAt(cx, cz) == null) return null; // not loaded yet
    let best: { x: number; z: number; d: number } | null = null;
    for (const side of [1, -1]) for (let d = WAIT_SCAN_M[0]!; d <= WAIT_SCAN_M[1]!; d += 0.5) {
      const x = cx + px * d * side, z = cz + pz * d * side, y = deps.world.surfaceHeightAt(x, z);
      if (y == null) break;
      if (deps.world.collides(x, y, z, 0.4, 1.8)) { // the building front: step back onto the pavement
        const back = d - 1.5;
        if (back >= WAIT_SCAN_M[0]! && (!best || back < best.d)) best = { x: cx + px * back * side, z: cz + pz * back * side, d: back };
        break;
      }
    }
    if (!best) for (const side of [1, -1]) {
      const x = cx + px * WAIT_FALLBACK_M * side, z = cz + pz * WAIT_FALLBACK_M * side;
      if (deps.world.surfaceHeightAt(x, z) != null) { best = { x, z, d: WAIT_FALLBACK_M }; break; }
    }
    return best ? { x: best.x, z: best.z, ux, uz } : null;
  };
  /** Stand a waiting recruit on the pavement beside their road point (a fixed 5-9 m offset was the parking lane, behind parked
   *  cars; final run 10-20). */
  const placeWaiting = (r: Recruit): boolean => {
    const spot = sidewalkBy(r.spot.x, r.spot.z);
    if (!spot) return false;
    r.x = spot.x; r.z = spot.z; r.placed = true; return true;
  };

  return {
    get following() { return crew.filter(r => r.phase === 'following').length; },
    debug: () => crew.map(r => ({ id: r.id, phase: r.phase, placed: r.placed, visible: r.avatar.root.visible, x: Math.round(r.x), z: Math.round(r.z), spotX: Math.round(r.spot.x), spotZ: Math.round(r.spot.z) })),
    objective(state) {
      if (disposed) return;
      if (!state || state.mission.id !== COFOUNDER_MISSION_ID) {
        // Passed: the crew stays at the house (cleared once the player leaves). Failed / abandoned: they go.
        if (!passed) { clear(); return; }
        for (const r of crew) { r.phase = 'home'; r.home = undefined; }
        return;
      }
      if (crew.length === 0 || !crew.some(r => r.phase !== 'home')) mount(state.mission);
      // Every recruit objective before the current one has been reached: hired.
      state.mission.objectives.forEach((o, i) => {
        const r = crew.find(c => c.id === o.id);
        if (r && i < state.index && r.phase === 'waiting') { r.phase = 'following'; r.label.visible = false; r.label.removeFromParent(); }
      });
    },
    passed() { passed = true; },
    update(player, dt, inVehicle) {
      if (disposed || crew.length === 0) return;
      const bx = -Math.sin(player.yaw), bz = -Math.cos(player.yaw), sx = Math.cos(player.yaw), sz = -Math.sin(player.yaw);
      let anyHome = false, homeNear = false;
      const moved = lastPlayer ? Math.hypot(player.x - lastPlayer.x, player.z - lastPlayer.z) : 0; lastPlayer = { x: player.x, z: player.z };
      settleStill = moved < 0.02 ? settleStill + dt : 0;
      for (const r of crew) {
        let moving = false;
        if (r.phase === 'waiting') {
          if (Math.hypot(player.x - r.spot.x, player.z - r.spot.z) > WAIT_DRAW_M) { r.avatar.root.visible = false; r.label.visible = false; continue; }
          if (!r.placed && !placeWaiting(r)) continue;
          r.avatar.root.rotation.y = Math.hypot(player.x - r.x, player.z - r.z) < 40 ? Math.atan2(player.x - r.x, player.z - r.z) : r.avatar.root.rotation.y;
        } else {
          // following: fall in behind the player. home: walk to a spot on the pavement at the house, then idle facing the player.
          if (r.phase === 'following' && inVehicle) { r.avatar.root.visible = false; r.placed = false; continue; } // rides along
          if (r.phase === 'home') {
            anyHome = true; if (Math.hypot(player.x - r.x, player.z - r.z) < CLEAR_HOME_M) homeNear = true;
            // PASSED fires at the stop's 15 m radius, and a player often walks on to the door: settle only once the player has
            // stood still ~0.8 s, beside them (2.2 / 2.2 / 3.4 m out, 0.5 m back; between camera and player filled the frame).
            // Earlier anchors failed in real runs: the player's spot at PASSED (left ~10 m behind) and a pavement scan at the
            // house (ended inside the building; final4, 10-20).
            if (!r.home && settleStill >= 0.8) {
              const lateral = r.side < 0 ? -2.2 : r.side > 0 ? 2.2 : 3.4;
              r.home = { x: player.x + bx * 0.5 + sx * lateral, z: player.z + bz * 0.5 + sz * lateral };
            }
          }
          const tx = r.home ? r.home.x : player.x + bx * r.back + sx * r.side; // home before settling = keep following
          const tz = r.home ? r.home.z : player.z + bz * r.back + sz * r.side;
          const dx = tx - r.x, dz = tz - r.z, dist = Math.hypot(dx, dz);
          if (!r.placed || dist > CATCH_UP_M) { r.x = tx; r.z = tz; r.placed = true; }
          else if (dist > ARRIVE_M) {
            const speed = Math.min(FOLLOW_MAX_MPS, Math.max(FOLLOW_SPEED_MPS, dist * 1.6));
            const step = Math.min(dist, speed * Math.min(dt, 0.1));
            r.x += (dx / dist) * step; r.z += (dz / dist) * step; moving = true;
            r.avatar.root.rotation.y = Math.atan2(dx, dz);
          } else r.avatar.root.rotation.y = r.home ? Math.atan2(player.x - r.x, player.z - r.z) : player.yaw;
        }
        const y = deps.world.surfaceHeightAt(r.x, r.z);
        if (y != null) { r.avatar.root.position.set(r.x, y, r.z); r.avatar.root.visible = true; }
        if (r.phase === 'waiting') {
          // Grows with distance (x1 within 14 m, up to x2.6) so the name reads from a block away (final4: tiny at 25-30 m).
          const grow = Math.min(2.6, Math.max(1, Math.hypot(player.x - r.x, player.z - r.z) / 14));
          r.label.scale.set(2.8 * grow, 0.62 * grow, 1);
          r.label.position.set(r.x, r.avatar.root.position.y + 2.2 + 0.25 * grow, r.z); r.label.visible = r.avatar.root.visible;
        }
        r.avatar.update(dt, moving ? 'walk' : 'idle', 1);
      }
      if (anyHome && !homeNear && crew.every(r => r.phase === 'home')) clear();
    },
    dispose() { if (disposed) return; clear(); disposed = true; },
  };
}
