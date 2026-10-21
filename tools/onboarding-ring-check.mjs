/** Offline check: does the onboarding tutorial's Founder Orientation ring sit on drivable road, so
 * the drive_ring step can actually be completed? Also checks the walk marker and (approx) spawn.
 * No browser/build/server; read-only. Run at the CPU boundary:
 *   tools/heavy.sh node --import tsx tools/onboarding-ring-check.mjs
 * De-risks gtasf-onboarding-smoke-enable-24i2 (onboarding lane, pane 14). Uses the same packed road
 * graph + ground-level road sampler as the running game (within 3.5 m of a lane centreline = on road).
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodePackedRoadGraph } from '../shared/roadgraphPacked.ts';
import { createRoadSampler } from '../web/src/render/chunks/terrain.ts';
import { ORIENTATION_RING, WALK_MARKER } from '../shared/onboarding/tutorial.ts';

const root = resolve(process.env.GTASF_CONTACT_MAP ?? 'tools/map/out/sf');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const packed = decodePackedRoadGraph(Uint8Array.from(await readFile(resolve(root, manifest.roadGraph.path))));

// Points of interest in metres (ring/marker constants are world centimetres).
const toM = p => ({ x: p.x / 100, z: p.z / 100, r: (p.radiusCm ?? 0) / 100 });
const ring = toM(ORIENTATION_RING), walk = toM(WALK_MARKER);
const spawn = { x: 1196.87, z: -1224.31, r: 0 }; // approx LOCAL_SPAWN per shared/onboarding/tutorial.ts comment

// Build only the edges near the tutorial corridor so the sampler stays light.
const minx = Math.min(ring.x, walk.x, spawn.x) - 200, maxx = Math.max(ring.x, walk.x, spawn.x) + 200;
const minz = Math.min(ring.z, walk.z, spawn.z) - 200, maxz = Math.max(ring.z, walk.z, spawn.z) + 200;
const c = packed.columns, roads = [];
for (let i = 0; i < packed.counts.edges; i++) {
  const from = c.edgeFrom[i] * 3, to = c.edgeTo[i] * 3;
  const ax = c.nodeXYZ[from] / 100, bx = c.nodeXYZ[to] / 100, az = c.nodeXYZ[from + 2] / 100, bz = c.nodeXYZ[to + 2] / 100;
  if (Math.max(ax, bx) < minx || Math.min(ax, bx) > maxx || Math.max(az, bz) < minz || Math.min(az, bz) > maxz) continue;
  roads.push(packed.edge(i));
}
const roadAt = createRoadSampler({ nodes: [], edges: roads }); // null => no ground-level lane within 3.5 m

/** Nearest ground-level drivable road to (x,z): { dist, x, z } in metres, or null within maxR. */
function nearestRoad(x, z, maxR = 80) {
  let best = Infinity, bx = null, bz = null;
  for (let dx = -maxR; dx <= maxR; dx += 0.5) for (let dz = -maxR; dz <= maxR; dz += 0.5) {
    const d = Math.hypot(dx, dz);
    if (d > maxR || d >= best) continue;
    if (roadAt(x + dx, z + dz) !== null) { best = d; bx = x + dx; bz = z + dz; }
  }
  return best === Infinity ? null : { dist: best, x: bx, z: bz };
}

console.log(`edges near corridor: ${roads.length}\n`);
for (const [name, p] of [['LOCAL_SPAWN(approx)', spawn], ['WALK_MARKER', walk], ['ORIENTATION_RING', ring]]) {
  const onRoad = roadAt(p.x, p.z) !== null;
  const n = nearestRoad(p.x, p.z);
  console.log(`${name.padEnd(20)} (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) r=${p.r}m  onRoad=${onRoad}  nearestRoad=${n === null ? '>80m' : `${n.dist.toFixed(1)}m @ (${n.x.toFixed(1)}, ${n.z.toFixed(1)})`}`);
}
const n = nearestRoad(ring.x, ring.z);
// A driver can clip the ring while on a lane if some road passes within (ring radius + a lane half-width).
const drivable = n !== null && n.dist <= ring.r + 3.5;
console.log(`\nRING DRIVABLE (a car can pass through the ${ring.r} m ring while on a lane): ${drivable}  [nearest road ${n === null ? '>80m' : n.dist.toFixed(1) + 'm'}]`);
if (!drivable && n) {
  const distFromSpawn = Math.hypot(n.x - spawn.x, n.z - spawn.z);
  console.log(`\nIF relocation is needed, nearest OSM lane to the ring is world cm { x: ${Math.round(n.x * 100)}, z: ${Math.round(n.z * 100)} }  (~${distFromSpawn.toFixed(0)} m from spawn).`);
}
// CAVEAT: this only sees OSM road-graph lanes, NOT authored drivable plaza/paving. The spawn sits ~16 m
// from any lane yet is a "drivable plaza spot", so an off-lane ring near the Ferry plaza may still be
// reachable across authored paving. A non-zero off-lane distance is a RISK FLAG to confirm by driving
// it in-browser (pane 6), not a proven dead-end. Diagnostic only — always exits 0.
console.log('\nNote: OSM lanes only; authored plaza paving is invisible here. Confirm by driving in-browser before trusting a "not drivable" verdict.');
