/** Retire only audited legacy route JSON after all compact consumers use the
 * already-loaded city graph. Separate output, exact preserved asset hashes. */
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { restoreMapArtifact } from '../../shared/mapTransport';
import { decodePackedRoadGraph, unpackRoadGraph } from '../../shared/roadgraphPacked';
import { createMapRouter } from '../../web/src/radar/routing';
import { writeRuntimeInventory } from './src/pipeline/runtime';
import { atomicWrite, digest } from './src/pipeline/sources';
import type { Artifact, MapManifest } from './src/pipeline/types';

const [input, destination, optIn] = process.argv.slice(2);
assert(input && destination && optIn === '--experimental-compact-map', 'Usage: tools/heavy.sh npx tsx tools/map/compact-runtime-audit.mts SOURCE NEW_OUTPUT --experimental-compact-map');
const root = await realpath(input), output = resolve(destination);
assert(output !== root && !root.startsWith(output + sep) && !output.startsWith(root + sep), 'Use a separate output directory');
const sourceManifest = await readFile(join(root, 'manifest.json')), manifest = JSON.parse(sourceManifest.toString()) as MapManifest;
assert.equal(manifest.version, 1); assert.deepEqual(manifest.requiredFeatures, ['compactMapAssets']);
assert.equal(manifest.roadGraph.encoding, 'roadpack-v1');
const previousBytes = await readFile(join(root, 'transport-report.json'));
const previous = JSON.parse(previousBytes.toString()) as { sourceRoot: string };
assert.equal(typeof previous.sourceRoot, 'string');
const before = JSON.parse(await readFile(join(root, 'runtime-inventory.json'), 'utf8')) as { gzipBytes: number };
const retiredPaths = ['roadgraph-playable.json', 'roadgraph-local-play.json', 'local-play.json'];
const retired = retiredPaths.map(path => {
  const artifact = manifest.runtime?.[path]; assert(artifact && artifact.path === path, `Expected audited input ${path}`); return artifact;
});
const checked = new Map<string, { raw: Buffer; gzip: Buffer }>();
async function read(artifact: Artifact) {
  const old = checked.get(artifact.path); if (old) return old;
  assert(resolve(output, artifact.path).startsWith(output + sep));
  const path = await realpath(join(root, artifact.path)); assert(path.startsWith(root + sep));
  const raw = await readFile(path), gzip = await readFile(path + '.gz');
  assert.equal(raw.length, artifact.bytes); assert.equal(digest(raw), artifact.sha256, artifact.path);
  assert.equal(gzip.length, artifact.gzipBytes); assert.deepEqual(gunzipSync(gzip), raw);
  const result = { raw, gzip }; checked.set(artifact.path, result); return result;
}
for (const artifact of retired) await read(artifact);
const graphBytes = await restoreMapArtifact(Uint8Array.from((await read(manifest.roadGraph)).raw).buffer, manifest.roadGraph, 'road', true);
const decoded = unpackRoadGraph(decodePackedRoadGraph(graphBytes));
const router = createMapRouter({ ...decoded, edges: decoded.edges.filter(edge => edge.routable) });
const hilltop = { x: -1041.863, z: -1975.201 }, bottom = { x: -897.138, z: -1999.980 };
const journeys = [
  { name: 'cinematic-lombard', from: hilltop, to: bottom },
  { name: 'ferry-to-lombard', from: { x: 1196.869, z: -1224.309 }, to: hilltop },
].map(journey => {
  const route = router.route(journey.from, journey.to); assert(route && route.points.length > 2, journey.name);
  assert(route.points.every(point => point.every(Number.isFinite)) && route.destinationDistanceM < 150);
  return { name: journey.name, distanceM: route.distanceM, points: route.points.length,
    minimumHeightM: Math.min(...route.points.map(p => p[1])), maximumHeightM: Math.max(...route.points.map(p => p[1])), destinationDistanceM: route.destinationDistanceM };
});
// Keep any other explicitly inventoried runtime resources. Only these three
// concrete files have had every runtime caller audited and migrated.
manifest.runtime = Object.fromEntries(Object.entries(manifest.runtime ?? {}).filter(([path]) => !retiredPaths.includes(path)));
const unique = new Map<string, Artifact>();
for (const artifact of [manifest.roadGraph, ...Object.values(manifest.runtime), ...(manifest.neighbourhoods ? [manifest.neighbourhoods] : []),
  ...(manifest.coastline ? [manifest.coastline] : []), ...manifest.chunks.flatMap(c => [...c.lods, c.terrain, c.collision])]) unique.set(artifact.path, artifact);
await mkdir(output); // Reject replacement of any existing candidate.
for (const artifact of unique.values()) {
  const { raw, gzip } = await read(artifact);
  await atomicWrite(join(output, artifact.path), raw); await atomicWrite(join(output, artifact.path + '.gz'), gzip);
}
manifest.generator += '+shared-cinematic-graph'; manifest.stats.budgetBytes = Math.min(manifest.stats.budgetBytes, 25_000_000);
manifest.stats.gzipBytes = [...unique.values()].reduce((sum, a) => sum + a.gzipBytes, 0);
manifest.stats.withinBudget = manifest.stats.gzipBytes <= manifest.stats.budgetBytes;
const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
await atomicWrite(join(output, 'manifest.json'), bytes); await atomicWrite(join(output, 'manifest.json.gz'), gzipSync(bytes, { level: 9 }));
await writeRuntimeInventory(output, manifest);
const inventory = JSON.parse(await readFile(join(output, 'runtime-inventory.json'), 'utf8')) as { gzipBytes: number; withinMapBudget: boolean };
assert(inventory.gzipBytes < before.gzipBytes);
await atomicWrite(join(output, 'transport-report.json'), JSON.stringify({ version: 1, sourceRoot: previous.sourceRoot, inputRoot: root, outputRoot: output,
  sourceManifestSha256: digest(sourceManifest), previousTransportReportSha256: digest(previousBytes), scriptSha256: digest(await readFile(new URL(import.meta.url))),
  requiresFeature: 'compactMapAssets', chunks: manifest.chunks.length, sourceDigests: manifest.sourceDigests, retiredRuntimeArtifacts: retired,
  retiredRuntimeGzipBytes: retired.reduce((sum, a) => sum + a.gzipBytes, 0), unchangedArtifacts: unique.size, journeys,
  beforeGzipBytes: before.gzipBytes, afterGzipBytes: inventory.gzipBytes, savedGzipBytes: before.gzipBytes - inventory.gzipBytes,
  withinMapBudget: inventory.withinMapBudget,
  consumerAudit: { cinematic: 'compact world.routingGraph; ordinary map keeps legacy fetch', radar: 'main.ts passes world.routingGraph',
    workerLocalFallback: 'embedded localRoadData.ts; no file fetch', sourceRetention: root },
  note: 'All retained assets copied with exact raw/gzip integrity checks. Source audit JSON retained in immutable input. No geometry, collision, contact or graph changes; no activation/publication/visual or device claim.',
}, null, 2) + '\n');
console.log(JSON.stringify({ output, gzipBytes: inventory.gzipBytes, savedGzipBytes: before.gzipBytes - inventory.gzipBytes, journeys, withinMapBudget: inventory.withinMapBudget }));
