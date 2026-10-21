import { Group, InstancedMesh, LOD, Matrix4, Mesh, type Object3D } from 'three';
import { mergeMeshesByMaterial } from '../chunks/mergeChunkMeshes';
import { flags } from '@gtasf/shared/flags';
import { loadVehicleTemplate, type VehicleInstance, type VehicleTemplate } from '../../vehicles/models/vehicle';
import type { KerbCarSpot } from './layout';

/** Shown kerb cars, as two 1 m circles along each body, so players and driven cars can't pass through. */
const shownBodies: { x: number; z: number; yaw: number }[] = [];
/** Shown kerb cars a player can steal (kerbCarTheft): pose + fleet kind. A taken spot never shows a prop again
 *  (the server spawned a real fleet car there). */
export interface KerbCarHandle { x: number; z: number; yaw: number; kind: 'prius' | 'subaru'; spot: KerbCarSpot }
const shownCars: KerbCarHandle[] = [];
const takenSpots = new WeakSet<KerbCarSpot>();
let takeHook: ((spot: KerbCarSpot) => void) | undefined;
let restoreHook: (() => void) | undefined;
/** The nearest shown kerb car within `maxM` metres (2-D) of a point, or undefined. */
export function nearestKerbCar(x: number, z: number, maxM = 3): KerbCarHandle | undefined {
  let best: KerbCarHandle | undefined, bestD = maxM;
  for (const car of shownCars) { const d = Math.hypot(car.x - x, car.z - z); if (d <= bestD) { bestD = d; best = car; } }
  return best;
}
/** Hide a kerb car for good (it's being stolen; the server puts a real car at the same pose). */
export function takeKerbCar(car: KerbCarHandle): void { takenSpots.add(car.spot); takeHook?.(car.spot); }
/** The server refused the theft: show the prop again (the next update re-pools it). */
export function restoreKerbCar(car: KerbCarHandle): void { takenSpots.delete(car.spot); restoreHook?.(); }
/** Shown kerb cars' centres and headings, for car-vs-car contact (flags.carCollisions). */
export function kerbCarBodies(): readonly { x: number; z: number; yaw: number }[] { return shownBodies; }
export function kerbCarBlocks(x: number, z: number, radius: number): boolean {
  for (const car of shownBodies) {
    const dx = x - car.x, dz = z - car.z;
    if (dx * dx + dz * dz > 16) continue;
    const sx = Math.sin(car.yaw) * 1.25, sz = Math.cos(car.yaw) * 1.25;
    // Squared compare: called per kerb car per movement probe every frame (no Math.hypot allocation; gtasf-pooa).
    const r2 = (radius + 1) * (radius + 1);
    if ((dx - sx) ** 2 + (dz - sz) ** 2 < r2 || (dx + sx) ** 2 + (dz + sz) ** 2 < r2) return true;
  }
  return false;
}

/** Cosmetic kerbside parked cars (gtasf-7moo): never networked or drivable, pooled to the nearest spots.
 *  HD fills a wider radius; Low keeps a handful near the player. */
export async function createKerbCars(spots: readonly KerbCarSpot[], options: {
  low: boolean; heightAt(x: number, z: number, referenceY?: number): number | null; isLoaded?(x: number, z: number): boolean;
}) {
  if (!flags.kerbParkedCars || !flags.graphicsV2 || !spots.length) return null;
  const ids = ['prius', 'outback'] as const;
  const loaded = await Promise.all(ids.map(id => loadVehicleTemplate(id).catch(() => undefined)));
  const templates = loaded.filter((t): t is VehicleTemplate => Boolean(t));
  // Fleet kind per loaded template (the outback GLB is the fleet's 'subaru').
  const kinds = ids.filter((_, i) => loaded[i]).map(id => (id === 'outback' ? 'subaru' : 'prius') as KerbCarHandle['kind']);
  if (!templates.length) return null;
  const capacity = options.low ? 10 : 44, radius = options.low ? 80 : 190;
  const root = new Group(); root.name = 'Kerbside parked cars';
  const pool: { car: VehicleInstance; spot: KerbCarSpot | undefined }[] = [];
  const hidden = new Matrix4().makeScale(0, 0, 0);
  // gtasf-c8sj: on Low each template's near model is merged per material and drawn instanced, so the
  // whole kerbside pool costs a few draws instead of ~10 per visible car. Slots then drive instance matrices.
  const instanced = options.low && flags.lowInstancedKerbCars ? templates.map(template => {
    const probe = template.createInstance(), near = (probe.root.children.find(c => c instanceof LOD) as LOD | undefined)?.levels[0]?.object;
    const keep = new Set<Object3D>(); near?.traverse(o => keep.add(o));
    for (const child of probe.root.children) if (!(child instanceof LOD)) child.traverse(o => keep.add(o));
    const { meshes } = mergeMeshesByMaterial(probe.root, mesh => keep.has(mesh), 1, false); // template geometry is shared
    const perSlot = Math.ceil(capacity / templates.length);
    const parts = meshes.map(mesh => {
      const part = new InstancedMesh(mesh.geometry, mesh.material, perSlot); part.count = perSlot;
      part.name = `Kerb ${template === templates[0] ? ids[0] : ids[1]} ${mesh.name}`; part.frustumCulled = false; part.renderOrder = mesh.renderOrder;
      for (let i = 0; i < perSlot; i++) part.setMatrixAt(i, hidden);
      root.add(part); return part;
    });
    probe.dispose();
    return parts;
  }) : undefined;
  for (let i = 0; i < capacity; i++) {
    const car = templates[i % templates.length]!.createInstance();
    car.root.visible = false; car.root.matrixAutoUpdate = false; if (!instanced) root.add(car.root);
    pool.push({ car, spot: undefined });
  }
  // carNearDetail on Low: the nearest shown kerb car within NEAR_M of the player leaves its instance and is drawn as
  // its own car, so its VisibleLod joins the fleet's single-winner HD swap (critic N5: a crushed Low kerb car at 2 m at
  // the phone pre-seed spawn). At most one car is pulled out at a time.
  const NEAR_M = 12;
  let pulled: (typeof pool)[number] | undefined;
  function publish() {
    if (!instanced) return;
    pool.forEach((slot, i) => {
      const parts = instanced[i % templates.length]!, index = Math.floor(i / templates.length);
      if (slot.spot && slot.car.root.visible) slot.car.root.updateMatrix();
      const show = slot.spot && slot.car.root.visible && slot !== pulled;
      for (const part of parts) { part.setMatrixAt(index, show ? slot.car.root.matrix : hidden); part.instanceMatrix.needsUpdate = true; }
    });
  }
  function pullNearest(focus: { x: number; z: number }): void {
    let best: (typeof pool)[number] | undefined, bestD = NEAR_M;
    for (const slot of pool) if (slot.spot && slot.car.root.visible) {
      const p = slot.car.root.position, d = Math.hypot(p.x - focus.x, p.z - focus.z);
      if (d < bestD) { bestD = d; best = slot; }
    }
    if (best === pulled) return;
    // Hysteresis (review LOW): only switch to a candidate at least 0.5 m nearer than the current one, so standing between two
    // kerb cars doesn't re-add a root and re-publish every instance matrix each frame.
    if (best && pulled?.spot && pulled.car.root.visible) {
      const p = pulled.car.root.position;
      if (Math.hypot(p.x - focus.x, p.z - focus.z) < NEAR_M && bestD > Math.hypot(p.x - focus.x, p.z - focus.z) - .5) return;
    }
    if (pulled) pulled.car.root.removeFromParent();
    pulled = best;
    if (pulled) { pulled.car.root.matrixAutoUpdate = false; pulled.car.root.updateMatrix(); root.add(pulled.car.root); }
    publish();
  }
  const cell = 64, grid = new Map<string, KerbCarSpot[]>();
  for (const spot of spots) {
    const key = `${Math.floor(spot.x / cell)}_${Math.floor(spot.z / cell)}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(spot);
  }
  let lastX = Infinity, lastZ = Infinity, disposed = false;
  const stats = { spots: spots.length, shown: 0 };
  function update(focus: { x: number; z: number }): void {
    if (disposed) return;
    if (instanced && flags.carNearDetail) pullNearest(focus);
    if (Math.hypot(focus.x - lastX, focus.z - lastZ) < 12) return;
    lastX = focus.x; lastZ = focus.z;
    const near: { spot: KerbCarSpot; d: number }[] = [];
    const r = Math.ceil(radius / cell);
    for (let gx = Math.floor(focus.x / cell) - r; gx <= Math.floor(focus.x / cell) + r; gx++)
      for (let gz = Math.floor(focus.z / cell) - r; gz <= Math.floor(focus.z / cell) + r; gz++)
        for (const spot of grid.get(`${gx}_${gz}`) ?? []) {
          if (takenSpots.has(spot)) continue; // stolen: a real fleet car is there now
          const d = Math.hypot(spot.x - focus.x, spot.z - focus.z);
          if (d <= radius && (options.isLoaded?.(spot.x, spot.z) ?? true)) near.push({ spot, d });
        }
    near.sort((a, b) => a.d - b.d);
    const wanted = new Set(near.slice(0, capacity).map(n => n.spot));
    // Keep cars that are still wanted in place (no popping); reassign the rest.
    for (const slot of pool) if (slot.spot && !wanted.has(slot.spot)) { slot.spot = undefined; slot.car.root.visible = false; }
    if (pulled && !pulled.spot) { pulled.car.root.removeFromParent(); pulled = undefined; }
    for (const slot of pool) if (slot.spot) wanted.delete(slot.spot);
    const free = pool.filter(slot => !slot.spot);
    for (const spot of wanted) {
      // Never pop a solid car in on top of the player.
      if (Math.hypot(spot.x - focus.x, spot.z - focus.z) < 4) continue;
      const y = options.heightAt(spot.x, spot.z, spot.y);
      if (y === null || !Number.isFinite(y)) continue;
      // Prefer a pooled model matching the spot's seed so the same kerb keeps the same car.
      const index = free.findIndex((slot, i) => (pool.indexOf(slot) % templates.length) === spot.seed % templates.length || i === free.length - 1);
      const slot = index >= 0 ? free.splice(index, 1)[0] : undefined;
      if (!slot) break;
      slot.spot = spot;
      const object = slot.car.root;
      object.position.set(spot.x, y + .02, spot.z); object.rotation.set(0, spot.yaw, 0);
      object.updateMatrix(); object.visible = true;
    }
    refreshShown();
    publish();
  }
  function refreshShown(): void {
    shownBodies.length = 0; shownCars.length = 0;
    pool.forEach((slot, i) => {
      if (!slot.spot || !slot.car.root.visible) return;
      const p = slot.car.root.position;
      shownBodies.push({ x: p.x, z: p.z, yaw: slot.spot.yaw });
      shownCars.push({ x: p.x, z: p.z, yaw: slot.spot.yaw, kind: kinds[i % templates.length] ?? 'prius', spot: slot.spot });
    });
    stats.shown = shownBodies.length;
  }
  restoreHook = () => { lastX = Infinity; lastZ = Infinity; };
  takeHook = spot => {
    for (const slot of pool) if (slot.spot === spot) { slot.spot = undefined; slot.car.root.visible = false; }
    if (pulled && !pulled.spot) { pulled.car.root.removeFromParent(); pulled = undefined; }
    refreshShown(); publish();
  };
  return { root, update, stats, dispose() {
    if (disposed) return; disposed = true; shownBodies.length = 0; shownCars.length = 0; takeHook = undefined; restoreHook = undefined; root.removeFromParent();
    for (const parts of instanced ?? []) for (const part of parts) { part.geometry.dispose(); part.dispose(); }
    for (const template of templates) template.dispose();
  } };
}
