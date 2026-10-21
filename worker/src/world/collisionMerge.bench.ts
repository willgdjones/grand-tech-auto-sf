// gtasf-j7wvv: what one CombatCollision.near() costs. near() used to rebuild the merged 3x3 collision on every call
// (police LoS per unit per tick, police fire, off-road steps, player shots), copying every building ring point.
//   node --expose-gc --import tsx worker/src/world/collisionMerge.bench.ts tools/map/out/sf-fidi-lift3
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MapCollision } from '@gtasf/shared/mapCollision';
import { mergeChunks } from './combatCollision';
import { lineOfSight } from '@gtasf/shared/combat/rayVsWorld';

const dir = process.argv[2]!;
const chunks = new Map<string, MapCollision>();
for (const name of readdirSync(join(dir, 'chunks'))) {
  const f = join(dir, 'chunks', name, 'collision.json');
  if (existsSync(f)) chunks.set(name, JSON.parse(readFileSync(f, 'utf8')) as MapCollision);
}
const points = (c: MapCollision) => c.buildings.reduce((n, b) => n + b.rings.reduce((m, r) => m + r.length, 0), 0);
// Densest 3x3 neighbourhood (downtown worst case) and the median one.
const scored = [...chunks.keys()].map(key => {
  const [cx, cz] = key.split('_').map(Number) as [number, number];
  const nine: MapCollision[] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const c = chunks.get(`${cx + dx}_${cz + dz}`); if (c) nine.push(c); }
  return { key, nine, points: nine.reduce((n, c) => n + points(c), 0), buildings: nine.reduce((n, c) => n + c.buildings.length, 0) };
}).sort((a, b) => b.points - a.points);
const gc = (globalThis as { gc?: () => void }).gc;
for (const [label, s] of [['densest', scored[0]!], ['p90', scored[Math.floor(scored.length * 0.1)]!], ['median', scored[Math.floor(scored.length / 2)]!]] as const) {
  for (let i = 0; i < 20; i++) mergeChunks(s.nine); // warm the JIT
  gc?.(); const heap0 = process.memoryUsage().heapUsed;
  const N = 200, t0 = performance.now();
  for (let i = 0; i < N; i++) mergeChunks(s.nine);
  const ms = (performance.now() - t0) / N;
  console.log(JSON.stringify({ label, center: s.key, buildings: s.buildings, ringPoints: s.points, msPerMerge: +ms.toFixed(3),
    allocMBper100Merges: +((process.memoryUsage().heapUsed - heap0) / 1e6 / N * 100).toFixed(1) }));
  // One sight/step check on the (now cached) merge: a 60 m ray from the 3x3 centre.
  const merged = mergeChunks(s.nine), xs = merged.buildings.flatMap(b => b.rings[0] ?? []).map(p => p[0]), zs = merged.buildings.flatMap(b => b.rings[0] ?? []).map(p => p[1]);
  if (xs.length) {
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2, M = 2000, t1 = performance.now();
    for (let i = 0; i < M; i++) { const a = i * 0.7; lineOfSight([cx, 1.5, cz], [cx + 60 * Math.cos(a), 1.5, cz + 60 * Math.sin(a)], merged); }
    console.log(JSON.stringify({ label, msPerLineOfSight: +((performance.now() - t1) / M).toFixed(4) }));
  }
}
