/**
 * weaponPoses (lane D, GTA V critic #7 "shooting has no body"): the equipped weapon in the avatar's hands and an aim pose.
 *
 * Meshes are procedural low-poly (pistol, SMG, rifle, bat: several shaped parts with metal/polymer/wood materials, zero
 * download bytes, built once per page). The aim pose is two-bone IK on the arms, applied after the mixer each frame, so it
 * layers over walk/idle legs and works on any rig with the hoodie bone names (hoodie, CC0 and Meshy bodies all have
 * UpperArm/LowerArm/Wrist .L/.R). Pistol: both hands meet at a grip point ahead of the chest. SMG/rifle: right hand at
 * the grip, left hand on the foregrip. Bat: carried along the right forearm. Local only (never on the wire).
 */
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial, Object3D, Quaternion, Vector3, type BufferGeometry } from 'three';
import type { WeaponId } from '@gtasf/shared/combat/weapons';

type Held = Exclude<WeaponId, 'fists'>;
const METAL = new MeshLambertMaterial({ color: 0x1f2226, name: 'Weapon metal' });
const POLYMER = new MeshLambertMaterial({ color: 0x2c2e2b, name: 'Weapon polymer' });
const STEEL = new MeshLambertMaterial({ color: 0x4a4f55, name: 'Weapon steel' });
const TAN = new MeshLambertMaterial({ color: 0x8a7a5c, name: 'Weapon furniture' });
const WOOD = new MeshLambertMaterial({ color: 0xa8784a, name: 'Bat ash' });
const TAPE = new MeshLambertMaterial({ color: 0x1b1b1d, name: 'Bat grip tape' });

/** One part: a geometry placed in weapon space (origin at the grip, barrel along +z, up +y), metres. */
function part(geometry: BufferGeometry, material: MeshLambertMaterial, x: number, y: number, z: number, tiltX = 0): Mesh {
  const mesh = new Mesh(geometry, material); mesh.position.set(x, y, z); mesh.rotation.x = tiltX;
  mesh.castShadow = false; mesh.receiveShadow = false; return mesh;
}
const barrel = (radius: number, length: number) => new CylinderGeometry(radius, radius, length, 8).rotateX(Math.PI / 2);

/** Lane B (critic R4): the same procedural weapon model, exported for the world pickups (a fresh Group each call). */
export function buildWeaponModel(id: Held): Group { return build(id); }
function build(id: Held): Group {
  const g = new Group(); g.name = `Held ${id}`;
  if (id === 'pistol') {
    g.add(part(new BoxGeometry(.032, .034, .19), STEEL, 0, .062, .055));          // slide
    g.add(part(new BoxGeometry(.03, .022, .15), METAL, 0, .036, .045));           // frame
    g.add(part(new BoxGeometry(.029, .105, .042), POLYMER, 0, -.012, -.012, -.26)); // grip, raked back
    g.add(part(new BoxGeometry(.006, .03, .04), METAL, 0, .012, .03));            // trigger guard
    g.add(part(barrel(.007, .02), METAL, 0, .066, .155));                         // muzzle
  } else if (id === 'smg') {
    g.add(part(new BoxGeometry(.045, .07, .3), METAL, 0, .05, .08));              // receiver
    g.add(part(new BoxGeometry(.03, .16, .04), POLYMER, 0, -.03, .12, .12));      // magazine
    g.add(part(new BoxGeometry(.03, .09, .04), POLYMER, 0, -.01, -.01, -.3));     // pistol grip
    g.add(part(barrel(.011, .09), STEEL, 0, .06, .27));                           // barrel
    g.add(part(new BoxGeometry(.012, .012, .2), STEEL, 0, .06, -.15));            // wire stock
    g.add(part(new BoxGeometry(.04, .06, .015), POLYMER, 0, .045, -.25));         // butt plate
  } else if (id === 'rifle') {
    g.add(part(new BoxGeometry(.05, .08, .42), METAL, 0, .055, .12));             // receiver
    g.add(part(new BoxGeometry(.055, .065, .22), TAN, 0, .05, .42));              // handguard
    g.add(part(barrel(.009, .26), STEEL, 0, .06, .66));                           // barrel
    g.add(part(new BoxGeometry(.032, .17, .055), METAL, 0, -.04, .16, .22));      // curved-ish magazine
    g.add(part(new BoxGeometry(.03, .09, .04), TAN, 0, -.01, -.005, -.3));        // pistol grip
    g.add(part(new BoxGeometry(.045, .095, .26), TAN, 0, .035, -.21));            // stock
    g.add(part(new BoxGeometry(.02, .03, .1), METAL, 0, .11, .13));               // optic rail/sight
  } else {
    g.add(part(new CylinderGeometry(.034, .017, .66, 10).rotateX(Math.PI / 2), WOOD, 0, 0, .43)); // barrel of the bat
    g.add(part(new CylinderGeometry(.017, .017, .16, 8).rotateX(Math.PI / 2), TAPE, 0, 0, .04));  // taped handle
    g.add(part(new CylinderGeometry(.024, .024, .015, 8).rotateX(Math.PI / 2), WOOD, 0, 0, -.045)); // knob
  }
  return g;
}

const v = { s: new Vector3(), e: new Vector3(), w: new Vector3(), t: new Vector3(), d: new Vector3(), p: new Vector3(), a: new Vector3(), b: new Vector3() };
const q = { r: new Quaternion(), world: new Quaternion(), parent: new Quaternion(), local: new Quaternion() };
/** Rotate `bone` (in world space) so its child direction `from` turns to `to`, blended by `weight`. */
function turn(bone: Object3D, from: Vector3, to: Vector3, weight: number): void {
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  q.r.setFromUnitVectors(from.normalize(), to.normalize());
  bone.getWorldQuaternion(q.world); q.world.premultiply(q.r);
  if (bone.parent) { bone.parent.getWorldQuaternion(q.parent); q.local.copy(q.parent).invert().multiply(q.world); } else q.local.copy(q.world);
  bone.quaternion.slerp(q.local, weight); bone.updateMatrixWorld(true);
}
/** Two-bone IK: put `wrist` at `target`, elbow bending toward `pole` (a world direction). */
function reach(upper: Object3D, lower: Object3D, wrist: Object3D, target: Vector3, pole: Vector3, weight: number): void {
  upper.getWorldPosition(v.s); lower.getWorldPosition(v.e); wrist.getWorldPosition(v.w);
  const a = v.s.distanceTo(v.e), b = v.e.distanceTo(v.w); if (a < 1e-4 || b < 1e-4) return;
  v.d.subVectors(target, v.s); const dist = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, v.d.length())); v.d.normalize();
  const along = (a * a - b * b + dist * dist) / (2 * dist), out = Math.sqrt(Math.max(0, a * a - along * along));
  v.p.copy(pole).addScaledVector(v.d, -pole.dot(v.d)); if (v.p.lengthSq() < 1e-8) v.p.set(0, -1, 0); v.p.normalize();
  const elbow = v.a.copy(v.s).addScaledVector(v.d, along).addScaledVector(v.p, out);
  turn(upper, v.b.subVectors(v.e, v.s), v.t.subVectors(elbow, v.s), weight);
  lower.getWorldPosition(v.e); wrist.getWorldPosition(v.w);
  turn(lower, v.b.subVectors(v.w, v.e), v.t.subVectors(target, v.e), weight);
}

/** Held weapon scale (gtasf-fni0u: true size vanished into the torso from the chase cam). */
const HELD_SCALE = 1.3;
/** Radians the wrists roll toward the grip while aiming (picked from a showroom sweep). */
const WRIST_ROLL = 1.6;
const rollAxis = new Vector3(), rollQ = new Quaternion();
function rollWrist(lower: Object3D, wrist: Object3D, angle: number): void {
  if (!angle) return;
  lower.getWorldPosition(v.e); wrist.getWorldPosition(v.w); rollAxis.subVectors(v.w, v.e); if (rollAxis.lengthSq() < 1e-10) return;
  rollAxis.normalize(); rollQ.setFromAxisAngle(rollAxis, angle);
  wrist.getWorldQuaternion(q.world); q.world.premultiply(rollQ);
  if (wrist.parent) { wrist.parent.getWorldQuaternion(q.parent); wrist.quaternion.copy(q.parent.invert().multiply(q.world)); } else wrist.quaternion.copy(q.world);
  wrist.updateMatrixWorld(true);
}

export interface HeldWeapon {
  /** Per frame, AFTER the avatar's mixer update: `id` null/fists hides the weapon; `aim` 0..1 blends the aim pose;
   *  `pitch` is the aim elevation in radians (camera pitch); `swing` 0..1 is the phase of a melee attack in progress
   *  (fists: a right jab; bat: a two-handed sweep across the front), anything else = no swing (flag meleeSwing). */
  update(id: WeaponId | null, aim: number, pitch: number, swing?: number): void;
  dispose(): void;
}

/** Attach to an avatar root (the object whose descendants are the rig's bones; the root's yaw is the body facing). */
export function createHeldWeapon(root: Object3D): HeldWeapon {
  const meshes = new Map<Held, Group>(), holder = new Group(); holder.name = 'Held weapon'; root.add(holder);
  // Critic gtasf-fni0u: at chase-cam distance a true-size gun was a dark blob inside the torso; 1.3x reads as a weapon.
  holder.scale.setScalar(HELD_SCALE);
  const bones: Record<string, Object3D | undefined> = {};
  const bone = (name: string) => {
    let found = bones[name];
    if (!found || !isDescendant(found, root)) { found = root.getObjectByName(name) ?? root.getObjectByName(name.replace('.', '')); bones[name] = found; }
    return found;
  };
  const fwd = new Vector3(), up = new Vector3(0, 1, 0), right = new Vector3(), aimDir = new Vector3(), mid = new Vector3(), tR = new Vector3(), tL = new Vector3();
  const poleR = new Vector3(), poleL = new Vector3(), look = new Quaternion(), zAxis = new Vector3(0, 0, 1), sl = new Vector3(), sr = new Vector3();
  const swingDir = new Vector3();
  let shown: Held | null = null;
  return {
    update(id, aim, pitch, swing = -1) {
      root.userData.heldWeapon = { id, aim: +aim.toFixed(2), pitch: +pitch.toFixed(2) }; // last inputs, for in-game evidence probes
      const held = id && id !== 'fists' ? id : null;
      if (held !== shown) {
        holder.clear(); shown = held;
        if (held) { let mesh = meshes.get(held); if (!mesh) { mesh = build(held); meshes.set(held, mesh); } holder.add(mesh); }
      }
      holder.visible = Boolean(held) && root.visible;
      // Melee swing (critique: "melee is a whoosh with no swing animation"): fists have no mesh but still throw the arm.
      const s = swing >= 0 && swing < 1 && (held === 'bat' || id === 'fists') ? swing : -1;
      const env = s < 0 ? 0 : held === 'bat' ? Math.min(1, s * 5, (1 - s) * 3) : s < .35 ? s / .35 : (1 - s) / .65;
      if ((!held && env <= 0) || !root.visible) return;
      const uR = bone('UpperArm.R'), lR = bone('LowerArm.R'), wR = bone('Wrist.R'), uL = bone('UpperArm.L'), lL = bone('LowerArm.L'), wL = bone('Wrist.L');
      if (!uR || !lR || !wR) { holder.visible = false; return; }
      if (!held) { // fists jab: right fist straight out at shoulder height, elbow down and out
        root.updateMatrixWorld(true);
        fwd.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(look)).setY(0).normalize();
        right.crossVectors(fwd, up).normalize(); uR.getWorldPosition(mid);
        if (uL) { uL.getWorldPosition(sl); right.subVectors(mid, sl).setY(0).normalize(); }
        tR.copy(mid).addScaledVector(fwd, .58).addScaledVector(right, -.08).addScaledVector(up, .02);
        poleR.copy(right).multiplyScalar(.6).addScaledVector(up, -1);
        reach(uR, lR, wR, tR, poleR, env);
        return;
      }
      root.updateMatrixWorld(true);
      fwd.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(look)).setY(0).normalize();
      if (uL) { uR.getWorldPosition(sr); uL.getWorldPosition(sl); right.subVectors(sr, sl).setY(0).normalize(); mid.addVectors(sr, sl).multiplyScalar(.5); }
      else { right.crossVectors(fwd, up).normalize(); uR.getWorldPosition(mid); }
      const w = held === 'bat' ? 0 : Math.max(0, Math.min(1, aim));
      const p = Math.max(-1, Math.min(1, pitch));
      aimDir.copy(fwd).multiplyScalar(Math.cos(p)).addScaledVector(up, Math.sin(p));
      if (w > 0) {
        if (held === 'pistol') { // both hands meet at a grip point at arm's length ahead of the chest
          tR.copy(mid).addScaledVector(aimDir, .54).addScaledVector(up, -.05).addScaledVector(right, .02); // near-full extension: forearms + gun clear the body
          tL.copy(tR).addScaledVector(right, -.035).addScaledVector(up, -.02);
          poleR.copy(right).multiplyScalar(.7).addScaledVector(up, -1); poleL.copy(right).multiplyScalar(-.7).addScaledVector(up, -1);
        } else { // long gun: stock in the right shoulder, right hand on the grip, left hand forward on the foregrip
          tR.copy(mid).addScaledVector(right, .13).addScaledVector(aimDir, .2).addScaledVector(up, -.1);
          tL.copy(mid).addScaledVector(right, .03).addScaledVector(aimDir, held === 'smg' ? .42 : .52).addScaledVector(up, -.08);
          poleR.copy(right).addScaledVector(up, -.8); poleL.copy(right).multiplyScalar(-.4).addScaledVector(up, -1);
        }
        reach(uR, lR, wR, tR, poleR, w);
        if (uL && lL && wL) reach(uL, lL, wL, tL, poleL, w);
        // Grip roll: the IK sets arm direction, not forearm twist, so the open hands faced palm-up. Roll each wrist about
        // its forearm axis so the palms face the grip (inward); mirrored for the left hand.
        const roll = (globalThis as { __gtasfWristRoll?: number }).__gtasfWristRoll ?? WRIST_ROLL;
        rollWrist(lR, wR, roll * w);
        if (lL && wL) rollWrist(lL, wL, -roll * w);
      }
      if (held === 'bat' && env > 0) { // bat sweep: hands travel an arc from the right shoulder, across the front, to the left
        const e = s * s * (3 - 2 * s), theta = 1.25 - 2.65 * e; // radians from straight ahead; + = to the player's right
        swingDir.copy(fwd).multiplyScalar(Math.cos(theta)).addScaledVector(right, Math.sin(theta));
        tR.copy(mid).addScaledVector(swingDir, .5).addScaledVector(up, -.02 + .12 * (1 - e));
        tL.copy(tR).addScaledVector(up, -.07).addScaledVector(swingDir, -.04);
        poleR.copy(right).multiplyScalar(.5).addScaledVector(up, -1); poleL.copy(right).multiplyScalar(-.5).addScaledVector(up, -1);
        reach(uR, lR, wR, tR, poleR, env);
        if (uL && lL && wL) reach(uL, lL, wL, tL, poleL, env);
      }
      // Weapon at the right hand: barrel along the aim when aiming, along the forearm when lowered.
      wR.getWorldPosition(v.w); lR.getWorldPosition(v.e);
      v.d.subVectors(v.w, v.e).normalize();
      if (held === 'bat') v.d.negate().addScaledVector(up, .6).normalize(); // bat carried up, resting toward the shoulder
      v.t.copy(v.d).lerp(aimDir, w).normalize();
      if (held === 'bat' && env > 0) v.t.lerp(swingDir.addScaledVector(up, .12).normalize(), env).normalize(); // barrel out along the arc
      // Grip in the palm, ~7.5 cm past the wrist joint along the forearm (at the joint the gun hid behind the open hand).
      v.w.addScaledVector(v.b.subVectors(v.w, v.e).normalize(), .075);
      holder.parent!.worldToLocal(holder.position.copy(v.w));
      look.setFromUnitVectors(zAxis, v.t); holder.parent!.getWorldQuaternion(q.parent); holder.quaternion.copy(q.parent.invert().multiply(look));
    },
    dispose() {
      holder.removeFromParent();
      for (const mesh of meshes.values()) mesh.traverse(o => { if (o instanceof Mesh) o.geometry.dispose(); });
    },
  };
}
function isDescendant(node: Object3D, root: Object3D): boolean { for (let o: Object3D | null = node; o; o = o.parent) if (o === root) return true; return false; }

const reachPole = new Vector3();
/**
 * One-off arm reach for interactions (critic #11: car door handle, carjack grab): two-bone IK of the `side` arm so the
 * wrist lands on `target` (world), blended by `weight` 0..1, elbow bending down and out. Call after the avatar's mixer
 * update each frame. Returns false when the rig has no such arm. Rig-agnostic (hoodie/CC0/Meshy bone names).
 */
export function reachHand(root: Object3D, side: 'L' | 'R', target: Vector3, weight: number): boolean {
  const find = (name: string) => root.getObjectByName(`${name}.${side}`) ?? root.getObjectByName(`${name}${side}`);
  const upper = find('UpperArm'), lower = find('LowerArm'), wrist = find('Wrist');
  if (!upper || !lower || !wrist || weight <= 0) return Boolean(upper && lower && wrist);
  root.updateMatrixWorld(true);
  const other = root.getObjectByName(`UpperArm.${side === 'R' ? 'L' : 'R'}`) ?? root.getObjectByName(`UpperArm${side === 'R' ? 'L' : 'R'}`);
  upper.getWorldPosition(v.s); if (other) other.getWorldPosition(v.e); else v.e.copy(v.s);
  reachPole.subVectors(v.s, v.e).setY(0); if (reachPole.lengthSq() < 1e-6) reachPole.set(0, 0, 0); else reachPole.normalize();
  reachPole.multiplyScalar(.6).y -= 1; // elbow out to this side and down
  reach(upper, lower, wrist, target, reachPole, Math.min(1, weight));
  return true;
}
