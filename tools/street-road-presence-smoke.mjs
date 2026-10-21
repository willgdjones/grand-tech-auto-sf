/** Full-city placement equality and Node diagnostics; never a phone performance gate. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const baselineRevision = '8fb3c6a';
const paths = ['web/src/render/chunks/terrain.ts', 'web/src/render/props/layout.ts'];
const out = resolve(process.env.GTASF_ROAD_PRESENCE_OUT ?? 'artifacts/street-road-presence');
const root = resolve(process.env.GTASF_ROAD_PRESENCE_MAP ?? 'tools/map/out/sf');
const manifest = JSON.parse(await readFile(root + '/manifest.json', 'utf8'));
assert.equal(manifest.roadGraph.encoding, 'roadpack-v1');
const bytes = await readFile(resolve(root, manifest.roadGraph.path));
const hash = value => createHash('sha256').update(value).digest('hex');
await mkdir(out, { recursive: true });
const entry = `
export { createStreetPropLayout } from './web/src/render/props/layout';
export { createRoadSampler } from './web/src/render/chunks/terrain';
export { decodePackedRoadGraph, unpackRoadGraph } from './shared/roadgraphPacked';`;
const modules = {}, sources = {};
for (const name of ['before', 'after']) {
  const source = Object.fromEntries(await Promise.all(paths.map(async path => [resolve(path), name === 'before'
    ? execFileSync('git', ['show', baselineRevision + ':' + path], { encoding: 'utf8' })
    : await readFile(path, 'utf8')])));
  sources[name] = Object.fromEntries(paths.map(path => [path, hash(source[resolve(path)])]));
  const outfile = out + '/' + name + '.mjs';
  await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' }, outfile,
    bundle: true, platform: 'node', format: 'esm', packages: 'external',
    alias: { '@gtasf/shared': resolve('shared') }, plugins: [{ name: 'road-presence-version', setup(builder) {
      builder.onLoad({ filter: /\/(chunks\/terrain|props\/layout)\.ts$/ }, args => ({
        contents: source[args.path], loader: 'ts', resolveDir: resolve(args.path, '..'),
      }));
    } }] });
  modules[name] = await import(pathToFileURL(outfile).href);
}
const graph = modules.after.unpackRoadGraph(modules.after.decodePackedRoadGraph(bytes));
assert.ok(graph.nodes.length > 100000, 'Use the actual full-city graph');
const samplers = { before: modules.before.createRoadSampler(graph), after: modules.after.createRoadSampler(graph) };
assert.equal(typeof samplers.after.contains, 'function');
assert.equal(samplers.before.contains, undefined);
const report = { diagnosticOnly: true, startedAt: new Date().toISOString(), node: process.version,
  baselineRevision, graph: { nodes: graph.nodes.length, edges: graph.edges.length, sha256: hash(bytes) },
  sources, flagsSha256: hash(await readFile('shared/flags.ts')), runs: [] };
// ABBA reduces run-order bias. The last run exercises the existing plain-function fallback.
for (const name of ['before', 'after', 'after', 'before', 'fallback']) {
  let yields = 0;
  const module = modules[name === 'before' ? 'before' : 'after'];
  const roadHeightAt = samplers[name === 'after' ? 'after' : 'before'];
  const start = performance.now();
  const layout = await module.createStreetPropLayout(graph, { roadHeightAt,
    yieldToMain: () => { yields++; return new Promise(resolve => setTimeout(resolve, 0)); } });
  const elapsedMs = performance.now() - start;
  report.runs.push({ name, elapsedMs, yields, siteCount: layout.siteCount, counts: layout.counts,
    cellCount: layout.cells.size, outputSha256: hash(JSON.stringify([...layout.cells])) });
  assert.ok(yields > 0, 'Full-city construction must still yield back to the host');
}
report.identical = new Set(report.runs.map(run => run.outputSha256)).size === 1;
await writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
assert.ok(report.identical, 'Every prop, wire and cell must remain exactly equal, including callback fallback');
