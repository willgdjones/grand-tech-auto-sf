/** Offline road-mask design for gtasf-r2mn. Writes an ignored candidate only. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Vector3 } from 'three';
import clipping from 'polygon-clipping';
import { createPlacedLandmarks, disposeLandmark } from '../web/src/render/landmarks/landmarks.ts';
import { FERRY_PEDESTRIAN_ROUTES } from '../web/src/render/ferryPedestrians.ts';
import { extractRoads } from './map/src/pipeline/osm.ts';
import { resample, offsetPath, gradeSeparated } from './map/src/pipeline/roads.ts';
import { containsRing } from './map/src/pipeline/geometry.ts';

const json = async file => JSON.parse(await readFile(file, 'utf8'));
const sources = await json('tools/map/out/sf/sources.json');
const record = sources.records.find(row => row.key === 'osm-pbf-normalized');
assert.ok(record);
const bytes = await readFile(`tools/map/out/cache/sf/${record.file}`);
assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
const native = await json('artifacts/ferry-pedestrians/game-1341/report.json');
const actors = native.views.flatMap(view => view.actors);
const city = createPlacedLandmarks({ enabled: true, ids: ['ferry-building'], heightAt: () => actors[0].position[1] });
const ferry = city.children[0]; city.updateMatrixWorld(true);
const matrixError = Math.max(...actors.map(actor => new Vector3(...actor.local).applyMatrix4(ferry.matrixWorld).distanceTo(new Vector3(...actor.position))));
assert.ok(matrixError < 1e-6);
const { x, z } = ferry.position;
const roads = extractRoads(JSON.parse(bytes.toString()), [x - 350, z - 350, x + 350, z + 350]).filter(road => !gradeSeparated(road));
const pedestrianPath = tags => /^(footway|pedestrian|path|steps|corridor|bridleway)$/.test(tags.highway)
  && tags.foot !== 'no' && ['bus', 'motor_vehicle', 'motorcar'].every(key => !tags[key] || tags[key] === 'no');
const envelope = [[[-117, -33], [117, -33], [117, 83], [-117, 83], [-117, -33]]];
const local = ([x, z]) => { const p = ferry.worldToLocal(new Vector3(x, 0, z)); return [Math.round(p.x * 1000) / 1000, Math.round(p.z * 1000) / 1000]; };
const ribbons = [], ways = [];
for (const road of roads.filter(road => !pedestrianPath(road.tags))) {
  let overlaps = false;
  // Include both LOD constructions and a small allowance for GLB quantization.
  for (const step of [3, 6]) {
    const dense = resample(road.points.map(p => [p.x, p.z]), step);
    const left = offsetPath(dense, -road.width / 2 - .05), right = offsetPath(dense, road.width / 2 + .05);
    for (let i = 1; i < dense.length; i++) {
      const ring = [left[i - 1], left[i], right[i], right[i - 1]].map(local); ring.push(ring[0]);
      const clipped = clipping.intersection(envelope, [ring]);
      if (clipped.length) { ribbons.push(...clipped); overlaps = true; }
    }
  }
  if (overlaps) ways.push({ id: road.osmWay, width: road.width, highway: road.tags.highway, name: road.tags.name });
}
assert.ok(ribbons.length);
const mask = clipping.union(...ribbons), retained = clipping.difference(envelope, mask);
const pointDistance = (p, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
};
function inspect(point) {
  const covered = mask.some(polygon => containsRing(polygon[0], point) && !polygon.slice(1).some(hole => containsRing(hole, point)));
  const edgeDistance = Math.min(...mask.flatMap(polygon => polygon.flatMap(ring => ring.slice(1).map((p, i) => pointDistance(point, ring[i], p)))));
  return { point, covered, edgeDistance };
}
const report = { checkedAt: new Date().toISOString(), osm: record.sha256, matrixError,
  transform: { position: ferry.position.toArray(), yaw: ferry.rotation.y },
  scope: 'Design candidate only: both LOD surface-traffic ribbons plus 5cm quantization margin. No runtime change or acceptance.',
  ways, mask, retained, spawn: inspect([0, 53]), routes: FERRY_PEDESTRIAN_ROUTES.map(route => route.map(inspect)) };
await mkdir('artifacts/ferry-contact', { recursive: true });
await writeFile('artifacts/ferry-contact/plaza-road-mask.json', JSON.stringify(report, null, 2) + '\n');
disposeLandmark(city);
console.log(JSON.stringify({ ways, maskPolygons: mask.length, retainedPolygons: retained.length, spawn: report.spawn, routes: report.routes }, null, 2));
