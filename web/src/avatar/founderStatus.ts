import { BoxGeometry, BufferGeometry, ConeGeometry, Group, Mesh, MeshLambertMaterial, Quaternion, SphereGeometry, Vector3 } from 'three';
import type { Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flags } from '@gtasf/shared/flags';
import { archetypeDef, LOOK_TIERS } from '@gtasf/shared/content/cosmetics';
import type { ResolvedLook } from '@gtasf/shared/content/cosmetics';
import type { AvatarInstance, AvatarTemplate, PlayerAnimation } from './riggedAvatar';

export interface AvatarStatusEnvironment {
  readonly scene: Object3D;
  heightAt(x: number, z: number, referenceY?: number): number | null;
  collides(x: number, y: number, z: number, radius: number): boolean;
  isLoaded(x: number, z: number): boolean;
}

/** Install once where the world and its avatar template meet. Followers use the
 * underlying template, so a companion can never recursively create companions.
 */
export function withFounderStatus(template: AvatarTemplate | null, environment: AvatarStatusEnvironment): AvatarTemplate | null {
  if (!template || !flags.characterLooks) return template;
  const instances = new Set<AvatarInstance>(); let dead = false;
  return {
    createInstance(outfit, look, forceLook, urgent) {
      if (dead) throw new Error('Avatar template has been disposed');
      const base = template.createInstance(outfit, undefined, undefined, urgent);
      let status: ReturnType<typeof createFounderStatus> = null, disposed = false;
      const avatar: AvatarInstance = {
        root: base.root,
        get outfit() { return base.outfit; },
        setOutfit(index) { base.setOutfit(index); },
        // meshyTierDress (gtasf-4vgje): forward the round tier. Without it the prod (characterLooks) player never got the vest,
        // since setTier?.() on this wrapper was a silent no-op, and forced-tier capture builds hid that.
        setTier(tier) { base.setTier?.(tier); },
        // meshyDeathClips + walker habits/flinches (lane B, after lane D's setTier find): forward the optional one-shot pose. Without it
        // pose?.() on this wrapper was undefined, so prod (characterLooks) deaths, hit flinches and habit clips silently fell back.
        pose(clip, seconds, opacity, loop) { return !disposed && (base.pose?.(clip, seconds, opacity, loop) ?? false); },
        applyLook(next, force = false) {
          if (disposed || (!flags.characterLooks && !force)) return;
          base.applyLook(next, force);
          if (next.companion || next.flyover) {
            status ??= createFounderStatus(environment, colleague => template.createInstance(0, colleague));
            status?.setLook(next);
          } else { status?.dispose(); status = null; }
        },
        update(dt, clip, opacity) { if (!disposed) { base.update(dt, clip, opacity); status?.update(dt, base.root, clip, opacity); } },
        dispose() {
          if (disposed) return; disposed = true;
          status?.dispose(); status = null; base.dispose(); instances.delete(avatar);
        },
      };
      instances.add(avatar); if (look) avatar.applyLook(look, forceLook); return avatar;
    },
    dispose() {
      if (dead) return; dead = true;
      for (const instance of instances) instance.dispose(); template.dispose();
    },
  };
}

function createStatusJet() {
  const root = new Group(); root.name = 'founder-jet';
  const paint = new MeshLambertMaterial({ color: 0xe3e0d3, flatShading: true });
  const trim = new MeshLambertMaterial({ color: 0x263947, flatShading: true });
  const accent = new MeshLambertMaterial({ color: 0xc8a154, flatShading: true });
  const geometries = new Set<BufferGeometry>();
  const parts = new Map<MeshLambertMaterial, BufferGeometry[]>();
  function add(geometry: BufferGeometry, material: MeshLambertMaterial, x = 0, y = 0, z = 0) {
    geometry.translate(x, y, z); geometry.deleteAttribute('uv');
    const bucket = parts.get(material) ?? []; bucket.push(geometry); parts.set(material, bucket);
  }
  add(new SphereGeometry(1, 12, 6).scale(.32, .30, 2.45), paint);
  add(new SphereGeometry(1, 10, 5).scale(.23, .16, .58), trim, 0, .225, 1.18);
  add(new BoxGeometry(.65, .035, 3.35), accent, 0, -.075, -.05);
  // Swept tapered wings and tail, with a finite thickness and a distinct fin.
  const wing = (side: number, scale: number) => {
    const vertices = [0, 0, .65, side * 2.9, 0, -.64, side * 2.8, 0, -1.05, 0, 0, -.75,
      0, -.07, .65, side * 2.9, -.035, -.64, side * 2.8, -.035, -1.05, 0, -.07, -.75];
    const points = Array.from({ length: vertices.length / 3 }, (_, i) => new Vector3(vertices[i * 3]! * scale, vertices[i * 3 + 1]! * scale, vertices[i * 3 + 2]! * scale));
    const geometry = new BufferGeometry().setFromPoints(points);
    const faces = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
    if (side < 0) for (let i = 0; i < faces.length; i += 3) [faces[i + 1], faces[i + 2]] = [faces[i + 2]!, faces[i + 1]!];
    geometry.setIndex(faces); geometry.computeVertexNormals(); return geometry;
  };
  for (const side of [-1, 1]) {
    add(wing(side, 1), paint, 0, -.035, 0);
    add(wing(side, .40), paint, 0, .16, -1.80);
    add(new SphereGeometry(1, 10, 5).scale(.17, .17, .55), paint, side * .49, .09, -1.32);
    add(new ConeGeometry(.12, .14, 10).rotateX(Math.PI / 2), trim, side * .49, .09, -1.82);
    for (let i = 0; i < 4; i++) add(new SphereGeometry(1, 6, 4).scale(.025, .065, .09), trim, side * .30, .07, .55 - i * .35);
  }
  const fin = new BoxGeometry(.075, .77, .55); fin.rotateX(-.30); add(fin, trim, 0, .50, -1.86);
  for (const [material, pieces] of parts) {
    const geometry = mergeGeometries(pieces, false); pieces.forEach(piece => piece.dispose());
    if (!geometry) throw new Error('Could not build founder jet');
    geometries.add(geometry); root.add(new Mesh(geometry, material));
  }
  return { root, dispose() { root.removeFromParent(); geometries.forEach(geometry => geometry.dispose()); paint.dispose(); trim.dispose(); accent.dispose(); } };
}

/** Cosmetic followers only. Never creates world players, payouts, collision bodies or packets. */
export function createFounderStatus(environment: AvatarStatusEnvironment, createAvatar: (look: ResolvedLook) => AvatarInstance) {
  if (!flags.characterLooks) return null;
  const root = new Group(); root.name = 'founder-status'; environment.scene.add(root);
  const followers: { avatar: AvatarInstance; initialized: boolean }[] = [];
  const ownerPosition = new Vector3(), ownerRotation = new Quaternion(), forward = new Vector3();
  let jet: ReturnType<typeof createStatusJet> | undefined, selection = '', dead = false;
  return {
    root,
    setLook(look: ResolvedLook) {
      if (dead) return;
      const next = `${look.companion ?? ''}:${look.flyover ?? ''}`;
      if (next === selection) return;
      selection = next;
      const count = look.companion === 'assistant' ? 1 : look.companion === 'entourage' ? 2 : 0;
      while (followers.length > count) followers.pop()!.avatar.dispose();
      while (followers.length < count) {
        const index = followers.length, tier = LOOK_TIERS[2]!;
        const colleague: ResolvedLook = { ...look, sex: index === 0 ? 'female' : 'male',
          archetype: archetypeDef('ex-faang'), tier, outfit: tier.outfit, outfitVariant: 4,
          hair: index === 0 ? 6 : 2, hairColor: index === 0 ? 1 : 4, accessory: index === 0 ? 1 : 0,
          prop: 'company-swag', title: 'Assistant', companion: null, flyover: null };
        const avatar = createAvatar(colleague); avatar.root.name = index === 0 ? 'founder-assistant' : 'founder-entourage';
        root.add(avatar.root); followers.push({ avatar, initialized: false });
      }
      if (look.flyover === 'jet' && !jet) { jet = createStatusJet(); root.add(jet.root); }
      if (look.flyover !== 'jet' && jet) { jet.dispose(); jet = undefined; }
    },
    update(dt: number, owner: Object3D, clip: PlayerAnimation, opacity = 1, nowMs = Date.now()) {
      if (dead) return;
      root.visible = flags.characterLooks && opacity > .01;
      if (!root.visible) return;
      if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(nowMs)) throw new RangeError('FOUNDER_STATUS_UPDATE');
      owner.getWorldPosition(ownerPosition); owner.getWorldQuaternion(ownerRotation);
      forward.set(0, 0, 1).applyQuaternion(ownerRotation);
      const yaw = Math.atan2(forward.x, forward.z), sin = Math.sin(yaw), cos = Math.cos(yaw);
      const onFoot = clip === 'idle' || clip === 'walk' || clip === 'run';
      for (let index = 0; index < followers.length; index++) {
        const follower = followers[index]!;
        const actor = follower.avatar.root;
        if (!onFoot) { actor.visible = false; follower.initialized = false; continue; }
        const side = index === 0 ? -1.15 : 1.15, behind = index === 0 ? -1.7 : -2.1;
        const targetX = ownerPosition.x + side * cos + behind * sin;
        const targetZ = ownerPosition.z - side * sin + behind * cos;
        const targetY = environment.isLoaded(targetX, targetZ) ? environment.heightAt(targetX, targetZ, ownerPosition.y) : null;
        if (targetY === null || !Number.isFinite(targetY) || environment.collides(targetX, targetY, targetZ, .24)) {
          actor.visible = false; follower.initialized = false; continue;
        }
        if (!follower.initialized || actor.position.distanceToSquared(ownerPosition) > 144) {
          actor.position.set(targetX, targetY, targetZ); actor.rotation.y = yaw; follower.initialized = true;
        }
        const dx = targetX - actor.position.x, dz = targetZ - actor.position.z, distance = Math.hypot(dx, dz);
        const step = Math.min(distance, Math.min(dt, .1) * 7), fraction = distance > .001 ? step / distance : 0;
        const x = actor.position.x + dx * fraction, z = actor.position.z + dz * fraction;
        let y: number | null = actor.position.y, clear = true;
        // Bounded swept contact avoids stepping through a thin wall on a slow frame.
        const samples = Math.max(1, Math.ceil(step / .20));
        for (let i = 1; i <= samples; i++) {
          const sx = actor.position.x + dx * fraction * i / samples;
          const sz = actor.position.z + dz * fraction * i / samples;
          y = environment.isLoaded(sx, sz) ? environment.heightAt(sx, sz, actor.position.y) : null;
          if (y === null || !Number.isFinite(y) || environment.collides(sx, y, sz, .24)) { clear = false; break; }
        }
        if (!clear || y === null) {
          actor.visible = false; follower.initialized = false; continue;
        }
        actor.position.set(x, y, z);
        if (step > .003) actor.rotation.y = Math.atan2(dx, dz);
        const speed = dt > 0 ? step / dt : 0;
        follower.avatar.update(dt, speed > 4.2 ? 'run' : speed > .1 ? 'walk' : 'idle', opacity);
      }
      if (jet) {
        // Shared wall time keeps the decorative orbit stable between observers.
        const angle = nowMs / 1000 * .12, radius = 48;
        jet.root.position.set(ownerPosition.x + Math.cos(angle) * radius, ownerPosition.y + 45 + Math.sin(angle * .5) * 3, ownerPosition.z + Math.sin(angle) * radius);
        jet.root.rotation.set(0, -angle, -.12);
      }
    },
    dispose() {
      if (dead) return; dead = true;
      followers.forEach(follower => follower.avatar.dispose()); followers.length = 0;
      jet?.dispose(); jet = undefined; root.removeFromParent();
    },
  };
}
