import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FootprintIndex, circleHitsBuilding, type ChunkCollision } from '../web/src/render/chunks/terrain';

// One scoped real-map smoke: compare the broad phase with the original exact polygon query.
const root = resolve(process.argv[2] ?? 'tools/map/out/lombard');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const chunks: ChunkCollision[] = await Promise.all(manifest.chunks.map(async (chunk: { collision: { path: string } }) =>
  JSON.parse(await readFile(resolve(root, chunk.collision.path), 'utf8'))));
const byId = new Map(chunks.map(chunk => [`${Math.floor(chunk.origin[0] / 256)}_${Math.floor(chunk.origin[2] / 256)}`, chunk]));
function original(x: number, y: number, z: number, radius: number, height: number): boolean {
  const cx = Math.floor(x / 256), cz = Math.floor(z / 256);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const chunk = byId.get(`${cx + dx}_${cz + dz}`);
    if (!chunk) continue;
    for (const building of chunk.buildings) {
      if (y + height <= building.minY || y >= building.maxY) continue;
      if (circleHitsBuilding(building, x - chunk.origin[0], z - chunk.origin[2], radius)) return true;
    }
  }
  return false;
}
const index = new FootprintIndex(); index.rebuild(chunks);
let queries = 0;
for (const chunk of chunks) {
  for (const building of chunk.buildings.filter((_, i) => i % 11 === 0)) {
    for (const ring of building.rings) {
      const a = ring[0], b = ring[1]; if (!a || !b) continue;
      const x = chunk.origin[0] + (a[0] + b[0]) / 2, z = chunk.origin[2] + (a[1] + b[1]) / 2;
      for (const [dx, dz, radius, y] of [[0, 0, .35, building.minY], [2, 2, .35, building.minY], [-2, -2, 2.4, building.minY], [0, 0, .35, building.maxY]]) {
        assert.equal(index.collides(x + dx!, y!, z + dz!, radius!, 1.8), original(x + dx!, y!, z + dz!, radius!, 1.8), `building ${building.id}`);
        queries++;
      }
    }
  }
}
const courtyard: ChunkCollision = { version: 1, origin: [-512, 0, -256], buildings: [{ id: 'courtyard', minY: 2, maxY: 12, rings: [
  [[0, 0], [64, 0], [64, 64], [0, 64]], [[16, 16], [48, 16], [48, 48], [16, 48]],
] }] };
index.rebuild([courtyard, courtyard]);
assert.equal(index.collides(-480, 2, -224, .35, 1.8), false, 'courtyard stays open');
assert.equal(index.collides(-496.1, 2, -224, .35, 1.8), true, 'courtyard inner wall blocks');
assert.equal(index.collides(-504, 12, -248, .35, 1.8), false, 'above roof stays clear');
assert.equal(index.collides(-504, 0, -248, .35, 2), false, 'below floor stays clear');
assert.equal(index.collides(-512.2, 2, -248, .35, 1.8), true, 'radius reaches neighboring spatial cell');
index.rebuild([]);
assert.equal(index.collides(-504, 2, -248, .35, 1.8), false, 'unloading removes footprints');
console.log(JSON.stringify({ chunks: chunks.length, comparedQueries: queries, courtyardAndUnload: 'PASS', stats: index.stats }));
