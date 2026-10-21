import type { Object3D } from 'three';
import { avatarOutfits, type PlayerAnimation } from '../avatar/riggedAvatar';
import { PEOPLE_BODIES } from '../avatar/peopleAssets';
import { createCrowdPopulation } from './instancedCrowd';
import { loadCrowdVat } from './crowdVat';

/**
 * gtasf-c8sj: on Low, remote players farther than `near` metres (12 m: a crowd test showed ~7 rigged peers inside 25 m) draw as the instanced crowd silhouette
 * (one draw for all of them) instead of a rigged avatar (~11 draws each). Near players keep full avatars.
 * crowdVat (lane D): once the vertex-animated bodies load, far players switch to them, each in the SAME body their near rigged
 * avatar wears (outfit = id % avatarOutfits: palettes 0-3 = hoodie, then the CC0 bodies), so crossing `near` doesn't swap people.
 */
export function createPeerImpostors(parent: Object3D, capacity = 48, near = 12) {
  let crowd = createCrowdPopulation(capacity, null);
  crowd.root.name = 'Low far-player silhouettes'; parent.add(crowd.root);
  const slots = new Map<number, number>(), shown = new Set<number>();
  // Free slots per body (box crowd: one list). Actor i of a VAT population wears body i % bodies.
  let free: number[][] = [Array.from({ length: capacity }, (_, i) => capacity - 1 - i)];
  let bodyFor: (id: number) => number = () => 0, disposed = false;
  void loadCrowdVat().then(vat => {
    if (!vat || disposed) return;
    const next = createCrowdPopulation(capacity, null, 0, [], vat);
    for (const id of [...slots.keys()]) api.release(id);
    parent.remove(crowd.root); crowd.dispose(); crowd = next; crowd.root.name = 'Low far-player silhouettes'; parent.add(crowd.root);
    const n = vat.bodies.length, index = new Map(vat.bodies.map((body, i) => [body.id, i]));
    free = vat.bodies.map((_, b) => Array.from({ length: capacity }, (_, i) => i).filter(i => i % n === b).reverse());
    bodyFor = id => {
      const outfit = ((id % avatarOutfits.length) + avatarOutfits.length) % avatarOutfits.length;
      return index.get(outfit < 4 ? 'hoodie' : PEOPLE_BODIES[outfit - 4] ?? 'hoodie') ?? id % n;
    };
  });
  const api = {
    near,
    /** Draw `id` as a silhouette this frame. False when the pool is full (caller keeps the rigged avatar). */
    place(id: number, x: number, y: number, z: number, yaw: number, clip: PlayerAnimation, dt: number): boolean {
      let slot = slots.get(id);
      if (slot === undefined) {
        slot = (free[bodyFor(id)] ?? free[0])!.pop(); if (slot === undefined) return false;
        slots.set(id, slot); crowd.actors[slot]!.setOutfit(id);
      }
      const actor = crowd.actors[slot]!;
      actor.root.position.set(x, y, z); actor.root.rotation.y = yaw;
      actor.update(dt, clip === 'idle' ? 'idle' : 'walk', 1); shown.add(slot); // riders read as walking at range
      return true;
    },
    release(id: number) {
      const slot = slots.get(id); if (slot === undefined) return; slots.delete(id); crowd.actors[slot]!.root.visible = false;
      (free.length > 1 ? free[slot % free.length] : free[0])!.push(slot);
    },
    /** Hide every slot not placed since the last flush, then upload. */
    flush() {
      for (const slot of slots.values()) if (!shown.has(slot)) crowd.actors[slot]!.root.visible = false;
      shown.clear(); crowd.flush();
    },
    clear() { for (const id of [...slots.keys()]) api.release(id); crowd.flush(); },
    dispose() { disposed = true; crowd.dispose(); },
  };
  return api;
}
