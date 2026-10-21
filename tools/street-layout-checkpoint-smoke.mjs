/** Full-city output equivalence and diagnostic timings; never a phone FPS gate. Run via heavy.sh. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const out = resolve(process.env.GTASF_LAYOUT_OUT ?? 'artifacts/street-layout-checkpoint');
const path = 'web/src/render/props/layout.ts';
const before = execFileSync('git', ['show', '4e17c65adfc57875d352fedd151fee117713f2e4:' + path], { encoding: 'utf8' });
const after = await readFile(path, 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const active = JSON.parse(await readFile('tools/map/out/active-map.json', 'utf8'));
const root = resolve('tools/map/out', active.area), manifest = JSON.parse(await readFile(root + '/manifest.json', 'utf8'));
assert.equal(manifest.roadGraph.encoding, 'roadpack-v1');
const bytes = await readFile(resolve(root, manifest.roadGraph.path));
await mkdir(out, { recursive: true });
const entry = `
export { createStreetPropLayout } from './web/src/render/props/layout';
export { createRoadSampler } from './web/src/render/chunks/terrain';
export { decodePackedRoadGraph, unpackRoadGraph } from './shared/roadgraphPacked';`;
const modules = {};
for (const [name, source] of [['before', before], ['after', after]]) {
  const outfile = out + '/' + name + '.mjs';
  await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' }, outfile,
    bundle: true, platform: 'node', format: 'esm', packages: 'external',
    alias: { '@gtasf/shared': resolve('shared') }, plugins: [{ name: 'layout-version', setup(builder) {
      builder.onLoad({ filter: /\/props\/layout\.ts$/ }, () => ({ contents: source, loader: 'ts', resolveDir: resolve('web/src/render/props') }));
    } }] });
  modules[name] = await import(pathToFileURL(outfile).href);
}
const graph = modules.before.unpackRoadGraph(modules.before.decodePackedRoadGraph(bytes));
const roadHeightAt = modules.before.createRoadSampler(graph);
const report = { diagnosticOnly: true, startedAt: new Date().toISOString(),
  graph: { nodes: graph.nodes.length, edges: graph.edges.length, sha256: hash(bytes) },
  source: { before: hash(before), after: hash(after) }, runs: [] };
// Reverse order in the second pair so one variant is not always the warmed run.
for (const name of ['before', 'after', 'after', 'before']) {
  let yields = 0;
  const start = performance.now();
  const layout = await modules[name].createStreetPropLayout(graph, { roadHeightAt,
    yieldToMain: () => { yields++; return new Promise(resolve => setTimeout(resolve, 0)); } });
  const elapsedMs = performance.now() - start;
  const content = JSON.stringify([...layout.cells]);
  report.runs.push({ name, elapsedMs, yields, siteCount: layout.siteCount, counts: layout.counts,
    cellCount: layout.cells.size, outputSha256: hash(content) });
  assert.ok(yields > 0, 'Real full-city construction must yield back to the host');
}
report.identical = new Set(report.runs.map(run => run.outputSha256)).size === 1;
await writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
assert.ok(report.identical, 'Every prop, wire and cell must remain exactly equal');
