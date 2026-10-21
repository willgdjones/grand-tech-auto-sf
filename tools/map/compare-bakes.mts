/**
 * Compare two city bakes side by side (gtasf-bhft 3DEP terrain, gtasf-tdbw residential density).
 *   tools/map/node_modules/.bin/tsx tools/map/compare-bakes.mts tools/map/out/sf tools/map/out/sf-3dep [tools/map/out/sf-3dep-dense]
 * Prints payload vs budget, chunk detail counts, buildings (collision records) in the residential check boxes, and
 * terrain heights at named hill points (nearest heightfield sample of the chunk that contains the point).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodeHeightfield } from './src/pipeline/heightfield';
import { project } from './src/pipeline/settings';

const POINTS: [string, number, number][] = [
  ['Lombard crooked block', 37.8021, -122.4187], ['Twin Peaks summit', 37.7544, -122.4477], ['Nob Hill (Grace Cathedral)', 37.7919, -122.4134],
  ['Russian Hill top', 37.8013, -122.4196], ['Ferry Building', 37.7955, -122.3937], ['Dolores Park top', 37.7586, -122.4276],
];
const BOXES: [string, number, number, number, number][] = [
  ['Haight/WA/Alamo', -122.455, 37.765, -122.425, 37.785], ['Mission/Castro/Noe', -122.440, 37.745, -122.405, 37.768], ['Marina', -122.450, 37.795, -122.425, 37.806],
];
type Chunk = { id: string; detail?: string; lods: { path: string }[]; x: number; z: number; bounds: [number, number, number, number]; terrain: { path: string }; collision: { path: string }; lods?: { path: string }[] };
type Manifest = { chunkSize: number; chunks: Chunk[]; stats: { gzipBytes: number; budgetBytes: number; withinBudget: boolean; buildings: number } };

/** Triangles in the GLB's 'buildings' mesh, read from the glTF JSON chunk (indexed primitives). */
function buildingTriangles(file: string): number {
  if (!existsSync(file)) return 0;
  const b = readFileSync(file), json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')) as
    { meshes?: { name?: string; primitives: { indices?: number }[] }[]; accessors: { count: number }[] };
  let n = 0;
  for (const m of json.meshes ?? []) if (m.name === 'buildings') for (const p of m.primitives) if (p.indices !== undefined) n += json.accessors[p.indices]!.count / 3;
  return n;
}
function report(dir: string) {
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest;
  const chunkAt = (x: number, z: number) => m.chunks.find(c => x >= c.bounds[0] && x < c.bounds[2] && z >= c.bounds[1] && z < c.bounds[3]);
  const heights = POINTS.map(([name, lat, lon]) => {
    const [x, z] = project(lon, lat), c = chunkAt(x, z);
    if (!c) return [name, null] as const;
    const f = decodeHeightfield(readFileSync(join(dir, c.terrain.path)));
    const ix = Math.round((x - c.bounds[0]) / f.step), iz = Math.round((z - c.bounds[1]) / f.step);
    const v = f.values[Math.min(f.size - 1, Math.max(0, iz)) * f.size + Math.min(f.size - 1, Math.max(0, ix))]!;
    // Local maximum within 150 m: a point coordinate can sit just off a summit, and smoothing shows up as a lower peak.
    let peak = -Infinity;
    for (let dx = -150; dx <= 150; dx += 4) for (let dz = -150; dz <= 150; dz += 4) {
      const cc = chunkAt(x + dx, z + dz); if (!cc) continue;
      const ff = cc === c ? f : decodeHeightfield(readFileSync(join(dir, cc.terrain.path)));
      const jx = Math.min(ff.size - 1, Math.max(0, Math.round((x + dx - cc.bounds[0]) / ff.step))), jz = Math.min(ff.size - 1, Math.max(0, Math.round((z + dz - cc.bounds[1]) / ff.step)));
      peak = Math.max(peak, (ff.values[jz * ff.size + jx]! + ff.offsetCm) / 100);
    }
    return [name, { at: (v + f.offsetCm) / 100, max150m: +peak.toFixed(1) }] as const;
  });
  const boxes = BOXES.map(([name, w, s, e, n]) => {
    const [x0, z0] = project(w, n), [x1, z1] = project(e, s);
    let buildings = 0, chunks = 0, tris = 0;
    for (const c of m.chunks) if (c.bounds[2] > Math.min(x0, x1) && c.bounds[0] < Math.max(x0, x1) && c.bounds[3] > Math.min(z0, z1) && c.bounds[1] < Math.max(z0, z1)) {
      chunks++; const file = join(dir, c.collision.path);
      if (existsSync(file)) buildings += (JSON.parse(readFileSync(file, 'utf8')) as { buildings: unknown[] }).buildings.length;
      tris += buildingTriangles(join(dir, c.lods[0]!.path));
    }
    // Low-detail chunks ship no building collision, so the rendered 'buildings' mesh is what shows density (1.0 review).
    return [name, { chunks, collisionBuildings: buildings, buildingTriangles: tris }] as const;
  });
  return { dir, gzipMB: +(m.stats.gzipBytes / 1e6).toFixed(1), budgetMB: m.stats.budgetBytes / 1e6, withinBudget: m.stats.withinBudget,
    chunks: m.chunks.length, lowChunks: m.chunks.filter(c => c.detail === 'low').length, sourceBuildings: m.stats.buildings,
    heights: Object.fromEntries(heights), boxes: Object.fromEntries(boxes) };
}
for (const dir of process.argv.slice(2)) {
  if (!existsSync(join(dir, 'manifest.json'))) { console.log(JSON.stringify({ dir, missing: true })); continue; }
  console.log(JSON.stringify(report(dir), null, 1));
}
