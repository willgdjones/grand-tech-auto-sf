import { Group, Mesh, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import { Parts, lettering, type BuilderOptions } from './primitives';

// The Castro Theatre (429 Castro St, 1922): a Spanish-colonial movie palace and the visual anchor of the Castro,
// famous for its illuminated marquee and the giant vertical "CASTRO" neon blade sign rising above the roofline.
// Built as two merged vertex-coloured static meshes: the facade + marquee structure (lit Lambert, like the other
// landmarks), and the neon -- the blade letters, blade frame and marquee chase-lights -- rendered UNLIT
// (MeshBasicMaterial, toneMapped off) exactly like the Castro rainbow crossing, so the signage reads bright on BOTH
// HD and Low instead of dimming to a muddy dark red. The front faces +Z (toward Castro St); the street runs along
// local X. No textures, no per-frame cost.
const STUCCO = '#d9cdb2', STUCCO_DK = '#c3b695', TRIM = '#8a6f52', GLASS = '#2b2f3a',
  MAROON = '#541519', RED = '#8f2420', NEON_RED = '#ff2a24', NEON_WARM = '#ffd98a', BLADE_FACE = '#f6ecd2';

export function createCastroTheatre({ detail = 'near' }: BuilderOptions = {}): Group {
  const lit = new Parts();
  // Facade block, cornice and parapet cap.
  lit.box([0, 9, 0], [28, 18, 13], STUCCO);
  lit.box([0, 18.5, 0], [29, 1.4, 14], STUCCO_DK);
  lit.box([0, 19.4, 0], [29, 0.5, 14], TRIM);
  // Central bay panel (proud), a string course, flanking pilasters, and a row of tall arched upper windows.
  lit.box([0, 12, 6.6], [13, 11, 0.6], STUCCO_DK);
  lit.box([0, 9.2, 6.7], [28, 0.7, 0.4], TRIM);                            // string course over the shopfronts
  for (const x of [-10.5, -6, -2, 2, 6, 10.5]) lit.box([x, 13, 6.75], [0.7, 12, 0.4], TRIM); // pilasters
  for (const x of [-4, 0, 4]) { lit.box([x, 14.5, 6.95], [2.8, 5.2, 0.3], GLASS); lit.arch([x, 17.4, 6.98], 2.8, 1.7, STUCCO_DK); }
  // Marquee: a bold horizontal slab projecting over the sidewalk from the facade front; red fascia, pale soffit.
  lit.box([0, 6.2, 9.4], [22, 2.2, 5.6], RED);
  lit.box([0, 7.6, 9.4], [22.8, 0.6, 5.9], STUCCO_DK);    // top trim/cap
  for (const x of [-10, 10]) lit.beam([x, 7.4, 6.6], [x, 7.4, 12.0], 0.18, TRIM); // tie rods to the facade
  // Blade sign backing (dark maroon frame) rising above the parapet; its bright lit face is in the neon mesh below.
  lit.box([0, 21.6, 6.75], [5.2, 13.4, 0.7], MAROON);
  lit.box([0, 28.6, 6.75], [2.8, 1.3, 1.3], MAROON);     // cap
  const theatre = lit.finish('Castro Theatre');

  // Neon mesh (unlit, toneMapped off) -- reads bright on HD and Low like the pride flag / castro crossing. The blade
  // and marquee are ILLUMINATED signs: a glowing cream blade field + bold red CASTRO, and a glowing marquee box, so
  // they read as the Castro from blocks away instead of a dim dark tower.
  const neon = new Parts();
  // Blade: a bright cream lit field with a red neon border, then the bold vertical "CASTRO".
  neon.box([0, 21.6, 7.15], [4.2, 12.6, 0.1], BLADE_FACE);                  // glowing blade face
  neon.box([0, 27.95, 7.2], [4.4, 0.34, 0.14], NEON_RED);                   // top border
  neon.box([0, 15.25, 7.2], [4.4, 0.34, 0.14], NEON_RED);                   // bottom border
  for (const x of [-2.05, 2.05]) neon.box([x, 21.6, 7.2], [0.3, 12.9, 0.14], NEON_RED); // side borders
  const letters = 'CASTRO', H = 1.85, top = 25.9, step = 2.02;
  for (let i = 0; i < letters.length; i++) lettering(neon, letters[i]!, H * 0.22, top - i * step, 7.28, H, NEON_RED);
  // Marquee as a glowing box: a bright warm fascia band on the front + sides, a pale soffit, red chase pin-stripes.
  neon.box([0, 6.3, 12.25], [21.8, 1.7, 0.1], NEON_WARM);                   // front fascia (lit)
  for (const x of [-10.95, 10.95]) neon.box([x, 6.3, 9.4], [0.1, 1.7, 5.6], NEON_WARM); // side fascias
  neon.box([0, 5.0, 9.4], [20.6, 0.36, 5.0], NEON_WARM);                    // glowing soffit
  neon.box([0, 7.2, 12.22], [21.8, 0.18, 0.1], NEON_RED);                   // upper red pin-stripe
  neon.box([0, 5.35, 12.22], [21.8, 0.18, 0.1], NEON_RED);                  // lower red pin-stripe
  if (detail === 'near') for (const z of [6.7, 12.18]) neon.box([0, 7.5, z], [21.4, 0.14, 0.1], NEON_WARM); // top-edge beads
  const banner = neon.finish('Castro Theatre neon');
  const mesh = banner.children[0] as Mesh | undefined;
  if (mesh) {
    (mesh.material as MeshLambertMaterial).dispose?.();
    mesh.material = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    mesh.name = 'Castro Theatre neon geometry';
    theatre.add(mesh);
  }
  return theatre;
}
