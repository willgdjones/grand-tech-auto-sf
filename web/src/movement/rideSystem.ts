import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, type BufferGeometry, type Object3D } from 'three';
import { fastestUnlockedRide, PERSONAL_RIDES, type PersonalRide } from '@gtasf/shared/content/rides';
import type { FundingRound } from '@gtasf/shared/funding';
import type { GroundPose } from './world';
import { flags } from '@gtasf/shared/flags';

/**
 * Personal ride mount/dismount (PLAN-v2.1 decision 1, gtasf-v21-personal-rides). Self-contained so
 * main.ts wires it in a handful of null-guarded lines behind flags.personalRides: toggle() pulls out /
 * stows the fastest ride the player's funding round grants, mountSpeed() feeds updateOnFoot's
 * mountSpeedMps, and update() parks the active ride mesh under the avatar each frame and spins its
 * wheels by distance travelled (gtasf-ride-wheel-spin, so a mounted ride doesn't slide on dead wheels).
 *
 * Each PersonalRide id has its own authored low-poly silhouette (gtasf-v21-ride-meshes-hd6d): scooter,
 * skateboard, e-bike, onewheel and segway. All are procedural three.js primitives (no GLB/texture
 * fetch) so the geo budget stays tiny on phones and only the mounted ride is ever visible. The
 * no-placeholder visual gate still applies: flags.personalRides stays OFF until pane 6 verifies the
 * look, so none of this is in the playtest while the flag is off.
 */
export interface RideSystem {
  readonly mounted: boolean;
  readonly ride: PersonalRide | null;
  /** Pull out (fastest unlocked ride for the round) or stow. No-op semantics: always flips state. */
  toggle(round: Pick<FundingRound, 'id'>): void;
  dismount(): void;
  /** Match a mounted ride to the current funding stage without toggling or moving the rider. */
  syncRound(round: Pick<FundingRound, 'id'>): void;
  /** Ground speed to pass as OnFootInput.mountSpeedMps; 0 when on foot. Re-reads the round so a mid-ride
   *  funding-up upgrades the ride. */
  mountSpeed(round: Pick<FundingRound, 'id'>): number;
  /** Park + orient the active ride mesh under the avatar and spin its wheels; hidden when dismounted. */
  update(foot: GroundPose): void;
  /** Label of the ride the player would pull out at this round (for the HUD hint). */
  availableLabel(round: Pick<FundingRound, 'id'>): string;
  destroy(): void;
}

type RideId = PersonalRide['id'];
/** A wheel mesh plus its rolling radius, so update() can spin it the right amount per metre. */
type Wheel = { mesh: Mesh; roll: number };
type RideMesh = { root: Group; wheels: Wheel[]; dispose(): void };

/**
 * Small per-ride builder: collects every geometry + material it creates so dispose() frees exactly
 * what the ride built. Metres; origin at ground (y=0), centred on x=0, forward = +z (so the shared
 * update() can keep parking the root at foot.yaw unchanged). wheel() bakes the cylinder's axle along x
 * so a plain mesh.rotation.x rolls it forward, and registers it for spinning.
 */
function rideBuilder() {
  const root = new Group();
  const geos: BufferGeometry[] = [];
  const mats: MeshStandardMaterial[] = [];
  const wheels: Wheel[] = [];
  const mat = (color: number, opts: { rough?: number; metal?: number } = {}) => {
    const m = new MeshStandardMaterial({ color, roughness: opts.rough ?? 0.6, metalness: opts.metal ?? 0.2 });
    mats.push(m);
    return m;
  };
  const add = (geo: BufferGeometry, material: MeshStandardMaterial, x: number, y: number, z: number, rot?: { x?: number; y?: number; z?: number }) => {
    const m = new Mesh(geo, material);
    m.position.set(x, y, z);
    if (rot) m.rotation.set(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0);
    root.add(m);
    geos.push(geo);
    return m;
  };
  /** A wheel at (x,y,z): axle baked along x, so update() spins it with mesh.rotation.x. `roll` is the
   *  rolling radius used for the spin rate (pass the tyre radius for coaxial rims/hubs). */
  const wheel = (radius: number, width: number, segments: number, material: MeshStandardMaterial, x: number, y: number, z: number, roll = radius) => {
    const geo = new CylinderGeometry(radius, radius, width, segments);
    geo.rotateZ(Math.PI / 2); // axle Y -> x, so the wheel reads side-on and mesh.rotation.x rolls it
    const m = new Mesh(geo, material);
    m.position.set(x, y, z);
    root.add(m);
    geos.push(geo);
    wheels.push({ mesh: m, roll });
    return m;
  };
  const finish = (): RideMesh => ({
    root,
    wheels,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  });
  return { add, mat, wheel, finish };
}

/** Kick-scooter: grip deck, T-stem, handlebar, two small wheels. */
function buildScooter(): RideMesh {
  const b = rideBuilder();
  const frame = b.mat(0x2b6cb0, { rough: 0.5, metal: 0.3 });
  const deck = b.mat(0x333842, { rough: 0.8 });
  const rubber = b.mat(0x1a1a1a, { rough: 0.9 });
  b.add(new BoxGeometry(0.17, 0.05, 0.72), deck, 0, 0.12, 0);     // deck
  b.add(new BoxGeometry(0.05, 0.9, 0.05), frame, 0, 0.56, 0.34);  // T-stem (front)
  b.add(new BoxGeometry(0.44, 0.05, 0.05), frame, 0, 1.0, 0.34);  // handlebar
  b.add(new BoxGeometry(0.07, 0.07, 0.1), frame, 0, 0.99, 0.3);   // stem clamp
  b.wheel(0.11, 0.06, 16, rubber, 0, 0.11, 0.34);                 // front wheel
  b.wheel(0.11, 0.06, 16, rubber, 0, 0.11, -0.34);                // back wheel
  return b.finish();
}

/** Skateboard: maple deck with grip top, two trucks, four small wheels. */
function buildSkateboard(): RideMesh {
  const b = rideBuilder();
  const deck = b.mat(0x7a4a24, { rough: 0.85 });
  const grip = b.mat(0x202024, { rough: 0.95 });
  const truck = b.mat(0x9a9aa0, { rough: 0.4, metal: 0.7 });
  const rubber = b.mat(0x151515, { rough: 0.9 });
  b.add(new BoxGeometry(0.22, 0.035, 0.82), deck, 0, 0.095, 0);  // deck
  b.add(new BoxGeometry(0.22, 0.012, 0.82), grip, 0, 0.117, 0);  // grip tape
  for (const z of [0.3, -0.3]) {
    b.add(new BoxGeometry(0.2, 0.03, 0.05), truck, 0, 0.06, z);  // axle bar
    b.wheel(0.05, 0.045, 14, rubber, 0.11, 0.05, z);
    b.wheel(0.05, 0.045, 14, rubber, -0.11, 0.05, z);
  }
  return b.finish();
}

/** E-bike: two spoke-rim wheels, a tubed frame, seat, handlebar and the tell-tale battery pack. */
function buildEbike(): RideMesh {
  const b = rideBuilder();
  const frame = b.mat(0x1f7a5a, { rough: 0.45, metal: 0.4 });
  const rubber = b.mat(0x161616, { rough: 0.9 });
  const rim = b.mat(0x8a8a90, { rough: 0.4, metal: 0.6 });
  const seat = b.mat(0x202024, { rough: 0.8 });
  const battery = b.mat(0x303036, { rough: 0.6, metal: 0.3 });
  for (const z of [0.52, -0.52]) {
    b.wheel(0.27, 0.05, 20, rubber, 0, 0.27, z);        // tyre
    b.wheel(0.17, 0.056, 16, rim, 0, 0.27, z, 0.27);    // rim (spins at the tyre's rate)
  }
  b.add(new BoxGeometry(0.05, 0.05, 0.9), frame, 0, 0.5, 0.05);           // top tube
  b.add(new BoxGeometry(0.05, 0.5, 0.05), frame, 0, 0.55, -0.2, { x: 0.15 }); // seat tube
  b.add(new BoxGeometry(0.08, 0.05, 0.7), frame, 0, 0.33, 0.1);           // down tube
  b.add(new BoxGeometry(0.11, 0.2, 0.34), battery, 0, 0.42, 0.08);        // battery pack
  b.add(new BoxGeometry(0.04, 0.3, 0.04), frame, 0, 0.64, -0.26);         // seat post
  b.add(new BoxGeometry(0.13, 0.05, 0.26), seat, 0, 0.78, -0.28);         // saddle
  b.add(new BoxGeometry(0.05, 0.55, 0.05), frame, 0, 0.55, 0.5, { x: -0.2 }); // head/fork
  b.add(new BoxGeometry(0.42, 0.05, 0.05), frame, 0, 0.85, 0.5);          // handlebar
  return b.finish();
}

/** Onewheel: one fat central tyre with a split foot-pad board straddling it. */
function buildOnewheel(): RideMesh {
  const b = rideBuilder();
  const board = b.mat(0x2d2d33, { rough: 0.7 });
  const pad = b.mat(0xb08030, { rough: 0.85 });
  const tyre = b.mat(0x111111, { rough: 0.95 });
  const hub = b.mat(0x9a9aa0, { rough: 0.4, metal: 0.6 });
  b.wheel(0.19, 0.24, 20, tyre, 0, 0.19, 0);        // fat central tyre
  b.wheel(0.08, 0.26, 14, hub, 0, 0.19, 0, 0.19);   // hub/motor (spins with the tyre)
  for (const z of [0.26, -0.26]) {
    b.add(new BoxGeometry(0.28, 0.05, 0.34), board, 0, 0.31, z);    // foot board
    b.add(new BoxGeometry(0.26, 0.015, 0.2), pad, 0, 0.335, z);     // grip pad
  }
  return b.finish();
}

/** Segway (parody): footboard, two side wheels, vertical stem and a T-handlebar. */
function buildSegway(): RideMesh {
  const b = rideBuilder();
  const body = b.mat(0xdedee4, { rough: 0.4, metal: 0.3 });
  const stem = b.mat(0x3a3a42, { rough: 0.5, metal: 0.3 });
  const tyre = b.mat(0x141414, { rough: 0.95 });
  const hub = b.mat(0x9a9aa0, { rough: 0.4, metal: 0.6 });
  b.add(new BoxGeometry(0.34, 0.07, 0.34), body, 0, 0.17, 0);  // footboard
  for (const x of [0.26, -0.26]) {
    b.wheel(0.2, 0.08, 20, tyre, x, 0.2, 0);        // side wheel
    b.wheel(0.09, 0.085, 14, hub, x, 0.2, 0, 0.2);  // hub (spins with the wheel)
  }
  b.add(new BoxGeometry(0.06, 1.0, 0.06), stem, 0, 0.68, 0);   // vertical stem
  b.add(new BoxGeometry(0.4, 0.05, 0.05), stem, 0, 1.16, 0);   // T-handlebar
  b.add(new BoxGeometry(0.06, 0.08, 0.14), body, 0, 1.12, 0);  // control knob
  return b.finish();
}

function buildRide(id: RideId): RideMesh {
  switch (id) {
    case 'scooter': return buildScooter();
    case 'skateboard': return buildSkateboard();
    case 'ebike': return buildEbike();
    case 'onewheel': return buildOnewheel();
    case 'segway': return buildSegway();
  }
}

export function createRideSystem(scene: Object3D): RideSystem {
  // One container holds every ride mesh (only the mounted one is visible); the scene gains a single
  // child that update() parks under the avatar and destroy() removes cleanly.
  const container = new Group();
  container.name = 'personal-ride';
  const meshes = new Map<RideId, RideMesh>();
  for (const r of PERSONAL_RIDES) {
    const m = buildRide(r.id);
    m.root.name = r.id;
    m.root.visible = false;
    container.add(m.root);
    meshes.set(r.id, m);
  }
  scene.add(container);
  let mounted = false;
  let ride: PersonalRide | null = null;
  let lastFoot: { x: number; z: number } | null = null; // for wheel-spin distance; reset on (dis)mount
  const active = (): RideMesh | null => (ride ? meshes.get(ride.id) ?? null : null);
  const hideAll = () => { for (const m of meshes.values()) m.root.visible = false; };
  const syncRound = (round: Pick<FundingRound, 'id'>) => {
    if (!mounted) return;
    const next = fastestUnlockedRide(round);
    if (ride?.id === next.id) return;
    const previous = active();
    ride = next;
    const replacement = active()!;
    if (previous) {
      replacement.root.position.copy(previous.root.position);
      replacement.root.quaternion.copy(previous.root.quaternion);
    }
    hideAll();
    replacement.root.visible = true;
  };
  return {
    get mounted() { return mounted; },
    get ride() { return ride; },
    toggle(round) {
      mounted = !mounted;
      ride = mounted ? fastestUnlockedRide(round) : null;
      lastFoot = null;
      hideAll();
      const m = active();
      if (m) m.root.visible = mounted;
    },
    dismount() { mounted = false; ride = null; lastFoot = null; hideAll(); },
    syncRound,
    mountSpeed(round) { syncRound(round); return mounted ? ride!.speedMps : 0; },
    availableLabel(round) { return fastestUnlockedRide(round).label; },
    update(foot) {
      // gtasf-c8sj: unmounted ride meshes are hidden; skip their per-frame matrix walk.
      if (flags.hiddenFleetMatrixSkip) for (const r of meshes.values()) r.root.matrixWorldAutoUpdate = r.root.visible;
      if (!mounted) return;
      const m = active();
      if (!m) return;
      m.root.position.set(foot.x, foot.y, foot.z);
      m.root.rotation.y = foot.yaw;
      if (lastFoot) {
        const dist = Math.hypot(foot.x - lastFoot.x, foot.z - lastFoot.z);
        if (dist > 0) for (const w of m.wheels) w.mesh.rotation.x += dist / w.roll;
      }
      lastFoot = { x: foot.x, z: foot.z };
    },
    destroy() {
      scene.remove(container);
      for (const m of meshes.values()) m.dispose();
      meshes.clear();
    },
  };
}
