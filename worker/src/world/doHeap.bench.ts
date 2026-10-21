// gtasf-j7wvv: how much heap the world DO's big structures take, to size the "the 'sf' DO resets on memory" hypothesis
// (Workers isolates are limited to 128 MB). Run with GC exposed:
//   node --expose-gc --import tsx worker/src/world/doHeap.bench.ts tools/map/out/sf-fidi-lift3
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodePackedRoadGraph } from '@gtasf/shared/roadgraphPacked';
import { PackedRoads } from './packedRoads';
import { TrafficSimulation } from './traffic/simulation';
import type { MapCollision } from '@gtasf/shared/mapCollision';

const dir = process.argv[2]!;
const gc = (globalThis as { gc?: () => void }).gc;
const heap = () => { gc?.(); gc?.(); return process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers; };
const mb = (b: number) => +(b / 1e6).toFixed(1);
const base = heap();
const bytes = readFileSync(join(dir, 'roadgraph.bin'));
const roads = new PackedRoads(decodePackedRoadGraph(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
const afterRoads = heap();
const traffic = new TrafficSimulation(roads, { maximum: 240, perPlayer: 24 });
const afterTraffic = heap();
const chunks: MapCollision[] = [];
for (const name of readdirSync(join(dir, 'chunks'))) {
  const f = join(dir, 'chunks', name, 'collision.json');
  if (existsSync(f)) chunks.push(JSON.parse(readFileSync(f, 'utf8')) as MapCollision);
}
const afterAll = heap();
const keep512 = chunks.slice(0, 512); chunks.length = 0;
const after512 = heap();
console.log(JSON.stringify({ baselineMB: mb(base), roadsMB: mb(afterRoads - base), trafficMB: mb(afterTraffic - afterRoads),
  collisionAllMB: mb(afterAll - afterTraffic), collision512MB: mb(after512 - afterTraffic),
  totalWorstMB: mb(afterAll - base) }));
void roads; void traffic; void keep512;
