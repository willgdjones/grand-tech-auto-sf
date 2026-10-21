/** Compare a profiled bake with sourced rails without mutating runtime data. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cableRoutes, type CableRoute } from '../../shared/transit/cableRoutes';
import { loadCableGround } from './profile-ground';

const path = process.argv[2] ?? 'artifacts/world-systems/cable-profiled.ts';
const mapPath = process.argv[3] ?? 'tools/map/out/sf';
const baked = await import(pathToFileURL(resolve(path)).href) as { cableRoutes: readonly CableRoute[]; cableRouteProvenance: { mapSurface?: unknown } };
assert(baked.cableRouteProvenance.mapSurface, 'Bake includes verified map surface provenance');
assert.equal(baked.cableRoutes.length, 6);
const all = baked.cableRoutes.flatMap(r => r.points);
const ground = await loadCableGround(mapPath, [Math.min(...all.map(p => p[0])) - 4, Math.min(...all.map(p => p[2])) - 4,
  Math.max(...all.map(p => p[0])) + 4, Math.max(...all.map(p => p[2])) + 4]);
const routes = baked.cableRoutes.map((route, routeIndex) => {
  const original = cableRoutes[routeIndex]!;
  assert.equal(route.id, original.id); assert.equal(route.relation, original.relation);
  assert.equal(route.lengthM, original.lengthM); assert.equal(route.points.length, original.points.length);
  assert.deepEqual(route.stops.map(s => [s.id, s.name, s.atM, s.point[0], s.point[2]]),
    original.stops.map(s => [s.id, s.name, s.atM, s.point[0], s.point[2]]));
  let maxSlope = 0, maxSurfaceErrorM = 0, maxHeightChangeM = 0;
  for (const [i, point] of route.points.entries()) {
    assert.equal(point[0], original.points[i]![0]); assert.equal(point[2], original.points[i]![2]);
    const before = route.points[Math.max(0, i - 1)]!, after = route.points[Math.min(route.points.length - 1, i + 1)]!;
    const y = ground.sample(point[0], point[2], after[0] - before[0], after[2] - before[2]);
    maxSurfaceErrorM = Math.max(maxSurfaceErrorM, Math.abs(point[1] - y));
    maxHeightChangeM = Math.max(maxHeightChangeM, Math.abs(point[1] - original.points[i]![1]));
    if (i) maxSlope = Math.max(maxSlope, Math.abs(point[1] - before[1]) / Math.hypot(point[0] - before[0], point[2] - before[2]));
  }
  assert(maxSlope < .4, `${route.id} continuous height profile: ${maxSlope}`);
  assert(maxSurfaceErrorM < .02, `${route.id} matches baked street surface: ${maxSurfaceErrorM}`);
  return { id: route.id, points: route.points.length, stops: route.stops.length, maxSlope, maxSurfaceErrorM, maxHeightChangeM };
});
// The real Hyde/Broadway crossing must stay on the elevated Hyde street deck.
const hyde = baked.cableRoutes[0]!;
for (const i of [602, 603, 604, 605]) assert(hyde.points[i]![1] > 60, `Hyde bridge point ${i} above Broadway`);
const report = { passed: true, source: path, mapPath, routes, provenance: baked.cableRouteProvenance.mapSurface };
await writeFile('artifacts/world-systems/cable-profile-report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, routes }));
