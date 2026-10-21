/** Single short simulation smoke against the real local Lombard terrain/collision artifacts. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { flags } from '../shared/flags';
import type { RoadGraph } from '../shared/roadgraph';
import { circleHitsBuilding, createRoadSampler, decodeHeightfield, sampleHeight } from '../web/src/render/chunks/terrain';
import type { ChunkCollision, Heightfield } from '../web/src/render/chunks/terrain';
import { updateOnFoot } from '../web/src/movement/onFoot';
import { alignVehicleToGround, createDrivingState, updateDriving } from '../web/src/vehicles/driving/controller';
import { moveOnGround } from '../web/src/movement/world';
import type { MovementWorld } from '../web/src/movement/world';

const root = process.env.GTASF_SMOKE_MAP ?? 'tools/map/out/lombard';
const json = async (path: string) => JSON.parse(await readFile(join(root, path), 'utf8'));
const manifest = await json('manifest.json') as { chunks: { id: string; terrain: { path: string }; collision: { path: string } }[] };
const local = await json('local-play.json') as { downhill: { points: number[][] } };
const roads = createRoadSampler(await json('roadgraph.json') as RoadGraph);
const fields = new Map<string, Heightfield>(), collisions: ChunkCollision[] = [];
for (const chunk of manifest.chunks) {
  const bytes = await readFile(join(root, chunk.terrain.path));
  fields.set(chunk.id, decodeHeightfield(Uint8Array.from(bytes).buffer));
  collisions.push(await json(chunk.collision.path) as ChunkCollision);
}
const world: MovementWorld = {
  heightAt(x, z) {
    const field = fields.get(`${Math.floor(x / 256)}_${Math.floor(z / 256)}`);
    return field ? roads(x, z) ?? sampleHeight(field, x, z) : null;
  },
  collidesCircle(x, z, radius) {
    return collisions.some(chunk => chunk.buildings.some(building =>
      circleHitsBuilding(building, x - chunk.origin[0], z - chunk.origin[2], radius)));
  },
};
// Approach one real, isolated building wall from its clear outside edge.
let collisionEvidence: { building: string; advanced: number } | undefined;
outer: for (const chunk of collisions) for (const building of chunk.buildings) {
  const ring = building.rings[0];
  if (!ring) continue;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!, b = ring[i]!, dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    if (length < 3) continue;
    const cx = (a[0] + b[0]) / 2 + chunk.origin[0], cz = (a[1] + b[1]) / 2 + chunk.origin[2];
    for (const side of [-1, 1]) {
      const nx = -dz / length * side, nz = dx / length * side;
      const x = cx + nx * .7, z = cz + nz * .7, y = world.heightAt(x, z);
      if (y === null || y + 1.75 <= building.minY || y >= building.maxY ||
        world.collidesCircle!(x, z, .3) || !world.collidesCircle!(cx - nx * .7, cz - nz * .7, .3)) continue;
      const pose = { x, y, z, yaw: 0 };
      for (let step = 0; step < 30; step++) moveOnGround(pose, -nx * .05, -nz * .05, world, .3, false);
      const advanced = Math.hypot(pose.x - x, pose.z - z);
      if (advanced < .05) continue; // Choose a walkable approach, not a terrain cliff.
      assert.ok(!world.collidesCircle!(pose.x, pose.z, .3), 'The real footprint must prevent building entry');
      assert.ok(advanced < .6, 'The avatar must stop before the actual facade');
      collisionEvidence = { building: building.id, advanced }; break outer;
    }
  }
}
assert.ok(collisionEvidence, 'The map must supply a real building wall for the smoke');
// The default spawn can change independently; this smoke exercises the named Lombard slope.
const [x, y, z] = local.downhill.points[0]! as [number, number, number];
const next = local.downhill.points[1]!;
const yaw = Math.atan2(next[0]! - x, next[2]! - z);
const foot = { x, y: world.heightAt(x, z) ?? y, z, yaw };
for (let i = 0; i < 60; i++) updateOnFoot(foot, { x: 0, z: -1, run: false }, yaw + Math.PI, 1 / 60, world);
assert.ok(Math.hypot(foot.x - x, foot.z - z) > 2.8, 'Walk must advance down the real street');
assert.ok(foot.y < y, 'Walk must follow the actual descending grade');
const before = { ...foot };
updateOnFoot(foot, { x: 0, z: -1, run: true }, yaw + Math.PI, .1, { heightAt: () => null });
assert.deepEqual(foot, before, 'Unloaded terrain must stop movement');
const car = createDrivingState({ x, y: world.heightAt(x, z) ?? y, z, yaw });
const visual = createDrivingState({ ...foot });
assert.ok(alignVehicleToGround(visual, .1, world));
assert.equal(visual.x, foot.x); assert.equal(visual.z, foot.z); assert.equal(visual.yaw, foot.yaw);
assert.ok(visual.pitch > .001, 'Server-driven taxi visual must tip downhill without changing its route');
if (!process.argv.includes('--on-foot')) {
  assert.ok(flags.driving, 'Enable driving through actual main-loop integration before checking it');
  for (let i = 0; i < 60; i++) updateDriving(car, { steer: 0, throttle: 1, brake: 0, handbrake: false }, 1 / 60, world);
  assert.ok(Math.hypot(car.x - x, car.z - z) > 3, 'Car must advance on the actual mapped street');
  assert.ok(car.speed > 6 && car.speed < 9);
  assert.ok(car.y < y);
  const heading = car.yaw;
  updateDriving(car, { steer: 1, throttle: 0, brake: 0, handbrake: false }, 1 / 60, world);
  assert.ok(car.yaw < heading, 'D/right must turn clockwise as seen from above');
  for (let i = 0; i < 30; i++) updateDriving(car, { steer: 0, throttle: 0, brake: 0, handbrake: true }, 1 / 60, world);
  assert.ok(car.speed < 1, 'Handbrake must stop promptly');
  const stopped = { ...car };
  updateDriving(car, { steer: 0, throttle: 1, brake: 0, handbrake: false }, .1, { heightAt: () => null });
  assert.equal(car.x, stopped.x); assert.equal(car.z, stopped.z); assert.equal(car.speed, 0);
}
console.log(JSON.stringify({ kind: 'local terrain movement smoke', onFootOnly: process.argv.includes('--on-foot'), foot, car, collisionEvidence, passed: true }));
