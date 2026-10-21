#!/usr/bin/env node
// Whole-city routing coverage acceptance check (gtasf-vcaj / gtasf-zzpr).
//
// NOTE: this reads a raw roadgraph JSON. The whole-city `roadgraph-playable.json` is the LEGACY
// corridor-clipped file (clipped to publishBounds for the 25MB cap) and is NOT what the client routes
// on, so it under-reports (3/13). For the ACTUAL client routing graph (the packed roadgraph.bin the
// client loads + routable-filters) use `npx tsx tools/route-coverage-bin.ts` — that reports the real
// coverage (12/13, whole-city routable). This JSON check is still useful on a non-clipped baked graph.
//
// The map's click-anywhere waypoint + GPS + robotaxi only work for a destination the loaded routing
// graph actually contains and can reach. This verifies the baked graph (a) has road geometry near
// every key SF district and (b) joins them into one reachable component. Run against a candidate graph:
//
//   node tools/route-coverage-check.mjs [path-to-roadgraph.json] [maxNearestMetres]
//
// Defaults to tools/map/out/sf/roadgraph-playable.json, 120 m. Exits non-zero if any district has no
// road within the threshold or is unreachable from the others. Uses the same ECEF→ENU projection as
// web/src/radar/projection.ts (frame origin = the Ferry plaza spawn). Reads the raw node/edge
// geometry; connectivity here is undirected (a necessary condition for directed routing).
import { readFile } from 'node:fs/promises';

const graphPath = process.argv[2] ?? new URL('./map/out/sf/roadgraph-playable.json', import.meta.url).pathname;
const MAX_NEAREST_M = Number(process.argv[3] ?? 120);
// Frame origin matches the manifest frame / the Ferry Building default spawn.
const ORIGIN = { lat: 37.7842, lon: -122.4078 };
// Key districts the Sunday playtest must be able to navigate to (PLAN-v2 citywide map).
const DISTRICTS = [
  ['Ferry Building', 37.7955, -122.3937], ['Lombard', 37.8021, -122.4188], ['North Beach', 37.8003, -122.4103],
  ['SoMa', 37.7785, -122.3990], ['Mission', 37.7599, -122.4148], ['Castro', 37.7609, -122.4350],
  ['Hayes Valley', 37.7765, -122.4245], ['The Richmond', 37.7800, -122.4700], ['The Sunset', 37.7530, -122.4940],
  ['Golden Gate Park', 37.7694, -122.4862], ['Marina', 37.8037, -122.4368], ['Potrero Hill', 37.7580, -122.4000],
  ['Bayview', 37.7290, -122.3900],
];

const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f);
const ecef = (lat, lon) => { const phi = lat * rad, lam = lon * rad, n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  return [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - e2) * Math.sin(phi)]; };
function project(lat, lon) {
  const a = ecef(ORIGIN.lat, ORIGIN.lon), b = ecef(lat, lon);
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], phi = ORIGIN.lat * rad, lam = ORIGIN.lon * rad;
  const east = -Math.sin(lam) * dx + Math.cos(lam) * dy;
  const north = -Math.sin(phi) * Math.cos(lam) * dx - Math.sin(phi) * Math.sin(lam) * dy + Math.cos(phi) * dz;
  return { x: east, z: -north };
}

const g = JSON.parse(await readFile(graphPath, 'utf8'));
const nodes = g.nodes ?? [], edges = g.edges ?? [];
// DIRECTED adjacency, matching the real router (routing.ts path() follows edge.from -> edge.to only).
// A district can have road nodes yet be unroutable if one-way streets cut it off directionally, which an
// undirected check would miss — so we require a round trip: Ferry -> district AND district -> Ferry.
const fwd = new Map();
for (const e of edges) (fwd.get(e.from) ?? fwd.set(e.from, []).get(e.from)).push(e.to);
const nearest = (p) => { let best = null, bd = Infinity; for (const n of nodes) { const d = Math.hypot(n.x - p.x, n.z - p.z); if (d < bd) { bd = d; best = n; } } return { node: best, dist: bd }; };
const reaches = (a, b) => { if (!a || !b) return false; const seen = new Set([a]), q = [a]; while (q.length) { const c = q.pop(); if (c === b) return true; for (const m of fwd.get(c) ?? []) if (!seen.has(m)) { seen.add(m); q.push(m); } } return false; };
const reachable = (a, b) => reaches(a, b) && reaches(b, a); // round-trip, directed

console.log(`route-coverage-check: ${graphPath.split('/').slice(-3).join('/')}  nodes=${nodes.length} edges=${edges.length} threshold=${MAX_NEAREST_M}m`);
const present = [];
let missing = 0;
for (const [name, lat, lon] of DISTRICTS) {
  const { node, dist } = nearest(project(lat, lon));
  const ok = dist <= MAX_NEAREST_M;
  if (ok) present.push({ name, id: node.id }); else missing++;
  console.log(`  ${ok ? 'OK ' : 'MISSING'}  ${name.padEnd(18)} nearest road ${dist.toFixed(0)}m`);
}
let disconnected = 0;
if (present.length > 1) {
  const anchor = present[0];
  for (const d of present.slice(1)) if (!reachable(anchor.id, d.id)) { disconnected++; console.log(`  UNREACHABLE (directed round-trip)  ${anchor.name} <-> ${d.name}`); }
}
const pass = missing === 0 && disconnected === 0;
console.log(`\n${pass ? 'PASS' : 'FAIL'}: ${present.length}/${DISTRICTS.length} districts have roads; ${missing} missing, ${disconnected} unreachable from ${present[0]?.name ?? '-'}.`);
if (!pass) console.log('Whole-city routing not ready — distant destinations will show "outside the drivable local area" (gtasf-vcaj). Re-run as districts bake.');
process.exit(pass ? 0 : 1);
