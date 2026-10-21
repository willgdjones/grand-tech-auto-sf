/** Regression gate for citywide GPS (gtasf-vcaj): the client route-preview uses
 *  createMapRouter(world.routingGraph) where routingGraph = unpacked manifest.roadGraph filtered to
 *  routable edges. A failed route can mean an endpoint has no nearby routable lane OR a directed
 *  path is missing. Neither the URL prefix nor route-null alone identifies the cause.
 *
 *  This checks the thing that actually matters: can the CLIENT router route BOTH ways between the Ferry
 *  corridor and each district, on the real manifest roadGraph? Exits non-zero if any district is
 *  unreachable. This is planar connectivity: omit player height instead of inventing y=0 on hills.
 *  For actual deep-link/contact-height diagnostics use tools/radar-route-smoke.ts. The local
 *  /map/lombard/ alias may already serve SF; terrain-only district bakes do not change this graph.
 *
 *  No browser/build/server; read-only. Run at the CPU boundary:
 *    tools/heavy.sh node --import tsx tools/citywide-routing-connectivity-check.mjs
 *    GTASF_ROUTE_MAP=tools/map/out/sf  (default; point at whichever bake you are gating)
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodePackedRoadGraph, unpackRoadGraph } from '../shared/roadgraphPacked.ts';
import { createMapRouter } from '../web/src/radar/routing.ts';
import { geodeticToWorld } from './map/src/geo.ts';

const root = resolve(process.env.GTASF_ROUTE_MAP ?? 'tools/map/out/sf');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const rg = manifest.roadGraph;
const bytes = await readFile(resolve(root, rg.path));
const decoded = rg.encoding === 'roadpack-v1'
  ? unpackRoadGraph(decodePackedRoadGraph(Uint8Array.from(bytes)))
  : JSON.parse(Buffer.from(bytes).toString());
// Mirror web/src/render/chunks/world.ts exactly: roadpack-v1 routes on the routable-filtered subgraph;
// a plain-JSON graph (no routable field) is used whole.
const routingGraph = rg.encoding === 'roadpack-v1'
  ? { ...decoded, edges: decoded.edges.filter(e => e.routable) }
  : decoded;
const router = createMapRouter(routingGraph);
console.log(`map=${root} roadGraph=${rg.path} enc=${rg.encoding ?? 'json'}`);
console.log(`nodes=${decoded.nodes.length} edges=${decoded.edges.length} routable=${routingGraph.edges.length}`);

const P = (lat, lon) => { const [x, z] = geodeticToWorld(lat, lon, manifest.frame); return { x, z }; };
// Corridor anchor the founder journey starts from (Ferry Building) + the destinations a Sunday player
// is most likely to deep-link / navigate to. Mirrors web/src/spawn/locations.ts PLACES + districts.
const CORRIDOR = { name: 'ferry', ...P(37.795229772, -122.394210973) };
const TARGETS = [
  { name: 'lombard', ...P(37.801995202, -122.419630198) },      // corridor control (must pass)
  { name: 'fidi', ...P(37.7946, -122.4006) },
  { name: 'soma', ...P(37.7785, -122.4056) },
  { name: 'mission', ...P(37.7599, -122.4148) },
  { name: 'dogpatch', ...P(37.7574, -122.3880) },
  { name: 'hayes-valley', ...P(37.7765, -122.4244) },
  { name: 'painted-ladies', ...P(37.7762, -122.4328) },
  { name: 'castro', ...P(37.7609, -122.4350) },
  { name: 'ocean-beach', ...P(37.7594, -122.5107) },
];

let failures = 0;
for (const t of TARGETS) {
  const out = router.route(CORRIDOR, t);   // corridor -> district, no fabricated height
  const back = router.route(t, CORRIDOR);  // district -> corridor
  const ok = Boolean(out && back);
  if (!ok) failures++;
  const fmt = (route, from, to) => route ? `${(route.distanceM / 1000).toFixed(2)}km`
    : !router.snap(from.x, from.z) ? 'NO START LANE' : !router.snap(to.x, to.z) ? 'NO END LANE' : 'NO DIRECTED PATH';
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${t.name.padEnd(16)} ferry→ ${fmt(out, CORRIDOR, t).padEnd(10)} →ferry ${fmt(back, t, CORRIDOR)}`);
}
console.log(`\n${TARGETS.length - failures}/${TARGETS.length} destinations reachable from/to the Ferry corridor.`);
if (failures) {
  console.error(`FAIL: ${failures} destination(s) have a missing endpoint snap or directed route (gtasf-vcaj); inspect the per-direction reason above.`);
  process.exit(1);
}
console.log('PASS: citywide GPS route-preview reaches every checked district.');
