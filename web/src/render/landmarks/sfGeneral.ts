import { Group, Mesh, MeshBasicMaterial, type MeshLambertMaterial } from 'three';
import { flags } from '@gtasf/shared/flags';
import { Parts, lettering, type BuilderOptions } from './primitives';
import { createCardTrees, type CardTree } from './cardTrees';
import type { LandmarkDefinition } from './landmarks';
import type { LocalRect } from './pier39';

/**
 * sfGeneralArrival (QA lane E, P3): every WASTED/BUSTED player respawns at SF General (shared/combat/economy.ts
 * SF_GENERAL_RESPAWN), and the client snaps that point onto the north-south road on the campus's east side. Facing the
 * respawn heading (north) the hospital's brick wards are on the left, but the right is a vast empty paved plain (the
 * US-101 corridor; the coarse bake drops small buildings). Dress the respawn as a hospital arrival: SF GENERAL monument,
 * a red EMERGENCY pylon, an ambulance bay with two ambulances, a staff car park and a screened tree line.
 * Anchored at the snapped respawn point (player = local origin, looking -z). Clusters each sit on their own sampled
 * ground (resampleTerrain) because the plain falls ~2 m eastward; the props are solid with no step (dynamic surface).
 */
export const SF_GENERAL_ARRIVAL: LandmarkDefinition = {
  id: 'sf-general-arrival', name: 'SF General arrival', lat: 37.75542, lon: -122.40363, heightM: 8, heightEstimated: true,
  fallbackBaseM: 29, base: 'terrain', rotationYDeg: 0,
  source: 'https://www.openstreetmap.org/way/24446045', heightSource: 'authored set dressing',
};

const WHITE = '#e9e7e1', RED = '#b8262a', NAVY = '#1f3554', CONCRETE = '#b7b2a6', DARK = '#26292c', GLASS = '#3a4752';
const CAR_PAINT = ['#d9d9d6', '#9ea3a8', '#2a2c30', '#5d6670', '#27406b', '#8c2a2a', '#e6e2d6', '#4a5a4a'];

function unlit(group: Group, parts: Parts, name: string): void {
  const finished = parts.finish(name), mesh = finished.children[0] as Mesh | undefined;
  if (!mesh) return;
  (mesh.material as MeshLambertMaterial).dispose();
  mesh.material = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  group.add(mesh);
}

/** Ambulance parked with its length along x, nose toward -x (the road), centred on (x, z). */
function ambulance(p: Parts, x: number, z: number): void {
  p.box([x + 0.9, 1.75, z], [4.4, 2.5, 2.3], WHITE);                    // box body
  p.box([x - 2.3, 1.2, z], [2.0, 1.5, 2.15], WHITE);                    // cab
  p.box([x - 2.85, 1.7, z], [0.9, 0.7, 2.0], GLASS);                    // windscreen
  for (const side of [-1, 1]) {
    p.box([x + 0.9, 1.35, z + side * 1.16], [4.4, 0.32, 0.02], RED);    // side stripe
    p.box([x - 2.0, 1.75, z + side * 1.08], [0.9, 0.55, 0.02], GLASS);  // cab side window
    for (const wx of [x - 2.2, x + 2.0]) p.box([wx, 0.42, z + side * 1.02], [0.82, 0.82, 0.28], DARK);
  }
  p.box([x + 3.1, 1.8, z], [0.02, 1.6, 1.0], GLASS);                    // rear doors' windows
  p.box([x - 2.2, 2.05, z], [0.5, 0.18, 1.7], RED);                     // light bar
  p.box([x + 2.95, 3.04, z], [0.25, 0.14, 2.1], RED);
}

function car(p: Parts, x: number, z: number, paint: string): void {
  p.box([x, 0.62, z], [4.3, 0.72, 1.8], paint);
  p.box([x + 0.2, 1.22, z], [2.3, 0.56, 1.6], GLASS);
  p.box([x + 0.2, 1.52, z], [2.1, 0.05, 1.5], paint);
  for (const wx of [x - 1.35, x + 1.35]) for (const side of [-1, 1]) p.box([wx, 0.33, z + side * 0.82], [0.68, 0.66, 0.24], DARK);
}

function tree(p: Parts, cards: CardTree[] | undefined, x: number, z: number, seed: number): void {
  if (cards) { cards.push({ kind: seed % 2 ? 'ficus' : 'plane', x, y: 0, z, height: 7.5 + (seed % 3) * 0.8, yaw: (seed % 5) * 0.63 }); return; } // landmarkCardTrees
  const leaf = ['#4f6b37', '#5d7a3f', '#44602f'][seed % 3]!;
  p.beam([x, 0, z], [x + 0.2, 4.4, z], 0.35, '#6e5a44');
  p.ellipsoid([x, 6.0, z], [2.9, 2.3, 2.8], leaf, seed, 1);
  p.ellipsoid([x - 1.2, 5.2, z + 0.7], [1.8, 1.4, 1.7], leaf, seed + 1, 0);
}

export function createSfGeneralArrival(_options: BuilderOptions = {}): Group {
  const root = new Group(); root.name = 'SF General arrival';
  const solids: LocalRect[] = [], clusters: { group: Group; x: number; z: number }[] = [];
  const cluster = (name: string, x: number, z: number, build: (p: Parts, lit: Parts, cards: CardTree[] | undefined) => void) => {
    const p = new Parts(), lit = new Parts(), group = new Group(), cards: CardTree[] | undefined = flags.landmarkCardTrees ? [] : undefined;
    build(p, lit, cards);
    const finished = p.finish(name), mesh = finished.children[0];
    if (mesh) group.add(mesh);
    if (cards?.length) group.add(createCardTrees(cards, `${name} trees`));
    unlit(group, lit, `${name} signage`);
    group.name = name; group.position.set(x, 0, z); root.add(group); clusters.push({ group, x, z });
  };
  const solid = (x: number, z: number, hx: number, hz: number) => solids.push({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz });

  // Monument sign ahead-right of the respawn, lettered face toward the arriving player (+z).
  cluster('SF General monument', 6.5, -22, (p, lit) => {
    p.box([0, 0.3, 0], [8.4, 0.6, 1.2], CONCRETE);
    p.box([0, 1.75, 0], [7.8, 2.3, 0.7], NAVY);
    lit.box([0, 2.95, 0], [7.8, 0.12, 0.72], '#d7e3f0');
    lettering(lit, 'SF GENERAL', 0, 1.95, 0.38, 0.72, '#f4f6f8');
    lettering(lit, 'HOSPITAL', 0, 1.0, 0.38, 0.5, '#f4f6f8');
    for (const x of [-3.4, -1.1, 1.1, 3.4]) p.ellipsoid([x, 0.75, 1.0], [0.9, 0.45, 0.4], '#5d7a3f', x, 0);
  });
  solid(6.5, -22, 4.2, 0.7);
  // Tall red EMERGENCY pylon at the ambulance bay entrance.
  cluster('SF General emergency pylon', 5.8, -46, (p, lit) => {
    p.box([0, 2.3, 0], [0.35, 4.6, 0.35], '#5b6166');
    p.box([0, 5.3, 0], [5.6, 1.5, 0.45], RED);
    lit.box([0, 5.3, 0.235], [5.2, 1.1, 0.02], '#d1302f');
    lettering(lit, 'EMERGENCY', 0, 4.95, 0.26, 0.7, '#ffffff');
  });
  solid(5.8, -46, 0.4, 0.4);
  // Ambulance bay: flat canopy on posts with two ambulances backed in, noses toward the road.
  cluster('SF General ambulance bay', 14, -35, p => {
    p.box([0, 4.1, 0], [12.5, 0.45, 11], '#d6d3cb');
    p.box([0, 3.85, 5.55], [12.5, 0.5, 0.12], RED);
    for (const x of [-5.9, 5.9]) for (const z of [-5.2, 5.2]) p.box([x, 2, z], [0.4, 4, 0.4], '#7c8287');
    p.box([0, 0.03, 0], [12, 0.04, 10.6], '#8f8b84');
    for (const z of [-4.9, 0, 4.9]) p.box([0, 0.06, z], [11, 0.02, 0.14], '#e8d35a');
    ambulance(p, 0.5, -2.45); ambulance(p, 0.5, 2.45);
  });
  solid(14.5, -37.45, 3.4, 1.2); solid(14.5, -32.55, 3.4, 1.2);
  for (const x of [8.1, 19.9]) for (const z of [-40.2, -29.8]) solid(x, z, 0.3, 0.3);
  // Staff car park: two head-to-head rows of painted stalls, ~2/3 occupied, a lamp standard per block.
  let seed = 0;
  for (const cz of [-60, -36, -12]) cluster(`SF General car park ${cz}`, 30, cz, p => {
    for (let i = 0; i < 9; i++) {
      const z = -10.8 + i * 2.7;
      for (const side of [-1, 1]) {
        p.box([side * 2.6, 0.04, z - 1.35], [5.0, 0.02, 0.12], '#e9e6dc');
        if ((i * 7 + side * 3 + cz) % 3 !== 0) car(p, side * 2.6, z, CAR_PAINT[(seed++ * 5 + i) % CAR_PAINT.length]!);
      }
    }
    p.box([0, 4.2, 0], [0.22, 8.4, 0.22], '#4a4f53');
    p.box([0, 8.4, 0], [2.4, 0.18, 0.5], '#4a4f53');
  });
  for (const cz of [-60, -36, -12]) solid(30, cz, 5.0, 12.2);
  // Screened chain-link fence + street trees closing off the freeway plain beyond the car park.
  for (const cz of [-60, -36, -12]) cluster(`SF General tree line ${cz}`, 42, cz, (p, _lit, cards) => {
    p.box([0, 0.95, 0], [0.06, 1.9, 24], '#2f4a3a');
    for (let z = -12; z <= 12; z += 3) p.box([0, 1.0, z], [0.12, 2.0, 0.12], '#5b6166');
    for (const z of [-8, 0, 8]) tree(p, cards, 2.5, z, Math.abs(cz) + z);
  });
  for (const cz of [-60, -36, -12]) solid(42, cz, 0.3, 12);

  root.userData.landmark = true;
  root.userData.solidFootprints = solids;
  // Solid with NO height step: inside a prop's margin the surface IS the sampled ground (not a flat deck).
  root.userData.walkableSurfaces = [];
  let ground: ((x: number, z: number) => number | null) | undefined;
  const margin = solids.map(r => ({ minX: r.minX - 2.5, maxX: r.maxX + 2.5, minZ: r.minZ - 2.5, maxZ: r.maxZ + 2.5 }));
  root.userData.dynamicSurfaceHeightAt = (x: number, z: number) =>
    ground && margin.some(r => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) ? ground(x, z) : null;
  root.userData.resampleTerrain = (sample: (x: number, z: number) => number | null) => {
    ground = sample;
    for (const c of clusters) { const y = sample(c.x, c.z); if (y !== null) c.group.position.y = y; }
  };
  return root;
}
