// GTA V pivot — LANE B (critic R4: "pickups are emoji in a green tube"): small 3D models that spin over the pickup aura,
// GTA style. A medkit (white case, red cross both sides), a body-armour vest, and the weapons reuse lane D's procedural
// weapon models (avatar/heldWeapon.ts), scaled up and brightened so they read at night. Lambert + a little emissive:
// cheap on phone Low and never a black silhouette after dark.
import * as THREE from 'three';
import type { WeaponId } from '@gtasf/shared/combat/weapons';
import { buildWeaponModel } from '../avatar/heldWeapon';

const lit = (color: number, glow = 0.35) => new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: glow });

export function medkitModel(): THREE.Group {
  const g = new THREE.Group(); g.name = 'Pickup medkit';
  const white = lit(0xf2f2ee, 0.3), red = lit(0xe8101a, 1.0), grey = lit(0x8b8f94, 0.2);
  red.toneMapped = false; // a saturated first-aid red (vitalPickups also draws the model after the aura so it isn't tinted)
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.2), white));                        // case
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.06), grey); handle.position.y = 0.2; g.add(handle);
  for (const z of [0.101, -0.101]) {                                                          // red cross, both faces
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, 0.004), red); v.position.z = z;
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.004), red); h.position.z = z;
    g.add(v, h);
  }
  // R4 look check (docs/sf-data/combat/pickups): at 0.5 m the case was a pale speck inside the ~1 m aura and read worse
  // than the old heart emoji. 1.7x makes it fill the tube like GTA's pickups.
  g.scale.setScalar(1.7);
  return g;
}

export function vestModel(): THREE.Group {
  const g = new THREE.Group(); g.name = 'Pickup armour vest';
  // Charcoal, not navy: a navy vest vanished into the blue armour aura (look check docs/sf-data/combat/pickups/vest-*.jpg).
  const navy = lit(0x2e3138, 0.3), plate = lit(0xc9d6ea, 0.55), strap = lit(0xb8a46a, 0.35);
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.52, 0.16), navy));                       // torso
  for (const x of [-0.14, 0.14]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.12), navy); s.position.set(x, 0.32, 0); g.add(s); } // shoulders
  for (const z of [0.085, -0.085]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.02), plate); p.position.set(0, 0.04, z); g.add(p); } // plates, both faces (it spins)
  for (const y of [-0.12, -0.2]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.035, 0.17), strap); b.position.y = y; g.add(b); } // straps
  g.scale.setScalar(1.5); // as the medkit: fill the aura (R4 look check)
  return g;
}

const brightened = new Map<THREE.Material, THREE.Material>();
/** A weapon pickup model: lane D's held weapon, 3x scale, materials swapped for brighter emissive copies (shared ones are
 *  untouched). Melee 'fists' has no model. */
export function weaponPickupModel(id: WeaponId): THREE.Group | null {
  if (id === 'fists') return null;
  const g = buildWeaponModel(id);
  g.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    const original = o.material as THREE.MeshLambertMaterial;
    let copy = brightened.get(original);
    if (!copy) {
      const c = original.color.clone().lerp(new THREE.Color(0xffffff), 0.25);
      copy = lit(c.getHex(), 0.45); brightened.set(original, copy);
    }
    o.material = copy;
  });
  // Fit the aura and stay readable: the longest side (the barrel/bat along +z) becomes 1.0 m, and the cross-section is up to 2.4x
  // that scale, a chunky stylised pickup. A fixed 3x made the bat ~2.5 m and it poked out of the tube; a uniform 0.7 m made it a
  // thin speck that vanished edge-on (in-game captures, docs/sf-data/combat/pickup-models-*).
  const box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  const k = 1.0 / Math.max(size.x, size.y, size.z, 1e-3), thick = Math.min(2.4, 0.85 / Math.max(size.x * k, size.y * k, 1e-3));
  for (const child of g.children) child.position.sub(centre);
  const holder = new THREE.Group(); holder.name = `Pickup ${id}`; holder.add(g);
  g.scale.set(k * thick, k * thick, k); g.position.set(0, 0, 0);
  // Stand it up diagonally (long axis ~63 deg above horizontal, GTA style): spinning about Y it can then never turn end-on to the
  // camera. Lying nearly flat, the third capture's bat shrank to a dot whenever it pointed at the lens.
  holder.rotation.x = -1.1;
  return holder;
}

/** Free a pickup model's geometries (+ its own materials for the medkit/vest). Weapon material copies are cached and shared. */
export function disposePickupModel(model: THREE.Object3D, ownMaterials: boolean): void {
  model.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return; // (weapon pickups: the model is nested in a holder group)
    o.geometry.dispose();
    if (ownMaterials) (o.material as THREE.Material).dispose();
  });
}
