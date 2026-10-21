/** Full-city expansion equality and isolated Node timing; not a browser FPS gate. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodePackedRoadGraph, unpackRoadGraph } from '../shared/roadgraphPacked.ts';

assert.equal(typeof globalThis.gc, 'function', 'Run node --expose-gc --import tsx');
const path = resolve(process.argv[2] ?? 'tools/map/out/sf/roadgraph.bin');
const bytes = new Uint8Array(await readFile(path));
const sourceHash = createHash('sha256').update(await readFile('shared/roadgraphPacked.ts')).digest('hex');
const out = resolve('artifacts/roadgraph-string-expansion'); await mkdir(out, { recursive: true });
// Exact previous browser adapter: its per-string cache is retained in the
// comparison. The candidate must improve on caching already present in main.
function baseline(packed) {
  const strings = [];
  return { version: 1,
    nodes: Array.from({ length: packed.counts.nodes }, (_, i) => packed.node(i, strings)),
    edges: Array.from({ length: packed.counts.edges }, (_, i) => packed.edge(i, strings)),
    warnings: Array.from(packed.columns.warnings, index => packed.string(index, strings)) };
}
function hashGraph(graph) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ version: graph.version, warnings: graph.warnings }));
  for (const node of graph.nodes) hash.update(JSON.stringify(node));
  for (const edge of graph.edges) hash.update(JSON.stringify(edge));
  return hash.digest('hex');
}
const report = { at: new Date().toISOString(), scope: 'Node diagnostic only; exact output comparison',
  path, sourceHash, inputSha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, runs: [], passed: false };
try {
  for (const name of ['baseline', 'candidate', 'candidate', 'baseline']) {
    globalThis.gc();
    const packed = decodePackedRoadGraph(bytes);
    const beforeHeap = process.memoryUsage().heapUsed, start = performance.now();
    let graph = (name === 'baseline' ? baseline : unpackRoadGraph)(packed);
    const elapsedMs = performance.now() - start, expandedHeap = process.memoryUsage().heapUsed;
    globalThis.gc(); const retainedHeap = process.memoryUsage().heapUsed;
    const outputSha256 = hashGraph(graph);
    report.runs.push({ name, elapsedMs, counts: packed.counts, outputSha256,
      expandedHeapDelta: expandedHeap - beforeHeap, retainedHeapDelta: retainedHeap - beforeHeap });
    graph = null; globalThis.gc();
  }
  assert.equal(new Set(report.runs.map(run => run.outputSha256)).size, 1, 'Every node, edge and warning is identical');
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} finally { await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); }
