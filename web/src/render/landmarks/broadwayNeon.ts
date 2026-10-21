import { Group, LOD, Matrix4, Mesh, MeshBasicMaterial, Object3D, type BufferGeometry, type MeshLambertMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Parts, lettering, type BuilderOptions } from './primitives';
import type { LandmarkDefinition } from './landmarks';

/**
 * broadwayNeon (GTA V gap critique #15, lane A): North Beach's Broadway strip between Columbus and Kearny is SF's
 * neon street, but at night it read like every other block. A run of neon blade signs (stacked letters on both faces)
 * and flush fascia signs on the real facade lines, in their own UNLIT mesh (MeshBasic, toneMapped off) so they read
 * bright on HD and Low like the Castro blade; dark backing boxes and brackets are lit geometry.
 * Frame: anchored on the OSM Broadway centreline 100 m east of the Columbus node, local +x along Broadway (bearing
 * 9.15 deg north of east), north facades at z = -12.0 m and south facades at z = +11.0 m (DataSF footprints; the
 * cross-street gaps and the Columbus corner are skipped). Generic words only, no real business names.
 */
export const BROADWAY_NEON: LandmarkDefinition = {
  id: 'broadway-neon', name: 'Broadway neon', lat: 37.798005, lon: -122.40562, heightM: 12, heightEstimated: true,
  fallbackBaseM: 12, base: 'terrain', rotationYDeg: 9.15,
  source: 'https://www.openstreetmap.org/way/406580281', heightSource: 'authored set dressing',
};

const NORTH = -12.0, SOUTH = 11.0, BACK = '#1c1a1f', BRACKET = '#3a3d42';
export const PINK = '#ff3fa4', RED = '#ff3328', BLUE = '#3fb4ff', GREEN = '#4dff7a', AMBER = '#ffb23a', WHITE = '#fff4dc', VIOLET = '#b45cff';

// wall (optional): this sign's own facade z, for streets whose building line wanders (marketNeon); default = strip north/south.
export interface Blade { s: number; side: 1 | -1; word: string; colour: string; border: string; wall?: number }
export interface Fascia { s: number; side: 1 | -1; word: string; colour: string; border: string; wall?: number }
/** A neon street strip in its own local frame: +x along the street, facades at z = north / south (north = -z side). */
export interface NeonStrip {
  name: string; north: number; south: number; anchorS: number; blades: Blade[]; fascias: Fascia[];
  /** Optional distance cull (marketNeon on Low): signs grouped into clusterM-long runs, each a LOD that empties beyond
   *  distanceM (+ the run's half length). Omitted = today's two merged meshes for the whole strip (Broadway). */
  cull?: { clusterM: number; distanceM: number };
}
// s = metres east of the Columbus node along Broadway; side 1 = north facade, -1 = south.
const BLADES: Blade[] = [
  { s: 30, side: 1, word: 'CABARET', colour: PINK, border: BLUE },
  { s: 92, side: 1, word: 'LIVE', colour: BLUE, border: PINK },
  { s: 132, side: 1, word: 'BEAT', colour: AMBER, border: RED },
  { s: 178, side: 1, word: 'HOTEL', colour: RED, border: WHITE },
  { s: 40, side: -1, word: 'PIZZA', colour: GREEN, border: RED },
  { s: 72, side: -1, word: 'NIGHTCLUB', colour: VIOLET, border: AMBER },
  { s: 135, side: -1, word: 'SALOON', colour: RED, border: AMBER },
  { s: 192, side: -1, word: 'BROADWAY', colour: WHITE, border: PINK },
];
const FASCIAS: Fascia[] = [
  { s: 57, side: 1, word: 'COCKTAILS', colour: BLUE, border: PINK },
  { s: 205, side: 1, word: 'BAR', colour: PINK, border: AMBER },
  { s: 90, side: -1, word: 'LIVE MUSIC', colour: AMBER, border: RED },
  { s: 160, side: -1, word: 'CAFE', colour: GREEN, border: WHITE },
];
const LETTER = 0.62, STEP = 0.82, BLADE_W = 1.5;

/** Bakes a Parts' merged geometry with a transform, so many oriented signs end up in one draw. */
function baked(parts: Parts, matrix: Matrix4, out: BufferGeometry[]): void {
  const mesh = parts.finish('neon part').children[0] as Mesh | undefined;
  if (!mesh) return;
  (mesh.material as MeshLambertMaterial).dispose();
  const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  if (geometry !== mesh.geometry) mesh.geometry.dispose();
  out.push(geometry.applyMatrix4(matrix));
}

export function createBroadwayNeon(_options: BuilderOptions = {}): Group {
  return createNeonStrip({ name: 'Broadway neon', north: NORTH, south: SOUTH, anchorS: 100, blades: BLADES, fascias: FASCIAS });
}

/** Builds any neon strip (Broadway, marketNeon): lit backing boxes + one merged UNLIT sign mesh (per cull run if set). */
export function createNeonStrip(strip: NeonStrip): Group {
  const steps = neonStripSteps(strip);
  for (let step = steps.next(); ; step = steps.next()) if (step.done) return step.value;
}

/** The same build as a generator that yields after every baked sign face, fascia and merge, so a caller can frame-pace
 *  it (marketNeonLazy's post-READY mount: a few ms per frame instead of one ~0.8 s stall on a 4x phone). */
export function* neonStripSteps(strip: NeonStrip): Generator<void, Group> {
  const root = new Group(); root.name = strip.name;
  const material = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  material.userData.gtasfUnlit = true; // keep it unlit through the ps2 / realistic world-material conversions
  if (!strip.cull) yield* buildSigns(strip, strip.blades, strip.fascias, material, root);
  else {
    const { clusterM, distanceM } = strip.cull, all = [...strip.blades.map(b => b.s), ...strip.fascias.map(f => f.s)];
    const lo = Math.min(...all), runs = new Map<number, { blades: Blade[]; fascias: Fascia[] }>();
    const run = (s: number) => { const k = Math.floor((s - lo) / clusterM); if (!runs.has(k)) runs.set(k, { blades: [], fascias: [] }); return runs.get(k)!; };
    for (const b of strip.blades) run(b.s).blades.push(b);
    for (const f of strip.fascias) run(f.s).fascias.push(f);
    for (const { blades, fascias } of runs.values()) {
      const ss = [...blades.map(b => b.s), ...fascias.map(f => f.s)], cx = (Math.min(...ss) + Math.max(...ss)) / 2 - strip.anchorS;
      const inner = new Group(); inner.position.x = -cx; // geometry stays strip-local; the LOD sits at the run centre
      yield* buildSigns(strip, blades, fascias, material, inner);
      const lod = new LOD(); lod.name = `${strip.name} run`; lod.position.x = cx;
      lod.addLevel(inner, 0);
      lod.addLevel(new Object3D(), distanceM + (Math.max(...ss) - Math.min(...ss)) / 2 + 20, 0.12);
      root.add(lod);
    }
  }
  root.userData.landmark = true;
  return root;
}

function* buildSigns(strip: NeonStrip, blades: Blade[], fascias: Fascia[], material: MeshBasicMaterial, into: Object3D): Generator<void, void> {
  const lit = new Parts(), neon: BufferGeometry[] = [];
  const base = 3.6;
  for (const b of blades) {
    const x = b.s - strip.anchorS, wall = b.wall ?? (b.side === 1 ? strip.north : strip.south), out = b.side; // toward the street: +z off the north facade
    const height = b.word.length * STEP + 0.7, mid = wall + out * (BLADE_W / 2 + 0.25), y = base + height / 2;
    lit.box([x, y, mid], [0.28, height, BLADE_W], BACK);
    for (const dy of [0.6, height - 0.6]) lit.box([x, base + dy, wall + out * 0.15], [0.12, 0.12, 0.5], BRACKET);
    // Each face: a neon border + the stacked word, drawn in a local XY plane then turned to face +-x.
    for (const face of [1, -1]) {
      const p = new Parts();
      p.box([0, height - 0.12, 0], [BLADE_W - 0.1, 0.1, 0.06], b.border);
      p.box([0, 0.12, 0], [BLADE_W - 0.1, 0.1, 0.06], b.border);
      for (const e of [-1, 1]) p.box([e * (BLADE_W / 2 - 0.1), height / 2, 0], [0.1, height - 0.2, 0.06], b.border);
      for (let i = 0; i < b.word.length; i++) {
        const ch = b.word[i]!;
        if (ch !== ' ') lettering(p, ch, -LETTER * 0.36, height - 0.55 - i * STEP - LETTER * 0.5, 0.05, LETTER, b.colour);
      }
      // Rotating local +z (the lettered face) to world +-x (a rotation, never a mirror, so both faces read correctly).
      const m = new Matrix4().makeTranslation(x + face * 0.15, base, mid).multiply(new Matrix4().makeRotationY(face * Math.PI / 2));
      baked(p, m, neon);
      yield;
    }
  }
  for (const f of fascias) {
    const x = f.s - strip.anchorS, wall = f.wall ?? (f.side === 1 ? strip.north : strip.south), out = f.side;
    const width = f.word.length * 0.95 + 1.0, y = base + 0.9;
    lit.box([x, y, wall + out * 0.12], [width, 1.4, 0.2], BACK);
    const p = new Parts();
    p.box([0, 0.66, 0], [width - 0.1, 0.08, 0.06], f.border);
    p.box([0, -0.66, 0], [width - 0.1, 0.08, 0.06], f.border);
    lettering(p, f.word, -(f.word.length * 0.95) / 2 + 0.1, -0.33, 0.05, 0.66, f.colour);
    // Face the street: the north fascia faces +z, the south one -z.
    const m = new Matrix4().makeTranslation(x, y, wall + out * 0.24).multiply(new Matrix4().makeRotationY(out > 0 ? 0 : Math.PI));
    baked(p, m, neon);
    yield;
  }
  const backing = lit.finish(`${strip.name} backing`).children[0];
  if (backing) into.add(backing);
  if (neon.length) {
    const mesh = new Mesh(mergeGeometries(neon, false)!, material);
    mesh.name = `${strip.name} geometry`; into.add(mesh);
    for (const g of neon) g.dispose();
  }
  yield;
}
