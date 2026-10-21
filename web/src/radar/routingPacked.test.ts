import { expect, it } from 'vitest';
import { packRoadGraph } from '../../../tools/map/src/pipeline/roadPack';
import { decodePackedRoadGraph, routingGraphFromPacked, routingSubgraph, unpackRoadGraphSliced, type PackedPublicRoadGraph } from '@gtasf/shared/roadgraphPacked';
import { assembleMapRouter, buildRouterStructures, createMapRouter, decodeRouterEdges, encodeRouterEdges, type RouterStructures } from './routing';

// gtasf-fddi / critic N16: a routing worker that decodes the SAME packed artifact with routingGraphFromPacked must build
// structures over an edge list identical to the one main derives (sliced unpack + routingSubgraph), so a router assembled on
// main from the worker's structures routes byte-identically to the on-main build.
function grid(size: number, spacing: number): PackedPublicRoadGraph {
  const nodes: PackedPublicRoadGraph['nodes'] = [], edges: PackedPublicRoadGraph['edges'] = [];
  const id = (i: number, j: number) => `n${i}_${j}`;
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) nodes.push({ id: id(i, j), x: i * spacing, y: 0, z: j * spacing, osmNode: `osm:${i * size + j + 1}` });
  const lane = (a: [number, number], b: [number, number]) => edges.push({ id: `lane:${id(...a)}>${id(...b)}`, from: id(...a), to: id(...b),
    lengthM: spacing, speedMps: 11, lane: 1, points: [[a[0] * spacing, 0, a[1] * spacing], [b[0] * spacing, 0, b[1] * spacing]],
    kind: 'lane', osmWay: 1, name: 'Test Street', inferredLanes: false, layer: 0, bridge: false, tunnel: false, next: [], routable: true });
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
    if (i + 1 < size) { lane([i, j], [i + 1, j]); lane([i + 1, j], [i, j]); }
    if (j + 1 < size) { lane([i, j], [i, j + 1]); lane([i, j + 1], [i, j]); }
  }
  // a non-routable connector in the middle of the list: the filter must drop it identically on both sides
  edges.splice(3, 0, { id: 'connector:footpath', from: id(0, 0), to: id(1, 1), lengthM: 1, speedMps: 1, lane: 0,
    points: [[0, 0, 0], [spacing, 0, spacing]], kind: 'connector', osmWay: 0, name: '', inferredLanes: true, layer: 0, bridge: false, tunnel: false, next: [], routable: false });
  for (const edge of edges) if (edge.kind === 'lane') edge.next = edges.filter(other => other.kind === 'lane' && other.from === edge.to && other.to !== edge.from).map(other => other.id);
  return { version: 1, warnings: [], nodes, edges };
}
const drain = (graph: Parameters<typeof buildRouterStructures>[0]): RouterStructures => {
  const build = buildRouterStructures(graph, Infinity); let step = build.next(); while (!step.done) step = build.next(); return step.value;
};

it('the worker-side routing graph from the packed artifact equals main (sliced unpack + routingSubgraph) and routes identically', async () => {
  const bytes = packRoadGraph(grid(6, 60));
  const main = routingSubgraph(await unpackRoadGraphSliced(decodePackedRoadGraph(bytes), async () => {}, 7));
  const worker = routingGraphFromPacked(bytes);
  expect(worker.edges.map(edge => edge.id)).toEqual(main.edges.map(edge => edge.id));
  expect(worker.edges.some(edge => edge.id === 'connector:footpath')).toBe(false);
  const onMain = createMapRouter(main), assembled = assembleMapRouter(main, drain(worker));
  const pairs: [[number, number], [number, number]][] = [[[5, 5], [290, 290]], [[0, 300], [300, 0]], [[120, 10], [10, 250]], [[61, 61], [239, 121]]];
  for (const [[ax, az], [bx, bz]] of pairs) {
    const from = { x: ax, y: 0, z: az }, to = { x: bx, y: 0, z: bz, title: 'T' };
    const expected = onMain.route(from, to);
    expect(expected).not.toBeNull();
    expect(assembled.route(from, to)).toEqual(expected);
  }
});

it('a router assembled over the worker-sent light edge view routes identically, without main\'s unpacked graph', () => {
  const bytes = packRoadGraph(grid(6, 60));
  const worker = routingGraphFromPacked(bytes), structures = drain(worker);
  const light = decodeRouterEdges(structuredClone(encodeRouterEdges(worker))); // what crosses the worker boundary
  const onMain = createMapRouter(worker), assembled = assembleMapRouter(light, structures);
  const pairs: [[number, number], [number, number]][] = [[[5, 5], [290, 290]], [[0, 300], [300, 0]], [[120, 10], [10, 250]], [[61, 61], [239, 121]]];
  for (const [[ax, az], [bx, bz]] of pairs) {
    const from = { x: ax, y: 0, z: az }, to = { x: bx, y: 0, z: bz, title: 'T' };
    const expected = onMain.route(from, to); expect(expected).not.toBeNull();
    expect(assembled.route(from, to)).toEqual(expected);
  }
  expect(assembled.snap(61, 61)?.edge.id).toBe(onMain.snap(61, 61)?.edge.id);
});
