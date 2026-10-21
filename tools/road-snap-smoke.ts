import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRoadSnapper } from '../web/src/render/chunks/terrain';
import type { RoadGraph } from '../shared/roadgraph';

const graph = JSON.parse(await readFile('tools/map/out/lombard/roadgraph.json', 'utf8')) as RoadGraph;
function original(x: number, z: number, maxDistance = 100) {
  let best = maxDistance ** 2, result: { x: number; y: number; z: number; yaw: number } | null = null;
  for (const edge of graph.edges) for (let i = 1; i < edge.points.length; i++) {
    const a = edge.points[i - 1]!, b = edge.points[i]!, dx = b[0] - a[0], dz = b[2] - a[2], length2 = dx * dx + dz * dz;
    if (!length2) continue;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / length2));
    const px = a[0] + dx * t, pz = a[2] + dz * t, distance2 = (x - px) ** 2 + (z - pz) ** 2;
    if (distance2 < best) { best = distance2; result = { x: px, y: a[1] + (b[1] - a[1]) * t, z: pz, yaw: Math.atan2(dx, dz) }; }
  }
  return result;
}
const indexed = createRoadSnapper(graph), queries: [number, number, number][] = [];
for (const edge of graph.edges.filter((_, i) => i % 29 === 0)) {
  const point = edge.points[Math.floor(edge.points.length / 2)];
  if (point) queries.push([point[0], point[2], 100], [point[0] + 13, point[2] - 27, 200]);
}
queries.push([1196.869, -1224.309, 600], [-1041.863, -1975.201, 200], [9999, 9999, 100], [0, 0, 0], [0, 0, Infinity]);
let before = performance.now(); const expected = queries.map(q => original(...q)); const originalMs = performance.now() - before;
before = performance.now(); const actual = queries.map(q => indexed(...q)); const indexedMs = performance.now() - before;
assert.deepEqual(actual, expected, 'Road point, height, direction and equal-distance tie ordering stay exact');
console.log(JSON.stringify({ edges: graph.edges.length, queries: queries.length, originalMs, indexedMs, result: 'PASS' }));
