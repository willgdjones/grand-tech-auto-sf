import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run in a fresh Node 24 process per implementation, with --import tsx --expose-gc. This is a
// bounded actual-map equivalence/retained-memory check, not browser FPS proof.
const root = resolve(process.env.GTASF_ROOT ?? process.cwd());
const modulePath = resolve(process.argv[2] ?? 'web/src/render/chunks/locationNames.ts');
const reportPath = resolve(process.argv[3] ?? 'artifacts/location-name-memory/report.json');
const baselinePath = process.argv[4] ? resolve(process.argv[4]) : undefined;
const graphPath = resolve(process.env.GTASF_LOCATION_GRAPH ?? `${root}/tools/map/out/sf/roadgraph.bin`);
const replayPath = resolve(process.env.GTASF_LOCATION_REPLAY ?? `${root}/artifacts/columbus-stream/2026-10-03T1223/evidence.json`);
assert.equal(typeof global.gc, 'function', 'Run Node with --expose-gc');
const { decodePackedRoadGraph, unpackRoadGraph } = await import(pathToFileURL(`${root}/shared/roadgraphPacked.ts`).href);
const { createLocationNameLookup } = await import(pathToFileURL(modulePath).href);
const bytes = await readFile(graphPath);
const districtBytes = await readFile(resolve(dirname(graphPath), 'neighbourhoods.json'));
const graph = unpackRoadGraph(decodePackedRoadGraph(bytes));
const districts = JSON.parse(districtBytes);
global.gc();
const before = process.memoryUsage(), started = performance.now();
const lookup = createLocationNameLookup(graph, districts);
const constructionMs = performance.now() - started;
global.gc();
const after = process.memoryUsage();
const replay = JSON.parse(await readFile(replayPath, 'utf8'));
const queries = [];
for (let i = 0; i < replay.trace.length; i += 10) {
  const p = replay.trace[i]; queries.push([p.x, p.z, 80, p.y], [p.x, p.z, 80]);
}
for (let i = 0; i < graph.edges.length; i += 37) {
  const edge = graph.edges[i], p = edge.points[0]; if (!p) continue;
  const x = p[0] + (i % 13 - 6) * .9, z = p[2] + (i % 11 - 5) * .7;
  const radius = [.1, 3, 20, 80, 256, -100][i % 6];
  queries.push([x, z, radius, p[1] + (i % 7 - 3)], [x, z, radius]);
}
queries.push([NaN, 0, 80], [0, Infinity, 80], [0, 0, NaN], [0, 0, Infinity], [0, 0, 0], [0, 0, 80, NaN], [999999, 999999, 80]);
const hash = createHash('sha256'), timings = [];
let streetHits = 0, districtHits = 0;
for (const query of queries) {
  const t = performance.now(), result = lookup(...query); timings.push(performance.now() - t);
  hash.update(JSON.stringify(result));
  if (result.street) streetHits++;
  if (result.neighbourhood) districtHits++;
}
timings.sort((a, b) => a - b);
const digest = value => createHash('sha256').update(value).digest('hex');
const report = {
  checkedAt: new Date().toISOString(), scope: 'Actual source-map equivalence and Node retained memory; no browser/device frame claim',
  nodeVersion: process.version, modulePath, moduleSha256: digest(await readFile(modulePath)),
  graphSha256: digest(bytes), neighbourhoodSha256: digest(districtBytes), queryInputSha256: digest(JSON.stringify(queries)),
  nodes: graph.nodes.length, edges: graph.edges.length, constructionMs,
  retainedHeapBytes: after.heapUsed - before.heapUsed, retainedArrayBufferBytes: after.arrayBuffers - before.arrayBuffers,
  queryCount: queries.length, streetHits, districtHits, queryResultSha256: hash.digest('hex'),
  queryMeanMs: timings.reduce((a, b) => a + b, 0) / timings.length,
  queryP95Ms: timings[Math.floor(timings.length * .95)], queryMaxMs: timings.at(-1),
};
if (baselinePath) {
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  for (const key of ['graphSha256', 'neighbourhoodSha256', 'queryInputSha256', 'queryCount', 'streetHits', 'districtHits', 'queryResultSha256']) {
    assert.equal(report[key], baseline[key], `Equivalent ${key}`);
  }
  report.savedBytes = baseline.retainedHeapBytes + baseline.retainedArrayBufferBytes - report.retainedHeapBytes - report.retainedArrayBufferBytes;
  assert.ok(report.savedBytes > 0, 'Candidate must reduce measured retained bytes');
  report.equivalent = true;
}
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
