/** Offline check: is the core founder-journey DRIVE connected in the routable road graph?
 * The v1 journey drives/robotaxis from the Ferry spawn to Lombard (~1.8 km); deep-link spawns can start
 * anywhere (e.g. Mission). The client router (createMapRouter, radar.ts) routes over DIRECTED routable
 * edges, so this checks both directed reachability (what the router can actually path) and the
 * undirected component (whether a start is on an island). A map rebuild (deploy #5/#6) could disconnect
 * a route. Read-only, no browser. Exits non-zero if any key DIRECTED route is unreachable (regression gate).
 *   tools/heavy.sh node --import tsx tools/route-connectivity-check.mjs
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodePackedRoadGraph } from '../shared/roadgraphPacked.ts';
import { geodeticToWorld } from './map/src/geo.ts';
import { SF_FRAME } from './map/src/config.ts';
import { DISTRICTS } from './map/src/districts/index.ts';

const ROUTABLE = 32; // ROAD_EDGE_FLAGS.routable
const district = id => { const d = DISTRICTS.find(x => x.id === id); return { lat: d.spawn.lat, lon: d.spawn.lon }; };
const STARTS = [['Ferry', { lat: 37.795229772, lon: -122.394210973 }], ['Mission', { lat: 37.7599, lon: -122.4148 }]];
const DESTS = [['lombard', { lat: 37.801995202, lon: -122.419630198 }], ['soma', district('soma')], ['fidi', district('fidi')]];

const root = resolve(process.env.GTASF_CONTACT_MAP ?? 'tools/map/out/sf');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const packed = decodePackedRoadGraph(Uint8Array.from(await readFile(resolve(root, manifest.roadGraph.path))));
const c = packed.columns, nodeCount = packed.counts.nodes, edgeCount = packed.counts.edges;

function nearestNode(lat, lon) {
  const [tx, tz] = geodeticToWorld(lat, lon, SF_FRAME);
  let best = Infinity, bi = -1;
  for (let i = 0; i < nodeCount; i++) {
    const dx = c.nodeXYZ[i * 3] / 100 - tx, dz = c.nodeXYZ[i * 3 + 2] / 100 - tz, d = dx * dx + dz * dz;
    if (d < best) { best = d; bi = i; }
  }
  return { index: bi, dist: Math.sqrt(best) };
}

// Directed (from->to) and undirected adjacency over ROUTABLE edges.
const dir = Array.from({ length: nodeCount }, () => []);
const und = Array.from({ length: nodeCount }, () => []);
let routableEdges = 0;
for (let i = 0; i < edgeCount; i++) {
  if (!(c.edgeFlags[i] & ROUTABLE)) continue;
  routableEdges++;
  const a = c.edgeFrom[i], b = c.edgeTo[i];
  dir[a].push(b);
  und[a].push(b); und[b].push(a);
}
function bfs(adj, start) {
  const seen = new Uint8Array(nodeCount); const q = [start]; seen[start] = 1; let n = 1;
  for (let h = 0; h < q.length; h++) for (const m of adj[q[h]]) if (!seen[m]) { seen[m] = 1; n++; q.push(m); }
  return { seen, reached: n };
}

console.log(`nodes=${nodeCount} routableEdges=${routableEdges}\n`);
const nodes = new Map();
for (const [name, p] of [...STARTS, ...DESTS]) nodes.set(name, nearestNode(p.lat, p.lon));
let fails = 0;
for (const [sName] of STARTS) {
  const s = nodes.get(sName);
  const d = bfs(dir, s.index), u = bfs(und, s.index);
  console.log(`${sName} node #${s.index} (${s.dist.toFixed(0)} m snap): directed reaches ${(100 * d.reached / nodeCount).toFixed(1)}%, undirected component ${(100 * u.reached / nodeCount).toFixed(1)}%`);
  for (const [dName] of DESTS) {
    const t = nodes.get(dName);
    const dOk = d.seen[t.index] === 1, uOk = u.seen[t.index] === 1;
    const verdict = dOk ? 'routable' : uOk ? 'ONE-WAY-ONLY (undirected-connected, directed-blocked)' : 'ISLAND (not in same component)';
    if (!dOk) fails++;
    console.log(`  ${sName} -> ${dName.padEnd(8)} directed=${dOk ? 'yes' : 'NO'} undirected=${uOk ? 'yes' : 'NO'}  [${verdict}]`);
  }
  console.log('');
}
console.log(`${fails} directed route(s) unreachable (the client router returns "outside the drivable local area" for these).`);
process.exitCode = fails ? 1 : 0;
