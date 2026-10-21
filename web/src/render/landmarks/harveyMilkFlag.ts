import { Group, Mesh, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import { Parts, type BuilderOptions, type V3 } from './primitives';

// Harvey Milk Plaza's giant rainbow flag at Castro & Market -- the Castro's signature marker (and the reason the
// rainbow crosswalk, which is at Castro & 18th, is NOT the plaza). A tall flagpole flying the six-stripe pride
// flag. The flag carries a frozen wave (taut at the pole, billowing toward the fly end); each quad is drawn in both
// windings so it reads from either side. No textures, no per-frame cost.
//
// Two meshes, each one draw call (there is exactly one flag citywide, so the pair is negligible):
//  - Pole/collar/finial: the normal lit MeshLambertMaterial -- neutral metal that reads right shaded.
//  - The six stripes: rendered UNLIT (MeshBasicMaterial, toneMapped off), exactly like the Castro rainbow crossing,
//    so the pride colours display at full saturation on BOTH HD and Low instead of being dimmed to a muddy, dark
//    rainbow by the Low path's weaker lighting. To keep the billow reading in 3D without lighting, a gentle
//    directional shade (floored at 0.82 so nothing goes dull) is baked per-facet into the stripe's vertex colour.
const BANDS = ['#e40303', '#ff8c00', '#ffed00', '#008026', '#004dff', '#750787']; // pride red..violet

/** Scale an sRGB hex by k in [0,1] (gentle per-facet billow shade baked into the unlit stripe colour). */
function scaleHex(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

export function createHarveyMilkFlag(_options: BuilderOptions = {}): Group {
  const pole = new Parts();
  const POLE_H = 20;
  pole.cylinder([0, 0.5, 0], 0.7, 0.55, 1.0, '#b9bab4', 12);              // base collar
  pole.cylinder([0, POLE_H / 2 + 0.3, 0], 0.22, 0.15, POLE_H, '#d2d3ce', 10); // pole, tapering up
  pole.ellipsoid([0, POLE_H + 0.55, 0], [0.32, 0.42, 0.32], '#d8b84a');   // gold finial
  // Six horizontal stripes hung near the top, flying out along +X. The wave amplitude grows with distance from the
  // pole (t: 0 at the pole, 1 at the fly end) so the flag is taut at the halyard and billows at the free edge.
  const flag = new Parts();
  const W = 9, H = 5.4, top = POLE_H - 0.6, x0 = 0.22, N = 18, stripeH = H / 6;
  const wave = (x: number): number => {
    const t = (x - x0) / W;
    return (Math.sin(t * 7.2 + 0.4) * 0.85 + Math.sin(t * 3.1) * 0.22) * t;
  };
  // Unlit facets need their own depth cue: shade each quad by how much its outward normal (−dz/dx, 0, 1) faces a
  // fixed front-upper light, floored at 0.82 so the colours stay bright. Crests and troughs of the billow then catch
  // visibly different brightness instead of reading as one flat rainbow rectangle.
  const Lx = 0.28, Linv = 1 / Math.hypot(Lx, 1);
  const shade = (xa: number, xb: number, za: number, zb: number): number => {
    const m = (zb - za) / Math.max(1e-4, xb - xa);     // dz/dx of the facet
    const inv = 1 / Math.hypot(-m, 1);
    const ndotl = (-m * Lx + 1) * inv * Linv;          // normal·light, in [−1,1]
    return 0.82 + 0.18 * Math.max(0, ndotl);
  };
  for (let s = 0; s < 6; s++) {
    const yTop = top - s * stripeH, yBot = yTop - stripeH, band = BANDS[s]!;
    for (let i = 0; i < N; i++) {
      const xa = x0 + (W * i) / N, xb = x0 + (W * (i + 1)) / N;
      const za = wave(xa), zb = wave(xb);
      const c = scaleHex(band, shade(xa, xb, za, zb));
      const a: V3 = [xa, yBot, za], b: V3 = [xb, yBot, zb], d: V3 = [xb, yTop, zb], e: V3 = [xa, yTop, za];
      flag.polygon([a, b, d, e], c);
      flag.polygon([e, d, b, a], c); // back face so the flag reads from either side
    }
  }
  const group = pole.finish('Harvey Milk Plaza flag');
  const banner = flag.finish('Harvey Milk Plaza banner');
  const mesh = banner.children[0] as Mesh | undefined;
  if (mesh) {
    (mesh.material as MeshLambertMaterial).dispose?.();
    // Unlit + non-tonemapped so the pride colours read identically bright on HD and Low, like the Castro crossing.
    mesh.material = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    mesh.name = 'Harvey Milk Plaza banner geometry';
    group.add(mesh);
  }
  return group;
}
