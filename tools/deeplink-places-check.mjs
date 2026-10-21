/** Offline check: do the deep-link landmark PLACES (web/src/spawn/locations.ts) each snap to a drivable
 * road within the 500 m limit that snapSpawn uses? A landmark with no road within 500 m makes its
 * /go/<slug> throw "No clear road or sidewalk", i.e. a broken founder-journey entry point.
 * No browser/build/server; read-only. Exits non-zero if ANY /go/ target (landmark or district) has no
 * road within the snap limit — usable as a regression gate after a map rebuild. Run at the CPU boundary:
 *   tools/heavy.sh node --import tsx tools/deeplink-places-check.mjs
 * Complements gtasf-2lrv (deep-link snap). Uses the same source road graph + snapper as the client.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodePackedRoadGraph, unpackRoadGraph } from '../shared/roadgraphPacked.ts';
import { createRoadSnapper } from '../web/src/render/chunks/terrain.ts';
import { geodeticToWorld } from './map/src/geo.ts';
import { SF_FRAME } from './map/src/config.ts';
import { DISTRICTS } from './map/src/districts/index.ts';

// Landmark deep-link targets, mirrored from web/src/spawn/locations.ts PLACES (lat/lon).
const PLACES = [
  { slug: 'ferry-building', lat: 37.795229772, lon: -122.394210973 },
  { slug: 'lombard', lat: 37.801995202, lon: -122.419630198 },
  { slug: 'coit-tower', lat: 37.8024, lon: -122.4058 },
  { slug: 'pier-39', lat: 37.8087, lon: -122.4098 },
  { slug: 'transamerica', lat: 37.7952, lon: -122.4028 },
  { slug: 'salesforce-tower', lat: 37.7898, lon: -122.3966 },
  { slug: 'golden-gate-bridge', lat: 37.8078, lon: -122.4750 },
  { slug: 'bay-bridge', lat: 37.7894, lon: -122.3883 },
  { slug: 'painted-ladies', lat: 37.7762, lon: -122.4328 },
  { slug: 'sutro-tower', lat: 37.7552, lon: -122.4528 },
];
const SNAP_LIMIT = 500; // metres — matches snapSpawn's world.nearestRoad(target, 500)

const root = resolve(process.env.GTASF_CONTACT_MAP ?? 'tools/map/out/sf');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const graph = unpackRoadGraph(decodePackedRoadGraph(Uint8Array.from(await readFile(resolve(root, manifest.roadGraph.path)))));
const snap = createRoadSnapper(graph);

console.log(`road edges: ${graph.edges.length}\n`);
function audit(label, targets) {
  let fails = 0;
  console.log(`== ${label} ==`);
  for (const t of targets) {
    const [x, z] = geodeticToWorld(t.lat, t.lon, SF_FRAME);
    const r = snap(x, z, 2000);
    const dist = r ? Math.hypot(x - r.x, z - r.z) : null;
    const ok = dist !== null && dist <= SNAP_LIMIT;
    if (!ok) fails++;
    console.log(`  ${t.slug.padEnd(22)} nearestRoad=${dist === null ? '>2000m' : dist.toFixed(0) + 'm'}  snaps(<=${SNAP_LIMIT}m)=${ok ? 'yes' : 'NO'}`);
  }
  console.log(`  -> ${fails} of ${targets.length} would FAIL to snap within ${SNAP_LIMIT} m.\n`);
  return fails;
}

const districts = DISTRICTS.map(d => ({ slug: d.id, lat: d.spawn.lat, lon: d.spawn.lon }));
const landmarkFails = audit('Landmark /go/<slug> (web/src/spawn/locations.ts PLACES)', PLACES);
const districtFails = audit('District /go/<district-id> (tools/map/src/districts spawn hints)', districts);
console.log(`TOTAL unsnappable: ${landmarkFails} landmarks + ${districtFails} districts.`);
console.log('Note: OSM lanes only (authored plaza/paths invisible); confirm borderline cases in-browser.');
// Regression gate: a deep-link target with no road within the snap limit makes its /go/ throw. Exit
// non-zero so a map rebuild (deploy #5/#6) that shifts a target off-road is caught, not shipped silently.
process.exitCode = (landmarkFails + districtFails) ? 1 : 0;
