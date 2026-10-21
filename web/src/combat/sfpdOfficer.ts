import { Box3, BoxGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial, Object3D } from 'three';
import { defaultAppearance, resolveLook, type ResolvedLook } from '@gtasf/shared/content/cosmetics';
import type { AvatarInstance, AvatarTemplate } from '../avatar/riggedAvatar';
import { meshyOfficerTemplate } from '../avatar/people';

// SFPD officer look (GTA-pivot lane A #2, reworked per founder look review): the current rigged avatar in a
// clearly NAVY uniform (not black), an eight-point-style patrol cap with a black visor + gold cap badge (not a
// baseball cap), a gold chest shield, a black duty belt, and the face/hands skin left untouched. The base look
// uses accessory 4 so the hair hides and a cap base is built in the right head frame; we then recolour the
// uniform to a brighter police navy and overlay the visor/badge/belt. Applied with forceLook so it renders
// regardless of the (networked) characterLooks gate — these are local, non-networked peds.

// A visible police navy, brighter than the palette's near-black "Ink" (0x262b35) so it reads as navy, not black.
const SFPD_NAVY = 0x2a3a6e;
const INK = 0x262b35; // the clothColours[4] tint the base look paints the uniform + cap dome with.
const CAP_BLACK = 0x0c0e14, GOLD = 0xe6c34f;

/** A ResolvedLook for an SFPD officer: navy formal outfit variant + patrol cap base. */
export function sfpdOfficerLook(): ResolvedLook {
  return resolveLook({ ...defaultAppearance('male', 'growth'), outfit: 4, accessory: 4 });
}

/** Repaint the uniform fabric (torso shirt + garment + cap dome) from near-black Ink to a clear police navy. */
function navyUniform(avatar: AvatarInstance): void {
  avatar.root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const mats = Array.isArray(object.material) ? object.material : [object.material];
    for (const m of mats) {
      const mat = m as MeshLambertMaterial;
      if (!mat.color) continue;
      // Leave face/hands skin alone; recolour only the uniform fabric (named 'Purple' or painted the Ink tint).
      if (mat.name === 'Skin' && !/Legs/i.test(object.name)) continue;
      if (mat.name === 'Purple' || mat.color.getHex() === INK) mat.color.setHex(SFPD_NAVY);
    }
  });
}

/** Recolour the bare-leg / shorts materials to navy so the lower body reads as uniform trousers. */
function navyLegs(avatar: AvatarInstance): void {
  avatar.root.traverse(o => {
    if (!(o instanceof Mesh) || !/leg|short|pant|thigh|calf/i.test(o.name)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) if ((m as MeshLambertMaterial).color) (m as MeshLambertMaterial).color.setHex(SFPD_NAVY);
  });
}

/**
 * Replace the base rounded baseball-cap dome with a STRUCTURED peaked service cap so it reads as police, not a
 * baseball cap (founder look review, lane A #3): hide the dome and build a flat-topped navy crown (gentle
 * service-cap flare), a black hatband, a flat forward peak at brow level, and a gold cap badge. The rebuilt cap
 * is attached as a SIBLING of the hidden cap bone (sharing its TRS), so hiding the dome can't hide the new cap.
 */
function patrolCap(avatar: AvatarInstance): void {
  let cap: Object3D | undefined;
  avatar.root.traverse(o => { if (!cap && o.name === 'cap') cap = o; });
  if (!cap || !cap.parent) return;
  // The cap's merged geometry is baked in the head-socket frame; union it to find its extent in local space.
  const box = new Box3();
  cap.traverse(o => { if (o instanceof Mesh) { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox!); } });
  if (box.isEmpty()) return;
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2, lowY = box.min.y;
  // Size everything RELATIVE to the baseball dome so proportions hold whatever the baked cap scale is.
  const r = (box.max.x - box.min.x) / 2, domeH = box.max.y - box.min.y;
  const bandH = domeH * 0.2, crownH = domeH * 0.5, bandY = lowY + bandH * 0.5;
  // Hide the rounded dome and rebuild a short, structured service cap as a SIBLING sharing the cap's exact head
  // frame (parenting to the now-hidden cap would hide it too, so we attach to the cap's parent and copy its TRS).
  // Drop the whole cap slightly so the band hugs the head instead of floating above the baked dome base.
  cap.visible = false;
  const navy = () => new MeshLambertMaterial({ color: SFPD_NAVY });
  const black = () => new MeshLambertMaterial({ color: CAP_BLACK });
  const built = new Group(); built.name = 'sfpd-peaked-cap';
  built.position.copy(cap.position); built.quaternion.copy(cap.quaternion); built.scale.copy(cap.scale);
  built.position.y -= domeH * 0.14;
  // Black hatband at the base.
  const band = new Mesh(new CylinderGeometry(r * 0.99, r * 1.02, bandH, 22), black());
  band.position.set(cx, bandY, cz); built.add(band);
  // Navy crown: straight sides with a gentle service-cap flare OUT to a flat top, rising from the band.
  const crown = new Mesh(new CylinderGeometry(r * 1.04, r * 0.99, crownH, 22), navy());
  crown.position.set(cx, bandY + bandH * 0.5 + crownH * 0.5, cz); built.add(crown);
  // Flat round top plate matching the flared crown edge.
  const top = new Mesh(new CylinderGeometry(r * 1.04, r * 1.04, domeH * 0.06, 22), navy());
  top.position.set(cx, bandY + bandH * 0.5 + crownH, cz); built.add(top);
  // Black forward peak: wide, flat, shallow, projecting beyond the front of the band at brow level, tilted down.
  const peak = new Mesh(new BoxGeometry(r * 1.95, domeH * 0.08, r * 1.25), black());
  peak.position.set(cx, bandY - domeH * 0.02, cz + r * 1.12); peak.rotation.x = 0.17; built.add(peak);
  // Gold cap badge on the front of the crown, above the band.
  const badge = new Mesh(new BoxGeometry(r * 0.28, crownH * 0.48, 0.012), new MeshLambertMaterial({ color: GOLD }));
  badge.position.set(cx, bandY + bandH * 0.5 + crownH * 0.42, cz + r * 1.0); built.add(badge);
  cap.parent.add(built);
}

/**
 * A gold shield badge on the left chest + a black duty belt with a gold buckle, in the appearance SOCKET frames
 * (`appearance-Chest` / `appearance-Hips`, metres, the garment batches' frame). Raw bones are not in metres, so
 * kit parented to them with metre offsets rendered inside the body (the shield + belt never showed).
 */
function addOfficerKit(avatar: AvatarInstance): void {
  const node = (name: string): Object3D | undefined => { let b: Object3D | undefined; avatar.root.traverse(o => { if (!b && o.name === name) b = o; }); return b; };
  const chest = node('appearance-Chest'), hips = node('appearance-Hips');
  if (chest) {
    const badge = new Mesh(new BoxGeometry(0.05, 0.06, 0.012), new MeshLambertMaterial({ color: GOLD }));
    badge.name = 'sfpd-badge'; badge.position.set(0.095, 0.05, 0.155);
    chest.add(badge);
  }
  if (hips) {
    const belt = new Group(); belt.name = 'sfpd-belt'; belt.position.set(0, 0.05, 0);
    const leather = new MeshLambertMaterial({ color: CAP_BLACK });
    const strap = new Mesh(new BoxGeometry(0.31, 0.045, 0.23), leather);
    const buckle = new Mesh(new BoxGeometry(0.042, 0.034, 0.012), new MeshLambertMaterial({ color: GOLD }));
    buckle.position.set(0, 0, 0.12);
    const holster = new Mesh(new BoxGeometry(0.045, 0.12, 0.08), leather); // sidearm on the wearer's right hip
    holster.position.set(-0.165, -0.045, 0.02);
    belt.add(strap, buckle, holster);
    hips.add(belt);
  }
}

/**
 * Turn the recoloured hoodie into a uniform shirt: hide the civilian bits the base look adds (the 'growth'
 * archetype's white earbuds and the tier-0 hoodie drawstrings, batch 'garment-*'), then dress the chest socket
 * (the garment batch's own frame, chest front z≈.143) with shirt collar points, a black tie + knot, and button-
 * down breast-pocket flaps with a silver name tag (the gold shield sits over the other pocket). The hood ring at the neck reads as the shirt's raised collar.
 */
function uniformShirt(avatar: AvatarInstance): void {
  let socket: Object3D | undefined;
  avatar.root.traverse(o => {
    if (o.name === 'prop-earbuds') o.visible = false;
    if (o.name.startsWith('garment-')) { o.visible = false; socket ??= o.parent ?? undefined; }
  });
  if (!socket) return;
  const front = 0.143;
  const kit = new Group(); kit.name = 'sfpd-shirt';
  const collarMat = new MeshLambertMaterial({ color: 0x1f2c58 }), tieMat = new MeshLambertMaterial({ color: CAP_BLACK });
  const flapMat = new MeshLambertMaterial({ color: 0x22305e }), silver = new MeshLambertMaterial({ color: 0xc9ced6 });
  const part = (geo: BoxGeometry, mat: MeshLambertMaterial, x: number, y: number, z: number, rz = 0) => {
    const m = new Mesh(geo, mat); m.position.set(x, y, z); m.rotation.z = rz; kit.add(m);
  };
  for (const side of [-1, 1]) {
    part(new BoxGeometry(0.075, 0.045, 0.012), collarMat, side * 0.042, 0.102, front + 0.012, side * 0.55); // collar point
    part(new BoxGeometry(0.078, 0.07, 0.008), flapMat, side * 0.095, -0.025, front + 0.004); // breast pocket
    part(new BoxGeometry(0.082, 0.02, 0.012), collarMat, side * 0.095, 0.012, front + 0.009); // pocket flap
  }
  part(new BoxGeometry(0.03, 0.026, 0.016), tieMat, 0, 0.088, front + 0.016); // tie knot
  part(new BoxGeometry(0.034, 0.2, 0.01), tieMat, 0, -0.03, front + 0.014); // tie
  part(new BoxGeometry(0.058, 0.013, 0.008), silver, -0.095, 0.034, front + 0.012); // name tag above the wearer's right pocket
  socket.add(kit);
}

/** Create an officer avatar from the shared rigged-avatar template with the SFPD look applied (forced). */
export function createSfpdOfficer(template: AvatarTemplate): AvatarInstance {
  // meshyPeople (lane D): the Meshy-6 officer carries the navy uniform, cap, badge and belt in its texture — no recolour/kit.
  const meshy = meshyOfficerTemplate();
  if (meshy) { const officer = meshy.createInstance(0); officer.root.name = 'SFPD officer'; return officer; }
  const look = sfpdOfficerLook();
  const avatar = template.createInstance(4, look, true);
  avatar.root.name = 'SFPD officer';
  navyUniform(avatar); navyLegs(avatar); patrolCap(avatar); addOfficerKit(avatar); uniformShirt(avatar);
  return avatar;
}
