// gtasf-fajmy (reviewer 2108e126 MED): what serverTerrainLos adds to one police/PvP line-of-sight check on the Durable
// Object. Real map chunks (a detailed 3x3 block on the hills): merged collision + drawn terrain, random 10-60 m chest-height
// lines like police sight/fire and pistol shots; buildings-only vs buildings + terrain (terrainLos: tunnel skip, tolerance).
//   node --import tsx worker/src/world/terrainLos.bench.ts tools/map/out/sf [cx] [cz]
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MapCollision } from '@gtasf/shared/mapCollision';
import { decodeHeightfield, sampleDrawnHeight, type Heightfield } from '@gtasf/shared/map/heightfield';
import { mergeChunks, policeLineClear, COLLISION_CHUNK_M } from './combatCollision';

const dir = process.argv[2]!, cx = Number(process.argv[3] ?? -5), cz = Number(process.argv[4] ?? -8);
const collisions: MapCollision[] = [], fields = new Map<string, Heightfield>();
for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
  const base = join(dir, 'chunks', `${cx + dx}_${cz + dz}`);
  if (existsSync(join(base, 'collision.json'))) collisions.push(JSON.parse(readFileSync(join(base, 'collision.json'), 'utf8')) as MapCollision);
  if (existsSync(join(base, 'terrain.bin'))) { const b = readFileSync(join(base, 'terrain.bin')); fields.set(`${cx + dx}:${cz + dz}`, decodeHeightfield(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))); }
}
const collision = mergeChunks(collisions);
let lastKey = '', last: Heightfield | undefined;
const heightAt = (x: number, z: number) => {
  const key = `${Math.floor(x / COLLISION_CHUNK_M)}:${Math.floor(z / COLLISION_CHUNK_M)}`;
  if (key !== lastKey) { lastKey = key; last = fields.get(key); }
  return last ? sampleDrawnHeight(last, x, z) : null;
};
// Lines on the ground (+1.4 m chest), 10-60 m long, inside the centre chunk.
let seed = 7; const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32); // imul: a float multiply lost precision and cycled
const lines: [readonly [number, number, number], readonly [number, number, number]][] = [];
for (let attempts = 0; lines.length < Number(process.env.LINES ?? 400); attempts++) {
  if (attempts > 100_000) throw new Error(`no terrain around chunk ${cx},${cz} (fields: ${[...fields.keys()].join(' ')})`);
  const x0 = (cx + rnd()) * COLLISION_CHUNK_M, z0 = (cz + rnd()) * COLLISION_CHUNK_M, a = rnd() * Math.PI * 2, d = 10 + rnd() * 50;
  const x1 = x0 + Math.sin(a) * d, z1 = z0 + Math.cos(a) * d, y0 = heightAt(x0, z0), y1 = heightAt(x1, z1);
  if (y0 === null || y1 === null) continue;
  lines.push([[x0, y0 + 1.4, z0], [x1, y1 + 1.4, z1]]);
}
function time(label: string, run: () => number): void {
  run(); const t = performance.now(); let clear = 0; for (let k = 0; k < 2; k++) clear += run(); const ms = (performance.now() - t) / 2;
  console.log(`${label}: ${(ms / lines.length * 1000).toFixed(1)} µs per line (${(clear / 2 / lines.length * 100).toFixed(0)}% clear)`);
}
console.log(`chunk ${cx},${cz}: ${collision.buildings.length} buildings, ${fields.size} terrain fields, ${lines.length} lines`);
time('buildings only     ', () => lines.reduce((n, [a, b]) => n + (policeLineClear(collision, a, b) ? 1 : 0), 0));
time('buildings + terrain', () => lines.reduce((n, [a, b]) => n + (policeLineClear(collision, a, b, heightAt) ? 1 : 0), 0));
