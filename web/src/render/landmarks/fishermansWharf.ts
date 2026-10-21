import { Group, Mesh, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import { Parts, lettering, type BuilderOptions } from './primitives';

// The Fisherman's Wharf sign at Taylor & Jefferson -- the round gateway sign that says you have arrived at the
// Wharf: a big circular board on two teal posts, a red crab on a yellow ship's-wheel roundel, "FISHERMANS WHARF"
// around the top and "SAN FRANCISCO" below. The posts/back are the usual lit vertex-coloured mesh; the sign FACE
// (board, ring, roundel, crab, lettering) is a SECOND mesh rendered UNLIT (MeshBasicMaterial, toneMapped off) like
// the Castro crossing, so the bright painted sign reads the same on HD and Low. Front faces +Z. No textures, no
// per-frame cost.
const POST = '#2f6d5e', POST_DK = '#234f44', BOARD = '#f3ecdd', BACK = '#cfc6b4',
  RED = '#c62b24', CRAB = '#df5a30', WHEEL = '#e6b53c', EYE = '#1d1a17';

/** A stylised red crab facing +Z, centred at (cx, cy, z), scaled by s. */
function crab(p: Parts, cx: number, cy: number, z: number, s: number): void {
  p.ellipsoid([cx, cy, z], [1.5 * s, 1.0 * s, 0.3 * s], CRAB, 0, 1);                     // shell
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++)                                                           // three legs per side
      p.beam([cx + sx * 1.2 * s, cy - 0.1 * s, z], [cx + sx * (2.3 + i * 0.5) * s, cy - (0.5 + i * 0.5) * s, z], 0.14 * s, CRAB);
    p.beam([cx + sx * 1.1 * s, cy + 0.25 * s, z], [cx + sx * 2.2 * s, cy + 1.05 * s, z], 0.2 * s, CRAB); // claw arm
    p.ellipsoid([cx + sx * 2.45 * s, cy + 1.3 * s, z], [0.5 * s, 0.6 * s, 0.26 * s], CRAB, 0, 1);         // claw
    p.ellipsoid([cx + sx * 0.5 * s, cy + 0.8 * s, z + 0.08 * s], [0.17 * s, 0.17 * s, 0.15 * s], EYE, 0, 1); // eye
  }
}

export function createFishermansWharfSign({ detail = 'near' }: BuilderOptions = {}): Group {
  const lit = new Parts();
  // Two teal posts with footings and a crossbar; the back of the board is a plain board so it is not see-through.
  for (const x of [-2.7, 2.7]) {
    lit.box([x, 0.4, 0], [0.9, 0.8, 0.9], POST_DK);                 // footing
    lit.box([x, 4.3, 0], [0.55, 8, 0.55], POST);                   // post
  }
  lit.box([0, 7.4, 0], [6.4, 0.5, 0.5], POST_DK);                  // crossbar
  lit.ellipsoid([0, 9.9, 0.06], [3.62, 3.62, 0.26], BACK, 0, 2);   // board back
  const sign = lit.finish('Fisherman\'s Wharf sign');

  // Sign face (unlit, toneMapped off) -- bright painted board reads the same on HD and Low.
  const face = new Parts();
  face.ellipsoid([0, 9.9, 0.22], [3.88, 3.88, 0.2], RED, 0, 2);    // red ring (shows as the rim)
  face.ellipsoid([0, 9.9, 0.36], [3.5, 3.5, 0.2], BOARD, 0, 2);    // white board face
  face.ellipsoid([0, 9.6, 0.44], [2.25, 2.25, 0.18], WHEEL, 0, 2); // yellow ship's-wheel roundel
  for (let i = 0; i < 8; i++) {                                     // wheel spokes
    const a = i / 8 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    face.beam([0 + c * 0.5, 9.6 + s * 0.5, 0.52], [c * 2.15, 9.6 + s * 2.15, 0.52], 0.1, BOARD);
  }
  crab(face, 0, 9.5, 0.62, 0.92);                                   // the crab
  // Lettering: "FISHERMANS" / "WHARF" around the top, "SAN FRANCISCO" along the bottom (all in red).
  lettering(face, 'FISHERMANS', 0, 12.0, 0.58, 0.52, RED);
  lettering(face, 'WHARF', 0, 11.05, 0.58, 0.6, RED);
  lettering(face, 'SAN FRANCISCO', 0, 7.05, 0.58, 0.46, RED);
  const signMesh = face.finish('Fisherman\'s Wharf face');
  const mesh = signMesh.children[0] as Mesh | undefined;
  if (mesh) {
    (mesh.material as MeshLambertMaterial).dispose?.();
    mesh.material = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    mesh.name = 'Fisherman\'s Wharf face geometry';
    sign.add(mesh);
  }
  void detail;
  return sign;
}
