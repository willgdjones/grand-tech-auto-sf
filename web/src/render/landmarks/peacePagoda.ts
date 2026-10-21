import { Group } from 'three';
import { Parts, type BuilderOptions } from './primitives';

// The Japantown Peace Pagoda (Peace Plaza, Japan Center, a 1968 gift from Osaka): a ~30 m pale-concrete five-tier
// stupa -- broad umbrella roofs stacked on a tapering core, topped by a gold sorin (finial spire). Japantown had no
// landmark; this gives the Peace Plaza its marker. One merged vertex-coloured static mesh like the other landmarks
// (concrete reads fine lit, so no separate unlit pass). No textures, no per-frame cost.
const CONC = '#dbd5c7', CONC_DK = '#c3bcac', ROOF = '#bcb29c', ROOF_DK = '#a79d87', GOLD = '#cdae55', BASE = '#cfc8b7';

export function createPeacePagoda(_options: BuilderOptions = {}): Group {
  const p = new Parts();
  // Wide stepped circular plinth.
  p.cylinder([0, 0.6, 0], 7.0, 6.5, 1.2, BASE, 28);
  p.cylinder([0, 1.7, 0], 5.8, 5.3, 1.0, CONC, 28);
  p.cylinder([0, 2.7, 0], 4.8, 4.4, 0.8, CONC_DK, 28);
  // Tapering central core the tiers hang from (mostly hidden by the drums/roofs).
  p.cylinder([0, 10, 0], 2.4, 1.3, 16, CONC, 18);
  // Five tiers stacked close, each a narrow drum under a broad, shallow umbrella roof; both shrink going up so the
  // stupa reads as the signature stacked-umbrella cone rather than a thin spire.
  const tiers = [{ y: 4.6, r: 6.2 }, { y: 7.4, r: 5.4 }, { y: 10.0, r: 4.5 }, { y: 12.4, r: 3.6 }, { y: 14.6, r: 2.8 }];
  for (const t of tiers) {
    p.cylinder([0, t.y - 0.35, 0], t.r * 0.42, t.r * 0.40, 1.3, CONC, 22);      // drum
    p.cylinder([0, t.y + 0.45, 0], t.r, t.r * 0.58, 0.85, ROOF, 30);            // broad shallow umbrella roof
    p.cylinder([0, t.y + 0.95, 0], t.r * 0.55, t.r * 0.4, 0.4, ROOF_DK, 22);    // roof crown
  }
  // Sorin finial: a drum, stacked gold rings and a spire with a jewel.
  p.cylinder([0, 16.2, 0], 1.3, 1.0, 1.4, CONC, 16);
  for (let i = 0; i < 6; i++) p.cylinder([0, 17.1 + i * 0.46, 0], 0.68 - i * 0.07, 0.58 - i * 0.07, 0.18, GOLD, 14); // rings
  p.cylinder([0, 20.1, 0], 0.15, 0.02, 1.9, GOLD, 8);                            // spire
  p.ellipsoid([0, 21.2, 0], [0.32, 0.46, 0.32], GOLD);                           // jewel
  return p.finish('Japantown Peace Pagoda');
}
