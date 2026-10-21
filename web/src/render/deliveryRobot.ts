import { CanvasTexture, CylinderGeometry, Mesh, MeshBasicMaterial, NearestFilter, PlaneGeometry, SRGBColorSpace } from 'three';
import { Parts, profile, type V3 } from './landmarks/primitives';

/** Original parked courier: six rubber wheels, chamfered cargo shell and a pickup label. */
export function createDeliveryRobot() {
  const p = new Parts();
  const ring = (y: number, x: number, z: number): V3[] => [
    [-x + .10, y, z], [x - .10, y, z], [x, y, z - .10], [x, y, -z + .10],
    [x - .10, y, -z], [-x + .10, y, -z], [-x, y, -z + .10], [-x, y, z - .10],
  ];
  profile(p, [ring(.22, .34, .57), ring(.39, .39, .62)], '#273a35');
  profile(p, [ring(.39, .39, .62), ring(.83, .36, .56)], '#d8d4bb');
  profile(p, [ring(.83, .38, .58), ring(.87, .38, .58)], '#526c60');
  profile(p, [ring(.87, .37, .57), ring(.94, .31, .50)], '#e8dfc4');
  p.box([0, .96, -.12], [.20, .035, .13], '#384c43');
  for (const side of [-1, 1]) {
    for (const z of [-.43, 0, .43]) {
      const tire = new CylinderGeometry(.205, .205, .135, 12).rotateZ(Math.PI / 2);
      p.add(tire, '#25312e', [side * .43, .215, z]);
      const hub = new CylinderGeometry(.095, .095, .015, 8).rotateZ(Math.PI / 2);
      p.add(hub, '#c1bb9e', [side * .505, .215, z]);
      p.beam([side * .32, .30, z - .08], [side * .44, .22, z], .045, '#596b5d');
    }
    // Painted panel seams, vent slots and small scuffs keep the shell authored at street scale.
    p.box([side * .382, .50, .10], [.015, .045, .65], '#967b4d');
    for (let i = 0; i < 4; i++) p.box([side * .371, .70, -.34 + i * .065], [.015, .08, .022], '#53675c');
    for (const z of [-.3, .2]) p.box([side * .385, .43, z], [.016, .012, .08], '#a5a289');
    p.box([side * .25, .39, .625], [.16, .05, .015], '#e6c76c');
    p.box([side * .26, .43, -.625], [.13, .055, .015], '#a9533f');
  }
  p.box([0, .75, .58], [.42, .10, .025], '#263b34');
  for (const x of [-.12, .12]) p.box([x, .75, .597], [.075, .025, .01], '#d4dda9');
  p.box([0, .30, .66], [.69, .08, .07], '#536358');
  const root = p.finish('Six-wheel delivery robot');
  const mastParts = new Parts(); mastParts.beam([0, 0, 0], [0, .72, 0], .025, '#5b6557');
  mastParts.polygon([[0, .69, 0], [.22, .62, 0], [0, .53, 0]], '#da8240');
  mastParts.polygon([[0, .53, 0], [.22, .62, 0], [0, .69, 0]], '#b56c38');
  const mast = mastParts.finish('Courier safety pennant'); mast.position.set(-.23, .92, -.40); root.add(mast);

  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Courier label canvas unavailable');
  ctx.fillStyle = '#e1d2a8'; ctx.fillRect(0, 0, 256, 128); ctx.fillStyle = '#35574c'; ctx.fillRect(5, 5, 246, 118);
  ctx.fillStyle = '#f5e5b9'; ctx.textAlign = 'center'; ctx.font = 'bold 47px Arial'; ctx.fillText('SOUP', 128, 57);
  ctx.font = 'bold 17px Arial'; ctx.fillText('AWAITING PICKUP', 128, 90); ctx.font = '12px Arial'; ctx.fillText('SERIES A · EXTRA NOODLES', 128, 111);
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.magFilter = NearestFilter;
  const label = new Mesh(new PlaneGeometry(.48, .24), new MeshBasicMaterial({ map: texture, toneMapped: false }));
  label.material.userData.gtasfUnlit = true; // full-bright label; skip the realisticRender PBR conversion (gtasf-z133)
  label.name = 'Courier pickup label'; label.position.set(0, .57, .625); root.add(label);
  const lampMaterial = new MeshBasicMaterial({ color: '#d4dda9', transparent: true, opacity: .7, toneMapped: false });
  lampMaterial.userData.gtasfUnlit = true; // full-bright waiting light; skip the realisticRender PBR conversion (gtasf-z133)
  const lamp = new Mesh(new PlaneGeometry(.07, .025), lampMaterial); lamp.name = 'Courier waiting light'; lamp.position.set(0, .75, .600); root.add(lamp);
  return { root, update(seconds: number) {
    mast.rotation.z = Math.sin(seconds * 1.3) * .035;
    lampMaterial.opacity = .65 + Math.sin(seconds * 1.7) * .20;
  } };
}
