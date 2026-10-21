/**
 * gtasf-8mjjf (lane D): citywide sweep of road-graph heights against the DRAWN ground. Every road-graph point (bridges and
 * tunnels excluded: they leave the ground on purpose) is compared with the chunk terrain heightfield the client draws
 * (chunks/<x>_<z>/terrain.bin, bilinear like web/src/render/chunks/terrain.ts). Prints the |offset| distribution, the worst
 * edges (with lat/lon for a ?at= deep link) and writes a JSON report.
 *   tools/map/node_modules/.bin/tsx tools/map/roadgraph-height-sweep.mts [--map=tools/map/out/sf] [--out=docs/perf/roadgraph-heights/sweep.json]
 */
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { decodePackedRoadGraph, unpackRoadGraph } from '../../shared/roadgraphPacked';
import { decodeHeightfield, type Heightfield } from './src/pipeline/heightfield';
import { worldToGeodetic } from './src/geo';
import { SF_FRAME } from './src/config';

const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const MAP = arg('map', 'tools/map/out/sf'), OUT = arg('out', 'docs/perf/roadgraph-heights/sweep.json');

const fields = new Map<string, Heightfield>();
let span = 0;
for (const id of await readdir(`${MAP}/chunks`)) {
  let raw: Buffer; try { raw = await readFile(`${MAP}/chunks/${id}/terrain.bin`); } catch { continue; }
  const f = decodeHeightfield(raw); fields.set(`${f.x}:${f.z}`, f); span ||= (f.size - 1) * f.step;
}
/** Bilinear terrain height (m) at world (x, z), or null outside the baked chunks. */
const terrainAt = (x: number, z: number): number | null => {
  const f = fields.get(`${Math.floor(x / span)}:${Math.floor(z / span)}`); if (!f) return null;
  const s = (f.size - 1) * f.step, gx = Math.min(f.size - 1.000001, Math.max(0, (x - f.x * s) / f.step)), gz = Math.min(f.size - 1.000001, Math.max(0, (z - f.z * s) / f.step));
  const x0 = Math.floor(gx), z0 = Math.floor(gz), tx = gx - x0, tz = gz - z0, v = (i: number, j: number) => f.values[j * f.size + i]!;
  const h = (v(x0, z0) * (1 - tx) + v(x0 + 1, z0) * tx) * (1 - tz) + (v(x0, z0 + 1) * (1 - tx) + v(x0 + 1, z0 + 1) * tx) * tz;
  return (h + f.offsetCm) / 100;
};

// A partial (--bbox) bake stops before packing: fall back to its roadgraph.json.
const graph = await readFile(`${MAP}/roadgraph.bin`).then(b => unpackRoadGraph(decodePackedRoadGraph(b)), async () => JSON.parse(await readFile(`${MAP}/roadgraph.json`, 'utf8')));
type EdgeLike = { id?: string; name?: string; kind?: string; bridge?: boolean; tunnel?: boolean; layer?: number; points: [number, number, number][] };
const hist = new Map<number, number>(), worst: { id: string; name: string; kind: string; layer: number; maxOff: number; meanOff: number; n: number; at: string }[] = [];
let points = 0, skipped = 0, noTerrain = 0;
for (const e of graph.edges as unknown as EdgeLike[]) {
  // Grade-separated on purpose: bridges/tunnels and any non-zero layer (the Golden Gate deck is layer 1 without `bridge`).
  if (e.bridge || e.tunnel || (e.layer ?? 0) !== 0) { skipped++; continue; }
  let max = 0, sum = 0, n = 0, wx = 0, wz = 0, signed = 0;
  for (const [x, y, z] of e.points) {
    const t = terrainAt(x, z); if (t === null) { noTerrain++; continue; }
    const d = y - t, a = Math.abs(d); points++; n++; sum += a;
    const b = a < 0.25 ? 0 : a < 0.5 ? 0.25 : a < 1 ? 0.5 : a < 2 ? 1 : a < 3 ? 2 : a < 5 ? 3 : 5; hist.set(b, (hist.get(b) ?? 0) + 1);
    if (a > max) { max = a; wx = x; wz = z; signed = d; }
  }
  if (n && max >= 1) { const g = worldToGeodetic(wx, wz, SF_FRAME);
    worst.push({ id: String(e.id ?? ''), name: e.name ?? '', kind: e.kind ?? '', layer: e.layer ?? 0, maxOff: +(Math.sign(signed) * max).toFixed(2), meanOff: +(sum / n).toFixed(2), n,
      at: `${g.lat.toFixed(5)},${g.lon.toFixed(5)}` }); }
}
worst.sort((a, b) => Math.abs(b.maxOff) - Math.abs(a.maxOff));
// --near=lat,lon[,radius]: every graph point within the radius (default 25 m) with its terrain height and offset.
const NEAR = process.argv.find(a => a.startsWith('--near='))?.slice(7);
if (NEAR) { const [lat, lon, r = 25] = NEAR.split(',').map(Number), { geodeticToWorld } = await import('./src/geo'), w = geodeticToWorld(lat!, lon!, SF_FRAME) as unknown as [number, number] | { x: number; z: number }, c = Array.isArray(w) ? { x: w[0], z: w[1] } : w;
  for (const e of graph.edges as unknown as EdgeLike[]) for (const [x, y, z] of e.points) { if (Math.hypot(x - c.x, z - c.z) > r!) continue; const t = terrainAt(x, z);
    console.log(`  near: ${e.kind} layer ${e.layer ?? 0} '${e.name ?? ''}' (${x.toFixed(1)}, ${z.toFixed(1)}) graph ${y.toFixed(2)} terrain ${t?.toFixed(2)} off ${t === null ? '?' : (y - t).toFixed(2)}`); } }
console.log(`chunks ${fields.size} (span ${span} m), edges ${graph.edges.length} (${skipped} bridge/tunnel/layer!=0 skipped), points ${points}, no-terrain ${noTerrain}`);
console.log('|graph y - terrain| distribution (m: points):', [...hist].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}+: ${v} (${(100 * v / points).toFixed(2)} %)`).join(', '));
console.log(`edges with a point >= 1 m off: ${worst.length}; >= 2 m: ${worst.filter(w => Math.abs(w.maxOff) >= 2).length}; >= 3 m: ${worst.filter(w => Math.abs(w.maxOff) >= 3).length}`);
for (const w of worst.slice(0, 25)) console.log(`  ${w.maxOff.toString().padStart(6)} m (mean ${w.meanOff}) ${w.kind} layer ${w.layer} '${w.name}' ?at=${w.at}`);
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ map: MAP, span, points, skipped, noTerrain, hist: Object.fromEntries(hist), worst: worst.slice(0, 500) }, null, 1));
console.log(`wrote ${OUT}`);
