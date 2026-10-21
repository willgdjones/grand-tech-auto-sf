/**
 * GTA V pivot — LANE B (combat & police): persistent NPC drivers in traffic cars (Combat 6b, flag trafficDrivers).
 * Decoupled overlay — reads fleet.cars and parents a pooled seated avatar to each nearby traffic car's `seat` node
 * (never edits lane A's fleet.ts), so the world reads as driven and a carjack pulls out a visibly-present person.
 *
 * Perf-conscious: a small pool (maxDrivers) seats only the NEAREST eligible traffic cars; the avatar is parented to
 * the car's seat so it follows the car for free (no per-frame position update), and the 'sit' pose is applied ONCE
 * (one update(dt,'sit') → appearance.setSeated, which also hides the hand/bulky props so they don't clip the wheel)
 * so there's no per-frame mixer cost. Skips police cars + any car a player occupies. Byte-inert when the flag is off.
 */
import type { AvatarInstance, AvatarTemplate } from '../avatar/riggedAvatar';
import { BufferAttribute, BufferGeometry, Group, InterleavedBufferAttribute, Matrix3, Matrix4, Mesh, Object3D, SkinnedMesh, Vector3, Vector4 } from 'three';
import { flags } from '@gtasf/shared/flags';
import { applyCarGlass, removeCarGlass } from '../vehicles/carGlass';

const TRAFFIC_FLAG = 0x20;
const POLICE_FLAG = 0x40;
/** The shared seat node sits at sill height (y .08); seated, an NPC's head was at the window line and the feet poked
 *  out under the car. Lift the NPC (not players) so the head fills the side window without clearing the roof, per
 *  body (asset id = the car root's name). */
const DRIVER_LIFT: Record<string, number> = { outback: .3, prius: .12, model3: .02, cab: .08 };
/** Driverless or not a car seat: robotaxis are autonomous; buses seat elsewhere. */
const NO_DRIVER_KINDS = new Set(['robotaxi', 'bus']);

/** Minimal shape of a fleet car this overlay reads (matches web/src/game/fleet.ts FleetCar). */
interface FleetCarLike { data: { id: number; flags: number; kind?: string }; model: { root: Object3D; seat: Object3D } }

interface Slot { avatar: AvatarInstance; body: Object3D; baked: BufferGeometry[]; figure: Object3D | undefined; carId: number | null; car: FleetCarLike | null; eject?: Eject }
/** carEnterAnim carjack (gtasf-9jl2j): a driver pulled out of their car stumbles from the door, then runs off. */
interface Eject { start: number; last: number; x: number; y: number; z: number; dx: number; dz: number; heightAt?: (x: number, z: number) => number | null }

/** The avatar's current figure mesh: a CC0 body (outfit 4) mounts after READY and replaces the fallback figure. */
function figureOf(avatar: AvatarInstance): Object3D | undefined {
  let found: Object3D | undefined;
  avatar.root.traverse(object => { if (!found && object instanceof SkinnedMesh) found = object; });
  return found;
}

/** frozenDrivers (gtasf-zd91j): a seated driver never moves its bones, yet as a live avatar every one of its skinned
 *  meshes re-skinned each frame with frustum culling off (riggedAvatar: bind-pose bounds miss seat poses), so all 8
 *  drew every frame even behind the camera. Bake the settled 'sit' pose once into plain meshes (CPU-skinned positions
 *  and normals, the instance's own materials) with real bounds, so they cull and cost no skeleton work. The live
 *  avatar stays detached only to own those materials. */
/** Baked geometry per SOURCE geometry: every slot bakes the same settled 'sit' pose at the same root transform, and
 *  outfits 0-3 share the base rig (they differ only in material colour), so 8 drivers need ~2 bakes, not 8 (each ~100 ms
 *  on a 4x phone, gtasf-fht16). Shared between slots, so only the driver set's dispose() frees them. */
type BakeCache = Map<BufferGeometry, BufferGeometry>;
/** N13j residual: where a new driver slot's time goes (instance + settle vs the bake, cache miss vs hit), for QA harnesses
 *  (window.__gtasfDriverBake). A few performance.now() calls per new slot. */
const bakeStats = { slots: 0, createMs: [] as number[], bakeMs: [] as number[], bakeMisses: [] as number[], rebakeMs: [] as number[] };
if (typeof window !== 'undefined') (window as unknown as { __gtasfDriverBake?: typeof bakeStats }).__gtasfDriverBake = bakeStats;
function bakePose(avatar: AvatarInstance, cache: BakeCache): { body: Object3D; geometries: BufferGeometry[] } {
  const root = avatar.root, body = new Group(), geometries: BufferGeometry[] = [];
  body.name = 'traffic-driver';
  root.updateMatrixWorld(true);
  const toRoot = new Matrix4(), rootInverse = root.matrixWorld.clone().invert();
  const skin = new Matrix4(), bone = new Matrix4(), full = new Matrix4(), normalMatrix = new Matrix3();
  const v = new Vector3(), n = new Vector3(), weights = new Vector4(), indices = new Vector4();
  const shown = (object: Object3D) => { for (let o: Object3D | null = object; o && o !== root; o = o.parent) if (!o.visible) return false; return true; };
  root.traverse(object => {
    if (!(object instanceof Mesh) || !shown(object)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.every(material => material.transparent)) return; // the blob shadow: the car body covers the seat
    const source = object.geometry as BufferGeometry, position = source.getAttribute('position'), normal = source.getAttribute('normal');
    if (!position) return;
    const cached = cache.get(source);
    if (cached) { // same rig, same pose: reuse the baked geometry with this instance's own materials
      const mesh = new Mesh(cached, object.material);
      mesh.name = object.name; mesh.castShadow = false; mesh.receiveShadow = object.receiveShadow; mesh.renderOrder = object.renderOrder;
      mesh.matrixAutoUpdate = false; body.add(mesh); return;
    }
    const geometry = new BufferGeometry();
    cache.set(source, geometry);
    // Positions/normals are rewritten, so they get fresh float storage: the source is quantized (normalized int16,
    // interleaved), and a posed head above 1 m wrapped to -1 m in a cloned attribute.
    for (const name of Object.keys(source.attributes)) {
      if (name === 'skinIndex' || name === 'skinWeight') continue;
      const attribute = source.getAttribute(name);
      geometry.setAttribute(name, name === 'position' || name === 'normal' ? new BufferAttribute(new Float32Array(attribute.count * 3), 3) : attribute.clone());
    }
    if (source.index) geometry.setIndex(source.index.clone());
    for (const group of source.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
    const out = geometry.getAttribute('position') as BufferAttribute, outNormal = geometry.getAttribute('normal') as BufferAttribute | undefined;
    toRoot.multiplyMatrices(rootInverse, object.matrixWorld);
    if (object instanceof SkinnedMesh) {
      object.skeleton.update();
      const skinIndex = source.getAttribute('skinIndex') as BufferAttribute, skinWeight = source.getAttribute('skinWeight') as BufferAttribute, matrices = object.skeleton.boneMatrices;
      if (!matrices) return;
      if (flags.fastDriverBake) { skinFast(object, source, position, normal, out, outNormal, matrices, toRoot); }
      else for (let i = 0; i < position.count; i++) {
        indices.fromBufferAttribute(skinIndex, i); weights.fromBufferAttribute(skinWeight, i);
        skin.elements.fill(0);
        for (let k = 0; k < 4; k++) {
          const w = weights.getComponent(k);
          if (!w) continue;
          bone.fromArray(matrices, indices.getComponent(k) * 16);
          for (let e = 0; e < 16; e++) skin.elements[e]! += bone.elements[e]! * w;
        }
        // Same as three's skinning shader: bindMatrixInverse * skin * bindMatrix, then the mesh's place under the root.
        full.multiplyMatrices(object.bindMatrixInverse, skin).multiply(object.bindMatrix).premultiply(toRoot);
        v.fromBufferAttribute(position, i).applyMatrix4(full); out.setXYZ(i, v.x, v.y, v.z);
        if (normal && outNormal) { n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix.getNormalMatrix(full)).normalize(); outNormal.setXYZ(i, n.x, n.y, n.z); }
      }
    } else {
      normalMatrix.getNormalMatrix(toRoot);
      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(toRoot); out.setXYZ(i, v.x, v.y, v.z);
        if (normal && outNormal) { n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize(); outNormal.setXYZ(i, n.x, n.y, n.z); }
      }
    }
    geometry.computeBoundingSphere(); geometry.computeBoundingBox();
    const mesh = new Mesh(geometry, object.material);
    mesh.name = object.name; mesh.castShadow = false; mesh.receiveShadow = object.receiveShadow; mesh.renderOrder = object.renderOrder;
    mesh.matrixAutoUpdate = false;
    body.add(mesh); geometries.push(geometry);
  });
  return { body, geometries };
}

/** fastDriverBake (N13j follow-up): skinning is linear in the weights, so fold each bone's full transform
 *  (toRoot * bindMatrixInverse * bone * bindMatrix) once, then blend four precomputed matrices per vertex. Normals take the
 *  blended matrix's 3x3, as three's skinning shader does. The old path did three matrix products and a normal-matrix
 *  inverse PER VERTEX: the CC0 body's rebake took ~1 s on a 4x phone. */
function skinFast(object: SkinnedMesh, source: BufferGeometry, position: BufferAttribute | InterleavedBufferAttribute, normal: BufferAttribute | InterleavedBufferAttribute | undefined,
  out: BufferAttribute, outNormal: BufferAttribute | undefined, matrices: Float32Array, toRoot: Matrix4): void {
  const bones = matrices.length / 16, folded = new Float32Array(bones * 16), pre = new Matrix4().multiplyMatrices(toRoot, object.bindMatrixInverse), m = new Matrix4();
  for (let b = 0; b < bones; b++) { m.fromArray(matrices, b * 16).premultiply(pre).multiply(object.bindMatrix); folded.set(m.elements, b * 16); }
  const skinIndex = source.getAttribute('skinIndex'), skinWeight = source.getAttribute('skinWeight');
  const e = new Float32Array(12); // column-major 3x4 (the bottom row of an affine bone transform is 0 0 0 1)
  for (let i = 0; i < position.count; i++) {
    e.fill(0);
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(i, k);
      if (!w) continue;
      const o = skinIndex.getComponent(i, k) * 16;
      e[0]! += folded[o]! * w; e[1]! += folded[o + 1]! * w; e[2]! += folded[o + 2]! * w;
      e[3]! += folded[o + 4]! * w; e[4]! += folded[o + 5]! * w; e[5]! += folded[o + 6]! * w;
      e[6]! += folded[o + 8]! * w; e[7]! += folded[o + 9]! * w; e[8]! += folded[o + 10]! * w;
      e[9]! += folded[o + 12]! * w; e[10]! += folded[o + 13]! * w; e[11]! += folded[o + 14]! * w;
    }
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    out.setXYZ(i, e[0]! * x + e[3]! * y + e[6]! * z + e[9]!, e[1]! * x + e[4]! * y + e[7]! * z + e[10]!, e[2]! * x + e[5]! * y + e[8]! * z + e[11]!);
    if (normal && outNormal) {
      const a = normal.getX(i), b = normal.getY(i), c = normal.getZ(i);
      const nx = e[0]! * a + e[3]! * b + e[6]! * c, ny = e[1]! * a + e[4]! * b + e[7]! * c, nz = e[2]! * a + e[5]! * b + e[8]! * c;
      const len = Math.hypot(nx, ny, nz) || 1;
      outNormal.setXYZ(i, nx / len, ny / len, nz / len);
    }
  }
}

export interface TrafficDrivers {
  update(cars: Iterable<FleetCarLike>, player: { x: number; z: number }, isOccupied: (carId: number) => boolean): void;
  /** Carjack (carEnterAnim): pull this car's driver out at `door` (world) and send them running along `away` (unit, xz).
   *  False when the car has no seated driver. The slot is busy until the run ends (~3 s). */
  eject(carId: number, scene: Object3D, door: { x: number; y: number; z: number }, away: { x: number; z: number }, heightAt?: (x: number, z: number) => number | null): boolean;
  dispose(): void;
}

export function createTrafficDrivers(options: { template: AvatarTemplate; maxDrivers?: number; rangeM?: number }): TrafficDrivers {
  const { template } = options;
  const max = options.maxDrivers ?? 8;
  const range = options.rangeM ?? 60;
  const range2 = range * range;
  const pool: Slot[] = [];
  const bakeCache: BakeCache = new Map();
  const OUTFITS = [0, 1, 2, 3, 4]; // per-instance material variety (riggedAvatar clones materials, so no bleed)

  function detach(slot: Slot): void {
    if (slot.car) removeCarGlass(slot.car.model.root);
    slot.car = null;
    slot.body.removeFromParent();
    slot.body.visible = false;
    slot.carId = null;
  }
  function attach(slot: Slot, car: FleetCarLike): void {
    car.model.seat.add(slot.body);
    slot.body.position.set(0, DRIVER_LIFT[car.model.root.name] ?? .1, 0);
    slot.body.rotation.set(0, 0, 0);
    slot.body.visible = true;
    slot.carId = car.data.id; slot.car = car;
    applyCarGlass(car.model.root); // the body's baked windows go translucent so the driver can be seen
  }
  function freeSlot(): Slot | undefined {
    const idle = pool.find(s => s.carId === null && !s.eject);
    if (idle) return idle;
    if (pool.length >= max) return undefined;
    const t0 = performance.now();
    const avatar = template.createInstance(OUTFITS[pool.length % OUTFITS.length]);
    // Settle the seated pose FULLY, then freeze: the idle->sit crossfade is 0.18s, so a single update(0.016)
    // leaves the driver standing (only ~9% faded) and clipping through the car. Advance past the crossfade once
    // (updates clamp dt at 0.1s), after which there's no per-frame mixer cost. setSeated hides wheel-clip props.
    avatar.update(0.016, 'sit');
    avatar.update(0.1, 'sit');
    avatar.update(0.1, 'sit');
    const t1 = performance.now(), cached = bakeCache.size;
    const baked = flags.frozenDrivers ? bakePose(avatar, bakeCache) : undefined;
    bakeStats.slots++; bakeStats.createMs.push(+(t1 - t0).toFixed(1)); bakeStats.bakeMs.push(+(performance.now() - t1).toFixed(1));
    bakeStats.bakeMisses.push(bakeCache.size - cached);
    avatar.root.visible = false;
    const body = baked?.body ?? avatar.root;
    body.visible = false;
    const slot: Slot = { avatar, body, baked: baked?.geometries ?? [], figure: baked ? figureOf(avatar) : undefined, carId: null, car: null };
    pool.push(slot);
    return slot;
  }

  function rebake(slot: Slot): void {
    const t0 = performance.now();
    slot.avatar.root.visible = true;
    const { body, geometries } = bakePose(slot.avatar, bakeCache);
    slot.avatar.root.visible = false;
    const parent = slot.body.parent;
    body.position.copy(slot.body.position); body.visible = slot.body.visible;
    slot.body.removeFromParent(); // the old geometries stay in bakeCache: other slots may share them
    parent?.add(body);
    slot.body = body; slot.baked = geometries; slot.figure = figureOf(slot.avatar);
    bakeStats.rebakeMs.push(+(performance.now() - t0).toFixed(1));
  }

  const EJECT_STUMBLE_S = .4, EJECT_S = 3;
  function stepEject(slot: Slot, now: number): void {
    const e = slot.eject!, root = slot.avatar.root, t = (now - e.start) / 1000, dt = Math.min(.1, (now - e.last) / 1000);
    e.last = now;
    if (t >= EJECT_S) { // gone round the corner: back to the pool, re-settled in the seated pose (rebake() bakes the live pose)
      root.removeFromParent(); root.visible = false; slot.body.visible = false; slot.eject = undefined;
      slot.avatar.update(.1, 'sit'); slot.avatar.update(.1, 'sit'); slot.avatar.update(.1, 'sit');
      return;
    }
    const stumbling = t < EJECT_STUMBLE_S, speed = stumbling ? 1.6 : 5.2;
    e.x += e.dx * speed * dt; e.z += e.dz * speed * dt; e.y = e.heightAt?.(e.x, e.z) ?? e.y;
    root.position.set(e.x, e.y, e.z); root.rotation.set(0, Math.atan2(e.dx, e.dz), 0);
    slot.avatar.update(dt, stumbling ? 'walk' : 'run');
  }

  let frame = 0;
  return {
    eject(carId, scene, door, away, heightAt) {
      const slot = pool.find(s => s.carId === carId && !s.eject);
      if (!slot) return false;
      detach(slot);
      const root = slot.avatar.root, now = performance.now();
      scene.add(root); root.visible = true;
      slot.eject = { start: now, last: now, x: door.x, y: door.y, z: door.z, dx: away.x, dz: away.z, heightAt };
      stepEject(slot, now);
      return true;
    },
    update(cars: Iterable<FleetCarLike>, player: { x: number; z: number }, isOccupied: (carId: number) => boolean): void {
      const now = performance.now();
      for (const slot of pool) if (slot.eject) stepEject(slot, now);
      // Nearest eligible traffic cars (traffic, not police, not occupied by a player), capped to the pool size.
      const eligible: { car: FleetCarLike; d2: number }[] = [];
      for (const car of cars) {
        if (!(car.data.flags & TRAFFIC_FLAG) || (car.data.flags & POLICE_FLAG) || NO_DRIVER_KINDS.has(car.data.kind ?? '') || isOccupied(car.data.id)) continue;
        const dx = car.model.root.position.x - player.x, dz = car.model.root.position.z - player.z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= range2) eligible.push({ car, d2 });
      }
      eligible.sort((a, b) => a.d2 - b.d2);
      const want = eligible.slice(0, max);
      const wantIds = new Set(want.map(e => e.car.data.id));

      // Release drivers whose car is no longer wanted (out of range / gone / now occupied).
      for (const slot of pool) if (slot.carId !== null && !wantIds.has(slot.carId)) detach(slot);
      // Seat a driver in each wanted car not already covered.
      const covered = new Set(pool.filter(s => s.carId !== null).map(s => s.carId));
      // At most ONE new driver per frame: each new slot bakes a posed body (~100 ms on a 4x phone), and the first update
      // used to create all eight at once — a ~1 s stall on the first frame after the loading card (gtasf-fht16). Idle
      // pooled drivers are still reused immediately; the rest fill in over the next few frames.
      let created = false;
      for (const e of want) {
        if (covered.has(e.car.data.id)) continue;
        const reuse = pool.some(s => s.carId === null);
        if (!reuse && created) break;
        const slot = freeSlot();
        if (!slot) break; // pool exhausted
        if (!reuse) created = true;
        attach(slot, e.car);
      }
      // carNearDetail swaps in an HD level lazily; glass it too (cheap no-op traverse otherwise, every ~0.5 s).
      // N13j follow-up: the CC0 body arrives for every pooled driver at once, and rebaking them all in one frame was an
      // ~830 ms freeze ~9 s into a 4x phone's opening. One rebake per check (every 30 frames); the rest follow.
      if (++frame % 30 === 0) {
        let rebaked = false;
        for (const slot of pool) {
          if (slot.car) applyCarGlass(slot.car.model.root);
          if (!rebaked && slot.figure && figureOf(slot.avatar) !== slot.figure) { rebake(slot); rebaked = flags.spreadDriverRebake; } // its CC0 body arrived: bake that instead
        }
      }
    },
    dispose(): void {
      for (const slot of pool) {
        if (slot.car) removeCarGlass(slot.car.model.root);
        slot.body.removeFromParent(); slot.avatar.root.removeFromParent(); slot.avatar.dispose();
      }
      for (const geometry of bakeCache.values()) geometry.dispose();
      bakeCache.clear();
      pool.length = 0;
    },
  };
}
