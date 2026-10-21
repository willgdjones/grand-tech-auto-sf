/**
 * GTA V pivot — LANE B (combat & police): the carjack "pull-out" cosmetic. When the player takes over a MOVING
 * traffic car, its driver is yanked out — this spawns a pooled NPC avatar beside the car that ragdoll-lite
 * topples (reusing ragdoll.ts) and fades out. Client-only + local; the car-theft wanted heat is the server's
 * job (WorldDO.handleMessage). Byte-inert when the flag is off (main.ts never creates this).
 *
 * The persistent "every traffic car has a visible driver" render is deferred (perf + lane A's fleet renderer);
 * this shows a driver at the moment of the jack, which is the GTA pull-out beat without the per-car cost.
 */
import * as THREE from 'three';
import type { AvatarInstance, AvatarTemplate } from '../avatar/riggedAvatar';
import { applyDeathPose, clearWastedPose } from './ragdoll';

const EJECT_LIFE_MS = 2600;  // on the ground this long, then recycled
const FADE_FROM = 0.72;      // fraction of life after which it fades out
const SIDE_M = 1.15;         // how far to the driver side the NPC lands
const POOL = 3;

interface Slot { avatar: AvatarInstance; active: boolean; startMs: number; x: number; y: number; z: number; yaw: number }

export interface CarjackEffect {
  /** Eject a driver beside a car at (x,y,z) metres with the car's heading (radians). */
  eject(x: number, y: number, z: number, carYaw: number, nowMs: number): void;
  update(nowMs: number): void;
  dispose(): void;
}

export function createCarjackEffect(options: { scene: THREE.Scene; template: AvatarTemplate; outfit?: number }): CarjackEffect {
  const { scene, template } = options;
  const slots: Slot[] = [];

  function ensureSlot(): Slot | undefined {
    const free = slots.find(s => !s.active);
    if (free) return free;
    if (slots.length < POOL) {
      const avatar = template.createInstance(options.outfit ?? 0);
      avatar.root.visible = false;
      scene.add(avatar.root);
      const slot: Slot = { avatar, active: false, startMs: 0, x: 0, y: 0, z: 0, yaw: 0 };
      slots.push(slot);
      return slot;
    }
    return slots.reduce((a, b) => (a.startMs <= b.startMs ? a : b)); // reuse the oldest if all busy
  }

  return {
    eject(x: number, y: number, z: number, carYaw: number, nowMs: number): void {
      const slot = ensureSlot();
      if (!slot) return;
      // Land just off the driver side (perpendicular to the car's heading).
      slot.x = x - Math.sin(carYaw) * SIDE_M;
      slot.z = z + Math.cos(carYaw) * SIDE_M;
      slot.y = y;
      slot.yaw = carYaw + Math.PI / 2;
      slot.startMs = nowMs;
      slot.active = true;
      slot.avatar.root.visible = true;
    },
    update(nowMs: number): void {
      for (const slot of slots) {
        if (!slot.active) continue;
        const t = (nowMs - slot.startMs) / EJECT_LIFE_MS;
        if (t >= 1) { slot.active = false; slot.avatar.root.visible = false; clearWastedPose(slot.avatar.root, slot.y); continue; }
        slot.avatar.root.position.set(slot.x, slot.y, slot.z);
        slot.avatar.root.rotation.y = slot.yaw;
        const fade = t < FADE_FROM ? 1 : Math.max(0, 1 - (t - FADE_FROM) / (1 - FADE_FROM));
        // A real forward fall on Meshy bodies (meshyDeathClips); otherwise the plank topple with a frozen skeleton.
        applyDeathPose(slot.avatar, slot.y, (nowMs - slot.startMs) / 1000, 'dieforward', fade);
      }
    },
    dispose(): void {
      for (const slot of slots) { scene.remove(slot.avatar.root); slot.avatar.dispose?.(); }
      slots.length = 0;
    },
  };
}
