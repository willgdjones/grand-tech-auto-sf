import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { RoadGraph } from '../shared/roadgraph';
import { decodePackedRoadGraph, unpackRoadGraph } from '../shared/roadgraphPacked';
import { createMapRouter } from '../web/src/radar/routing';

const graphPath = resolve(process.argv[2] ?? 'tools/map/out/lombard/roadgraph.json');
const graph: RoadGraph = graphPath.endsWith('.bin')
  ? unpackRoadGraph(decodePackedRoadGraph(await readFile(graphPath)))
  : JSON.parse(await readFile(graphPath, 'utf8'));
const router = createMapRouter(graph);
// Real source-derived roadside positions: Hyde over Broadway, then Broadway under Cyrus Place.
const points = [
  { sourceStreet: 'Hyde Street', x: -935.6426835667573, y: 61.4615, z: -1343.177213475661 },
  { sourceStreet: 'Broadway', x: -830.789745194851, y: 54.255250000000004, z: -1359.9037600099814 },
];
const samples = points.map(({ sourceStreet, ...position }) => {
  const before = router.snap(position.x, position.z, 20), after = router.snap(position.x, position.z, 20, position.y);
  assert.ok(before && after, 'Real roadside point must snap to source lanes');
  const beforeStreet = (before.edge as typeof before.edge & { name?: string }).name;
  const afterStreet = (after.edge as typeof after.edge & { name?: string }).name;
  assert.notEqual(beforeStreet, sourceStreet, 'Planar snap reproduces the wrong street');
  assert.equal(afterStreet, sourceStreet, 'Player height chooses the actual street level');
  assert.ok(Math.abs(after.point[1] - position.y) <= 3);
  return { sourceStreet, position, before: { edge: before.edge.id, street: beforeStreet, point: before.point }, after: { edge: after.edge.id, street: afterStreet, point: after.point } };
});
const output = resolve('artifacts/gps-height/source.json');
const evidence = { checkedAt: new Date().toISOString(), passed: true, scope: 'Source GPS snap comparison, not a native drive or visual/device gate', graphPath, samples };
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
