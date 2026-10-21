/**
 * Founder-ladder phase 6 — cosmetic teammate followers (flags.seriesAQuest; docs/PLAN-founder-ladder-phase6.md).
 * Closing the Series A Demo Day round "hires" a small crew of finished rigged avatars that trail the player in a
 * loose formation. PURELY COSMETIC: they never affect gameplay, funding, speed or collision (like characterLooks)
 * — they only walk/idle behind the player. Session-only (re-hired on each Series A close; not persisted).
 *
 * Reuses the shared avatar template (finished silhouettes, not capsules). Each follower lerps toward a leash slot
 * behind the player, playing 'walk' while catching up and 'idle' once settled. Mounted only when the quest flag is
 * on and hired() is called from the Series A pitch's credited onDone, so prod with the flag off is unaffected.
 */
import type { Object3D } from 'three';
import { defaultAppearance, resolveLook, type FounderArchetype } from '@gtasf/shared/content/cosmetics';
import type { AvatarInstance, AvatarTemplate } from '../avatar/riggedAvatar';

export interface FounderFollowersDeps {
  template: AvatarTemplate;
  root: Object3D;
  world: { surfaceHeightAt(x: number, z: number): number | null };
}

export interface FounderFollowers {
  /** Hire the cosmetic crew (idempotent — a no-op once hired). Positioned on the first update behind the player. */
  hire(): void;
  readonly hired: boolean;
  /** Per-frame: ease each follower toward its leash slot behind the player and animate walk/idle. */
  update(player: { x: number; z: number; yaw: number }, dt: number): void;
  dispose(): void;
}

interface Follower { avatar: AvatarInstance; x: number; z: number; placed: boolean; readonly back: number; readonly side: number }

/** Three distinct teammate looks (an engineer, a designer, an operator) so the crew reads as a founding team. */
const CREW: readonly { sex: 'male' | 'female'; archetype: FounderArchetype; outfit: number; accessory: number; back: number; side: number }[] = [
  { sex: 'male', archetype: 'hacker', outfit: 1, accessory: 0, back: 2.4, side: -1.3 },
  { sex: 'female', archetype: 'design', outfit: 2, accessory: 0, back: 3.2, side: 0 },
  { sex: 'male', archetype: 'growth', outfit: 3, accessory: 0, back: 2.4, side: 1.3 },
];

const FOLLOW_SPEED_MPS = 3.4; // slightly faster than a walk, so the crew keeps up without sprinting
const ARRIVE_M = 0.35;        // within this of the leash slot → settle to idle

export function createFounderFollowers(deps: FounderFollowersDeps): FounderFollowers {
  let crew: Follower[] = [];
  let disposed = false;
  return {
    get hired() { return crew.length > 0; },
    hire() {
      if (disposed || crew.length > 0) return;
      crew = CREW.map(c => {
        const look = resolveLook({ ...defaultAppearance(c.sex, c.archetype), outfit: c.outfit, accessory: c.accessory });
        const avatar = deps.template.createInstance(c.outfit, look, true);
        avatar.root.name = 'Founder-ladder teammate';
        avatar.root.visible = false; // positioned on the first update (avoids a one-frame avatar at the origin)
        deps.root.add(avatar.root);
        return { avatar, x: 0, z: 0, placed: false, back: c.back, side: c.side };
      });
    },
    update(player, dt) {
      if (disposed || crew.length === 0) return;
      // Behind = opposite the player's facing (atan2(dx,dz) convention: forward = (sin yaw, cos yaw)); side is ⟂.
      const bx = -Math.sin(player.yaw), bz = -Math.cos(player.yaw), sx = Math.cos(player.yaw), sz = -Math.sin(player.yaw);
      for (const f of crew) {
        const tx = player.x + bx * f.back + sx * f.side, tz = player.z + bz * f.back + sz * f.side;
        if (!f.placed) { f.x = tx; f.z = tz; f.placed = true; } // snap into formation on hire
        const dx = tx - f.x, dz = tz - f.z, dist = Math.hypot(dx, dz);
        let moving = false;
        if (dist > ARRIVE_M) {
          const step = Math.min(dist, FOLLOW_SPEED_MPS * Math.min(dt, 0.1));
          f.x += (dx / dist) * step; f.z += (dz / dist) * step; moving = true;
          f.avatar.root.rotation.y = Math.atan2(dx, dz); // face the direction of travel
        } else {
          f.avatar.root.rotation.y = player.yaw; // settled: face the way the player faces
        }
        const y = deps.world.surfaceHeightAt(f.x, f.z);
        f.avatar.root.position.set(f.x, y ?? f.avatar.root.position.y, f.z);
        f.avatar.root.visible = y != null || f.avatar.root.visible;
        f.avatar.update(dt, moving ? 'walk' : 'idle', 1);
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const f of crew) { f.avatar.root.removeFromParent(); f.avatar.dispose(); }
      crew = [];
    },
  };
}
