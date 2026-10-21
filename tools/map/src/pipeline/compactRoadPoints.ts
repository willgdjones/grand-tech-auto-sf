import assert from 'node:assert/strict';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { encodeRoadPointTransport } from '../../../../shared/mapRoadPointTransport';
import { decodeRoadTransport, encodeRoadTransport, restoreMapArtifact } from '../../../../shared/mapTransport';
import { atomicWrite, digest } from './sources';
import { writeRuntimeInventory } from './runtime';
import type { Artifact, MapManifest } from './types';

/** Announced d5-only incremental conversion. Every untouched runtime asset is
 * carried byte-for-byte into a fresh directory; no activation or publication. */
export async function compactRoadPoints(input: string | undefined, destination: string | undefined, optIn: string | undefined) {
  assert(input && destination && optIn === '--experimental-compact-map', 'Usage: tools/heavy.sh npx tsx tools/map/compact-road-points.mts SOURCE NEW_OUTPUT --experimental-compact-map');
  const root = await realpath(input), output = resolve(destination);
  assert(output !== root && !root.startsWith(output + sep) && !output.startsWith(root + sep), 'Use a separate output directory');
  const sourceManifest = await readFile(join(root, 'manifest.json')), manifest = JSON.parse(sourceManifest.toString()) as MapManifest;
  assert.equal(manifest.version, 1); assert.deepEqual(manifest.requiredFeatures, ['compactMapAssets']);
  const priorBytes = await readFile(join(root, 'transport-report.json')), prior = JSON.parse(priorBytes.toString()) as { sourceRoot: string };
  assert.equal(typeof prior.sourceRoot, 'string');
  const before = JSON.parse(await readFile(join(root, 'runtime-inventory.json'), 'utf8')) as { gzipBytes: number };
  async function raw(artifact: Artifact) {
    assert(resolve(output, artifact.path).startsWith(output + sep), 'Artifact escapes destination');
    const path = await realpath(join(root, artifact.path)); assert(path.startsWith(root + sep), 'Artifact escapes source');
    const bytes = await readFile(path); assert.equal(bytes.length, artifact.bytes); assert.equal(digest(bytes), artifact.sha256, artifact.path); return bytes;
  }
  const graph = manifest.roadGraph, source = await raw(graph);
  const decoded = new Uint8Array(await restoreMapArtifact(Uint8Array.from(source).buffer, graph, 'road', true));
  const encoded = encodeRoadPointTransport(decoded, encodeRoadTransport(decoded)), gzip = gzipSync(encoded, { level: 9 });
  assert.deepEqual(decodeRoadTransport(encoded), decoded, 'Every original graph byte must survive');
  assert(gzip.length < graph.gzipBytes, 'Routing point transport does not improve complete graph gzip');
  const changedGraph: Artifact = { ...graph, bytes: encoded.length, gzipBytes: gzip.length, sha256: digest(encoded),
    transport: 'predictive-v1', decodedBytes: decoded.length, decodedSha256: digest(decoded) };
  assert.deepEqual(new Uint8Array(await restoreMapArtifact(encoded.buffer, changedGraph, 'road', true)), decoded);
  await mkdir(output);
  const artifacts = [graph, ...Object.values(manifest.runtime ?? {}), ...(manifest.neighbourhoods ? [manifest.neighbourhoods] : []),
    ...(manifest.coastline ? [manifest.coastline] : []), ...manifest.chunks.flatMap(c => [...c.lods, c.terrain, c.collision])];
  const done = new Map<string, Artifact>(), records: { path: string; sourceSha256: string; sha256: string; changed: boolean }[] = [];
  for (const artifact of artifacts) {
    const previous = done.get(artifact.path); if (previous) { Object.assign(artifact, previous); continue; }
    const bytes = await raw(artifact), zipped = await readFile(join(root, artifact.path + '.gz'));
    assert.equal(zipped.length, artifact.gzipBytes); assert.deepEqual(gunzipSync(zipped), bytes, artifact.path);
    const changed = artifact.path === graph.path, next = changed ? changedGraph : { ...artifact };
    records.push({ path: artifact.path, sourceSha256: artifact.sha256, sha256: next.sha256, changed });
    await atomicWrite(join(output, artifact.path), changed ? encoded : bytes);
    await atomicWrite(join(output, artifact.path + '.gz'), changed ? gzip : zipped);
    done.set(artifact.path, next); Object.assign(artifact, next);
  }
  manifest.generator += '+road-points-v1'; manifest.stats.budgetBytes = Math.min(manifest.stats.budgetBytes, 25_000_000);
  manifest.stats.gzipBytes = [...done.values()].reduce((n, a) => n + a.gzipBytes, 0); manifest.stats.withinBudget = manifest.stats.gzipBytes <= manifest.stats.budgetBytes;
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  await atomicWrite(join(output, 'manifest.json'), bytes); await atomicWrite(join(output, 'manifest.json.gz'), gzipSync(bytes, { level: 9 }));
  await writeRuntimeInventory(output, manifest);
  const inventory = JSON.parse(await readFile(join(output, 'runtime-inventory.json'), 'utf8')) as { gzipBytes: number; withinMapBudget: boolean };
  const summary = { output, sourceGraphGzipBytes: gzipSync(source, { level: 9 }).length, graphGzipBytes: gzip.length,
    decodedGraphBytes: decoded.length, decodedGraphSha256: digest(decoded), gzipBytes: inventory.gzipBytes,
    savedGzipBytes: before.gzipBytes - inventory.gzipBytes, withinMapBudget: inventory.withinMapBudget };
  await atomicWrite(join(output, 'transport-report.json'), JSON.stringify({ version: 1, sourceRoot: prior.sourceRoot, inputRoot: root, outputRoot: output,
    sourceManifestSha256: digest(sourceManifest), previousTransportReportSha256: digest(priorBytes), implementationSha256: digest(await readFile(new URL(import.meta.url))),
    requiresFeature: 'compactMapAssets', chunks: manifest.chunks.length, sourceDigests: manifest.sourceDigests, everyGraphByteExact: true,
    unchangedArtifacts: records.filter(r => !r.changed).length, beforeGzipBytes: before.gzipBytes, afterGzipBytes: inventory.gzipBytes,
    note: 'Exact graph byte reconstruction; all other runtime raw/gzip bytes carried unchanged. No activation, publication or browser/device acceptance.', ...summary, records,
  }, null, 2) + '\n');
  assert(inventory.gzipBytes < before.gzipBytes); console.log(JSON.stringify(summary));
}
