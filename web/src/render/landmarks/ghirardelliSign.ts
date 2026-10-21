import { Group, Mesh, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import { Parts, lettering, type BuilderOptions } from './primitives';

// The GHIRARDELLI rooftop sign at Ghirardelli Square -- the giant illuminated letters along the top of the old
// chocolate-factory building, one of the most photographed signs in the city. The support frame is the usual lit
// vertex-coloured mesh; the big letters are a SECOND mesh rendered UNLIT (MeshBasicMaterial, toneMapped off) like the
// Castro crossing, so they are a fixed-brightness white that reads the same on BOTH HD and Low. The letters are PURE
// WHITE on purpose: the scene (incl. the sunset sky) is ACES-tonemapped bright while these opt out of tonemapping, so
// a warm cream read as a dim tan silhouette -- pure white is the max, coolest value and pops against the warm sky as
// the real lit white neon does (and it is a true Low floor: no bloom exists on the phone path). The letters sit ~16-21
// m up so they ride the building's roofline; front faces +Z. No textures, no per-frame cost.
const FRAME = '#38342f', FRAME_DK = '#2a2723', LETTER = '#ffffff';

export function createGhirardelliSign({ detail = 'near' }: BuilderOptions = {}): Group {
  const lit = new Parts();
  const text = 'GHIRARDELLI', H = 4.0, advance = H * 0.88, railW = text.length * advance + 2;
  const baseY = 16.4, railY = baseY - 0.5;
  // Dark catwalk rail the letters stand on, a top rail, and support posts dropping to the roofline.
  lit.box([0, railY, 0], [railW, 0.5, 0.8], FRAME);
  lit.box([0, baseY + H + 0.3, 0], [railW, 0.35, 0.6], FRAME_DK);     // top rail
  for (let i = -2; i <= 2; i++) lit.box([i * (railW / 5), railY - 1.7, 0], [0.45, 3.2, 0.45], FRAME); // posts to roof
  lit.box([0, railY - 3.1, 0], [railW, 0.35, 0.7], FRAME_DK);        // lower rail on the roof
  const sign = lit.finish('Ghirardelli sign');

  // Letters (unlit, toneMapped off) -- pure-white sign letters, the same bright white on HD and Low. A dark backing
  // band sits just behind them (also unlit, so it stays dark regardless of scene light): from the classic bay view
  // the letters are seen against the bright sunset sky, where even pure white (the Low-path ceiling) can wash out, so
  // the dark band guarantees the white letters read as a lit sign from across the park.
  const face = new Parts();
  face.box([0, baseY + H / 2 + 0.1, -0.1], [railW - 0.4, H + 0.6, 0.3], '#1b1712');
  lettering(face, text, 0, baseY, 0.35, H, LETTER);
  void detail;
  const letterMesh = face.finish('Ghirardelli letters');
  const mesh = letterMesh.children[0] as Mesh | undefined;
  if (mesh) {
    (mesh.material as MeshLambertMaterial).dispose?.();
    mesh.material = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    mesh.name = 'Ghirardelli letters geometry';
    sign.add(mesh);
  }
  return sign;
}
