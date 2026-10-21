import { BufferGeometry, Matrix4, Mesh, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flags } from '@gtasf/shared/flags';
import { graphicsPreset } from '../graphicsPreset';
import { sampleHeight } from '../chunks/terrain';
import { realisticFacadePieces } from '../../assets/realisticFacadePieces';
import type { ShopfrontContext } from '../shopfrontSigns';

function hash(text: string): number { let value = 2166136261; for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619); return value >>> 0; }

export type FacadeKind = 'storefront' | 'entrance';
export type FacadePlacement = { id: string; kind: FacadeKind; centre: [number, number, number]; normal: [number, number]; width: number };

/**
 * Pure placement: one ground-floor Meshy facade piece on the canonical street-facing wall of each
 * qualifying building, at ground level facing the road. Mirrors shopfrontSigns' wall pick so the
 * piece, its sign (y+3) and buildingDetail's awning stack on the SAME frontage. buildingDetail has
 * no ground-floor facade, so this never double-places. Each eligible building gets EXACTLY ONE of
 * storefront (default) or a grand entrance (taller blocks, a hash subset) — never both. Hash-gated
 * to ~half of eligible blocks for variety; cross-chunk dedup is the caller's.
 */
export function placeGroundFacades({ collision, ground, nearestRoad }: ShopfrontContext, max = 24): FacadePlacement[] {
  const result: FacadePlacement[] = [];
  const [originX, , originZ] = collision.origin;
  for (const building of [...collision.buildings].sort((a, b) => hash(a.id) - hash(b.id))) {
    const height = building.maxY - building.minY;
    if (building.id.startsWith('datasf:201006.0000058:') || height < 4 || hash(building.id + ':store') % 2 !== 0) continue;
    const ring = building.rings[0]; if (!ring || ring.length < 3) continue;
    let area = 0;
    for (let i = 0; i < ring.length; i++) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!; area += a[0] * b[1] - b[0] * a[1]; }
    const signArea = Math.sign(area) || 1;
    let candidate: { x: number; z: number; nx: number; nz: number; width: number; roadY: number } | undefined, best = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!, dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      if (length < 5) continue;
      const nx = dz / length * signArea, nz = -dx / length * signArea;
      const x = originX + (a[0] + b[0]) / 2, z = originZ + (a[1] + b[1]) / 2;
      const road = nearestRoad(x + nx, z + nz, 22); if (!road) continue;
      const rx = road.x - x, rz = road.z - z, distance = Math.hypot(rx, rz);
      if (distance < 2 || distance > 22 || (nx * rx + nz * rz) / distance < 0.7) continue;
      if (distance < best) { best = distance; candidate = { x, z, nx, nz, width: Math.min(6, length - 1), roadY: road.y }; }
    }
    if (!candidate) continue;
    const { x, z, nx, nz, width, roadY } = candidate;
    // One canonical owning cell, so footprints shared across chunk seams place a piece once.
    if (Math.floor(x / 256) !== ground.x || Math.floor(z / 256) !== ground.z) continue;
    // Near-road ground; fall back to the road height where the heightfield is sparse (as buildingDetail does).
    const y = sampleHeight(ground, x + nx * 0.2, z + nz * 0.2) ?? roadY;
    if (Math.abs(y - roadY) > 3 || y + 3 > building.maxY) continue;
    // Only blocks that start at the street: an upper block set back behind a low shop row (Chinatown) put the
    // piece inside the podium, so only its blurry top poked out above the awnings as giant shop windows.
    if (building.minY > y + 1) continue;
    // ...or whose chosen wall faces another building (a low shop row in front) rather than open sidewalk.
    const fx = x + nx * 1.5 - originX, fz = z + nz * 1.5 - originZ;
    if (collision.buildings.some(other => other !== building && insideRing(other.rings[0], fx, fz))) continue;
    // Taller blocks sometimes get a grand entrance instead of a shopfront, for street variety.
    const kind: FacadeKind = height >= 12 && hash(building.id + ':grand') % 3 === 0 ? 'entrance' : 'storefront';
    result.push({ id: building.id, kind, centre: [x + nx * 0.1, y, z + nz * 0.1], normal: [nx, nz], width });
    if (result.length === max) break;
  }
  return result;
}

function insideRing(ring: readonly (readonly number[])[] | undefined, x: number, z: number): boolean {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1]! > z) !== (b[1]! > z) && x < (b[0]! - a[0]!) * (z - a[1]!) / (b[1]! - a[1]!) + a[0]!) inside = !inside;
  }
  return inside;
}

const KINDS: readonly FacadeKind[] = ['storefront', 'entrance'];

/**
 * Meshy ground-floor facade pieces (gtasf-realistic-facade-meshy-pieces-xyrw), merged per chunk like
 * shopfrontSigns. Loads the Low GLBs once and stamps a scaled, road-facing copy onto each placement,
 * one merged mesh per piece kind. Gated: realisticFacades + storefrontPieces (OFF until pane 6 tunes
 * each piece's facing/depth/scale and verifies the look). A no-op otherwise. Wire beside
 * createShopfrontSigns in foundation.ts.
 */
export function createFacadeStorefronts() {
  const stats = { state: 'loading', error: '', pieces: 0, batches: 0 };
  const mounted = new Set<string>();
  const releases = new Set<() => void>();
  const assets = new Map<FacadeKind, { base: BufferGeometry; material: Material; nativeWidth: number }>();
  let disposed = false;

  const ready = (async () => {
    // HD only, the same gate as buildingDetail's Meshy pieces: Low phones fetched ~413 KB of entrance/storefront GLBs
    // they never needed, which put the 27-flag batch's first load at 15.31 MB (budget 15 MB; ship list, Oct 7).
    if (typeof window === 'undefined' || !flags.realisticFacades || !flags.storefrontPieces || graphicsPreset() !== 'hd') { stats.state = 'disabled'; return false; }
    try {
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      for (const kind of KINDS) {
        const manifest = realisticFacadePieces[kind];
        if (!manifest) continue;
        const gltf = await loader.loadAsync(manifest.low.url);
        gltf.scene.updateMatrixWorld(true);
        const geometries: BufferGeometry[] = []; let material: Material | undefined;
        gltf.scene.traverse(object => {
          if (object instanceof Mesh) {
            const geometry = object.geometry.clone(); geometry.applyMatrix4(object.matrixWorld);
            geometries.push(geometry); material ??= Array.isArray(object.material) ? object.material[0] : object.material;
          }
        });
        if (!geometries.length || !material) continue;
        let base: BufferGeometry;
        if (geometries.length === 1) base = geometries[0]!;
        else { base = mergeGeometries(geometries, false)!; for (const g of geometries) g.dispose(); }
        assets.set(kind, { base, material, nativeWidth: (manifest.bounds.max[0]! - manifest.bounds.min[0]!) || 1 });
      }
      if (!assets.size) throw new Error('no ground-floor facade pieces in the manifest');
      stats.state = 'ready';
      return true;
    } catch (error) { if (!disposed) { stats.state = 'unavailable'; stats.error = String(error); } return false; }
  })();

  function mount(root: Object3D): () => void {
    const context = root.userData.gtasfShopfrontContext as ShopfrontContext | undefined;
    if (!context) return () => {};
    let active = true, ids: string[] = [];
    const meshes: Mesh[] = [];
    const release = () => {
      if (!active) return;
      active = false;
      for (const mesh of meshes) { root.remove(mesh); mesh.geometry.dispose(); }
      if (meshes.length) stats.batches--;
      stats.pieces -= ids.length;
      for (const id of ids) mounted.delete(id);
      releases.delete(release);
    };
    releases.add(release);
    void ready.then(ok => {
      if (!ok || !active || disposed || !assets.size) return;
      const placements = placeGroundFacades(context).filter(p => !mounted.has(p.id) && assets.has(p.kind));
      if (!placements.length) return;
      ids = placements.map(p => p.id); for (const id of ids) mounted.add(id);
      for (const kind of KINDS) {
        const asset = assets.get(kind); if (!asset) continue;
        const parts: BufferGeometry[] = [];
        for (const p of placements) {
          if (p.kind !== kind) continue;
          const s = Math.min(1.2, p.width / asset.nativeWidth); // scale the unit to the wall, never blown up much
          const yaw = Math.atan2(p.normal[0], p.normal[1]);      // rotate the piece's +Z (detail) to the wall normal
          const matrix = new Matrix4()
            .makeTranslation(p.centre[0] - root.position.x, p.centre[1] - root.position.y, p.centre[2] - root.position.z)
            .multiply(new Matrix4().makeRotationY(yaw))
            .multiply(new Matrix4().makeScale(s, s, s));
          parts.push(asset.base.clone().applyMatrix4(matrix));
        }
        if (!parts.length) continue;
        const merged = mergeGeometries(parts, false)!;
        for (const part of parts) part.dispose();
        const mesh = new Mesh(merged, asset.material);
        mesh.name = `Facade ${kind}`; mesh.castShadow = true; mesh.receiveShadow = true;
        root.add(mesh); meshes.push(mesh);
      }
      if (meshes.length) { stats.pieces += ids.length; stats.batches++; }
    });
    return release;
  }

  return { stats, ready, mount,
    dispose() {
      if (disposed) return; disposed = true;
      for (const release of releases) release();
      for (const asset of assets.values()) { asset.base.dispose(); asset.material.dispose(); }
      assets.clear();
      stats.state = 'disposed';
    },
  };
}
