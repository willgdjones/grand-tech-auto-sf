import {
  Box3, BoxGeometry, CanvasTexture, Color, Group, LinearFilter, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  Shape, ShapeGeometry,
} from 'three';

// SFPD black-and-white patrol livery (GTA-pivot lane A #2) applied client-side to a POLICE_FLAG 'subaru'
// (outback) cruiser. Classic SFPD: a BLACK body shell with WHITE door panels across the central door region
// (proud overlay panels — reliable on any body geometry, where an in-shader side/height/length split was not),
// a gold seven-point star on the front door + "POLICE" lettering on the rear door each side, and a black push
// bar on the front. The flashing red/blue roof light bar is lane B's policeLights.ts in-game; the demo/showroom
// add a static bar. Reusable by the fleet renderer + the showroom.

/** "POLICE" lettering texture (dark on transparent) for the white door — generated, no fetch. */
function policeTexture(): CanvasTexture {
  const w = 256, h = 72, c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#10131a'; ctx.font = 'bold 54px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('POLICE', w / 2, h / 2 + 2);
  const tex = new CanvasTexture(c); tex.minFilter = tex.magFilter = LinearFilter; tex.needsUpdate = true; return tex;
}

/** A flat gold seven-point star mesh for the door. */
function starMesh(): Mesh {
  const shape = new Shape();
  for (let i = 0; i < 14; i++) { const a = -Math.PI / 2 + i * Math.PI / 7, r = i % 2 ? 0.045 : 0.1; const x = Math.cos(a) * r, y = Math.sin(a) * r; i ? shape.lineTo(x, y) : shape.moveTo(x, y); }
  shape.closePath();
  return new Mesh(new ShapeGeometry(shape), new MeshLambertMaterial({ color: 0xe6c34f }));
}

/**
 * Recolour a cruiser to the SFPD b&w door-split livery + add the star/POLICE/push-bar props. Clones the body
 * material (fleet instances share it) and returns a disposer that frees the clones + added meshes.
 */
export function applySfpdLivery(root: Group): (() => void) & { refresh(): void } {
  const cloned: MeshLambertMaterial[] = [];
  const added: Mesh[] = [];
  let body: Mesh | undefined;
  root.traverse(object => { if (object instanceof Mesh && object.name === 'body') body ??= object; });
  if (!body) return Object.assign(() => {}, { refresh() {} });
  const tex = policeTexture();
  // Paint the body shell solid black (drop the stock paint map so colour shows pure). The WHITE doors are added
  // as proud panels below — reliable on any body geometry, where an in-shader side/height/length split was not.
  // EVERY 'body' mesh: the PBR cars carry one per LOD level (HD near + low far), and on phone Low carNearDetail adds the
  // HD level lazily when a car comes close; painting only one left the other level stock (prod #6.41 probe: 2 bodies,
  // 1 black). `refresh()` paints levels added since.
  const paint = () => root.traverse(object => {
    if (!(object instanceof Mesh) || object.name !== 'body' || object.userData.sfpdPainted) return;
    const mats = Array.isArray(object.material) ? object.material : [object.material];
    const next = mats.map(m => {
      const mat = (m as MeshLambertMaterial).clone();
      mat.map = null; mat.vertexColors = false; mat.color.copy(new Color().setRGB(0.07, 0.08, 0.10));
      mat.needsUpdate = true; cloned.push(mat); return mat;
    });
    object.material = Array.isArray(object.material) ? next : next[0]!;
    object.userData.sfpdPainted = true;
  });
  paint();

  // White DOORS as proud panels (reliable where the in-shader split was not): one white panel per side across
  // the central door region, then a gold star on the FRONT door + "POLICE" on the REAR door on top of it.
  const wb = new Box3().setFromObject(body);
  const cx = (wb.max.x + wb.min.x) / 2, cz = (wb.max.z + wb.min.z) / 2;
  const bodyH = wb.max.y - wb.min.y, doorMidY = wb.min.y + bodyH * 0.46;
  const halfW = (wb.max.x - wb.min.x) / 2, L = wb.max.z - wb.min.z;
  const whiteMat = new MeshLambertMaterial({ color: 0xeceef1 });
  for (const side of [-1, 1] as const) {
    const panel = new Mesh(new BoxGeometry(0.014, bodyH * 0.42, L * 0.54), whiteMat);
    panel.position.set(cx + side * (halfW + 0.006), doorMidY, cz); root.add(panel); added.push(panel);
    const star = starMesh(); star.position.set(cx + side * (halfW + 0.016), doorMidY + 0.05, cz + L * 0.14);
    star.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2; root.add(star); added.push(star);
    const police = new Mesh(new BoxGeometry(0.46, 0.13, 0.004), new MeshBasicMaterial({ map: tex, transparent: true }));
    police.position.set(cx + side * (halfW + 0.018), doorMidY - 0.085, cz - L * 0.12);
    police.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2; root.add(police); added.push(police);
  }
  const pushMat = new MeshLambertMaterial({ color: 0x12151b });
  const push = new Mesh(new BoxGeometry(halfW * 1.7, 0.1, 0.07), pushMat);
  push.position.set(cx, wb.min.y + (wb.max.y - wb.min.y) * 0.3, wb.max.z + 0.1); root.add(push); added.push(push);
  for (const x of [-0.6, -0.2, 0.2, 0.6]) { const v = new Mesh(new BoxGeometry(0.05, 0.42, 0.05), pushMat); v.position.set(cx + x * halfW, wb.min.y + (wb.max.y - wb.min.y) * 0.33, wb.max.z + 0.1); root.add(v); added.push(v); }

  return Object.assign(() => {
    for (const m of cloned) m.dispose(); tex.dispose(); pushMat.dispose();
    for (const mesh of added) { mesh.geometry.dispose(); const mm = mesh.material; if (!Array.isArray(mm)) mm.dispose(); root.remove(mesh); }
  }, { refresh: paint });
}
