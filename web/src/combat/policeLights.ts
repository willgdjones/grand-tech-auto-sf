/**
 * GTA V pivot — LANE B (combat & police): the SFPD light bar. Decoupled from the car renderer — it reads the
 * POLICE_FLAG on fleet cars (set server-side by WorldPolice) and overlays a flashing red/blue light bar on each,
 * so pursuit cars read as cops before lane A's real SFPD car art lands. Unlit (MeshBasic, toneMapped off) so the
 * colours stay bright on HD and Low (see memory: unlit-neon-signage). Pooled; no per-car-render coupling.
 */
import * as THREE from 'three';
import { POLICE_FLAG } from '@gtasf/shared/combat/police';

/** Minimal shape of a fleet car we read (matches web/src/game/fleet.ts FleetCar). */
interface FleetCarLike {
  data: { flags: number };
  model: { root: THREE.Object3D };
}

interface Bar { group: THREE.Group; red: THREE.Mesh; blue: THREE.Mesh }

const ROOF_Y = 1.45;      // metres above the car origin (placeholder roof height)
const FLASH_MS = 240;     // half-period of the red/blue alternation
const BRIGHT_RED = 0xff2a2a, DIM_RED = 0x3a0606;
const BRIGHT_BLUE = 0x2a5aff, DIM_BLUE = 0x060a3a;

export interface PoliceLights {
  update(cars: Iterable<FleetCarLike>, nowMs: number): void;
  dispose(): void;
}

/** Top of a body in its vehicle root's LOCAL frame, from geometry bounds and local matrices only. World matrices can be stale
 *  here: vehicle nodes are frozen (matrixAutoUpdate off) and a hidden LOD level isn't re-rendered (a world-space box read
 *  -68 m and 2.29 m for the same Subaru). Null when the body has no geometry yet. */
function localTopY(body: THREE.Object3D, root: THREE.Object3D): number | null {
  let top = -Infinity; const m = new THREE.Matrix4(), v = new THREE.Vector3();
  body.traverse(o => {
    const mesh = o as THREE.Mesh; if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const b = mesh.geometry.boundingBox!; m.copy(mesh.matrix);
    for (let p = mesh.parent; p && p !== root; p = p.parent) m.premultiply(p.matrix);
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) top = Math.max(top, v.set(x, y, z).applyMatrix4(m).y);
  });
  return Number.isFinite(top) ? top : null;
}

export function createPoliceLights(scene: THREE.Scene): PoliceLights {
  const pool: Bar[] = [];
  // N38 (critic, lane E's prod frames): the bar never showed. It was 0.64 m wide and sat at the 1.45 m placeholder, INSIDE
  // the SFPD SUV's roof (that model never set policeBarY). Now ~1.2 m across, a real bar's proportions.
  const geom = new THREE.BoxGeometry(0.56, 0.14, 0.3);

  function makeBar(): Bar {
    const group = new THREE.Group();
    const red = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: BRIGHT_RED, toneMapped: false }));
    red.position.x = -0.3;
    const blue = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: BRIGHT_BLUE, toneMapped: false }));
    blue.position.x = 0.3;
    group.add(red, blue);
    group.visible = false;
    group.frustumCulled = false;
    scene.add(group);
    const bar: Bar = { group, red, blue };
    pool.push(bar);
    return bar;
  }

  return {
    update(cars: Iterable<FleetCarLike>, nowMs: number): void {
      const phase = Math.floor(nowMs / FLASH_MS) % 2 === 0; // red on / blue on, alternating
      let i = 0;
      for (const car of cars) {
        if (!(car.data.flags & POLICE_FLAG)) continue;
        // Lane A's police art (policeAir.ts) sets its roof height, or null when it carries its own strobes (heli).
        let roofY = car.model.root.userData.policeBarY as number | null | undefined;
        if (roofY === null) continue;
        if (roofY === undefined) { // a model that didn't declare its roof: measure the BODY once (the LOD's near level; the root
          // also holds the blob shadow and anything a night pass hangs on it, which read 2.35 m on a ~1.6 m Subaru roof)
          const lod = car.model.root.children.find(c => (c as { levels?: unknown }).levels) as { levels: { object: THREE.Object3D }[] } | undefined;
          const top = lod?.levels[0] ? localTopY(lod.levels[0].object, car.model.root) : null;
          if (top === null) roofY = ROOF_Y; // not built yet: placeholder this frame, measure again next frame (don't cache)
          else { roofY = top + 0.06; car.model.root.userData.policeBarY = roofY; }
        }
        const bar = pool[i] ?? makeBar();
        bar.group.visible = true;
        bar.group.position.copy(car.model.root.position);
        bar.group.position.y += roofY ?? ROOF_Y;
        bar.group.rotation.y = car.model.root.rotation.y;
        (bar.red.material as THREE.MeshBasicMaterial).color.setHex(phase ? BRIGHT_RED : DIM_RED);
        (bar.blue.material as THREE.MeshBasicMaterial).color.setHex(phase ? DIM_BLUE : BRIGHT_BLUE);
        i++;
      }
      for (; i < pool.length; i++) pool[i]!.group.visible = false;
    },
    dispose(): void {
      for (const bar of pool) {
        scene.remove(bar.group);
        (bar.red.material as THREE.Material).dispose();
        (bar.blue.material as THREE.Material).dispose();
      }
      pool.length = 0;
      geom.dispose();
    },
  };
}
