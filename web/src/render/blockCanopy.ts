import {
  DoubleSide, InstancedMesh, LinearFilter, LinearMipmapLinearFilter, Matrix4, MeshLambertMaterial,
  type Object3D, PlaneGeometry, Quaternion, RepeatWrapping, SRGBColorSpace, type Texture, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flags } from '@gtasf/shared/flags';
import type { GraphicsPreset } from './graphicsPreset';
import { loadSceneryTexture } from './sceneryTexture';
import { circleHitsBuilding, sampleHeight, type ChunkCollision, type Heightfield } from './chunks/terrain';
import { districtAt } from '../../../tools/map/src/districts';
import { LIDAR_HIDE } from './lidarRoofs';
import type { ShopfrontContext } from './shopfrontSigns';

// gtasf-cf1a: the residential AERIAL leafiness gap vs the Teleoperator reference. SF blocks are
// rooftop-dominated from above and the vertical crossed-card STREET trees read edge-on (thin) from the
// aerial -- three prior canopy attempts all read subtle there. The reference's green actually sits in the
// block INTERIORS (backyards). This scatters instanced canopy "blobs" through residential block interiors
// (where residentialBlockGreens already greens the ground), each with a HORIZONTAL cap so it reads as green
// canopy mass from the oblique aerial AND from the street. Backyards are hidden from the street by the row
// houses, so this is almost entirely an aerial lever.

// Leafy residential districts (mirrors props/layout.ts LEAFY_RESIDENTIAL) -- canopy only lands here.
const LEAFY_RESIDENTIAL = new Set(['mission', 'noe-valley', 'haight-ashbury', 'castro', 'hayes-valley',
  'pacific-heights', 'cow-hollow', 'marina', 'richmond', 'sunset', 'bernal-heights', 'potrero-hill',
  'glen-park', 'excelsior', 'western-addition', 'japantown', 'dogpatch', 'bayview']);

const GRID = 11;       // metres between candidate backyard points (coarse: this runs per chunk at mount)
const ROAD_CLEAR = 14; // a point must be at least this far from any road to count as block interior (backyard)
const FOOT_CLEAR = 1.2; // keep canopy out of building footprints (a trunk clearance)

/** One leafy canopy "blob": two crossed vertical cards (side silhouette) plus a horizontal cap at canopy
 *  height (the aerial read). The cap samples the leafy upper band of the foliage card, not the trunk. */
function canopyGeometry(width: number, height: number) {
  // Tall enough that the crown sits at/above the 2-3 storey row-house rooftops, where it reads from the oblique
  // aerial instead of being occluded behind the roofs. The crown is a BIG horizontal cap (the aerial read) plus
  // the crossed vertical cards (the oblique/side read).
  const vA = new PlaneGeometry(width, height).translate(0, height / 2, 0);
  const vB = vA.clone().rotateY(Math.PI / 2);
  const capY = height * 0.62, capW = width * 1.2;
  const cap = new PlaneGeometry(capW, capW).rotateX(-Math.PI / 2).translate(0, capY, 0);
  // A second cap, tilted, so the crown reads as a 3D dome rather than a flat disc from a low oblique angle.
  const cap2 = new PlaneGeometry(capW * 0.8, capW * 0.8).rotateX(-Math.PI / 2).rotateZ(Math.PI / 5).translate(0, capY + width * 0.13, 0);
  for (const g of [cap, cap2]) { // sample the leafy upper band of the card, not the trunk
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.06 + uv.getX(i) * 0.88, 0.5 + uv.getY(i) * 0.48);
    uv.needsUpdate = true;
  }
  const merged = mergeGeometries([vA, vB, cap, cap2], false)!;
  vA.dispose(); vB.dispose(); cap.dispose(); cap2.dispose();
  return merged;
}

function hash(x: number, z: number): number {
  let v = 2166136261;
  v = Math.imul(v ^ Math.floor(x * 7.3), 16777619);
  v = Math.imul(v ^ Math.floor(z * 11.7), 16777619);
  return ((v >>> 0) % 10000) / 10000;
}

function insideFootprint(collision: ChunkCollision, x: number, z: number): boolean {
  const lx = x - collision.origin[0], lz = z - collision.origin[2];
  for (const building of collision.buildings) if (circleHitsBuilding(building, lx, lz, FOOT_CLEAR)) return true;
  return false;
}

/** lidarRoofs replaces the baked buildings of two blocks with LiDAR meshes and hides the baked ones in-shader,
 *  so those buildings are absent from collision.buildings -- without this, canopy lands on their flat roofs.
 *  Replicates lidarRoofs' own lidarHidden() (world xz inside a LiDAR block AND a per-building rect). No-op when
 *  lidarRoofs is off (uLidarCount 0). */
function onLidarBuilding(x: number, z: number): boolean {
  const count = LIDAR_HIDE.uLidarCount.value;
  if (count <= 0) return false;
  let inBlock = false;
  for (const r of LIDAR_HIDE.uLidarBlocks.value) if (x >= r.x && x <= r.z && z >= r.y && z <= r.w) { inBlock = true; break; }
  if (!inBlock) return false;
  const rects = LIDAR_HIDE.uLidarRects.value;
  for (let i = 0; i < count; i++) { const r = rects[i]!; if (x >= r.x && x <= r.z && z >= r.y && z <= r.w) return true; }
  return false;
}

function leafyChunk(ground: { x: number; z: number }): boolean {
  const xs = [ground.x * 256 + 1, (ground.x + 0.5) * 256, (ground.x + 1) * 256 - 1];
  const zs = [ground.z * 256 + 1, (ground.z + 0.5) * 256, (ground.z + 1) * 256 - 1];
  for (const x of xs) for (const z of zs) if (LEAFY_RESIDENTIAL.has(districtAt(x, z)?.id ?? '')) return true;
  return false;
}

/** Block-interior canopy mass (gtasf-cf1a). Factory: loads one foliage card, shares geometry + material; a
 *  per-chunk mount scatters instanced canopy blobs across the residential block interiors of that chunk. */
export function createBlockCanopy(preset: GraphicsPreset, enabled = flags.blockInteriorCanopy) {
  if (!enabled) return undefined;
  const low = preset === 'low';
  // Density fraction of candidate backyard points that get a canopy, and the per-chunk instance cap. Lower on
  // phone for fill-rate; the cap bounds the worst (dense-interior) chunk.
  // The canopy only renders from the aerial (update() hides it at street level), and no perf gate is aerial, so
  // both tiers can be dense/tall for a leafy aerial read; Low stays a little lighter for the rare phone player
  // who lifts to an aerial view.
  const fraction = low ? 0.5 : 0.72, cap = low ? 170 : 340;
  // Backyard trees ~roof-line height (crown tops ~8-13 m), not towering above the rooftops. The scale jitter in
  // mount() keeps the tallest near this.
  const geometry = canopyGeometry(low ? 7.0 : 7.6, low ? 11.5 : 13.0);
  // One MeshLambertMaterial, scene-lit (MeshLambert gets the sun + hemisphere/ambient); DoubleSide so back faces
  // are lit too, not dark. NO dark colour tint -- let the foliage card's own green show so the crowns read as
  // lit, sun-facing golden-hour greens like residentialBlockGreens / the street trees, not black silhouettes.
  // alphaTest is RAMPED by update() for the aerial fade (1.0 = fully eroded/hidden -> 0.5 = full crown); it stays
  // opaque (no transparent sorting / no shader recompile), so the only cost is at an aerial vantage, never the gate.
  const material = new MeshLambertMaterial({ color: '#ffffff', map: null, alphaTest: 1, side: DoubleSide, transparent: false });
  let texture: Texture | undefined, disposed = false;
  const mounts = new Set<() => void>();
  const meshes = new Set<InstancedMesh>();
  // The canopy is a backyard/AERIAL feature: at street level the row houses occlude it anyway, but its
  // alpha-tested foliage still costs fill-rate (~4 fps on the phone residential gate). So it FADES IN over a
  // camera-height band (FADE_LOW..FADE_HIGH metres above the ground) rather than popping on a hard toggle -- a
  // robotaxi lift or a hill crest crosses the band smoothly. The fade erodes the crowns via the alphaTest uniform
  // (1.0 = gone -> 0.5 = full), so it stays opaque (no transparent sorting, no shader recompile) and below the
  // band the meshes are hidden outright, so street gameplay (and the phone perf gate) still pays nothing.
  const FADE_LOW = 14, FADE_HIGH = 34;
  let canopyLit = 0; // 0 hidden .. 1 full
  const ready = loadSceneryTexture('/art/foliage/plane.png').then(value => {
    if (disposed) { value.dispose(); return false; }
    texture = value; value.colorSpace = SRGBColorSpace; value.wrapS = value.wrapT = RepeatWrapping;
    value.minFilter = LinearMipmapLinearFilter; value.magFilter = LinearFilter;
    value.generateMipmaps = true; value.anisotropy = low ? 4 : 8; value.needsUpdate = true;
    material.map = value; material.needsUpdate = true;
    return true;
  }, () => false);

  function mount(root: Object3D): () => void {
    const context = root.userData.gtasfShopfrontContext as ShopfrontContext | undefined;
    const ground = context?.ground as Heightfield | undefined;
    if (!context || !ground || !leafyChunk(ground)) return () => {};
    // The placement scan (per-chunk grid x nearestRoad/footprint queries) is deferred to idle: the canopy is
    // aerial-only and hidden at street level, so it never needs to be ready during the post-READY mount burst, and
    // running it there would drag the residential phone gate (which samples that window). Build off-main-burst via
    // requestIdleCallback; a release before it fires just cancels it.
    let mesh: InstancedMesh | undefined, cancelled = false;
    const build = () => {
      if (cancelled || disposed) return;
      const ox = ground.x * 256, oz = ground.z * 256;
      // Chunk geometry is authored in LOCAL space with the chunk root translated to its world origin (urbanSurfaces
      // reconstructs world via modelMatrix); our queries are in WORLD metres, so convert back to root-local before
      // writing the instance matrix. Chunk roots are axis-aligned, so a translation subtract suffices.
      const rootWorld = new Vector3(); root.updateWorldMatrix(true, false); root.getWorldPosition(rootWorld);
      const matrices: Matrix4[] = [];
      const pos = new Vector3(), quat = new Quaternion(), scale = new Vector3(), up = new Vector3(0, 1, 0);
      for (let gz = 0; gz < 256 && matrices.length < cap; gz += GRID) {
        for (let gx = 0; gx < 256 && matrices.length < cap; gx += GRID) {
          const bx = ox + gx, bz = oz + gz;
          if (!LEAFY_RESIDENTIAL.has(districtAt(bx, bz)?.id ?? '')) continue;
          const h0 = hash(bx, bz);
          if (h0 > fraction) continue;
          const h1 = hash(bx + 97, bz), h2 = hash(bx, bz + 131); // jitter so the canopy is not a lattice
          const x = bx + (h1 - 0.5) * GRID * 0.9, z = bz + (h2 - 0.5) * GRID * 0.9;
          const road = context.nearestRoad(x, z, 40);
          const roadDist = road ? Math.hypot(x - road.x, z - road.z) : 40;
          if (roadDist < ROAD_CLEAR) continue;            // on/near the street, not a backyard
          if (insideFootprint(context.collision, x, z)) continue; // under a baked building
          if (onLidarBuilding(x, z)) continue;            // on a LiDAR building (absent from collision.buildings)
          const y = sampleHeight(ground, x, z);
          if (y === null || !Number.isFinite(y)) continue;
          pos.set(x - rootWorld.x, y - rootWorld.y, z - rootWorld.z);
          quat.setFromAxisAngle(up, h0 * Math.PI * 2);
          // Capped jitter so the tallest backyard tree still tops out near the row-house roofline, never towering.
          const s = 0.78 + hash(bx + 53, bz + 29) * 0.32; // 0.78 - 1.10
          scale.set(s, 0.82 + hash(bx, bz + 61) * 0.3, s);
          matrices.push(new Matrix4().compose(pos, quat, scale));
        }
      }
      if (cancelled || disposed || !matrices.length) return;
      mesh = new InstancedMesh(geometry, material, matrices.length);
      mesh.name = 'SF block-interior canopy';
      mesh.castShadow = false; mesh.receiveShadow = false; mesh.visible = canopyLit > 0.01; mesh.frustumCulled = true;
      for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]!);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      root.add(mesh); meshes.add(mesh);
    };
    const useIdle = typeof requestIdleCallback === 'function';
    const handle = useIdle ? requestIdleCallback(build, { timeout: 4000 }) : setTimeout(build, 600);
    const release = () => {
      cancelled = true;
      if (useIdle) { if (typeof cancelIdleCallback === 'function') cancelIdleCallback(handle as number); }
      else clearTimeout(handle as ReturnType<typeof setTimeout>);
      if (mesh) { root.remove(mesh); mesh.dispose(); meshes.delete(mesh); }
      mounts.delete(release);
    };
    mounts.add(release);
    return release;
  }

  return {
    ready, mount,
    /** Call per frame with the camera's metres above the ground: fades the canopy in over FADE_LOW..FADE_HIGH so
     *  it never pops, and keeps it fully hidden (zero cost) below the band. */
    update(altitude: number) {
      const t = Math.max(0, Math.min(1, (altitude - FADE_LOW) / (FADE_HIGH - FADE_LOW)));
      const lit = t * t * (3 - 2 * t); // smoothstep
      if (Math.abs(lit - canopyLit) < 0.004) return;
      const wasShown = canopyLit > 0.01, nowShown = lit > 0.01;
      canopyLit = lit;
      material.alphaTest = 1 - lit * 0.5; // 1.0 eroded/hidden -> 0.5 full crown
      if (wasShown !== nowShown) for (const mesh of meshes) mesh.visible = nowShown;
    },
    get count() { return mounts.size; },
    dispose() {
      if (disposed) return; disposed = true;
      for (const release of [...mounts]) release();
      geometry.dispose(); material.dispose(); texture?.dispose();
    },
  };
}
