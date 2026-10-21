// gtasf-27jen: time each step a world-DO wake does to load the city road graph (run: npx tsx this file <roadgraph.bin>).
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { decodePackedRoadGraph } from '@gtasf/shared/roadgraphPacked';
import { PackedRoads } from './packedRoads';
import { TrafficSimulation } from './traffic/simulation';

const file = process.argv[2]!;
const t = () => performance.now();
let a = t(); const bytes = readFileSync(file); const read = t() - a;
a = t(); await webcrypto.subtle.digest('SHA-256', bytes); const sha = t() - a;
a = t(); const graph = decodePackedRoadGraph(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)); const decode = t() - a;
a = t(); const roads = new PackedRoads(graph); const packed = t() - a;
a = t(); new TrafficSimulation(roads, { maximum: 240, perPlayer: 24 }); const traffic = t() - a;
console.log(JSON.stringify({ mb: +(bytes.byteLength / 1e6).toFixed(1), readMs: +read.toFixed(0), sha256Ms: +sha.toFixed(0), decodeMs: +decode.toFixed(0), packedRoadsMs: +packed.toFixed(0), trafficMs: +traffic.toFixed(0) }));
