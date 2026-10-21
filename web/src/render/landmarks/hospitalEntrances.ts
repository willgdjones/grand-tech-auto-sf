import { Group, Mesh, MeshBasicMaterial, type MeshLambertMaterial } from 'three';
import { Parts, lettering, type BuilderOptions } from './primitives';
import type { LandmarkDefinition } from './landmarks';
import type { LocalRect } from './pier39';

/**
 * hospitalEntrances (critic N20 follow-up, lane D): nearestHospitalRespawn wakes a WASTED/BUSTED player at the nearest of
 * four hospitals, but only SF General has authored set dressing; Saint Francis, UCSF Mission Bay and St. Mary's wake the
 * player on an anonymous street ("NOTHING says hospital", docs/sf-data/hospital-respawn/). Each gets a lit monument sign
 * ahead of the waking player, a red EMERGENCY pylon and an entrance canopy against the east frontage.
 * Anchored at each hospital's SNAPPED respawn point (player = local origin, waking heading 0 = looking -z); +x is east.
 * Placements come from an in-game occupancy grid around each spawn (tools/_console-diag.mjs HOSPGRID=1), so every piece
 * stands on sidewalk/plaza, clear of the road and of building collision.
 */
interface Entrance {
  readonly def: LandmarkDefinition; readonly lines: readonly [string, number][];
  /** yaw (rad) turns the lettered +z face; default 0 faces south (toward a player waking at heading 0 north of it). */
  readonly sign: { x: number; z: number; w: number; yaw?: number }; readonly pylon: { x: number; z: number; yaw?: number };
  /** Canopy footprint (local metres); the +x edge is the facade side, or `free` = a drop-off shelter on four posts. */
  readonly canopy: { x0: number; x1: number; z0: number; z1: number; free?: boolean };
}

const def = (id: string, name: string, lat: number, lon: number): LandmarkDefinition => ({
  id, name, lat, lon, heightM: 6, heightEstimated: true, fallbackBaseM: 20, base: 'terrain', rotationYDeg: 0,
  source: 'shared/combat/respawn.ts RESPAWN_HOSPITALS (snapped spawn)', heightSource: 'authored set dressing',
});

export const HOSPITAL_ENTRANCES: readonly Entrance[] = [
  { def: def('saint-francis-entrance', 'Saint Francis entrance', 37.789539, -122.417083),
    lines: [['SAINT FRANCIS', 0.52], ['MEMORIAL HOSPITAL', 0.34]],
    sign: { x: 7.5, z: -3.5, w: 6.4 }, pylon: { x: 5.5, z: -11 }, canopy: { x0: 16.2, x1: 20.6, z0: -4.6, z1: -0.6 } },
  { def: def('ucsf-mission-bay-entrance', 'UCSF Mission Bay entrance', 37.766591, -122.390756),
    lines: [['UCSF', 0.85], ['MISSION BAY HOSPITAL', 0.3]],
    sign: { x: 9, z: -4.5, w: 6 }, pylon: { x: 6, z: -12 }, canopy: { x0: 17, x1: 22, z0: -3.4, z1: 0.4 } },
  // gtasf-2mdpz: the original Stanyan spot (37.7737,-122.4545) had the road graph 3.7 m under the drawn hill (a respawned
  // player was buried for everyone else). Moved 59 m north to the Stanyan cross-section where graph and drawn ground agree
  // within ~0.2 m (_console-diag GROUNDCHECK=1); the forecourt is south-east, so sign/pylon face the spawn (wake heading ~125).
  { def: def('st-marys-entrance', "St. Mary's entrance", 37.774227, -122.454550),
    lines: [['ST MARYS', 0.6], ['MEDICAL CENTER', 0.34]],
    sign: { x: 13, z: 9, w: 5, yaw: Math.atan2(-13, -9) }, pylon: { x: 20, z: 7, yaw: Math.atan2(-20, -7) },
    canopy: { x0: 17.5, x1: 22, z0: 14.5, z1: 18.5, free: true } },
];

const NAVY = '#1f3554', RED = '#b8262a', CONCRETE = '#b7b2a6', STEEL = '#7c8287', SLAB = '#d6d3cb';

function unlit(group: Group, parts: Parts, name: string): void {
  const finished = parts.finish(name), mesh = finished.children[0] as Mesh | undefined;
  if (!mesh) return;
  (mesh.material as MeshLambertMaterial).dispose();
  mesh.material = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  group.add(mesh);
}

export function createHospitalEntrance(entrance: Entrance, _options: BuilderOptions = {}): Group {
  const root = new Group(); root.name = entrance.def.name;
  const solids: LocalRect[] = [], clusters: { group: Group; x: number; z: number }[] = [];
  const cluster = (name: string, x: number, z: number, build: (p: Parts, lit: Parts) => void, yaw = 0) => {
    const p = new Parts(), lit = new Parts(), group = new Group();
    build(p, lit);
    const mesh = p.finish(name).children[0];
    if (mesh) group.add(mesh);
    unlit(group, lit, `${name} signage`);
    group.name = name; group.position.set(x, 0, z); group.rotation.y = yaw; root.add(group); clusters.push({ group, x, z });
  };
  const solid = (x: number, z: number, hx: number, hz: number) => solids.push({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz });
  const { sign, pylon, canopy, lines } = entrance;

  // Monument sign, lettered face toward the waking player (+z).
  cluster(`${entrance.def.name} monument`, sign.x, sign.z, (p, lit) => {
    p.box([0, 0.3, 0], [sign.w + 0.6, 0.6, 1.2], CONCRETE);
    p.box([0, 1.75, 0], [sign.w, 2.3, 0.7], NAVY);
    lit.box([0, 2.95, 0], [sign.w, 0.12, 0.72], '#d7e3f0');
    lit.box([-sign.w / 2 + 0.45, 1.75, 0.36], [0.5, 0.16, 0.02], RED); lit.box([-sign.w / 2 + 0.45, 1.75, 0.36], [0.16, 0.5, 0.02], RED); // red cross
    // Text centred right of the cross; each line shrinks to fit (lettering() advances 0.88 x height per character).
    const room = sign.w - 1.2, fit = ([text, height]: [string, number]): [string, number] => [text, Math.min(height, room / (text.length * 0.88))];
    const [top, bottom] = lines.map(fit);
    if (top) lettering(lit, top[0], 0.35, bottom ? 1.95 : 1.5, 0.38, top[1], '#f4f6f8');
    if (bottom) lettering(lit, bottom[0], 0.35, 1.05, 0.38, bottom[1], '#f4f6f8');
  }, sign.yaw);
  // A rotated sign's footprint: the axis-aligned box around its turned rectangle.
  const sy = sign.yaw ?? 0, hx = Math.abs(Math.cos(sy)) * (sign.w / 2 + 0.3) + Math.abs(Math.sin(sy)) * 0.6, hz = Math.abs(Math.sin(sy)) * (sign.w / 2 + 0.3) + Math.abs(Math.cos(sy)) * 0.6;
  solid(sign.x, sign.z, hx, hz);
  // Tall red EMERGENCY pylon, face toward the player.
  cluster(`${entrance.def.name} emergency pylon`, pylon.x, pylon.z, (p, lit) => {
    p.box([0, 2.3, 0], [0.35, 4.6, 0.35], '#5b6166');
    p.box([0, 5.3, 0], [5.6, 1.5, 0.45], RED);
    lit.box([0, 5.3, 0.235], [5.2, 1.1, 0.02], '#d1302f');
    lettering(lit, 'EMERGENCY', 0, 4.95, 0.26, 0.7, '#ffffff');
  }, pylon.yaw);
  solid(pylon.x, pylon.z, 0.4, 0.4);
  // Entrance canopy: flat slab on two posts at its street edge (the +x edge meets the facade), red fascia, ENTRANCE.
  const cx = (canopy.x0 + canopy.x1) / 2, cz = (canopy.z0 + canopy.z1) / 2, w = canopy.x1 - canopy.x0, d = canopy.z1 - canopy.z0;
  cluster(`${entrance.def.name} canopy`, cx, cz, (p, lit) => {
    p.box([0, 3.6, 0], [w, 0.35, d], SLAB);
    p.box([-w / 2, 3.35, 0], [0.12, 0.5, d], RED);
    for (const z of [-d / 2 + 0.3, d / 2 - 0.3]) for (const x of canopy.free ? [-w / 2 + 0.3, w / 2 - 0.3] : [-w / 2 + 0.3]) p.box([x, 1.7, z], [0.3, 3.4, 0.3], STEEL);
    p.box([0, 0.02, 0], [w, 0.03, d], '#8f8b84');
    lit.box([-w / 2 - 0.07, 3.35, 0], [0.02, 0.32, Math.min(d - 0.6, 3.4)], '#f4f6f8');
    lettering(lit, 'ENTRANCE', -w / 2 - 0.09, 3.22, 0, 0.26, RED);
  });
  for (const z of [canopy.z0 + 0.3, canopy.z1 - 0.3]) for (const x of canopy.free ? [canopy.x0 + 0.3, canopy.x1 - 0.3] : [canopy.x0 + 0.3]) solid(x, z, 0.25, 0.25);

  root.userData.landmark = true;
  root.userData.solidFootprints = solids;
  // Solid with NO height step (as sfGeneral.ts): inside a prop's margin the surface IS the sampled ground.
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
