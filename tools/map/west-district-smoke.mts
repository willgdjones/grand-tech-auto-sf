/** Read-only actual-bake smoke. Run via tools/heavy.sh npx tsx tools/map/west-district-smoke.mts. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { decodePackedRoadGraph, unpackRoadGraph } from '../../shared/roadgraphPacked';
import { geodeticToWorld, worldToGeodetic } from './src/geo';
import { SF_FRAME } from './src/config';
import { DISTRICTS_WEST } from './src/districts/west';
import { districtAt } from './src/districts';
import { createRoadSnapper, decodeHeightfield, sampleHeight } from '../../web/src/render/chunks/terrain';

const root = resolve(process.argv[2] ?? 'tools/map/out/sf');
const manifestBytes = await readFile(resolve(root, 'manifest.json'));
const manifest = JSON.parse(manifestBytes.toString());
assert.equal(manifest.roadGraph.encoding, 'roadpack-v1', 'Use the complete packed city bake');
const graphBytes = await readFile(resolve(root, manifest.roadGraph.path));
assert.equal(createHash('sha256').update(graphBytes).digest('hex'), manifest.roadGraph.sha256);
const graph = unpackRoadGraph(decodePackedRoadGraph(graphBytes));
const snap = createRoadSnapper(graph);
const surfaceSnap = createRoadSnapper({ ...graph, edges: graph.edges.filter(e => e.kind === 'lane' && !e.bridge && !e.tunnel && !e.layer) });
const arrivals = [];
for (const district of DISTRICTS_WEST) {
  const [x, z] = geodeticToWorld(district.spawn.lat, district.spawn.lon, SF_FRAME);
  assert.equal(districtAt(x, z)?.id, district.id, `Overlapping profile steals ${district.id} arrival`);
  const arrival = snap(x, z, 100);
  assert.ok(arrival, `${district.id}: no source lane within 100m`);
  assert.ok(Object.values(arrival).every(Number.isFinite));
  const surface = surfaceSnap(x, z, 100);
  assert.ok(surface && Math.hypot(arrival.x - surface.x, arrival.y - surface.y, arrival.z - surface.z) < 0.05,
    `${district.id}: nearest lane selected a bridge, tunnel or junction connector`);
  const id = `${Math.floor(arrival.x / manifest.chunkSize)}_${Math.floor(arrival.z / manifest.chunkSize)}`;
  const chunk = manifest.chunks.find((c: { id: string }) => c.id === id);
  assert.ok(chunk, `${district.id}: snapped chunk missing`);
  const bytes = await readFile(resolve(root, chunk.terrain.path));
  const ground = sampleHeight(decodeHeightfield(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), arrival.x, arrival.z);
  assert.notEqual(ground, null, `${district.id}: arrival has no streamed terrain`);
  // The current coarse DEM need not match lane height; record it rather than hiding that limitation.
  const streets = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind === 'connector' || edge.bridge || edge.tunnel) continue;
    if (edge.points.some(p => districtAt(p[0], p[2])?.id === district.id)) streets.add(edge.name);
  }
  const matched = district.streets.filter(name => streets.has(name));
  const missing = district.streets.filter(name => !streets.has(name));
  assert.ok(matched.length, `${district.id}: no configured detail street appears in the source graph`);
  const geo = worldToGeodetic(arrival.x, arrival.z, SF_FRAME);
  arrivals.push({ district: district.id, chunk: id, distanceM: +Math.hypot(x - arrival.x, z - arrival.z).toFixed(2),
    laneHeightM: +arrival.y.toFixed(2), terrainHeightM: +ground!.toFixed(2),
    link: `/?at=${geo.lat.toFixed(7)},${geo.lon.toFixed(7)},${district.spawn.heading ?? 0}`,
    matchedStreets: matched, missingStreets: missing });
}
console.log(JSON.stringify({ status: 'source-arrivals-pass', manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
  roadGraphSha256: manifest.roadGraph.sha256, arrivals,
  acceptance: 'Source graph + streamed terrain only. Re-bake, in-game collision, desktop/phone visual and payload gates remain.' }, null, 2));
