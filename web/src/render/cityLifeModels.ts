import { CanvasTexture, DoubleSide, Group, Mesh, MeshBasicMaterial, NearestFilter, PlaneGeometry, SRGBColorSpace } from 'three';
import { Parts, type V3 } from './landmarks/primitives';

/** Articulated counterpart to Pier39's existing warm-brown, photo-referenced herd. */
export function createAnimatedSeaLion(colour: string, phase: number) {
  const body = new Parts();
  body.ellipsoid([0, .45, 0], [.57, .45, 1.15], colour);
  body.ellipsoid([0, .88, .72], [.40, .62, .45], colour);
  for (const side of [-1, 1]) {
    const fin: V3[] = [[side * .4, .35, .5], [side * 1.0, .05, -.1], [side * .4, .14, -.65]];
    body.polygon(fin, colour); body.polygon([...fin].reverse(), colour);
    body.ellipsoid([side * .30, .12, -1.15], [.27, .08, .46], colour, side * .25);
  }
  const root = body.finish('Animated Pier39 sea lion'), headParts = new Parts();
  headParts.ellipsoid([0, .2, .18], [.37, .32, .44], colour);
  headParts.ellipsoid([0, .08, .55], [.24, .15, .24], '#b29a73');
  headParts.ellipsoid([0, .1, .745], [.085, .055, .055], '#322d24');
  for (const side of [-1, 1]) {
    headParts.ellipsoid([side * .26, .31, .42], [.037, .035, .045], '#1e231d');
    headParts.ellipsoid([side * .31, .25, -.03], [.07, .12, .09], colour);
    for (let i = 0; i < 3; i++) headParts.beam([side * .15, .05, .64], [side * (.41 + i * .035), .01 + i * .04, .72 - i * .05], .014, '#ddd0ad');
  }
  const head = headParts.finish('Sea lion head and whiskers'); head.position.set(0, 1.12, .77); root.add(head);
  return { root, update(seconds: number) {
    root.scale.y = 1 + Math.sin(seconds * .8 + phase) * .012;
    head.rotation.x = Math.sin(seconds * .7 + phase) * .075;
    head.rotation.y = Math.sin(seconds * .43 + phase * 2) * .20;
    head.position.y = 1.12 + Math.max(0, Math.sin(seconds * .8 + phase)) * .055;
  } };
}

export function createCone() {
  const p = new Parts(); p.box([0, .035, 0], [.72, .07, .72], '#272e29');
  p.cylinder([0, .39, 0], .31, .06, .70, '#e87929', 8);
  p.cylinder([0, .42, 0], .225, .175, .14, '#f7e9c8', 8);
  return p.finish('Orange cone with reflective band');
}

/** Original sign lettering on a 0.13MP canvas; no real transit predictions or logos. */
export function createCityBanner(title: string, subtitle: string, colour = '#b94732') {
  const root = new Group(); root.name = title;
  const structure = new Parts();
  for (const x of [-2.4, 2.4]) structure.cylinder([x, 1.75, 0], .065, .065, 3.5, '#9ea58b', 8);
  structure.box([0, 3.02, 0], [5.05, 1.27, .13], '#d6cba5'); root.add(structure.finish('Banner poles and hem'));
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('City banner canvas unavailable');
  ctx.fillStyle = '#e7d8ad'; ctx.fillRect(0, 0, 512, 256); ctx.fillStyle = colour; ctx.fillRect(9, 9, 494, 238);
  ctx.strokeStyle = '#efdca7'; ctx.lineWidth = 3; ctx.strokeRect(18, 18, 476, 220);
  ctx.fillStyle = '#fff2c6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 44px Arial'; ctx.fillText(title, 256, 91, 452);
  ctx.font = 'bold 22px Arial'; ctx.fillText(subtitle, 256, 149, 456);
  ctx.font = '16px Arial'; ctx.fillText('SAN FRANCISCO · FICTIONAL CITY NOTICE', 256, 201, 446);
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.magFilter = NearestFilter;
  const face = new Mesh(new PlaneGeometry(4.94, 1.23), new MeshBasicMaterial({ map: texture, side: DoubleSide, toneMapped: false }));
  face.material.userData.gtasfUnlit = true; // full-bright notice; skip the realisticRender PBR conversion (gtasf-coum)
  face.position.set(0, 3.02, .071); root.add(face); return root;
}
