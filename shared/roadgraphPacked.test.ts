import { expect, it } from 'vitest';
import { packRoadGraph } from '../tools/map/src/pipeline/roadPack';
import { decodePackedRoadGraph, roadPackLayout, unpackRoadGraph, unpackRoadGraphSliced, type PackedPublicRoadGraph } from './roadgraphPacked';

const graph: PackedPublicRoadGraph = { version: 1, warnings: ['Source warning retained'], nodes: [
  { id: 'n-source', x: -500.125, y: 22.456, z: 1000.994, osmNode: 'osm:12345678901', control: 'signal', yield: true },
  { id: 'n-turn', x: -430.654, y: 10.5, z: 1010.001, osmNode: 'osm:12345678902', control: 'stop' },
  { id: 'n-end', x: -430.601, y: 10.5, z: 1010.043, osmNode: 'osm:12345678902' },
], edges: [
  { id: 'lane:real', from: 'n-source', to: 'n-turn', lengthM: 72.845, speedMps: 8.941, lane: 2,
    points: [[-500.125, 22.456, 1000.994], [-470.219, 20.041, 1007.265], [-430.654, 10.5, 1010.001]],
    kind: 'lane', osmWay: 402111597, name: 'California Street 🌉', inferredLanes: false, layer: 1, bridge: true, tunnel: false, next: ['turn:real'] },
  { id: 'turn:real', from: 'n-turn', to: 'n-end', lengthM: .08, speedMps: 4, lane: 0,
    points: [[-430.654, 10.5, 1010.001], [-430.601, 10.5, 1010.043]],
    kind: 'connector', osmWay: 0, name: '', inferredLanes: true, layer: -1, bridge: false, tunnel: true, next: [] },
] };
it('preserves sourced topology, controls and metadata with sub-centimetre geometry error', async () => {
  const bytes = packRoadGraph(graph), packed = decodePackedRoadGraph(bytes), restored = unpackRoadGraph(packed);
  let yields = 0; // the batched browser expansion must give the same graph (gtasf-0k01)
  expect(await unpackRoadGraphSliced(packed, async () => { yields++; }, 1)).toEqual(restored); expect(yields).toBeGreaterThan(1);
  expect(restored.warnings).toEqual(graph.warnings);
  for (const [i, node] of restored.nodes.entries()) {
    const original = graph.nodes[i]!;
    expect({ ...node, x: 0, y: 0, z: 0 }).toEqual({ ...original, x: 0, y: 0, z: 0 });
    for (const key of ['x', 'y', 'z'] as const) expect(Math.abs(node[key] - original[key])).toBeLessThanOrEqual(.005001);
  }
  for (const [i, edge] of restored.edges.entries()) {
    const original = graph.edges[i]!;
    expect({ ...edge, points: [], lengthM: 0, speedMps: 0 }).toEqual({ ...original, routable: true, points: [], lengthM: 0, speedMps: 0 });
    expect(edge.points).toHaveLength(original.points.length);
    for (const [p, point] of edge.points.entries()) for (let axis = 0; axis < 3; axis++) expect(Math.abs(point[axis]! - original.points[p]![axis]!)).toBeLessThanOrEqual(.005001);
    expect(edge.lengthM).toBeCloseTo(original.lengthM, 4); expect(edge.speedMps).toBeCloseTo(original.speedMps, 4);
  }
  const offset = new Uint8Array(bytes.length + 3); offset.set(bytes, 1);
  expect(unpackRoadGraph(decodePackedRoadGraph(offset.subarray(1, -2)))).toEqual(restored);
});
it('retains off-network road contact geometry while marking only supplied edges routable', () => {
  const restored = unpackRoadGraph(decodePackedRoadGraph(packRoadGraph(graph, { routableEdgeIds: new Set(['lane:real']) })));
  expect(restored.edges.map(edge => [edge.id, edge.routable])).toEqual([['lane:real', true], ['turn:real', false]]);
  expect(restored.edges[1]!.points).toHaveLength(2);
  expect(restored.edges[0]!.next).toEqual(['turn:real']);
});
it('keeps ASCII, Unicode, BOM and malformed UTF-8 behavior equal to direct packed access', () => {
  const packed = decodePackedRoadGraph(packRoadGraph({ ...graph,
    warnings: ['plain ASCII', '\u0000tab\tDEL\u007f', 'César Chávez · 🌉', '\ufeffleading BOM', ''],
  }));
  const direct = {
    version: 1,
    nodes: Array.from({ length: packed.counts.nodes }, (_, i) => packed.node(i)),
    edges: Array.from({ length: packed.counts.edges }, (_, i) => packed.edge(i)),
    warnings: Array.from(packed.columns.warnings, index => packed.string(index)),
  };
  expect(unpackRoadGraph(packed)).toEqual(direct);
  const invalid = decodePackedRoadGraph(packed.bytes.slice());
  const badIndex = invalid.columns.warnings[0]!;
  invalid.columns.strings[invalid.columns.stringOffsets[badIndex]!] = 255;
  expect(() => invalid.string(badIndex)).toThrow();
  expect(() => unpackRoadGraph(invalid)).toThrow();
  // Unreferenced bytes are still lazy: they must not make an otherwise usable
  // graph fail merely because browser expansion primes its ASCII cache.
  invalid.columns.warnings[0] = invalid.columns.warnings[1]!;
  expect(unpackRoadGraph(invalid).warnings).toEqual([direct.warnings[1], ...direct.warnings.slice(1)]);
});
it('rejects invalid framing and indices before exposing topology, and malformed point data on access', () => {
  const bytes = packRoadGraph(graph), packed = decodePackedRoadGraph(bytes), layout = roadPackLayout(packed.counts);
  for (const length of [0, 39, 40, bytes.length - 1]) expect(() => decodePackedRoadGraph(bytes.subarray(0, length))).toThrow();
  expect(() => decodePackedRoadGraph(new Uint8Array([...bytes, 0]))).toThrow();
  const wrongVersion = bytes.slice(); wrongVersion[4] = 2; expect(() => decodePackedRoadGraph(wrongVersion)).toThrow();
  const badNode = bytes.slice(); new DataView(badNode.buffer).setUint32(layout.offsets.edgeFrom, 99, true);
  expect(() => decodePackedRoadGraph(badNode)).toThrow();
  const badNext = bytes.slice(); new DataView(badNext.buffer).setUint32(layout.offsets.next, 99, true);
  expect(() => decodePackedRoadGraph(badNext)).toThrow();
  const badOffsets = bytes.slice(); new DataView(badOffsets.buffer).setUint32(layout.offsets.edgePointOffsets + 4, 0, true);
  expect(() => decodePackedRoadGraph(badOffsets)).toThrow();
  const badPoint = bytes.slice(); badPoint.fill(255, layout.offsets.points, layout.offsets.points + 5);
  expect(() => decodePackedRoadGraph(badPoint).edgePoints(0)).toThrow('ROAD_PACK_VARINT');
  expect(() => packRoadGraph({ ...graph, edges: [{ ...graph.edges[0]!, next: ['missing'] }] })).toThrow();
});
