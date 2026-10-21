import { afterLocalBody } from '../../avatar/peopleAssets';
import {
  BufferGeometry, Color, Float32BufferAttribute, Group, LOD, Matrix3, Mesh,
  MeshLambertMaterial, MeshStandardMaterial, Object3D, Texture, Vector3,
} from 'three';
import type { Material } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { flags } from '@gtasf/shared/flags';
import type { VehicleKind } from '@gtasf/shared/protocol/types';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { loadModel } from '../../assets/loadModel';
import type { VehicleAssetId } from '../../assets/manifest';
import { realisticVehicleAssets } from '../../assets/realisticVehicles';
import { createBlobShadow } from '../../render/blobShadow';
import { graphicsPreset } from '../../render/graphicsPreset';
import type { GraphicsPreset } from '../../render/graphicsPreset';
import { loadVehicleTextures, polishVehicle } from './polish';
import type { VehicleTextures } from './polish';
import { VisibleLod } from './visibleLod';

export const vehicleAssetForKind: Readonly<Record<VehicleKind, VehicleAssetId>> = {
  prius: 'prius', tesla: 'model3', subaru: 'outback', bus: 'muni-bus',
  robotaxi: 'robotaxi', 'cable-car': 'powell-cable-car', supercar: 'vc-supercar',
};
export interface VehicleInstance {
  readonly root: Group;
  /** Avatar feet origin for the authored sit pose; +Z faces forward. */
  readonly seat: Object3D;
  /** Ground contact point beside the door. Validate terrain/collision before exiting. */
  readonly exit: Object3D;
  /** Pass its world position as feet to ThirdPersonCamera, which adds target height. */
  readonly cameraTarget: Object3D;
  update(dt: number, speedMps?: number, steeringRad?: number): void;
  dispose(): void;
}
export interface VehicleTemplate {
  readonly assetId: VehicleAssetId | RealisticExtraId;
  readonly budget: Readonly<{ nearDraws: number; farDraws: number; triangles: number }>;
  createInstance(): VehicleInstance;
  dispose(): void;
}

/** Feature checks precede asset I/O. Cache templates in the fleet owner, never per entity. */
export async function loadVehicleTemplate(assetId: VehicleAssetId): Promise<VehicleTemplate | undefined> {
  const enabled = assetId === 'robotaxi' ? flags.robotaxi
    : assetId === 'powell-cable-car' ? flags.cableCars
      : assetId === 'muni-bus' ? flags.driving || flags.muni : flags.driving;
  if (!enabled) return undefined;
  const realistic = await loadRealisticTemplate(assetId);
  if (realistic) return realistic;
  const [model, textures] = await Promise.all([loadModel(assetId), loadVehicleTextures()]);
  return createVehicleTemplate(assetId, model, textures);
}

/** Realistic-only extras: cosmetic traffic variants and parked props (no protocol kind of their own). */
export type RealisticExtraId = 'cab' | 'van' | 'food-truck' | 'scooter';
export function loadRealisticExtraTemplate(id: RealisticExtraId): Promise<VehicleTemplate | undefined> {
  return flags.driving ? loadRealisticTemplate(id) : Promise.resolve(undefined);
}

/**
 * Meshy PBR fleet behind the HD-only realistic renderer. Its Low file is the HD fleet's far LOD;
 * the Low/PS2 renderer uses the CC0 kit and its Lambert polish instead. Match foundation's renderer
 * gate before asset I/O so phones never receive PBR-only paint without the matching light pipeline.
 * Undefined (caller falls back to CC0) when disabled, missing, or loading fails.
 */
/**
 * Demote a Meshy car's PBR (MeshStandard) materials to Lambert, keeping the base-colour texture and vertex colours.
 * The graphicsV2 renderer has no PBR light pipeline yet (NoToneMapping, no env map — Item 2 adds it), so metal/rough
 * MeshStandard blows out to flat white under the direct lights. Lambert reads the painted body correctly. Stray
 * emissive (no emissiveMap) is dropped so bodies don't self-light white; emissiveMap lamps (head/tail lights) stay.
 */
function demotePbrToLambert(root: Object3D): void {
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const convert = (m: Material): Material => {
      if (!(m instanceof MeshStandardMaterial)) return m;
      const lambert = new MeshLambertMaterial({
        map: m.map ?? undefined, color: m.color.clone(), vertexColors: m.vertexColors,
        transparent: m.transparent, opacity: m.opacity, side: m.side, alphaTest: m.alphaTest,
        emissiveMap: m.emissiveMap ?? undefined, emissive: m.emissiveMap ? m.emissive.clone() : new Color(0),
      });
      lambert.name = m.name;
      return lambert;
    };
    object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material);
  });
}

/** carNearDetail: set by main.ts to compile shaders + upload textures of a freshly loaded HD car before its first close-up
 * (the first approach otherwise stalled ~700 ms on decode + upload). */
let nearWarmer: ((root: Object3D) => Promise<void>) | undefined;
export function setNearDetailWarmer(warm: (root: Object3D) => Promise<void>): void { nearWarmer = warm; }
/** HD near models fetched + warmed in idle time after start: the cars players most often see at 1-2 m (robotaxi drop-off,
 * the parked Prius by the Ferry spawn). Other types still load lazily on first approach. */
const PREWARM_NEAR = new Set<string>(['robotaxi', 'prius', 'outback']); // outback: the other kerb-car type (review, critic N5)

async function loadRealisticTemplate(id: VehicleAssetId | RealisticExtraId): Promise<VehicleTemplate | undefined> {
  const preset = graphicsPreset();
  // Two ways to reach the Meshy PBR fleet: the legacy dead realistic path (HD only, !graphicsV2), or pbrCarsV2 on
  // the live graphicsV2 path (HD + Low). pbrCarsV2 runs the same models on Low via the .low.glb.
  const legacy = flags.ps2Render && flags.realisticRender && !flags.graphicsV2 && preset === 'hd';
  const pbrV2 = flags.pbrCarsV2 && flags.graphicsV2;
  const asset = legacy || pbrV2 ? realisticVehicleAssets[id] : undefined;
  if (!asset) return undefined;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  try {
    if (preset === 'hd') {
      const [near, far] = await Promise.all([loader.loadAsync(asset.hd.url), loader.loadAsync(asset.low.url)]);
      // graphicsV2 HD has no PBR pipeline UNLESS realisticLightingV2 (item 2: ACES + HDRI env + SSAO) is on — then
      // keep the authored PBR so the cars tonemap + reflect the env. Without it, demote to Lambert so they paint
      // instead of blowing white. The legacy realistic path keeps authored PBR (it has ACES/env/SSAO).
      if (pbrV2 && !flags.realisticLightingV2) { demotePbrToLambert(near.scene); demotePbrToLambert(far.scene); }
      return createVehicleTemplate(id, near, undefined, { preset, far });
    }
    // Low (pbrCarsV2): the .low.glb (~5k tris) is the model; no separate far LOD. The ps2/Low renderer has no PBR
    // env, so demote to Lambert too.
    const low = await loader.loadAsync(asset.low.url);
    demotePbrToLambert(low.scene);
    // carNearDetail: this type's HD glb (already shipped for desktop) loads lazily, once, when one comes near the camera.
    let near: Promise<Group | null> | undefined;
    const mark = (what: string) => { try { performance.mark(`carNearDetail:${what}:${id}`); } catch { /* marks are evidence only */ } };
    const loadNear = flags.carNearDetail ? () => (near ??= (mark('load'), loader.loadAsync(asset.hd.url)).then(async hd => {
      demotePbrToLambert(hd.scene); await nearWarmer?.(hd.scene).catch(() => {}); mark('ready'); return hd.scene; }, () => null)) : undefined;
    // Review: start from READY (not a fixed 12 s after load), then idle-time, so the opening's first frames stay clear. After the
    // local player's body (bounded 4 s; no 3 s grace), so the three HD GLBs (~2.4 MB) don't compete with localBodyFirst's download,
    // then 1 s + idle. The car beside the player also loads by proximity (onNear, player-focus ring), so N5 doesn't need this sooner.
    if (loadNear && PREWARM_NEAR.has(id)) void afterLocalBody().then(() => setTimeout(() => {
      const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
      if (idle) idle(() => void loadNear(), { timeout: 2000 }); else void loadNear();
    }, 1_000));
    return createVehicleTemplate(id, low, undefined, { preset, loadNear });
  } catch (error) {
    console.warn(`realistic vehicle ${id} failed; using CC0 model`, error);
    return undefined;
  }
}

/** The distant vehicle keeps its silhouette/colours but batches to one draw, with no moving parts. */
function bakeDistantModel(scene: Group): { geometry: BufferGeometry; triangles: number; draws: number } {
  const positions: number[] = [], normals: number[] = [], colours: number[] = [];
  const vertex = new Vector3(), normal = new Vector3(), normalMatrix = new Matrix3();
  let draws = 0;
  scene.updateMatrixWorld(true);
  scene.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const geometry: BufferGeometry = object.geometry, p = geometry.getAttribute('position');
    const n = geometry.getAttribute('normal'), c = geometry.getAttribute('color');
    const index = geometry.index, count = index?.count ?? p.count;
    const materials: Material[] = Array.isArray(object.material) ? object.material : [object.material];
    draws += Array.isArray(object.material) ? Math.max(1, geometry.groups.length) : 1;
    normalMatrix.getNormalMatrix(object.matrixWorld);
    for (let i = 0; i < count; i++) {
      const j = index ? index.getX(i) : i;
      vertex.fromBufferAttribute(p, j).applyMatrix4(object.matrixWorld);
      positions.push(vertex.x, vertex.y, vertex.z);
      if (n) normal.fromBufferAttribute(n, j).applyNormalMatrix(normalMatrix);
      else normal.set(0, 1, 0);
      normals.push(normal.x, normal.y, normal.z);
      const group = geometry.groups.find(g => i >= g.start && i < g.start + g.count);
      // BoxGeometry has one group per face even when its mesh uses one material.
      const material = (Array.isArray(object.material) ? materials[group?.materialIndex ?? 0] : object.material) as Material & { color?: Color };
      const base = material.color;
      colours.push((c?.getX(j) ?? 1) * (base?.r ?? 1), (c?.getY(j) ?? 1) * (base?.g ?? 1), (c?.getZ(j) ?? 1) * (base?.b ?? 1));
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
  geometry.computeBoundingSphere();
  return { geometry, triangles: positions.length / 9, draws };
}

/** Static GLBs can clone nodes while all instances share the immutable GPU resources. */
export function createVehicleTemplate(
  assetId: VehicleAssetId | RealisticExtraId, gltf: GLTF, textures?: VehicleTextures,
  realistic?: { preset: GraphicsPreset; far?: GLTF; loadNear?: () => Promise<Group | null> },
): VehicleTemplate {
  // Realistic PBR models keep their authored materials: no PS2 repaint/trim and no vertex-colour bake.
  const disposePolish = realistic ? () => {} : polishVehicle(assetId as VehicleAssetId, gltf.scene, textures, graphicsPreset() === 'low');
  const baked = realistic ? undefined : bakeDistantModel(gltf.scene);
  const farScene = realistic?.far?.scene;
  // Early shipped Low GLBs dropped the emissive mask but kept its white multiplier. Repair those
  // cached LODs at load time; the fixed asset pipeline now clears both. Preserve near-model lamps.
  farScene?.traverse(object => {
    if (!(object instanceof Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material instanceof MeshStandardMaterial && !material.emissiveMap) material.emissive.setHex(0);
    }
  });
  const farMaterial = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const shadowCasting = realistic ? realistic.preset === 'hd' : !flags.vehiclePolish;
  const low = (realistic?.preset ?? graphicsPreset()) === 'low';
  const count = (root: Object3D) => { let draws = 0, triangles = 0; root.traverse(o => { if (o instanceof Mesh) { draws++; triangles += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3; } }); return { draws, triangles }; };
  const nearStats = count(gltf.scene), farStats = farScene ? count(farScene) : undefined;
  const instances = new Set<VehicleInstance>();
  let disposed = false;
  return {
    assetId,
    budget: Object.freeze(baked ? { nearDraws: baked.draws, farDraws: 1, triangles: baked.triangles }
      : { nearDraws: nearStats.draws, farDraws: farStats?.draws ?? nearStats.draws, triangles: nearStats.triangles }),
    createInstance() {
      if (disposed) throw new Error('Vehicle template has been disposed');
      const root = new Group(); root.name = assetId;
      const lod = low ? new VisibleLod() : new LOD(), near = gltf.scene.clone(true);
      near.traverse(object => { if (object instanceof Mesh) object.castShadow = shadowCasting; });
      lod.addLevel(near, 0);
      if (baked) lod.addLevel(new Mesh(baked.geometry, farMaterial), 55, .15);
      else if (farScene) lod.addLevel(farScene.clone(true), 55, .15);
      lod.addLevel(new Group(), 350, .1);
      root.add(lod);
      const seat = new Object3D(), exit = new Object3D(), cameraTarget = new Object3D();
      seat.name = 'seat'; exit.name = 'exit'; cameraTarget.name = 'ride-camera-feet';
      const bus = assetId === 'muni-bus', cable = assetId === 'powell-cable-car';
      const shadow = flags.vehiclePolish && !shadowCasting ? createBlobShadow(bus || cable ? 2.4 : 1.8, bus ? 11 : cable ? 7 : 4.2) : undefined;
      if (shadow) { root.add(shadow.root); shadow.root.position.y = .05; }
      seat.position.set(bus ? -.65 : cable ? .45 : -.38, bus || cable ? .7 : .08, bus ? 4.4 : cable ? 0 : assetId === 'robotaxi' ? -.65 : .35);
      exit.position.set(bus || cable ? 1.9 : -1.55, 0, seat.position.z);
      cameraTarget.position.set(0, bus || cable ? 1.2 : .45, 0);
      root.add(seat, exit, cameraTarget);
      const rotor = near.getObjectByName('lidar');
      const wheels: { node: Object3D; front: boolean; initialY: number }[] = [];
      near.traverse(node => {
        if (/^wheel-(front|back)-(left|right)$/.test(node.name)) {
          node.rotation.order = 'YXZ';
          wheels.push({ node, front: node.name.includes('front'), initialY: node.rotation.y });
        }
      });
      // gtasf-pooa: only wheels and the lidar rotor animate inside a model, yet every node recomposed its local
      // matrix each frame (2,442 updateMatrix calls/frame at Ferry Low, 1,015 from cable cars). Freeze the rest once;
      // world matrices still follow the vehicle root.
      const moving = new Set<Object3D>(wheels.map(w => w.node)); if (rotor) moving.add(rotor);
      for (const level of lod.levels) level.object.traverse(node => {
        if (moving.has(node)) return;
        node.updateMatrix(); node.matrixAutoUpdate = false;
      });
      let dead = false;
      // carNearDetail (phone Low): the ~5k-tri .low.glb reads as a crumpled blob at 1-2 m (critic N5, gtasf-xuiyv). The
      // first time the camera comes within 6 m, this car type's HD glb loads (once per type, lazily) and becomes the
      // near level for the single nearest car within 9 m (VisibleLod); every other car stays low. PBR cars have no animated
      // parts, so the HD level needs no wiring.
      if (low && realistic?.loadNear && lod instanceof VisibleLod) {
        const loadNear = realistic.loadNear;
        lod.nearRequestM = 12; // load a type's HD only when the player actually gets close to one (ahead of the 9 m swap)
        lod.onNear = () => { void loadNear().then(scene => {
          if (!scene || dead) return;
          const hd = scene.clone(true); hd.traverse(node => { node.updateMatrix(); node.matrixAutoUpdate = false; });
          // HD goes FIRST at distance 0; the low level's distance (9 for the winner, 0 for everyone else) decides. Not
          // addLevel(hd, -1): three takes Math.abs, so HD landed AFTER the low level at 1 m and every car of a loaded type
          // drew its HD level from 1 m to the far level (350 m) on phone Low, winner or not. (lane D, gtasf-w3un3)
          const lowLevel = lod.levels[0]!; lod.add(hd); lod.levels.unshift({ distance: 0, hysteresis: 0, object: hd }); lod.nearLowLevel = lowLevel;
        }); };
      }
      const instance: VehicleInstance = {
        root, seat, exit, cameraTarget,
        update(dt, speedMps = 0, steeringRad = 0) {
          if (dead) return;
          if (!Number.isFinite(dt) || !Number.isFinite(speedMps) || !Number.isFinite(steeringRad) || dt < 0) throw new RangeError('VEHICLE_UPDATE');
          const step = Math.min(.1, dt);
          if (rotor) rotor.rotation.y = (rotor.rotation.y + step * Math.PI * 5) % (Math.PI * 2);
          for (const wheel of wheels) {
            wheel.node.rotation.x = (wheel.node.rotation.x + speedMps * step / (bus ? .45 : .32)) % (Math.PI * 2);
            if (wheel.front) wheel.node.rotation.y = wheel.initialY + Math.max(-.55, Math.min(.55, steeringRad));
          }
        },
        dispose() {
          if (dead) return;
          dead = true; shadow?.dispose(); root.removeFromParent(); instances.delete(instance);
        },
      };
      instances.add(instance); return instance;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const instance of instances) instance.dispose();
      const geometries = new Set<BufferGeometry>(), materials = new Set<Material>();
      for (const scene of [gltf.scene, farScene]) scene?.traverse(object => {
        if (object instanceof Mesh) {
          geometries.add(object.geometry);
          (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
        }
      });
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => {
        // Realistic GLBs own their PBR textures (the CC0 kit's shared palette is released by polish).
        if (realistic) for (const value of Object.values(material)) if (value instanceof Texture) value.dispose();
        material.dispose();
      });
      baked?.geometry.dispose(); farMaterial.dispose();
      disposePolish();
    },
  };
}
