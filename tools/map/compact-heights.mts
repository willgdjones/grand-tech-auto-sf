/** Incremental lossless surface-height prediction. Run through heavy.sh.
 * A fresh candidate only; every source contact/collision/routing asset is retained.
 * Runtime support and native evidence are required before any activation.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { restoreMapArtifact } from '../../shared/mapTransport';
import { packHeightPredictedMesh } from './src/pipeline/compactHeightPredictor';
import { writeRuntimeInventory } from './src/pipeline/runtime';
import { atomicWrite, digest } from './src/pipeline/sources';
import type { Artifact, MapManifest } from './src/pipeline/types';

const [input, destination, optIn] = process.argv.slice(2);
assert(input && destination && optIn === '--experimental-compact-map', 'Usage: tools/heavy.sh npx tsx tools/map/compact-heights.mts SOURCE NEW_OUTPUT --experimental-compact-map');
const root = await realpath(input), output = resolve(destination);
assert(output !== root && !root.startsWith(output + sep) && !output.startsWith(root + sep), 'Use a separate output directory');
const sourceManifest = await readFile(join(root, 'manifest.json')), manifest = JSON.parse(sourceManifest.toString()) as MapManifest;
assert.equal(manifest.version, 1); assert.deepEqual(manifest.requiredFeatures, ['compactMapAssets']);
const previousReportBytes = await readFile(join(root, 'transport-report.json'));
const previous = JSON.parse(previousReportBytes.toString()) as { sourceRoot: string };
assert.equal(typeof previous.sourceRoot, 'string');
const beforeInventory = JSON.parse(await readFile(join(root, 'runtime-inventory.json'), 'utf8')) as { gzipBytes: number };
const fields = new Map(manifest.chunks.flatMap(c => c.lods.map(a => [a.path, { ...c.terrain }] as const)));
const all = [manifest.roadGraph, ...Object.values(manifest.runtime ?? {}), ...(manifest.neighbourhoods ? [manifest.neighbourhoods] : []),
  ...(manifest.coastline ? [manifest.coastline] : []), ...manifest.chunks.flatMap(c => [...c.lods, c.terrain, c.collision])];
const zip = (bytes: Uint8Array) => gzipSync(bytes, { level: 9 });
async function checkedRead(asset: Artifact): Promise<Buffer> {
  assert(resolve(output, asset.path).startsWith(output + sep), 'Artifact escapes destination');
  const path = await realpath(join(root, asset.path)); assert(path.startsWith(root + sep), 'Artifact escapes source');
  const bytes = await readFile(path); assert.equal(bytes.length, asset.bytes); assert.equal(digest(bytes), asset.sha256, asset.path);
  return bytes;
}
await mkdir(output); // EEXIST intentionally rejects replacing any existing candidate.
let changed = 0, predictedVertices = 0, predictedStreams = 0;
const done = new Map<string, Artifact>(), records: { path: string; sourceSha256: string; sha256: string; sourceGzipBytes: number; gzipBytes: number; changed: boolean; sourceEncoding?: string }[] = [];
for (const artifact of all) {
  const prior = done.get(artifact.path); if (prior) { Object.assign(artifact, prior); continue; }
  const source = await checkedRead(artifact), oldGzip = await readFile(join(root, artifact.path + '.gz'));
  assert.equal(oldGzip.length, artifact.gzipBytes); assert.deepEqual(gunzipSync(oldGzip), source, `Source gzip ${artifact.path}`);
  let bytes: Uint8Array = source, gzip = oldGzip, meshEncoding = artifact.meshEncoding;
  const fieldArtifact = fields.get(artifact.path);
  if (fieldArtifact) {
    const fieldSource = await checkedRead(fieldArtifact);
    const fieldBytes = new Uint8Array(await restoreMapArtifact(Uint8Array.from(fieldSource).buffer, fieldArtifact, 'height', true));
    const packed = await packHeightPredictedMesh(source, fieldBytes);
    if (packed.used) {
      const compressed = zip(packed.bytes); assert(compressed.length < oldGzip.length);
      bytes = packed.bytes; gzip = compressed; meshEncoding = 'height-predicted-v1';
      changed++; predictedVertices += packed.predictedVertices; predictedStreams += packed.streams;
    }
  }
  const hash = digest(bytes), converted: Artifact = { ...artifact, bytes: bytes.length, gzipBytes: gzip.length, sha256: hash,
    ...(meshEncoding ? { meshEncoding } : {}) };
  records.push({ path: artifact.path, sourceSha256: artifact.sha256, sha256: hash, sourceGzipBytes: artifact.gzipBytes, gzipBytes: gzip.length, changed: hash !== artifact.sha256, sourceEncoding: artifact.meshEncoding });
  await atomicWrite(join(output, artifact.path), bytes); await atomicWrite(join(output, artifact.path + '.gz'), gzip);
  done.set(artifact.path, converted); Object.assign(artifact, converted);
}
manifest.generator += '+height-prediction-v1';
manifest.stats.budgetBytes = Math.min(manifest.stats.budgetBytes, 25_000_000);
manifest.stats.gzipBytes = [...done.values()].reduce((sum, a) => sum + a.gzipBytes, 0);
manifest.stats.withinBudget = manifest.stats.gzipBytes <= manifest.stats.budgetBytes;
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
await atomicWrite(join(output, 'manifest.json'), manifestBytes); await atomicWrite(join(output, 'manifest.json.gz'), zip(manifestBytes));
await writeRuntimeInventory(output, manifest);
const inventory = JSON.parse(await readFile(join(output, 'runtime-inventory.json'), 'utf8')) as { gzipBytes: number; withinMapBudget: boolean };
await atomicWrite(join(output, 'transport-report.json'), JSON.stringify({ version: 1, sourceRoot: previous.sourceRoot, inputRoot: root, outputRoot: output,
  sourceManifestSha256: digest(sourceManifest), previousTransportReportSha256: digest(previousReportBytes), scriptSha256: digest(await readFile(new URL(import.meta.url))),
  requiresFeature: 'compactMapAssets', chunks: manifest.chunks.length, sourceDigests: manifest.sourceDigests, legacyRuntimePaths: Object.keys(manifest.runtime ?? {}),
  heightPrediction: { eligibleFiles: fields.size, changed, predictedVertices, predictedStreams, everyVertexIndexColorAndTransformBitExact: true },
  unchangedArtifacts: records.filter(r => !r.changed).length, beforeGzipBytes: beforeInventory.gzipBytes, afterGzipBytes: inventory.gzipBytes,
  savedGzipBytes: beforeInventory.gzipBytes - inventory.gzipBytes, withinMapBudget: inventory.withinMapBudget,
  note: 'Complete isolated incremental candidate. Every input raw/gzip artifact checked; every compact leaf decoded and compared in full, preserving all recipe records and seam selection masks. Original ordinary source root retained only to pair its authored street-detail assets. No activation, publication or visual/device acceptance.', records,
}, null, 2) + '\n');
assert(changed > 0 && inventory.gzipBytes < beforeInventory.gzipBytes, 'No measured whole-candidate saving');
console.log(JSON.stringify({ output, changed, beforeGzipBytes: beforeInventory.gzipBytes, afterGzipBytes: inventory.gzipBytes,
  savedGzipBytes: beforeInventory.gzipBytes - inventory.gzipBytes, withinMapBudget: inventory.withinMapBudget, activated: false }));
