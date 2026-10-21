import { type Group, type Mesh, MeshBasicMaterial, type MeshLambertMaterial } from 'three';
import { Parts, lettering, type BuilderOptions, type V3 } from './primitives';

/**
 * Historic F-line (Market & Wharves) streetcar in the classic Muni green-and-cream PCC livery, parked at the
 * Embarcadero / Ferry Building terminus where the real F-line loops. A static hero prop that gives the default
 * spawn its San Francisco waterfront identity (the plaza otherwise reads as empty flat paving). Built along the
 * local +Z axis (front = +Z, where the destination roll sign faces); createPlacedLandmarks rotates it onto the
 * street. The whole car is rendered UNLIT (MeshBasic, toneMapped off) so the signature Muni green-and-cream holds
 * at face value across the day/night cycle on HD and Low -- lit, the green (complement of the golden evening cast)
 * washes to flat tan at the 18:15 spawn. Strong horizontal banding carries the form. Same signage pattern as
 * ferryClockFaces / pier39Sign; the roll sign, "F" badge and headlights sit proud of the nose as bright fittings.
 */
export function createEmbarcaderoStreetcar(_options: BuilderOptions = {}): Group {
  const p = new Parts();
  const CREAM = '#f3ecd8', GREEN = '#179a49', GREEN_DK = '#0c6f35', GLASS = '#64767e', SEAT = '#51463a';
  const SKIRT = '#363b3c', TRUCK = '#1d2021', ROOF = '#ccc6b4', RAIL = '#51514c';
  const HALF_L = 6.7, HALF_W = 1.28; // ~13.4 m long, ~2.56 m wide

  // Short stub of F-line rail (standard gauge) under the car, run past each end so it reads as the terminus
  // track rather than a box floating on the plaza. Then the dark trucks (undercarriage) tucked under the skirt.
  for (const side of [-1, 1]) p.box([side * 0.72, 0.05, 0], [0.12, 0.1, 15.8], RAIL);
  for (const z of [-4.3, 4.3]) p.box([0, 0.42, z], [2.0, 0.82, 2.7], TRUCK);
  // Skirt (dark base shadow line) and green lower body.
  p.box([0, 0.95, 0], [2.52, 0.6, 13.0], SKIRT);
  p.box([0, 1.42, 0], [2.52, 1.12, 13.2], GREEN);
  p.box([0, 1.1, 0], [2.56, 0.18, 13.1], GREEN_DK);          // lower accent band
  p.box([0, 1.98, 0], [2.56, 0.09, 13.1], CREAM);            // cream sill pinstripe
  // Window band: glass over a warm interior/seat tone, with a cream head frame and vertical mullions, so the windows
  // read as framed glass with an interior rather than a flat black void up close.
  p.box([0, 2.63, 0], [2.52, 0.32, 11.9], '#7f919a');       // bright sky-reflection (upper glass)
  p.box([0, 2.37, 0], [2.52, 0.24, 11.9], GLASS);           // glass (steel-blue, mid)
  p.box([0, 2.12, 0], [2.5, 0.26, 11.9], SEAT);             // interior/seat tone (lower, through the glass)
  p.box([0, 2.79, 0], [2.56, 0.1, 12.1], CREAM);            // window head frame
  for (let z = -5.4; z <= 5.4; z += 1.1) for (const side of [-1, 1])
    p.box([side * 1.27, 2.42, z], [0.07, 0.9, 0.1], CREAM); // mullions
  // Cream letterboard above the windows.
  p.box([0, 2.95, 0], [2.52, 0.34, 13.2], CREAM);
  // Subtly rounded PCC ends: shallow caps that round the body end (they must NOT bulge past the front fittings),
  // plus a windscreen proud of each nose.
  for (const end of [-1, 1] as const) {
    p.ellipsoid([0, 1.5, end * 6.4], [1.28, 1.08, 0.3], GREEN);
    p.ellipsoid([0, 2.95, end * 6.45], [1.26, 0.4, 0.26], CREAM);
    p.box([0, 2.42, end * 6.72], [1.5, 0.82, 0.12], GLASS);  // end windscreen, proud of the nose
  }
  // Roof: wide lip + narrower crown, plus a raised center monitor and vent pods (reads as a real tram roof up close).
  p.box([0, 3.14, 0], [2.5, 0.14, 13.1], ROOF);
  p.box([0, 3.26, 0], [2.26, 0.22, 12.7], ROOF);
  p.box([0, 3.42, 0], [1.2, 0.12, 11.0], '#b4ae9d');        // raised roof monitor
  for (const z of [-3.8, 0, 3.8]) p.box([0, 3.5, z], [0.68, 0.16, 0.7], '#8f8a7a');  // vent pods
  // Trolley pole: base on the roof, leaning up and back (-Z) — the single clearest "streetcar" cue.
  p.box([0, 3.4, -0.6], [0.34, 0.22, 0.6], '#2c2f30');
  p.beam([0, 3.46, -0.6], [0, 5.5, -4.6], 0.055, '#34383a');
  p.box([0, 5.5, -4.6], [0.12, 0.12, 0.6], '#44484a');

  const root = p.finish('F-line streetcar');
  // Render the whole car UNLIT (MeshBasic, toneMapped off): the signature Muni green is the complement of the golden
  // evening cast and washes to flat tan when lit (noon reads green, but the 18:15 spawn does not). Unlit holds the
  // green-and-cream livery at face value across the day/night cycle on HD and Low; the strong horizontal banding
  // (green body / cream letterboard / dark window band / dark skirt) carries the form without normal shading.
  const body = root.children[0] as Mesh | undefined;
  if (body) {
    (body.material as MeshLambertMaterial).dispose?.();
    body.material = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    body.name = 'F-line streetcar body';
  }

  // Bright unlit fittings, all PROUD of the nose face so nothing is buried: front roll sign ("EMBARCADERO"),
  // red "F" route badge, and a headlight at each nose.
  const s = new Parts();
  const SIGN_BG = '#17160f', SIGN_TXT = '#f3ead0', BADGE = '#c23a2a', LAMP = '#fff6d8';
  s.box([0, 2.92, 6.74], [1.9, 0.32, 0.08], SIGN_BG);        // front roll-sign panel, proud of the cream nose
  lettering(s, 'EMBARCADERO', 0, 2.86, 6.79, 0.2, SIGN_TXT);
  s.box([0, 1.92, 6.76], [0.52, 0.52, 0.08], BADGE);         // "F" route badge, proud of the green nose
  lettering(s, 'F', 0, 1.74, 6.81, 0.44, '#fff4d8');
  for (const end of [-1, 1] as const) {
    const zc: V3 = [0, 1.62, end * 6.78];
    s.box(zc, [0.22, 0.22, 0.08], LAMP);                     // headlight
  }
  const sign = s.finish('F-line streetcar sign');
  const mesh = sign.children[0] as Mesh | undefined;
  if (mesh) {
    (mesh.material as MeshLambertMaterial).dispose?.();
    mesh.material = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    mesh.name = 'F-line streetcar sign geometry';
    root.add(mesh);
  }

  // Solid to the player. The landmark collision system (withLandmarkSurfaces) only tests solidFootprints on a
  // landmark that ALSO defines walkableSurfaces, and only where the probe is within one — so author a thin flat
  // ground margin around the car (at its base height, y:0) that activates the footprint without raising the plaza.
  const foot = { minX: -HALF_W - 0.15, maxX: HALF_W + 0.15, minZ: -HALF_L, maxZ: HALF_L };
  root.userData.solidFootprints = [foot];
  root.userData.walkableSurfaces = [{ minX: foot.minX - 2.2, maxX: foot.maxX + 2.2, minZ: foot.minZ - 2.2, maxZ: foot.maxZ + 2.2, y: 0 }];
  return root;
}
