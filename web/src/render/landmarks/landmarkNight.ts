/**
 * Landmark night signatures (look gap 4: landmarks must read instantly, also at night). The Salesforce Tower crown
 * carries a lit LED band (283-322 m) and the Bay Bridge's western spans get "The Bay Lights": points along the
 * vertical suspender cables. Both are attached in each builder's local frame (every detail level), are unlit
 * (MeshBasic / Points, additive), and fade in with the city night factor; hidden by day so they cost nothing.
 */
import { AdditiveBlending, BufferGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial, type Object3D, Points, PointsMaterial } from 'three';
import { flags } from '@gtasf/shared/flags';

/** Matches createSalesforceTower's radius profile (towers.ts). */
const salesforceRadius = (y: number) => y < 270 ? 31 - 4 * (y / 270) ** 2 : 27 * Math.sqrt(Math.max(0.015, 1 - ((y - 270) / 57) ** 2));

function bayLightsGeometry(): BufferGeometry {
  // Matches createBayBridge (bridges.ts): spans centred at z = +-704, towers at centre +-352, cables 157 m at the
  // towers sagging to 77 m mid-span, at x = +-12; deck at 67 m. One light every 2.5 m up each suspender (every 8 m).
  const p: number[] = [], deck = 67;
  for (const centre of [-704, 704]) for (let z = centre - 344; z <= centre + 344; z += 8) {
    const cable = 77 + 80 * ((z - centre) / 352) ** 2;
    for (const side of [-1, 1]) for (let y = deck + 2; y < cable; y += 2.5) p.push(side * 12.4, y, z);
  }
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(p, 3));
  return g;
}

export function createLandmarkNightLights(landmarks: Object3D) {
  if (!flags.nightLighting) return null;
  const bayMaterial = new PointsMaterial({ color: '#fff3d6', size: 2.2, sizeAttenuation: true, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, fog: false });
  const crownMaterial = new MeshBasicMaterial({ color: '#e9f4ff', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false });
  // Unlit opt-out: landmarks are mounted through prepareWorldGeometry, which would otherwise swap the crown for a
  // Lambert copy frozen at its mount-time opacity (0) - the first look-check showed no crown.
  crownMaterial.userData.gtasfUnlit = true;
  const bayGeometry = bayLightsGeometry();
  const crownTop = 322, crownBottom = 283, crownHeight = crownTop - crownBottom;
  const crownGeometry = new CylinderGeometry(salesforceRadius(crownTop) + .6, salesforceRadius(crownBottom) + .6, crownHeight, 32, 1, true);
  crownGeometry.translate(0, crownBottom + crownHeight / 2, 0);
  const added: Object3D[] = [];
  landmarks.traverse(object => {
    if (object.name === 'Bay Bridge western spans') { const pts = new Points(bayGeometry, bayMaterial); pts.name = 'The Bay Lights'; pts.frustumCulled = false; object.add(pts); added.push(pts); }
    if (object.name === 'Salesforce Tower') { const band = new Mesh(crownGeometry, crownMaterial); band.name = 'Salesforce crown lights'; object.add(band); added.push(band); }
  });
  for (const o of added) o.visible = false;
  let last = -1;
  return {
    /** night: 0 (day) .. 1 (full night), the city's night factor. */
    update(night: number) {
      const n = Math.round(Math.max(0, Math.min(1, night)) * 50) / 50;
      if (n === last) return; last = n;
      bayMaterial.opacity = n * .95; crownMaterial.opacity = n * .55;
      for (const o of added) o.visible = n > 0.02;
    },
    dispose() { for (const o of added) o.removeFromParent(); bayGeometry.dispose(); crownGeometry.dispose(); bayMaterial.dispose(); crownMaterial.dispose(); },
  };
}
