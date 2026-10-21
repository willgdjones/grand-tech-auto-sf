/** Actual client graph smoke, not the legacy corridor-clipped audit JSON.
 * tools/heavy.sh npx tsx tools/radar-route-smoke.ts [manifest path or URL]
 * Default uses the same GTASF_MAP_AREA / active-map.json selection as localMapPlugin.
 * Reports start/end snaps separately from A* failure. Read-only: never repacks a map.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { flags } from '../shared/flags';
import type { RoadGraph } from '../shared/roadgraph';
import { decodePackedRoadGraph, unpackRoadGraph } from '../shared/roadgraphPacked';
import { restoreMapArtifact, type TransportMetadata } from '../shared/mapTransport';
import { geodeticToWorld, type WorldFrame } from './map/src/geo';
import { createRoadSnapper } from '../web/src/render/chunks/terrain';
import { createMapRouter, type RoadSnap } from '../web/src/radar/routing';

interface Manifest {
  frame: WorldFrame;
  chunks: unknown[];
  roadGraph: TransportMetadata & { path: string; encoding?: string; bytes: number; sha256: string };
}
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
async function read(url: URL): Promise<Uint8Array<ArrayBuffer>> {
  if (url.protocol === 'file:') return Uint8Array.from(await readFile(url));
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  assert(response.ok, `${response.status} ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}
let source = process.argv[2];
if (!source) {
  const active = await readFile('tools/map/out/active-map.json', 'utf8').then(text => JSON.parse(text) as { area: string }).catch(() => null);
  const area = process.env.GTASF_MAP_AREA ?? active?.area ?? 'lombard';
  assert.match(area, /^[a-z0-9_-]+$/);
  source = `tools/map/out/${area}/manifest.json`;
}
const url = /^[a-z]+:/i.test(source) ? new URL(source) : pathToFileURL(resolve(source));
const manifestBytes = await read(url), manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Manifest;
const artifact = manifest.roadGraph, graphBytes = await read(new URL(artifact.path, url));
assert.equal(graphBytes.length, artifact.bytes, 'Manifest graph byte size');
assert.equal(sha(graphBytes), artifact.sha256, 'Manifest graph identity');
let graph: RoadGraph, routingGraph: RoadGraph;
if (artifact.encoding === 'roadpack-v1') {
  const restored = await restoreMapArtifact(graphBytes.buffer, artifact, 'road', flags.compactMapAssets);
  const unpacked = unpackRoadGraph(decodePackedRoadGraph(restored));
  graph = unpacked;
  routingGraph = { ...unpacked, edges: unpacked.edges.filter(edge => edge.routable) };
} else {
  graph = routingGraph = JSON.parse(new TextDecoder().decode(graphBytes)) as RoadGraph;
}
const router = createMapRouter(routingGraph), spawnSnap = createRoadSnapper(graph);
const places = {
  ferry: [37.795229772, -122.394210973], lombard: [37.801995202, -122.419630198],
  mission: [37.7599, -122.4148], painted: [37.7762, -122.4328],
  moscone: [37.7841202, -122.4014765], fidi: [37.7933948, -122.4028417],
  dogpatch: [37.7602018, -122.3886700], soma: [37.7784664, -122.4036573],
} satisfies Record<string, [number, number]>;
type Place = keyof typeof places;
const point = (name: Place) => {
  const [lat, lon] = places[name], [x, z] = geodeticToWorld(lat, lon, manifest.frame);
  return { x, z };
};
const describe = (snap: RoadSnap | null) => snap && ({ edge: snap.edge.id, point: snap.point, distanceM: snap.distance, alongM: snap.along });
const pairs: [Place, Place][] = [
  ['ferry', 'lombard'], ['mission', 'lombard'], ['mission', 'ferry'], ['painted', 'ferry'],
  ['ferry', 'moscone'], ['ferry', 'fidi'], ['ferry', 'dogpatch'], ['ferry', 'soma'],
];
const routes = pairs.map(([from, to]) => {
  const requested = point(from), destination = point(to);
  // Explicit deep links first snap against the full contact graph; the router then
  // must find a routable lane at that player's deck height. Keep both results.
  const arrival = spawnSnap(requested.x, requested.z, 500);
  const start = arrival ?? requested;
  const startSnap = router.snap(start.x, start.z, 150, arrival?.y), endSnap = router.snap(destination.x, destination.z);
  const planarStart = router.snap(start.x, start.z);
  const route = router.route(start, destination);
  let gap = 0;
  if (route) for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1]!, b = route.points[i]!;
    gap = Math.max(gap, Math.hypot(b[0] - a[0], b[2] - a[2]));
  }
  return { from, to, requested, arrival, startSnap: describe(startSnap), planarStart: describe(planarStart), endSnap: describe(endSnap),
    passed: Boolean(route), failure: route ? null : !startSnap ? 'start-snap' : !endSnap ? 'destination-snap' : 'directed-path',
    metres: route?.distanceM, points: route?.points.length, maxSegmentM: gap, destinationDistanceM: route?.destinationDistanceM };
});
const report = { source: url.href, manifestSha256: sha(manifestBytes), graphSha256: artifact.sha256,
  frame: manifest.frame, chunks: manifest.chunks.length, nodes: graph.nodes.length, edges: graph.edges.length,
  routableEdges: routingGraph.edges.length, compactMapAssets: flags.compactMapAssets, routes };
console.log(JSON.stringify(report, null, 2));
assert(routes.every(route => route.passed), `Failed routes: ${routes.filter(route => !route.passed).map(route => `${route.from}->${route.to} (${route.failure})`).join(', ')}`);
assert(routes.every(route => Number.isFinite(route.metres) && (route.metres ?? 0) > 0 && (route.points ?? 0) >= 2), 'GPS returns usable source-road paths');
assert.equal(router.route(point('ferry'), { x: 100_000, z: 100_000 }), null, 'Unmapped destination remains unavailable');
