/**
 * gtasf-8mjjf PREVIEW (lane D): build tools/map/out/<dst> = the source bake (symlinks) with every road graph (roadgraph.bin
 * + all roadgraph-near*.bin) lifted onto the drawn coarse roads, WITHOUT a re-bake: on coarse chunks (32 m terrain.bin) the
 * bake draws surface roads at max(carved, 32 m plane) + 0.1 m and the graph point is carved + 0.1 m, so the lifted point is
 * max(y, plane + 0.1). The plane is the chunk's own 32 m grid (terrain.bin = the same cm-rounded samples), split on the
 * (x, z+s)-(x+s, z) diagonal like meshes.ts uncutGround. The real fix is graphCoarseLift.ts in the bake (MAP_GRAPH_COARSE_LIFT=1);
 * this preview exists to measure it in-game first. Serve with GTASF_MAP_AREA=<dst>.
 *   tools/map/node_modules/.bin/tsx tools/map/roadgraph-coarse-lift-preview.mts [--src=sf-fidi-lift3] [--dst=sf-graphlift]
 */
import { readFile, readdir, writeFile, mkdir, symlink, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { decodePackedRoadGraph, unpackRoadGraph } from '../../shared/roadgraphPacked';
import { packRoadGraph } from './src/pipeline/roadPack';
import { liftGraph, quantizeGraphHeights } from './src/pipeline/graphCoarseLift';
import { decodeHeightfield, type Heightfield } from './src/pipeline/heightfield';

const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = 'tools/map/out', SRC = `${OUT}/${arg('src', 'sf-fidi-lift3')}`, DST = `${OUT}/${arg('dst', 'sf-graphlift')}`;

const fields = new Map<string, Heightfield>(); let span = 0;
for (const id of await readdir(`${SRC}/chunks`)) {
  try { const f = decodeHeightfield(await readFile(`${SRC}/chunks/${id}/terrain.bin`)); fields.set(`${f.x}:${f.z}`, f); span ||= (f.size - 1) * f.step; } catch { /* no terrain */ }
}
/** The drawn 32 m plane at (x, z) on a COARSE chunk (terrain.bin step 32), else null. */
const plane = (x: number, z: number): number | null => {
  const f = fields.get(`${Math.floor(x / span)}:${Math.floor(z / span)}`); if (!f || f.step !== 32) return null;
  const s = f.step, ox = f.x * span, oz = f.z * span, i = Math.min(f.size - 2, Math.floor((x - ox) / s)), j = Math.min(f.size - 2, Math.floor((z - oz) / s));
  const u = (x - ox) / s - i, v = (z - oz) / s - j, g = (ii: number, jj: number) => (f.values[jj * f.size + ii]! + f.offsetCm) / 100;
  const a = g(i, j), b = g(i + 1, j), c = g(i, j + 1), d = g(i + 1, j + 1);
  return u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d);
};
const round = (n: number) => Math.round(n * 100) / 100;

async function liftFile(name: string): Promise<{ bytes: number; gzipBytes: number; sha256: string; raised: number; max: number }> {
  const graph = unpackRoadGraph(decodePackedRoadGraph(await readFile(`${SRC}/${name}`)));
  // The SAME lift as the bake (graphCoarseLift.ts liftGraph): drawn = coarse 32 m plane + 0.1 m, null off coarse chunks.
  const lift = liftGraph(graph, (x, z) => { const q = plane(x, z); return q === null ? null : round(q + 0.1); }, 15, Number(arg('quant', '0.1')));
  const raised = lift.points, max = lift.maxRaise;
  // --quant-all=<m>: also round EVERY graph height (not just lifted ones) to this step: a payload experiment for the 87 MB cap.
  const qa = Number(arg('quant-all', '0'));
  if (qa > 0) quantizeGraphHeights(graph, qa);
  const routable = new Set(graph.edges.filter(e => e.routable).map(e => e.id));
  const bytes = packRoadGraph(graph, { routableEdgeIds: routable }), gz = gzipSync(bytes, { level: 9 });
  await writeFile(`${DST}/${name}`, bytes); await writeFile(`${DST}/${name}.gz`, gz);
  return { bytes: bytes.byteLength, gzipBytes: gz.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), raised, max: round(max) };
}

await mkdir(DST, { recursive: true });
const manifest = JSON.parse(await readFile(`${SRC}/manifest.json`, 'utf8'));
const graphs = new Set<string>([manifest.roadGraph.path, manifest.roadGraphNear.path, ...manifest.roadGraphNear.parts.map((p: { path: string }) => p.path)]);
for (const name of await readdir(SRC)) {
  if (graphs.has(name) || graphs.has(name.replace(/\.gz$/, '')) || name === 'manifest.json' || name === 'manifest.json.gz') continue;
  try { await lstat(`${DST}/${name}`); } catch { await symlink(`${process.cwd()}/${SRC}/${name}`, `${DST}/${name}`); }
}
const results = new Map<string, Awaited<ReturnType<typeof liftFile>>>();
for (const name of graphs) { results.set(name, await liftFile(name)); }
const apply = (entry: { path: string; bytes: number; gzipBytes: number; sha256: string }) => { const r = results.get(entry.path)!; Object.assign(entry, { bytes: r.bytes, gzipBytes: r.gzipBytes, sha256: r.sha256 }); };
apply(manifest.roadGraph); apply(manifest.roadGraphNear); manifest.roadGraphNear.sourceSha256 = manifest.roadGraph.sha256;
for (const part of manifest.roadGraphNear.parts) apply(part);
const text = JSON.stringify(manifest); await writeFile(`${DST}/manifest.json`, text); await writeFile(`${DST}/manifest.json.gz`, gzipSync(text, { level: 9 }));
const main = results.get(manifest.roadGraph.path)!;
console.log(`${DST}: ${results.size} graphs lifted; city graph ${main.raised} points raised (max ${main.max} m), ${main.bytes} bytes (${main.gzipBytes} gz)`);
