import { AnimationMixer, Color, Group, LoopOnce, Matrix4, Mesh, MeshLambertMaterial, Quaternion, QuaternionKeyframeTrack, SkinnedMesh, Sphere, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { AnimationClip } from 'three';
import type { AnimationAction, BufferGeometry, Material, Skeleton, Texture } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { flags } from '@gtasf/shared/flags';
import type { ResolvedLook } from '@gtasf/shared/content/cosmetics';
import { loadModel } from '../assets/loadModel';
import { avatarClips } from '../assets/manifest';
import { addCharacterNightFill } from '../render/characterNight';
import type { AvatarClip } from '../assets/manifest';
import { createBlobShadow } from '../render/blobShadow';
import { createRidingClips, rideBodyYaw, type RideAnimation } from './ridingPoses';
import { createAvatarAppearanceTemplate } from './appearance';
import { createTierDress, type TierDress } from './tierDress';
import { loadMeshyClips, loadPeopleGltf, PEOPLE_BODIES, PEOPLE_LABELS, WARDROBE_BODIES, whenReady, type SharedClips } from './peopleAssets';
import { CROWD_CLOTH, CROWD_HUES, CROWD_SKINS } from '../render/crowdVat';

const hoodieOutfits = ['Ocean hoodie', 'Mission red', 'Golden Gate green', 'Sunset cream'] as const;
/** Outfit indices below this are hoodie palettes; at or above it, wardrobe bodies (cc0People/meshyPeople). */
export const HOODIE_OUTFIT_COUNT = hoodieOutfits.length;
/** adultDefaultLook may only roll these wardrobe looks: light/mid clothing that reads at night (orchestrator N1: never a
 * near-black default; the black blazer + black hoodie stay choosable in the wardrobe). Outfit indices; empty = no body. */
export const DEFAULT_LOOK_OUTFITS: readonly number[] = flags.cc0People
  ? ['meshy-founder-hoodie', 'meshy-founder-bomber'].map(id => PEOPLE_BODIES.indexOf(id)).filter(i => i >= 0 && i < WARDROBE_BODIES).map(i => HOODIE_OUTFIT_COUNT + i)
  : [];
const outfitColours = [0x477d99, 0x9d3938, 0x4b7352, 0xc5b792] as const;
/** Wardrobe/outfit labels: the hoodie palettes, then (cc0People) the first WARDROBE_BODIES bodies (<= 8 total: 3-bit protocol field). Indices past the palettes swap the
 * whole figure inside the same avatar root, so callers keep one object for camera/movement. Local only, like palettes. */
export const avatarOutfits: readonly string[] = flags.cc0People ? [...hoodieOutfits, ...PEOPLE_LABELS.slice(0, WARDROBE_BODIES)] : hoodieOutfits;
export type PlayerAnimation = AvatarClip | 'drive' | RideAnimation;

export interface AvatarInstance {
  readonly root: Group;
  readonly outfit: number;
  setOutfit(index: number): void;
  /** `force` applies the look even when flags.characterLooks is off — ONLY for local, non-networked NPCs
   *  (e.g. founder-ladder meme NPCs): the characterLooks gate exists for the SET_APPEARANCE wire opcode,
   *  which these never use, so forcing their local garments is safe and independent of that deploy gate. */
  applyLook(look: ResolvedLook, force?: boolean): void;
  /** meshyTierDress (critique 20c): the funding-round tier (LOOK_TIERS index) to dress a Meshy body in (tierDress.ts). The
   *  template body ignores it (its garment kit comes from applyLook). Local players and remotes call it from their round. */
  setTier?(tier: number): void;
  update(dt: number, clip: PlayerAnimation, opacity?: number): void;
  /** meshyDeathClips: hold a one-shot clip baked into this body (e.g. 'dieforward') at `seconds` (clamped at its end). Returns
   * false when the body has no such clip (CC0/hoodie bodies, VAT crowd), so callers fall back to their own pose. The next
   * update() resumes normal animation. Local only: never sent over the wire. */
  pose?(clip: string, seconds: number, opacity?: number, loop?: boolean): boolean;
  dispose(): void;
}
export interface AvatarTemplate {
  /** `urgent` (localBodyFirst): the local player - its wardrobe body loads first, at READY. */
  createInstance(outfit?: number, look?: ResolvedLook, forceLook?: boolean, urgent?: boolean): AvatarInstance;
  dispose(): void;
}

// avatarPoseBounds (gtasf-iedec): one fixed culling sphere per avatar, in the avatar root's metres, that holds every pose
// (stand, run, seated driver, ride, lying dead: feet at the origin; a 1.92 m body (characterPolish scale) lying flat reaches
// 2.08 m from 0.8 m up, so 2.4 m leaves margin; standing measures 0.61 of it).
const POSE_CENTRE = new Vector3(0, .8, 0), POSE_RADIUS = 2.4;
const _rootInverse = new Matrix4(), _meshToRoot = new Matrix4();
/** Replace `frustumCulled = false` (bind-pose bounds miss seat/run poses) with a pose-covering sphere, so an avatar
 *  behind the camera is culled instead of drawn: police, SWAT, other players and drivers. */
function applyPoseBounds(root: Object3D, figure: Object3D): void {
  root.updateMatrixWorld(true); _rootInverse.copy(root.matrixWorld).invert();
  figure.traverse(object => {
    if (!(object instanceof SkinnedMesh)) return;
    _meshToRoot.multiplyMatrices(_rootInverse, object.matrixWorld);
    const radius = POSE_RADIUS / _meshToRoot.getMaxScaleOnAxis();
    const cull = new Sphere(POSE_CENTRE.clone().applyMatrix4(_meshToRoot.invert()), radius);
    object.boundingSphere = cull;
    object.frustumCulled = true;
    // The wide culling sphere must not reach raycasts: SkinnedMesh.raycast pre-tests boundingSphere and then skins every
    // vertex, so a 2.4 m sphere sent far more aim rays to the per-vertex path (lane B aim-sweep firefight: 39.0 -> 23.5 fps).
    // Raycasts keep the old behaviour: a tight sphere computed lazily from the pose at the first raycast, then cached.
    let tight: Sphere | null = null;
    const raycast = object.raycast.bind(object);
    object.raycast = (raycaster, intersects) => {
      (object as { boundingSphere: Sphere | null }).boundingSphere = tight; // null = SkinnedMesh.raycast computes it
      try { raycast(raycaster, intersects); tight = object.boundingSphere; } finally { object.boundingSphere = cull; }
    };
  });
}

/** Keep the authored seated legs, with both hands reaching the wheel instead of the lap. */
function drivingClip(gltf: GLTF, sit: AnimationClip): AnimationClip {
  const figure = clone(gltf.scene), mixer = new AnimationMixer(figure);
  mixer.clipAction(sit).play(); mixer.update(0); figure.updateMatrixWorld(true);
  const drive = sit.clone(); drive.name = 'drive';
  const aim = (name: string, childName: string, direction: Vector3) => {
    const bone = figure.getObjectByName(name)!, child = figure.getObjectByName(childName)!;
    const current = child.getWorldPosition(new Vector3()).sub(bone.getWorldPosition(new Vector3())).normalize();
    const desired = new Quaternion().setFromUnitVectors(current, direction.normalize()).multiply(bone.getWorldQuaternion(new Quaternion()));
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(desired));
    figure.updateMatrixWorld(true);
    const trackName = `${name}.quaternion`, q = bone.quaternion.toArray();
    drive.tracks = drive.tracks.filter(track => track.name !== trackName);
    drive.tracks.push(new QuaternionKeyframeTrack(trackName, [0, 1, 2], [...q, ...q, ...q]));
  };
  for (const side of ['L', 'R']) {
    aim(`UpperArm${side}`, `LowerArm${side}`, new Vector3(side === 'L' ? .12 : -.12, -.6, .8));
    aim(`LowerArm${side}`, `Wrist${side}`, new Vector3(0, .12, 1));
  }
  mixer.stopAllAction(); mixer.uncacheRoot(figure);
  figure.traverse(object => { if (object instanceof SkinnedMesh) object.skeleton.dispose(); });
  return drive;
}

/** No download when on-foot mode is disabled. A rejected load is surfaced by the entry point. */
export async function loadAvatarTemplate(): Promise<AvatarTemplate | null> {
  if (!flags.onFoot) return null;
  return createAvatarTemplate(await loadModel('hoodie'));
}

/** A figure source: the scene to clone plus its clips (shared, immutable). */
type Rig = { gltf: GLTF; clips: AnimationClip[] };
function rigFor(gltf: GLTF): Rig {
  const clips = avatarClips.map(name => {
    const clip = gltf.animations.find(candidate => candidate.name === name);
    if (!clip) throw new Error(`Avatar is missing its ${name} clip`);
    return clip;
  });
  const seated = clips.find(clip => clip.name === 'sit')!;
  const drive = flags.characterPolish ? drivingClip(gltf, seated) : seated.clone();
  drive.name = 'drive'; clips.push(drive);
  if (flags.personalRides) clips.push(...createRidingClips(gltf, clips.find(clip => clip.name === 'idle')!, flags.characterPolish));
  return { gltf, clips };
}
/** meshyDeathClips: shared one-shot clips retargeted to a Meshy rig (same 24-bone skeleton; detected by Meshy's 'headfront'
 * bone, since the CC0/hoodie rigs share the renamed bone names but not the skeleton). The hip track is re-based on this
 * body's rest hip position and scaled by hip height. Loading starts on the first Meshy rig; until it lands, pose() is false. */
let shared: SharedClips | null = null;
const retargeted = new WeakMap<Rig, Map<string, AnimationClip | null>>();
function sharedClipFor(rig: Rig, name: string): AnimationClip | null {
  if (!flags.meshyDeathClips || !rig.gltf.scene.getObjectByName('headfront')) return null;
  if (!shared) { void loadMeshyClips().then(result => { shared = result; }); return null; }
  let byName = retargeted.get(rig); if (!byName) { byName = new Map(); retargeted.set(rig, byName); }
  if (byName.has(name)) return byName.get(name)!;
  const source = shared.clips.find(candidate => candidate.name === name), hips = rig.gltf.scene.getObjectByName('Body')?.position;
  let clip: AnimationClip | null = null;
  if (source && hips) {
    clip = source.clone();
    const from = shared.hipsRest, k = Math.abs(from.y) > 1e-6 ? hips.y / from.y : 1;
    for (const track of clip.tracks) if (track.name === 'Body.position') for (let i = 0; i < track.values.length; i += 3) {
      track.values[i] = hips.x + (track.values[i]! - from.x) * k;
      track.values[i + 1] = hips.y + (track.values[i + 1]! - from.y) * k;
      track.values[i + 2] = hips.z + (track.values[i + 2]! - from.z) * k;
    }
  }
  byName.set(name, clip);
  return clip;
}
/** cc0People wardrobe bodies (outfit index >= avatarOutfits' hoodie palettes), built once per page on first wear. */
const bodyRigs = new Map<number, Promise<Rig>>();
const bodyRig = (body: number, urgent = false) => {
  let rig = bodyRigs.get(body);
  if (!rig) { rig = loadPeopleGltf(PEOPLE_BODIES[body]!, urgent).then(rigFor); bodyRigs.set(body, rig); }
  return rig;
};

/** Share immutable geometry/clips while giving each player independent bones, mixer and opacity. */
export function createAvatarTemplate(gltf: GLTF): AvatarTemplate {
  const base = rigFor(gltf);
  const instances = new Set<AvatarInstance>();
  // Built on first applyLook: bodies that never wear a resolved look (CC0 pedestrians) skip the fitted-body work.
  let appearances: ReturnType<typeof createAvatarAppearanceTemplate> | undefined;
  let disposed = false;
  return {
    createInstance(outfit = 0, look, forceLook = false, urgent = false) {
      if (disposed) throw new Error('Avatar template has been disposed');
      const root = new Group();
      root.name = 'on-foot-avatar';
      const rideRotation = new Quaternion(), up = new Vector3(0, 1, 0);
      let rig = base, figure!: Object3D, originalRotation!: Quaternion, mixer!: AnimationMixer;
      let materials = new Set<Material>(), skeletons = new Set<Skeleton>(), clothes: MeshLambertMaterial[] = [];
      // Pedestrian instances never use most riding/seat clips. Bind their tracks
      // only when first played, keeping the extra poses out of crowd startup work.
      let actions = new Map<PlayerAnimation, AnimationAction>();
      const actionFor = (name: PlayerAnimation): AnimationAction => {
        let action = actions.get(name);
        if (!action) { action = mixer.clipAction(rig.clips.find(clip => clip.name === name)!); actions.set(name, action); }
        return action;
      };
      let current: PlayerAnimation = 'idle', lastOpacity = 1, dead = false, wanted = 0, posing: AnimationAction | undefined;
      const setOpacity = (value: number) => {
        const opacity = Math.max(0, Math.min(1, value));
        if (shadow) shadow.root.material.opacity = opacity;
        root.visible = opacity > .01;
        if (opacity !== lastOpacity) {
          appearance?.setOpacity(opacity); dress?.setOpacity(opacity);
          for (const material of materials) {
            const transparent = opacity < .999;
            if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
            material.opacity = opacity;
            material.depthWrite = !transparent;
          }
          lastOpacity = opacity;
        }
      };
      let appearance: ReturnType<ReturnType<typeof createAvatarAppearanceTemplate>["create"]> | undefined;
      let currentLook: ResolvedLook | undefined;
      let dress: TierDress | null = null, tierIndex = 0;
      /** (Re)build this instance's figure from `next`, keeping the root, shadow, clip and opacity. */
      const mount = (next: Rig) => {
        if (figure) {
          mixer.stopAllAction(); mixer.uncacheRoot(figure); figure.removeFromParent();
          appearance?.dispose(); appearance = undefined; dress?.dispose(); dress = null;
          materials.forEach(material => material.dispose()); skeletons.forEach(skeleton => skeleton.dispose());
        }
        rig = next; figure = clone(next.gltf.scene); originalRotation = figure.quaternion.clone();
        if (flags.characterPolish) figure.scale.set(1.07, 1.04, 1.02);
        root.add(figure);
        materials = new Set(); skeletons = new Set(); clothes = []; actions = new Map();
        figure.traverse(object => {
          if (object instanceof Mesh) {
            const copies = (Array.isArray(object.material) ? object.material : [object.material]).map(material => {
              if (!flags.characterPolish) return material.clone();
              const colour = (material as Material & { color?: Color }).color;
              // Keep a base-colour texture (Meshy bodies); untextured CC0/hoodie materials are unchanged.
              const copy = new MeshLambertMaterial({ color: colour?.clone() ?? new Color(0xffffff), map: (material as Material & { map?: Texture | null }).map ?? null });
              copy.name = material.name;
              if (material.name === 'Purple') clothes.push(copy);
              if (material.name === 'LightBlue') copy.color.set(0x283c53);
              if (material.name === 'White') copy.color.set(0xdbd6c6);
              return copy;
            });
            copies.forEach(material => { addCharacterNightFill(material); materials.add(material); const c = (material as Material & { color?: Color }).color; if (c) material.userData.gtasfBase = c.clone(); });
            object.material = Array.isArray(object.material) ? copies : copies[0]!;
            object.castShadow = !flags.characterPolish;
          }
          if (object instanceof SkinnedMesh) {
            skeletons.add(object.skeleton);
            // Bind-pose bounding spheres do not contain every run/seat pose.
            object.frustumCulled = false;
          }
        });
        if (flags.avatarPoseBounds) applyPoseBounds(root, figure);
        mixer = new AnimationMixer(figure);
        actionFor(current).play(); mixer.update(0);
        const yaw = Object.hasOwn(rideBodyYaw, current) ? rideBodyYaw[current as RideAnimation] : 0;
        figure.quaternion.copy(originalRotation).multiply(rideRotation.setFromAxisAngle(up, yaw));
        if (flags.meshyTierDress && rig !== base && tierIndex > 0) { dress = createTierDress(figure); dress?.apply(tierIndex); }
        if (lastOpacity !== 1) { const opacity = lastOpacity; lastOpacity = 1; instance.update(0, current, opacity); }
      };
      const shadow = flags.characterPolish ? createBlobShadow(.95, .8) : undefined;
      if (shadow) root.add(shadow.root);
      const instance: AvatarInstance = {
        root,
        get outfit() { return outfit; },
        setOutfit(index) {
          outfit = ((Math.trunc(Number.isFinite(index) ? index : 0) % avatarOutfits.length) + avatarOutfits.length) % avatarOutfits.length;
          const body = outfit - outfitColours.length, ticket = ++wanted;
          if (body >= 0) { // cc0People: wear a CC0 body (loads once, after READY); the template's own figure until then.
            // localBodyFirst: the local player never shows the fallback figure while its body is on the way (critic N12: the
            // outfit changed in full view). Shown again 2.5 s after READY if the body is still missing.
            if (urgent && flags.localBodyFirst && figure && rig === base) {
              const hidden = figure; hidden.visible = false;
              void whenReady().then(() => setTimeout(() => { if (figure === hidden) hidden.visible = true; }, 2500));
            }
            void bodyRig(body, urgent).then(next => { if (!dead && ticket === wanted && rig !== next) mount(next); }, () => { /* keep the current figure */ });
            return;
          }
          if (rig !== base) mount(base);
          for (const material of clothes) material.color.set(outfitColours[outfit]!);
          // CC0 bodies have no hoodie palette: the slot instead shifts clothing hue and skin tone, like the VAT crowd.
          if (!clothes.length) for (const material of materials) {
            const tinted = material as MeshLambertMaterial, original = tinted.userData.gtasfBase as Color | undefined;
            if (!original || !tinted.color) continue;
            tinted.color.copy(original);
            if (CROWD_CLOTH.has(material.name)) tinted.color.offsetHSL(CROWD_HUES[outfit % CROWD_HUES.length]! / (Math.PI * 2), 0, 0);
            else if (/^Skin/.test(material.name)) tinted.color.multiplyScalar(CROWD_SKINS[outfit % CROWD_SKINS.length]!);
          }
          if (currentLook) instance.applyLook({ ...currentLook, outfitVariant: outfit });
        },
        setTier(next) {
          tierIndex = Math.max(0, Math.trunc(next));
          if (!flags.meshyTierDress || dead || rig === base || !figure) return;
          if (!dress && tierIndex > 0) dress = createTierDress(figure);
          dress?.apply(tierIndex);
        },
        applyLook(next, force = false) {
          if (dead || (!flags.characterLooks && !force)) return;
          currentLook = next;
          if (rig !== base) return; // fitted garments are authored for the template's own body
          outfit = Math.max(0, Math.min(7, Math.trunc(next.outfitVariant)));
          appearance ??= (appearances ??= createAvatarAppearanceTemplate(gltf)).create(figure);
          appearance.apply(next);
          appearance.setOpacity(lastOpacity);
          appearance.setSeated(current === 'sit' || current === 'drive' || Object.hasOwn(rideBodyYaw, current));
        },
        pose(name, seconds, opacity = 1, loop = false) {
          if (dead || !Number.isFinite(seconds) || !Number.isFinite(opacity)) return false;
          const clip = rig.gltf.animations.find(candidate => candidate.name === name) ?? sharedClipFor(rig, name); if (!clip) return false;
          const action = mixer.clipAction(clip);
          if (posing !== action) {
            mixer.stopAllAction();
            action.reset().setLoop(LoopOnce, 1).setEffectiveWeight(1).play(); action.clampWhenFinished = true; posing = action;
          }
          action.time = loop ? ((seconds % clip.duration) + clip.duration) % clip.duration : Math.max(0, Math.min(seconds, clip.duration - 1e-3)); mixer.update(0);
          setOpacity(opacity);
          return true;
        },
        update(dt, clip, opacity = 1) {
          if (dead) return;
          if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(opacity)) throw new RangeError('AVATAR_UPDATE');
          if (posing) { posing.stop(); posing = undefined; actionFor(current).reset().setEffectiveWeight(1).play(); }
          if (current !== clip) {
            const next = actionFor(clip).reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
            actionFor(current).crossFadeTo(next, .18, false);
            current = clip;
            const yaw = Object.hasOwn(rideBodyYaw, clip) ? rideBodyYaw[clip as RideAnimation] : 0;
            figure.quaternion.copy(originalRotation).multiply(rideRotation.setFromAxisAngle(up, yaw));
            appearance?.setSeated(clip === 'sit' || clip === 'drive' || Object.hasOwn(rideBodyYaw, clip));
          }
          mixer.update(Math.min(dt, .1));
          opacity = Math.max(0, Math.min(1, opacity));
          if (flags.characterPolish) figure.scale.y = clip === 'sit' || clip === 'drive' ? 1 : 1.04;
          if (shadow) shadow.root.visible = clip !== 'sit' && clip !== 'drive';
          setOpacity(opacity);
        },
        dispose() {
          if (dead) return;
          dead = true;
          root.removeFromParent();
          mixer.stopAllAction(); mixer.uncacheRoot(figure);
          appearance?.dispose(); dress?.dispose();
          materials.forEach(material => material.dispose());
          skeletons.forEach(skeleton => skeleton.dispose());
          shadow?.dispose();
          instances.delete(instance);
        },
      };
      mount(base);
      instance.setOutfit(outfit);
      if (look) instance.applyLook(look, forceLook);
      instances.add(instance);
      return instance;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const instance of instances) instance.dispose();
      appearances?.dispose();
      const geometries = new Set<BufferGeometry>(), materials = new Set<Material>(), skeletons = new Set<Skeleton>();
      gltf.scene.traverse(object => {
        if (object instanceof Mesh) {
          geometries.add(object.geometry);
          (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
        }
        if (object instanceof SkinnedMesh) skeletons.add(object.skeleton);
      });
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      skeletons.forEach(skeleton => skeleton.dispose());
    },
  };
}
