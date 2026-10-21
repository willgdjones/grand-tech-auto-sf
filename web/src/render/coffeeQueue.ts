import { Group, Mesh, Texture, Vector3, type Material } from 'three';
import { NPC_CHATTER } from '@gtasf/shared/content/flavour';
import type { AvatarInstance, AvatarTemplate } from '../avatar/riggedAvatar';
import type { MovementWorld } from '../movement/world';
import type { CityLifeDestination } from './cityLife';
import type { LocalRect } from './landmarks/pier39';
import { createCoffeeCart } from './coffeeQueueModels';
import { worldToGeodetic } from '../../../tools/map/src/geo';
import { SF_FRAME } from '../../../tools/map/src/config';
import { VisiblePopulation } from './visiblePopulation';
import { createCrowdPopulation } from './instancedCrowd';
import { loadCrowdVat } from './crowdVat';
import { flags } from '@gtasf/shared/flags';

type Point = { x: number; y: number; z: number };
// Façade-side pocket between bollards; preserve the shared walk, cycleway and busway.
export const COFFEE_CART = Object.freeze({ x: -40.5, y: .18, z: 21 });
export const COFFEE_QUEUE = [[0, 2.2], [.25, 4], [-.2, 5.8], [.7, -1.4]] as const;
export const COFFEE_COUNTER_HALF_EXTENTS = Object.freeze({ x: 2.1, z: .85 });
// Conservative bound includes the canopy stripes and front valance, beyond the counter collider.
export const COFFEE_CART_EXTENTS = Object.freeze({ minX: -2.1, maxX: 2.1, minZ: -1.12, maxZ: 1.05 });
export const COFFEE_YIELD_DISTANCE = 1.15;
const cart = COFFEE_CART, queue = COFFEE_QUEUE;
const chatter = NPC_CHATTER.find(group => group.id === 'coffee-regular')!.lines;

/** Local fictional atmosphere, with no player identity, funding reward or network traffic. */
export function createCoffeeQueue(options: {
  enabled: boolean; template: AvatarTemplate | null; landmarks: Group; ground: MovementWorld;
  isLoaded(x: number, z: number): boolean; low?: boolean; parent?: HTMLElement;
  onDestination?(destination: CityLifeDestination): boolean | void; onNotice?(text: string): void;
}) {
  if (!options.enabled || !options.template) return null;
  const ferry = options.landmarks.children.find(object => object.userData.landmarkId === 'ferry-building');
  if (!ferry) return null;
  const root = options.low ? new VisiblePopulation() : new Group(); root.name = 'Ferry coffee queue';
  const stand = createCoffeeCart(); root.add(stand);
  const footprint: LocalRect = { minX: cart.x - COFFEE_COUNTER_HALF_EXTENTS.x, maxX: cart.x + COFFEE_COUNTER_HALF_EXTENTS.x,
    minZ: cart.z - COFFEE_COUNTER_HALF_EXTENTS.z, maxZ: cart.z + COFFEE_COUNTER_HALF_EXTENTS.z };
  ferry.userData.solidFootprints = [...(ferry.userData.solidFootprints as LocalRect[] ?? []), footprint];
  const actors: { avatar: AvatarInstance; x: number; z: number; offset: number; facing: number }[] = [];
  const count = options.low ? 2 : queue.length;
  // gtasf-c8sj: Low draws the regulars as one instanced crowd mesh (was ~10 draws per rigged avatar).
  let crowd = options.low && flags.lowInstancedQueue ? createCrowdPopulation(count, null) : undefined;
  if (crowd) root.add(crowd.root);
  for (let i = 0; i < count; i++) {
    const avatar = crowd ? crowd.actors[i]! : options.template.createInstance((i + 1) % 4), [x, z] = queue[i]!;
    if (crowd) avatar.setOutfit(i + 1);
    avatar.root.name = `Coffee queue regular ${i + 1}`; if (!crowd) root.add(avatar.root);
    avatar.root.position.set(cart.x + x, cart.y, cart.z + z); avatar.root.rotation.y = i === 3 ? 0 : Math.PI;
    actors.push({ avatar, x: cart.x + x, z: cart.z + z, offset: 0, facing: avatar.root.rotation.y });
  }
  // crowdVat (lane D): once the vertex-animated bodies load, the Low regulars become real people instead of box figures.
  if (crowd) void loadCrowdVat().then(vat => {
    if (!vat || disposed || !crowd) return;
    const next = createCrowdPopulation(count, null, 0, [], vat);
    root.remove(crowd.root); crowd.dispose(); crowd = next; root.add(next.root);
    actors.forEach((actor, i) => { const avatar = next.actors[i]!; avatar.root.name = actor.avatar.root.name;
      avatar.root.position.copy(actor.avatar.root.position); avatar.root.rotation.y = actor.avatar.root.rotation.y; actor.avatar = avatar; });
  });
  const point = new Vector3(), worldPoint = new Vector3();
  let disposed = false, elapsed = 0, nearby = false, noticeAt = 0, line = 0;
  const controls = document.createElement('section'); controls.className = 'gt-coffee-controls';
  const heading = document.createElement('h3'); heading.textContent = 'Coffee break';
  const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Find the coffee queue';
  button.style.cssText = 'display:block;width:100%;min-height:44px;margin:7px 0';
  controls.append(heading, button); options.parent?.append(controls);
  function destination(): CityLifeDestination {
    ferry!.updateWorldMatrix(true, false); point.set(cart.x + 3.7, cart.y, cart.z + 4).applyMatrix4(ferry!.matrixWorld);
    const geo = worldToGeodetic(point.x, point.z, SF_FRAME);
    return { x: point.x, y: point.y, z: point.z, lat: geo.lat, lon: geo.lon, id: 'coffee-queue', title: 'Blue Pitch · Ferry coffee queue', description: 'A fictional plaza pop-up. Join the queue, keep the crossing clear, and bring a warm introduction.' };
  }
  const select = () => { if (options.onDestination?.(destination()) === false) options.onNotice?.('This coffee stop is outside the current road map.'); };
  button.addEventListener('click', select);
  const stats = { count: actors.length, visible: 0 };
  return { root, controls, stats, destination, location: cart,
    update(player: Point, seconds: number) {
      if (disposed) return;
      const dt = Math.max(0, Math.min(.1, Number.isFinite(seconds) ? seconds : 0)); elapsed += dt;
      root.position.copy(ferry.position); root.rotation.y = ferry.rotation.y;
      stand.position.set(cart.x, cart.y, cart.z);
      point.set(cart.x, cart.y, cart.z).applyAxisAngle(root.up, ferry.rotation.y).add(ferry.position);
      const distance = Math.hypot(player.x - point.x, player.z - point.z), range = options.low ? 60 : 100;
      root.visible = ferry.visible && ferry.parent === options.landmarks && distance < range && options.isLoaded(point.x, point.z);
      stats.visible = 0;
      if (!root.visible) { nearby = false; return; }
      for (const actor of actors) {
        worldPoint.set(actor.x, cart.y, actor.z).applyAxisAngle(root.up, ferry.rotation.y).add(ferry.position);
        const y = options.isLoaded(worldPoint.x, worldPoint.z) ? options.ground.heightAt(worldPoint.x, worldPoint.z) : null;
        if (y === null || !Number.isFinite(y) || options.ground.collidesCircle?.(worldPoint.x, worldPoint.z, .35)) { actor.avatar.root.visible = false; continue; }
        const target = Math.abs(player.y - y) < 2.5 && Math.hypot(player.x - worldPoint.x, player.z - worldPoint.z) < 2.8 ? -COFFEE_YIELD_DISTANCE : 0;
        const step = Math.max(-1.5 * dt, Math.min(1.5 * dt, target - actor.offset));
        worldPoint.set(actor.x + actor.offset + step, cart.y, actor.z).applyAxisAngle(root.up, ferry.rotation.y).add(ferry.position);
        const nextY = options.isLoaded(worldPoint.x, worldPoint.z) ? options.ground.heightAt(worldPoint.x, worldPoint.z) : null;
        const moving = Math.abs(step) > .001 && nextY !== null && Number.isFinite(nextY) && Math.abs(nextY - y) < .2 && !options.ground.collidesCircle?.(worldPoint.x, worldPoint.z, .35);
        if (moving) actor.offset += step;
        actor.avatar.root.position.set(actor.x + actor.offset, (moving ? nextY! : y) - ferry.position.y, actor.z);
        const targetYaw = moving ? Math.sign(step) * Math.PI / 2 : actor.facing;
        const turn = Math.atan2(Math.sin(targetYaw - actor.avatar.root.rotation.y), Math.cos(targetYaw - actor.avatar.root.rotation.y));
        actor.avatar.root.rotation.y += turn * (1 - Math.exp(-10 * dt));
        // Yield locally to approaching players, then return to the queue. Own no shared materials.
        actor.avatar.update(moving ? dt * .5 : dt, moving ? 'walk' : 'idle', Math.min(1, Math.max(0, (range - distance) / 15)));
        if (actor.avatar.root.visible) stats.visible++;
      }
      const inside = distance < 9 && Math.abs(player.y - point.y) < 2.5;
      if (inside && !nearby && elapsed >= noticeAt) {
        options.onNotice?.(`Blue Pitch coffee queue · ${chatter[line++ % chatter.length]}`); noticeAt = elapsed + 20;
      }
      nearby = inside;
      crowd?.flush();
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const actor of actors) actor.avatar.dispose(); crowd?.dispose();
      // Actors share player geometry, so dispose only the original cart meshes here.
      const materials = new Set<Material>(), textures = new Set<Texture>();
      stand.traverse(object => { if (object instanceof Mesh) { object.geometry.dispose(); for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material); } });
      for (const material of materials) { for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value); material.dispose(); }
      for (const texture of textures) texture.dispose();
      ferry.userData.solidFootprints = (ferry.userData.solidFootprints as LocalRect[]).filter(value => value !== footprint);
      button.removeEventListener('click', select); controls.remove(); root.removeFromParent(); stats.visible = 0;
    },
  };
}
