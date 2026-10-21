import { CanvasTexture, Mesh, MeshBasicMaterial, NearestFilter, PlaneGeometry, SRGBColorSpace } from 'three';
import { Parts } from './landmarks/primitives';

/** Original fictional cart: painted slats, striped canvas, cups and a small espresso machine. */
export function createCoffeeCart() {
  const p = new Parts(), blue = '#366777', cream = '#e6d9b8', wood = '#766047';
  p.box([0, .72, 0], [3.6, 1.3, 1.35], blue);
  p.box([0, 1.43, .08], [3.92, .16, 1.7], wood);
  p.box([0, 1.54, .10], [3.96, .06, 1.74], '#d8ceb1');
  for (let x = -1.5; x <= 1.5; x += .3) p.box([x, .73, .685], [.025, 1.16, .025], '#204853');
  for (const x of [-1.82, 1.82]) {
    p.box([x, 1.5, -.58], [.11, 3, .11], '#57594c');
    p.box([x, .22, .46], [.12, .44, .12], '#38453f');
  }
  p.box([0, 2.92, -.05], [4.18, .16, 2.12], cream);
  for (let x = -1.8; x < 2; x += .6) {
    p.box([x, 3.01, -.05], [.30, .035, 2.13], blue);
    p.box([x, 2.77, 1.025], [.30, .27, .045], blue);
  }
  p.box([0, 2.77, 1.00], [4.18, .27, .04], cream);
  p.box([.67, 1.80, -.16], [1.02, .48, .59], '#7c8d86');
  p.box([.67, 1.83, .145], [.82, .30, .045], '#24382f');
  for (const x of [.42, .87]) {
    p.cylinder([x, 1.97, .18], .055, .055, .1, '#d3c7a8', 8);
    p.box([x, 1.65, .22], [.16, .055, .22], '#404d46');
  }
  for (const x of [-1.20, -.85, -.50]) {
    p.cylinder([x, 1.70, .25], .075, .11, .26, cream, 8);
    p.cylinder([x, 1.836, .25], .085, .085, .012, '#503b29', 8);
  }
  p.box([-1.1, 1.83, -.4], [.80, .48, .14], '#24464e');
  const root = p.finish('Blue Pitch fictional coffee cart');
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Coffee sign canvas unavailable');
  ctx.fillStyle = '#dfd1a9'; ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#315865'; ctx.fillRect(8, 8, 496, 240);
  ctx.strokeStyle = '#c6b981'; ctx.lineWidth = 3; ctx.strokeRect(17, 17, 478, 222);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff1c7';
  ctx.font = 'bold 62px Arial'; ctx.fillText('BLUE PITCH', 256, 70, 452);
  ctx.font = 'bold 32px Arial'; ctx.fillText('BOOTSTRAP COFFEE', 256, 131, 452);
  ctx.font = 'bold 23px Arial'; ctx.fillText('GOOD THINGS TAKE A QUEUE', 256, 183, 456);
  ctx.font = '14px Arial'; ctx.fillText('FICTIONAL FERRY PLAZA POP-UP', 256, 220, 446);
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.magFilter = NearestFilter;
  const face = new Mesh(new PlaneGeometry(3.60, 1.05), new MeshBasicMaterial({ map: texture, toneMapped: false }));
  face.name = 'Blue Pitch original sign'; face.position.set(0, 2.13, .70); root.add(face);
  return root;
}
