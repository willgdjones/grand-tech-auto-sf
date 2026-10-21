import { Group, Mesh, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import { Parts, lettering, type BuilderOptions } from './primitives';

// The HAIGHT / ASHBURY street-sign corner -- the two crossed green street blades on a pole at the heart of the
// Haight, one of the city's most-photographed street signs. Pole + green blades are the usual lit vertex-coloured
// mesh; the white street names are UNLIT (MeshBasicMaterial, toneMapped off) so they read on HD and Low like real
// reflective sign lettering. The HAIGHT blade faces +Z; the ASHBURY blade crosses it facing +X (its text mesh is
// rotated 90deg). No textures, no per-frame cost.
const POLE = '#39403a', POLE_DK = '#2b302c', GREEN = '#1a6b39', GREEN_DK = '#115029', WHITE = '#ffffff';

/** Finish a Parts of white lettering into an UNLIT mesh. */
function unlitMesh(p: Parts, name: string): Mesh | undefined {
  const g = p.finish(name);
  const mesh = g.children[0] as Mesh | undefined;
  if (!mesh) return undefined;
  (mesh.material as MeshLambertMaterial).dispose?.();
  mesh.material = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  mesh.name = `${name} geometry`;
  return mesh;
}

export function createHaightSign(_options: BuilderOptions = {}): Group {
  const lit = new Parts();
  // Pole with a small base, and the two crossed green blades near the top (HAIGHT along X, ASHBURY along Z). The
  // blades ride high (~6 m) so they clear the Haight's continuous shop awnings and read from the street, as a tall
  // corner sign-post.
  lit.cylinder([0, 0.4, 0], 0.34, 0.27, 0.8, POLE_DK, 10);         // base
  lit.cylinder([0, 3.4, 0], 0.14, 0.11, 6.4, POLE, 10);          // pole
  lit.cylinder([0, 6.75, 0], 0.19, 0.05, 0.4, POLE, 10);        // finial cap
  const hY = 6.0, aY = 5.35, H = 0.44;
  lit.box([0, hY, 0], [3.1, 0.66, 0.12], GREEN);                  // HAIGHT blade (faces +Z)
  lit.box([0, hY, 0], [3.14, 0.1, 0.14], GREEN_DK);              // blade top trim
  lit.box([0, aY, 0], [0.12, 0.66, 3.5], GREEN);                 // ASHBURY blade (faces +X)
  lit.box([0, aY + 0.33, 0], [0.14, 0.1, 3.54], GREEN_DK);       // blade top trim
  const sign = lit.finish('Haight & Ashbury street signs');

  // HAIGHT text facing +Z (on the +Z face of its blade).
  const faceH = new Parts();
  lettering(faceH, 'HAIGHT', 0, hY - H / 2, 0.08, H, WHITE);
  const mh = unlitMesh(faceH, 'Haight text');
  if (mh) sign.add(mh);
  // ASHBURY text: built centred facing +Z, then the mesh is rotated 90deg so it faces +X on the crossing blade.
  const faceA = new Parts();
  lettering(faceA, 'ASHBURY', 0, aY - H / 2, 0.0, H, WHITE);
  const ma = unlitMesh(faceA, 'Ashbury text');
  if (ma) { ma.rotation.y = Math.PI / 2; ma.position.x = 0.08; sign.add(ma); }
  return sign;
}
