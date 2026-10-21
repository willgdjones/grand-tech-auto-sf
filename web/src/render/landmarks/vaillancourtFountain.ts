import { type Group } from 'three';
import { Parts, type BuilderOptions, type V3 } from './primitives';

/**
 * Vaillancourt Fountain in Embarcadero (Justin Herman) Plaza at the foot of Market — the brutalist jumble of
 * precast square concrete tubes over a pool that is this plaza's signature landmark. It fills the empty flat
 * plaza that the founder-ladder onboarding frames behind the player's Embarcadero billboard. Concrete is a
 * neutral grey, so this stays LIT (normal MeshLambert) and reads fine through the golden cast, unlike the
 * streetcar's green. Angled tubes are `beam()`s (square cross-section between two points).
 */
export function createVaillancourtFountain(_options: BuilderOptions = {}): Group {
  const p = new Parts();
  // Light concrete with a WIDE value spread between tubes, so the angular overlapping reads as a sculpture (not a dark
  // blob) even on Low/phone where the golden-evening lighting dims it. (Kept lit: flatShading gives the tubes form.)
  const C = '#bcb7aa', C_DK = '#79756a', C_HI = '#d6d1c2', WATER = '#55696d', RIM = '#a39e92';
  const tube = (a: V3, b: V3, w: number, colour: string) => p.beam(a, b, w, colour, w * 1.08);

  // Shallow pool: concrete basin with a water surface inset, and a low rim curb.
  p.box([0, 0.2, 0], [15.5, 0.4, 13], RIM);
  p.box([0, 0.46, 0], [14.2, 0.14, 11.7], WATER);
  for (const [x, z, w, d] of [[-7.6, 0, 0.5, 13], [7.6, 0, 0.5, 13], [0, -6.4, 15.5, 0.5], [0, 6.4, 15.5, 0.5]] as const)
    p.box([x, 0.55, z], [w, 0.7, d], RIM);                       // curb walls

  // Central concrete mass the tubes spring from.
  p.box([0.3, 1.5, -0.2], [3.4, 2.6, 2.8], C);
  p.box([-1.2, 2.4, 1], [2.2, 2.0, 2.4], C_DK);
  p.box([1.4, 2.0, 1.2], [2.0, 1.6, 2.0], C_HI);

  // The signature chaotic projecting tubes (square concrete box sections at clashing angles). Mix of low
  // cantilevers over the pool, diagonal risers, and L-bends up to the ~11 m top.
  tube([-1, 2.6, -0.8], [4.4, 4.8, 2.6], 0.9, C);
  tube([1.2, 3.0, 1.2], [-3.8, 5.4, -1.8], 0.82, C_DK);
  tube([0.2, 3.8, -0.4], [2.2, 7.6, -1.2], 0.92, C_HI);
  tube([-0.6, 4.4, 0.6], [-2.4, 8.2, 2.2], 0.78, C);
  tube([2.0, 4.8, -1.2], [4.8, 6.4, -3.2], 0.74, C_DK);          // cantilever out
  tube([-2.2, 5.2, 1.0], [-4.6, 6.0, -1.8], 0.78, C_HI);
  tube([0.6, 6.4, 0.2], [1.6, 10.4, 0.6], 0.84, C);              // tall riser
  tube([1.6, 9.6, 0.6], [4.6, 9.8, 2.2], 0.72, C_DK);            // top cantilever (L with the riser)
  tube([-1.0, 6.8, -0.6], [-3.4, 9.0, 1.2], 0.74, C);
  tube([-4.2, 1.6, 0.2], [-6.8, 2.0, 2.4], 0.82, C_HI);         // low tubes over the pool
  tube([4.2, 1.4, -1.0], [6.4, 2.6, -3.2], 0.82, C);
  tube([2.8, 1.7, 3.2], [6.2, 1.7, 4.8], 0.76, C_DK);
  tube([-3.0, 2.2, -2.6], [-5.2, 3.6, -4.6], 0.78, C);

  const root = p.finish('Vaillancourt Fountain');
  // Solid pool + central mass (the collision system needs a walkableSurface to activate the footprint).
  const foot = { minX: -7.8, maxX: 7.8, minZ: -6.6, maxZ: 6.6 };
  root.userData.solidFootprints = [foot];
  root.userData.walkableSurfaces = [{ minX: foot.minX - 2.5, maxX: foot.maxX + 2.5, minZ: foot.minZ - 2.5, maxZ: foot.maxZ + 2.5, y: 0 }];
  return root;
}
