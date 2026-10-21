/** Read-only cached-bake check: tools/heavy.sh npx tsx tools/map/south-district-source-smoke.mts [map-root] */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodePackedRoadGraph, type PackedPublicEdge } from '../../shared/roadgraphPacked';
import { createRoadSnapper, decodeHeightfield, sampleHeight } from '../../web/src/render/chunks/terrain';
import { districtAt } from './src/districts';
import { DISTRICTS_SOUTH } from './src/districts/south';
import { project } from './src/pipeline/settings';
import type { MapManifest } from './src/pipeline/types';

const root = resolve(process.argv[2] ?? 'tools/map/out/sf');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(resolve(root, 'manifest.json'));
const manifest = JSON.parse(manifestBytes.toString()) as MapManifest;
assert.equal(manifest.roadGraph.encoding, 'roadpack-v1', 'Use the complete packed city graph');
const bytes = await readFile(resolve(root, manifest.roadGraph.path));
assert.equal(hash(bytes), manifest.roadGraph.sha256, 'Road graph must match its manifest');
const graph = decodePackedRoadGraph(bytes), strings: (string | undefined)[] = [];
const radius = 25;
const arrivals = DISTRICTS_SOUTH.map(profile => ({
  profile, point: project(profile.spawn.lon, profile.spawn.lat),
  edges: [] as PackedPublicEdge[], streets: new Set<string>(),
}));
// Decode one edge at a time. Keep every segment whose bounds can touch a 25 m
// arrival query, including connectors/decks/tunnels and source ordering. The
// excerpt therefore gives the same nearest result as a full-city runtime query
// without allocating a second expanded city graph on the shared laptop.
for (let i = 0; i < graph.counts.edges; i++) {
  const points = graph.edgePoints(i);
  const name = graph.string(graph.columns.edgeName[i]!, strings);
  let edge: PackedPublicEdge | undefined;
  for (const arrival of arrivals) {
    const [x, z] = arrival.point;
    if (points.some((b, j) => {
      const a = points[j - 1];
      return a && Math.max(a[0], b[0]) >= x - radius && Math.min(a[0], b[0]) <= x + radius
        && Math.max(a[2], b[2]) >= z - radius && Math.min(a[2], b[2]) <= z + radius;
    })) arrival.edges.push(edge ??= graph.edge(i, strings));
    if (arrival.profile.streets.includes(name)
      && points.some(p => districtAt(p[0], p[2])?.id === arrival.profile.id)) arrival.streets.add(name);
  }
}
const report = [];
for (const { profile, point: [x, z], edges, streets } of arrivals) {
  assert.equal(districtAt(x, z)?.id, profile.id, `Another art region steals ${profile.id}`);
  const localGraph = { version: 1 as const, nodes: [], edges };
  const snap = createRoadSnapper(localGraph)(x, z, radius);
  assert.ok(snap, `${profile.id}: no source road within ${radius} m`);
  const surface = createRoadSnapper({ ...localGraph, edges: edges.filter(e =>
    e.kind === 'lane' && !e.bridge && !e.tunnel && !e.layer && e.name === profile.streets[0]) })(x, z, radius);
  assert.ok(surface && Math.hypot(snap.x - surface.x, snap.y - surface.y, snap.z - surface.z) < .05,
    `${profile.id}: nearest source contact must be its primary surface street`);
  assert.ok(Math.hypot(snap.x - x, snap.z - z) < .1, `${profile.id}: hint drifted away from its source lane`);
  const chunkId = `${Math.floor(snap.x / manifest.chunkSize)}_${Math.floor(snap.z / manifest.chunkSize)}`;
  const chunk = manifest.chunks.find(c => c.id === chunkId);
  assert.ok(chunk, `${profile.id}: snapped chunk is absent`);
  const terrainBytes = await readFile(resolve(root, chunk.terrain.path));
  assert.equal(hash(terrainBytes), chunk.terrain.sha256);
  const field = decodeHeightfield(terrainBytes.buffer.slice(terrainBytes.byteOffset, terrainBytes.byteOffset + terrainBytes.byteLength));
  const ground = sampleHeight(field, snap.x, snap.z);
  assert.ok(ground !== null && Number.isFinite(ground), `${profile.id}: missing terrain contact`);
  const missing = profile.streets.filter(name => !streets.has(name));
  assert.deepEqual(missing, [], `${profile.id}: configured streets absent from sourced district`);
  report.push({ district: profile.id, street: profile.streets[0], chunk: chunkId,
    distanceM: +Math.hypot(snap.x - x, snap.z - z).toFixed(4),
    laneHeightM: +snap.y.toFixed(2), terrainHeightM: +ground.toFixed(2),
    link: `/?at=${profile.spawn.lat},${profile.spawn.lon},${profile.spawn.heading ?? 0}`,
    matchedStreets: profile.streets });
}
console.log(JSON.stringify({ status: 'source-arrivals-pass', manifestSha256: hash(manifestBytes),
  roadGraphSha256: manifest.roadGraph.sha256, arrivals: report,
  acceptance: 'Cached source lanes and terrain only. Rebuilt geometry, runtime collision, desktop/phone visuals and payload gates remain.' }, null, 2));
