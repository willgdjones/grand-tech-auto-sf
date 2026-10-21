import { Group, Mesh, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import { Parts, lettering, type BuilderOptions } from './primitives';

// The City Lights Booksellers vertical blade sign at Columbus & Jack Kerouac Alley -- the Beat-era North Beach
// landmark. A dark green projecting blade mounted on the building corner carrying the tall vertical "CITY LIGHTS"
// name. The blade/bracket are the usual lit vertex-coloured mesh; the white name + neon border are a SECOND mesh
// rendered UNLIT (MeshBasicMaterial, toneMapped off) like the Castro crossing, so the sign reads bright on HD and
// Low. The blade faces +Z (toward Columbus Ave); the bracket reaches back to the facade (-Z). No textures, no
// per-frame cost.
// NEON is a bright warm neon white (unlit below) so "CITY LIGHTS" reads as lit letters on the phone/Low path, not a
// dim cream; the dark blade behind gives it contrast.
const BLADE = '#17221d', BLADE_DK = '#0e1512', BRACKET = '#2a2420', NEON = '#fff2c8', RED = '#dd4230';

export function createCityLightsSign({ detail = 'near' }: BuilderOptions = {}): Group {
  const lit = new Parts();
  // Bracket: a vertical bar against the facade and two short arms out to the blade.
  lit.box([0, 10.5, -0.75], [0.34, 7.2, 0.34], BRACKET);
  for (const y of [7.6, 13.4]) lit.box([0, y, -0.4], [0.26, 0.26, 0.9], BRACKET);
  // Dark blade panel with a darker backing frame.
  lit.box([0, 10.5, 0.12], [1.55, 7.2, 0.2], BLADE);
  lit.box([0, 10.5, 0.02], [1.75, 7.4, 0.12], BLADE_DK);
  const sign = lit.finish('City Lights sign');

  // Neon (unlit, toneMapped off): the white "CITY LIGHTS" vertical name + a red/white border frame.
  const neon = new Parts();
  neon.box([0, 14.0, 0.24], [1.5, 0.16, 0.12], RED);                  // top border
  neon.box([0, 7.0, 0.24], [1.5, 0.16, 0.12], RED);                   // bottom border
  for (const x of [-0.72, 0.72]) neon.box([x, 10.5, 0.24], [0.13, 7.2, 0.12], RED); // side borders
  // "CITY LIGHTS" stacked top-to-bottom, with a gap between the two words.
  const letters = 'CITYLIGHTS', H = 0.62, top = 13.2, step = 0.68;
  for (let i = 0; i < letters.length; i++) {
    const gap = i >= 4 ? 0.34 : 0;                                    // space between CITY and LIGHTS
    const y = top - i * step - gap;
    // Draw twice with a small x offset so the strokes read bolder (not thin/dim) from across the street.
    lettering(neon, letters[i]!, H * 0.22, y, 0.28, H, NEON);
    lettering(neon, letters[i]!, H * 0.22 + 0.06, y, 0.3, H, NEON);
  }
  void detail;
  const banner = neon.finish('City Lights name');
  const mesh = banner.children[0] as Mesh | undefined;
  if (mesh) {
    (mesh.material as MeshLambertMaterial).dispose?.();
    mesh.material = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    mesh.name = 'City Lights name geometry';
    sign.add(mesh);
  }
  return sign;
}
