/** Offline placement check. Run with: node --import tsx tools/ferry-placement-clearance.mjs
 * Uses current source transforms/routes and the cached sources of the emitted SF map.
 * This is road placement evidence, not visual, frame-rate or real-device acceptance.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { Vector3 } from 'three';
import { createPlacedLandmarks } from '../web/src/render/landmarks/landmarks.ts';
import { FERRY_PEDESTRIAN_ROUTES } from '../web/src/render/ferryPedestrians.ts';
import { COFFEE_CART, COFFEE_QUEUE, COFFEE_COUNTER_HALF_EXTENTS, COFFEE_CART_EXTENTS, COFFEE_YIELD_DISTANCE } from '../web/src/render/coffeeQueue.ts';
import { decodePackedRoadGraph } from '../shared/roadgraphPacked.ts';
import { extractRoads, isDrivable } from './map/src/pipeline/osm.ts';
import { resample, offsetPath, gradeSeparated } from './map/src/pipeline/roads.ts';
import { containsRing } from './map/src/pipeline/geometry.ts';

const mapRoot = resolve(process.env.GTASF_PLACEMENT_MAP ?? 'tools/map/out/sf');
const cache = resolve(process.env.GTASF_PLACEMENT_CACHE ?? 'tools/map/out/cache/sf');
const nativePath = resolve(process.env.GTASF_PLACEMENT_NATIVE ?? 'artifacts/ferry-pedestrians/game-1308/report.json');
const output = resolve(process.env.GTASF_PLACEMENT_OUT ?? 'artifacts/ferry-pedestrians/placement-current.json');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const native = await json(nativePath), nativeActors = native.views.flatMap(view => view.actors);
assert.ok(nativeActors.length, 'Saved actual-game actor coordinates are required');
const landmarks = createPlacedLandmarks({ enabled: true, ids: ['ferry-building'], heightAt: () => nativeActors[0].position[1] });
const ferry = landmarks.children[0]; ferry.updateWorldMatrix(true, false);
const world = ([x, z]) => { const p = new Vector3(x, .18, z).applyMatrix4(ferry.matrixWorld); return [p.x, p.z]; };
const matrixError = Math.max(...nativeActors.map(actor => new Vector3(...actor.local).applyMatrix4(ferry.matrixWorld).distanceTo(new Vector3(...actor.position))));
assert.ok(matrixError < 1e-6, `Current factory differs from actual-game transform: ${matrixError}m`);

const manifest = await json(resolve(mapRoot, 'manifest.json'));
const graphBytes = await readFile(resolve(mapRoot, manifest.roadGraph.path));
assert.equal(hash(graphBytes), manifest.roadGraph.sha256);
const graph = decodePackedRoadGraph(Uint8Array.from(graphBytes));
const sources = await json(resolve(mapRoot, 'sources.json'));
const record = sources.records.find(record => record.key === 'osm-pbf-normalized');
assert.ok(record, 'Map source provenance must identify normalized OSM');
const osmBytes = await readFile(resolve(cache, record.file));
assert.equal(hash(osmBytes), record.sha256, 'Cached OSM must match the emitted map provenance');
const osm = JSON.parse(osmBytes.toString('utf8'));
const { x, z } = ferry.position, bounds = [x - 350, z - 350, x + 350, z + 350];
const roads = extractRoads({ elements: osm.elements.filter(way => way.type === 'way' && way.tags?.highway) }, bounds).filter(road => !gradeSeparated(road));
// Routing eligibility excludes bus-only/private roads and cycleways. Those are
// still traffic corridors for physical placement. Pedestrians may use a shared
// footway, while a stationary cart and queue must leave every mapped path clear.
const pedestrianPath = tags => /^(footway|pedestrian|path|steps|corridor|bridleway)$/.test(tags.highway)
  && tags.foot !== 'no' && ['bus', 'motor_vehicle', 'motorcar'].every(key => !tags[key] || tags[key] === 'no');
const roadQuads = roads.flatMap(road => {
  // Exactly the XZ ribbon construction used by addRoadMeshes at detailed LOD.
  // Keeping pre-union quads conservatively includes hidden overlapping surfaces.
  const dense = resample(road.points.map(p => [p.x, p.z]), road.tags.name === 'Lombard Street' ? 1 : 3);
  const left = offsetPath(dense, -road.width / 2), right = offsetPath(dense, road.width / 2);
  return dense.slice(1).map((_, i) => ({ ring: [left[i], left[i + 1], right[i + 1], right[i]], osmWay: road.osmWay, name: road.tags.name, width: road.width,
    highway: road.tags.highway, pedestrianPath: pedestrianPath(road.tags), drivable: isDrivable(road.tags) }));
});
const laneSegments = [];
for (let i = 0; i < graph.counts.edges; i++) {
  const c = graph.columns, from = c.edgeFrom[i] * 3, to = c.edgeTo[i] * 3;
  const ax = c.nodeXYZ[from] / 100, az = c.nodeXYZ[from + 2] / 100;
  const bx = c.nodeXYZ[to] / 100, bz = c.nodeXYZ[to + 2] / 100;
  if (Math.max(ax, bx) < bounds[0] || Math.min(ax, bx) > bounds[2] || Math.max(az, bz) < bounds[1] || Math.min(az, bz) > bounds[3]) continue;
  const points = graph.edgePoints(i);
  for (let j = 1; j < points.length; j++) laneSegments.push({ a: [points[j - 1][0], points[j - 1][2]], b: [points[j][0], points[j][2]], osmWay: c.edgeSource[i] });
}
assert.ok(roadQuads.length && laneSegments.length, 'Real road geometry must be present');
const pointDistance = (p, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
};
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const segmentDistance = (a, b, c, d) => {
  const u = cross(a, b, c), v = cross(a, b, d), p = cross(c, d, a), q = cross(c, d, b);
  if (((u > 0 && v < 0) || (u < 0 && v > 0)) && ((p > 0 && q < 0) || (p < 0 && q > 0))) return 0;
  return Math.min(pointDistance(a, c, d), pointDistance(b, c, d), pointDistance(c, a, b), pointDistance(d, a, b));
};
const edges = (points, closed) => points.slice(closed ? 0 : 1).map((_, i) => closed ? [points[i], points[(i + 1) % points.length]] : [points[i], points[i + 1]]);
function check(name, local, { radius = .5, closed = true, filled = false, keepPathsClear = false } = {}) {
  const points = local.map(world), segments = edges(points, closed);
  let road = { metres: Infinity }, path = { metres: Infinity }, lane = { metres: Infinity };
  for (const quad of roadQuads) {
    let distance = points.some(point => containsRing(quad.ring, point)) || (filled && quad.ring.some(point => containsRing(points, point))) ? 0 : Infinity;
    for (const [a, b] of segments) for (const [c, d] of edges(quad.ring, true)) distance = Math.min(distance, segmentDistance(a, b, c, d));
    const value = { metres: distance, osmWay: quad.osmWay, name: quad.name, width: quad.width, highway: quad.highway, drivable: quad.drivable };
    if (distance < path.metres) path = value;
    if (!quad.pedestrianPath && distance < road.metres) road = value;
  }
  for (const [a, b] of segments) for (const segment of laneSegments) {
    const distance = segmentDistance(a, b, segment.a, segment.b);
    if (distance < lane.metres) lane = { metres: distance, osmWay: segment.osmWay };
  }
  const passed = road.metres > radius && lane.metres > 3.5 + radius && (!keepPathsClear || path.metres > radius);
  return { name, local, radius, roadEdge: road, pathEdge: path, laneCentre: lane, keepPathsClear, passed };
}
const checks = FERRY_PEDESTRIAN_ROUTES.map((route, i) => check(`pedestrian-${i}`, route));
// Coffee placement is supplied by the same source module used by its game entry.
const cart = COFFEE_CART, extents = COFFEE_CART_EXTENTS, counter = COFFEE_COUNTER_HALF_EXTENTS;
checks.push(check('coffee-whole-cart', [[cart.x + extents.minX, cart.z + extents.minZ], [cart.x + extents.maxX, cart.z + extents.minZ], [cart.x + extents.maxX, cart.z + extents.maxZ], [cart.x + extents.minX, cart.z + extents.maxZ]], { radius: 0, filled: true, keepPathsClear: true }));
checks.push(check('coffee-counter', [[cart.x - counter.x, cart.z - counter.z], [cart.x + counter.x, cart.z - counter.z], [cart.x + counter.x, cart.z + counter.z], [cart.x - counter.x, cart.z + counter.z]], { radius: 0, filled: true, keepPathsClear: true }));
COFFEE_QUEUE.forEach(([dx, dz], i) => checks.push(check(`coffee-actor-${i}`, [[cart.x + dx, cart.z + dz], [cart.x + dx - COFFEE_YIELD_DISTANCE, cart.z + dz]], { radius: .35, closed: false, keepPathsClear: true })));
const report = { checkedAt: new Date().toISOString(), nativePath, matrixError, transform: { position: ferry.position.toArray(), yaw: ferry.rotation.y, definition: ferry.userData.definition }, graph: manifest.roadGraph.sha256, osm: record.sha256, roads: roads.length, roadQuads: roadQuads.length, laneSegments: laneSegments.length, method: 'Continuous segment distances to exact detailed-LOD road ribbon quads, including full OSM width and bounded miters. Walking loops avoid all traffic corridors including busway/cycleway/private roads, with pedestrian-permitted paths reported separately. Coffee keeps every mapped path clear. Current packed lanes retain 3.5m contact margin; current factory matrix checked against native actor coordinates.', checks, passed: checks.every(check => check.passed) };
await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, matrixError, checks: checks.map(({ name, roadEdge, pathEdge, laneCentre, passed }) => ({ name, roadEdge, pathEdge, laneCentre, passed })), passed: report.passed }, null, 2));
assert.ok(report.passed, 'Placement overlaps rendered road or lane contact margin; see report');
