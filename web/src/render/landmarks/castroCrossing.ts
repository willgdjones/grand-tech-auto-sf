import { Group, Mesh, MeshBasicMaterial } from 'three';
import { Parts, type BuilderOptions } from './primitives';

// Castro & 18th rainbow crosswalks. The map renders this normal road intersection as pale civic concrete (a
// surface misclassification — Harvey Milk Plaza is at Castro & MARKET, not here). This lays a scoped asphalt
// cross over the junction so it reads as road, then paints the four pride-flag crosswalks on it. Rendered UNLIT
// (MeshBasicMaterial, toneMapped off) so it reads identically on HD and Low and matches the road's floored
// asphalt albedo (vec3(0.30,0.29,0.27), the aerialRoadRead/legibleLowRoads grey) instead of a near-black hole.
//
// The junction sits on a ~3% cross-slope (W ~0.6 m above E over 20 m). A single flat decal therefore buries its
// uphill crossings underground and gets clipped by the ground along a hard diagonal. So the geometry is TILED
// (asphalt and every stripe subdivided into ~CELL cells) and `resampleTerrain` tilts the whole mesh onto a smooth
// plane fit of the ground, raised just clear of it (see below); updateLandmarkTerrain re-runs it each second
// (rotation-aware, relative to the placement height) as chunks load. Castro St runs along local Z, 18th St along local X.
// '#95928d' is sRGB for linear ~(0.30,0.29,0.27): unlit, it displays as that grey, matching the road.
type Sample = (x: number, z: number) => number | null;

const ASPHALT = '#95928d';
const BANDS = ['#e40303', '#ff8c00', '#ffed00', '#008026', '#004dff', '#750787']; // pride red..violet
const Y = 0.07;    // flat lift of the asphalt above the sampled ground (clears minor surface bumps on the slope fit)
const CELL = 3;    // tile size (m): fine enough to follow the cross-slope without burying/floating

/** Tile rectangle [x0,x1]×[z0,z1] into ~CELL flat boxes so the merged mesh has interior vertices to follow the ground. */
function slab(p: Parts, x0: number, z0: number, x1: number, z1: number, color: string): void {
  const nx = Math.max(1, Math.round((x1 - x0) / CELL)), nz = Math.max(1, Math.round((z1 - z0) / CELL));
  const dx = (x1 - x0) / nx, dz = (z1 - z0) / nz;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    p.box([x0 + dx * (i + 0.5), Y, z0 + dz * (j + 0.5)], [dx, 0.05, dz], color);
  }
}

/** A run of flat boxes from `from`→`to` along `axis` at perpendicular `fixed`, `w` wide, `yTop` proud, subdivided ~CELL. */
function strip(p: Parts, axis: 'x' | 'z', fixed: number, from: number, to: number, w: number, color: string, yTop: number): void {
  const n = Math.max(1, Math.round((to - from) / CELL)), d = (to - from) / n;
  for (let i = 0; i < n; i++) {
    const c = from + d * (i + 0.5);
    if (axis === 'x') p.box([c, yTop, fixed], [d, 0.05, w], color);
    else p.box([fixed, yTop, c], [w, 0.05, d], color);
  }
}

/** One pride crosswalk across a street: six colour bands. `cross='x'` → bands run along X (crossing Castro St).
 *  The two E/W crossings ride 3 cm higher than the N/S ones so they draw cleanly over them where they overlap at
 *  the corners, instead of z-fighting into a sawtooth. Span stops just short of the curbs. */
function crosswalk(p: Parts, cx: number, cz: number, cross: 'x' | 'z'): void {
  const step = 0.82, span = 12.5, yTop = cross === 'z' ? Y + 0.06 : Y + 0.03;
  for (let i = 0; i < 6; i++) {
    const off = (i - 2.5) * step;
    if (cross === 'x') strip(p, 'x', cz + off, cx - span / 2, cx + span / 2, step, BANDS[i]!, yTop);
    else strip(p, 'z', cx + off, cz - span / 2, cz + span / 2, step, BANDS[i]!, yTop);
  }
}

export function createCastroCrossing(_options: BuilderOptions = {}): Group {
  const p = new Parts();
  // Asphalt + covering the junction: Castro St arm (long on Z) and 18th St arm (long on X), both the ~13.6 m street width.
  slab(p, -6.8, -9, 6.8, 9, ASPHALT);
  slab(p, -9, -6.8, 9, 6.8, ASPHALT);
  // Four rainbow crosswalks, one per leg, each at the edge of the junction box: N/S cross Castro St, E/W cross 18th St.
  crosswalk(p, 0, -6.8, 'x'); // north
  crosswalk(p, 0, 6.8, 'x');  // south
  crosswalk(p, 6.8, 0, 'z');  // east
  crosswalk(p, -6.8, 0, 'z'); // west
  const group = p.finish('Castro rainbow crossing');
  const mesh = group.children[0] as Mesh | undefined;
  if (!mesh) return group;
  // Unlit, non-tonemapped, polygon-offset so it reads the same on HD and Low and sits flush without z-fighting.
  (mesh.material as MeshBasicMaterial).dispose?.();
  mesh.material = new MeshBasicMaterial({ vertexColors: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  mesh.renderOrder = 1;
  // Tilt the whole decal to the junction's cross-slope. Per-vertex sampling of surfaceHeightAt tears the mesh — that
  // height field jumps at curbs/buildings/plaza edges, so a tile straddling a step shoots vertical. Instead fit ONE
  // smooth plane from a few on-road samples (centre + gradients) and set each vertex to plane + its flat lift. The
  // small residual on a non-planar surface is absorbed by the lift. updateLandmarkTerrain re-runs this each second
  // (rotation-aware, relative to the placement height) as chunks load; until a full set of samples is valid it holds.
  const pos = mesh.geometry.getAttribute('position');
  const lift = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) lift[i] = pos.getY(i);
  const ok = (v: number | null): v is number => v !== null && Number.isFinite(v);
  const PROBES: [number, number][] = [[0, 0], [7, 0], [-7, 0], [0, 7], [0, -7], [6, 6], [-6, -6], [6, -6], [-6, 6]];
  group.userData.resampleTerrain = (sample: Sample) => {
    const c = sample(0, 0), xp = sample(7, 0), xn = sample(-7, 0), zp = sample(0, 7), zn = sample(0, -7);
    if (!ok(c) || !ok(xp) || !ok(xn) || !ok(zp) || !ok(zn)) return; // keep the current seat until fully on valid ground
    const bx = (xp - xn) / 14, bz = (zp - zn) / 14; // local ground gradient (c ≈ 0: placement height is the centre ground)
    const plane = (x: number, z: number) => c + bx * x + bz * z;
    // The surface isn't a true plane (convex junction), so the linear fit dips below ground on the low legs and buries
    // those crossings. Raise the whole decal until no probe sits below its ground, so every leg clears; the leftover
    // float is just the surface's non-planarity (~0.3 m), invisible from above and a shallow raised crossing up close.
    let rise = 0;
    for (const [x, z] of PROBES) { const g = sample(x, z); if (ok(g)) rise = Math.max(rise, g - plane(x, z)); }
    rise += 0.04;
    for (let i = 0; i < pos.count; i++) pos.setY(i, plane(pos.getX(i), pos.getZ(i)) + rise + lift[i]!);
    pos.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
  };
  return group;
}
