// GTA V pivot — LANE B: SFPD officers on foot (flag sfpdOnFoot), the client side of server WorldPolice 'foot' units.
// The server sends the officers near this player (S2C OFFICERS, positions in cm at the 10 Hz snapshot rate); this
// keeps a small pool of lane A's SFPD officer avatars (createSfpdOfficer), eases each toward its latest server
// position, stands it on the ground and plays run/idle. Officers that leave the list are hidden and recycled.
import type { Scene } from 'three';
import type { AvatarInstance, AvatarTemplate } from '../avatar/riggedAvatar';
import { createSfpdOfficer } from './sfpdOfficer';
import { createHeldWeapon, type HeldWeapon } from '../avatar/heldWeapon';

export interface PoliceOfficerEntry { id: number; x: number; y: number; z: number; yaw: number; moving: boolean }

export interface PoliceOfficers {
  /** Replace the visible officer set with the server's latest list (centimetres, byte yaw). */
  sync(entries: readonly PoliceOfficerEntry[]): void;
  /** `target` (policePresence): the player's position (metres) — officers draw a pistol and aim at it while they stand
   *  (holding at the cruiser door / covering an arrest); lowered while they run. Omit for the plain run/idle. */
  update(dt: number, target?: { x: number; y: number; z: number }): void;
  readonly count: number;
  /** Rendered officer positions (metres), e.g. for the radar's police blips. */
  positions(): { x: number; y: number; z: number }[];
  dispose(): void;
}

const POOL_MAX = 8;          // more than the server ever sends near one player (2 per pursuit × a few pursuits)
const EASE_PER_SEC = 10;     // snapshot smoothing toward the latest server position
const TELEPORT_M = 12;       // a jump bigger than this snaps instead of sliding across the street

interface Slot { avatar: AvatarInstance; id: number; x: number; z: number; tx: number; tz: number; yaw: number; moving: boolean; live: boolean; weapon?: HeldWeapon; aim: number }

export function createPoliceOfficers(options: { scene: Scene; template: AvatarTemplate; surfaceHeightAt: (x: number, z: number) => number;
  /** policePresence: officers carry a pistol (lane D's held-weapon arm IK) and aim it at `update`'s target. */
  armed?: boolean }): PoliceOfficers {
  const slots: Slot[] = [];
  const byId = new Map<number, Slot>();

  function take(id: number): Slot | undefined {
    let slot = slots.find(s => !s.live);
    if (!slot && slots.length < POOL_MAX) {
      const avatar = createSfpdOfficer(options.template);
      avatar.root.visible = false;
      options.scene.add(avatar.root);
      slot = { avatar, id, x: 0, z: 0, tx: 0, tz: 0, yaw: 0, moving: false, live: false, aim: 0, weapon: options.armed ? createHeldWeapon(avatar.root) : undefined };
      slots.push(slot);
    }
    if (!slot) return undefined;
    slot.id = id; slot.live = true; byId.set(id, slot);
    return slot;
  }

  return {
    sync(entries) {
      const seen = new Set<number>();
      for (const e of entries) {
        seen.add(e.id);
        const tx = e.x / 100, tz = e.z / 100;
        let slot = byId.get(e.id);
        if (!slot) { slot = take(e.id); if (!slot) continue; slot.x = tx; slot.z = tz; }
        if (Math.hypot(tx - slot.x, tz - slot.z) > TELEPORT_M) { slot.x = tx; slot.z = tz; }
        slot.tx = tx; slot.tz = tz; slot.yaw = (e.yaw / 256) * Math.PI * 2; slot.moving = e.moving;
        slot.avatar.root.visible = true;
      }
      for (const [id, slot] of byId) if (!seen.has(id)) { slot.live = false; slot.avatar.root.visible = false; byId.delete(id); }
    },
    update(dt, target) {
      const k = 1 - Math.exp(-EASE_PER_SEC * Math.max(0, dt)), aimK = 1 - Math.exp(-6 * Math.max(0, dt));
      for (const slot of slots) {
        if (!slot.live) continue;
        slot.x += (slot.tx - slot.x) * k; slot.z += (slot.tz - slot.z) * k;
        slot.avatar.root.position.set(slot.x, options.surfaceHeightAt(slot.x, slot.z), slot.z);
        slot.avatar.root.rotation.y = slot.yaw;
        slot.avatar.update(dt, slot.moving ? 'run' : 'idle', 1);
        // Perf (QA #6.20 firefight on the 30 fps edge): the weapon IK forces a full skeleton matrix update per officer; past
        // 30 m the aim isn't readable on a phone, so those officers keep their last pose.
        const near = !target || Math.hypot(target.x - slot.x, target.z - slot.z) <= 30;
        if (slot.weapon && near) { // after the mixer: raise and aim when standing with the player in view, lowered on the run
          const want = target && !slot.moving ? 1 : 0;
          slot.aim += (want - slot.aim) * aimK;
          const p = slot.avatar.root.position, d = target ? Math.hypot(target.x - p.x, target.z - p.z) : 1;
          const pitch = target ? Math.atan2(target.y + 1.1 - (p.y + 1.45), Math.max(1, d)) : 0; // muzzle at chest height → their torso
          slot.weapon.update('pistol', slot.aim, pitch);
        }
      }
    },
    get count() { return byId.size; },
    positions() { return slots.filter(s => s.live).map(s => ({ x: s.x, y: s.avatar.root.position.y, z: s.z })); },
    dispose() {
      for (const slot of slots) { slot.weapon?.dispose(); options.scene.remove(slot.avatar.root); slot.avatar.dispose(); }
      slots.length = 0; byId.clear();
    },
  };
}
