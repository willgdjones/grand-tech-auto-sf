import { Group, Mesh, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import { Parts, lettering, type BuilderOptions } from './primitives';

// SHELVED 2026-10-12 (flag vesuvioSign off): renders correctly but the dense North Beach corner gives no clear
// sightline -- it crowds the cityLightsSign blade that already anchors this corner, and every camera angle is blocked
// by the City Lights building / facades / awnings / a foreground pole. Preserved for a cleaner placement later.
// The Vesuvio Cafe sign at Columbus & Jack Kerouac Alley -- the Beat-era bar next to City Lights. A warm red-maroon
// projecting blade on the building corner carrying the vertical "VESUVIO" name in amber neon, set opposite the City
// Lights blade to complete the Beat corner. Blade/bracket are the usual lit mesh; the amber name + border are a
// SECOND mesh rendered UNLIT (MeshBasicMaterial, toneMapped off) so the sign reads bright on HD and Low. The blade
// faces +Z (toward Columbus Ave); the bracket reaches back to the facade (-Z). No textures, no per-frame cost.
const BLADE = '#36130f', BLADE_DK = '#24100c', BRACKET = '#2a2018', AMBER = '#ffd27a', RED = '#d84a2a';

export function createVesuvioSign({ detail = 'near' }: BuilderOptions = {}): Group {
  const lit = new Parts();
  lit.box([0, 9.4, -0.7], [0.32, 5.6, 0.32], BRACKET);                // facade mount
  for (const y of [7.1, 11.7]) lit.box([0, y, -0.38], [0.24, 0.24, 0.85], BRACKET); // arms
  lit.box([0, 9.4, 0.12], [1.5, 5.6, 0.2], BLADE);                    // blade
  lit.box([0, 9.4, 0.02], [1.7, 5.75, 0.12], BLADE_DK);              // backing frame
  const sign = lit.finish('Vesuvio sign');

  // Amber-neon "VESUVIO" + a warm red border, unlit.
  const neon = new Parts();
  neon.box([0, 12.1, 0.24], [1.45, 0.15, 0.12], RED);                // top border
  neon.box([0, 6.7, 0.24], [1.45, 0.15, 0.12], RED);                 // bottom border
  for (const x of [-0.69, 0.69]) neon.box([x, 9.4, 0.24], [0.12, 5.6, 0.12], RED); // side borders
  const letters = 'VESUVIO', H = 0.64, top = 11.5, step = 0.7;
  for (let i = 0; i < letters.length; i++) {
    const y = top - i * step;
    lettering(neon, letters[i]!, H * 0.22, y, 0.28, H, AMBER);        // bold double pass so it reads from the street
    lettering(neon, letters[i]!, H * 0.22 + 0.06, y, 0.3, H, AMBER);
  }
  void detail;
  const banner = neon.finish('Vesuvio name');
  const mesh = banner.children[0] as Mesh | undefined;
  if (mesh) {
    (mesh.material as MeshLambertMaterial).dispose?.();
    mesh.material = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    mesh.name = 'Vesuvio name geometry';
    sign.add(mesh);
  }
  return sign;
}
