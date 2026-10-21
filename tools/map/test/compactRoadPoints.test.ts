import { expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { encodeRoadPointTransport } from '../../../shared/mapRoadPointTransport';
import { decodeRoadTransport, encodeRoadTransport, restoreMapArtifact } from '../../../shared/mapTransport';
import { decodePackedRoadGraph, type PackedPublicRoadGraph } from '../../../shared/roadgraphPacked';
import { packRoadGraph } from '../src/pipeline/roadPack';
import { digest } from '../src/pipeline/sources';

it('restores the entire graph with curved hills, connectors, UTF-8 names and controls', async () => {
  const graph: PackedPublicRoadGraph = { version: 1, nodes: [], edges: [], warnings: ['Survey: café – hill profile preserved'] };
  for (let i = 0; i <= 80; i++) graph.nodes.push({ id: `source-node:${i}`, osmNode: `${10_000_000 + i}`,
    x: i * 150, y: i % 2 ? -4.12 : 42.71, z: i % 3 * 13, ...(i % 2 ? { control: 'signal' as const } : { yield: true }) });
  for (let i = 0; i < 80; i++) {
    const a = graph.nodes[i]!, b = graph.nodes[i + 1]!;
    graph.edges.push({ id: `source-edge:${i}`, from: a.id, to: b.id, lengthM: 155.123, speedMps: 13.4, lane: i % 3,
      points: Array.from({ length: 81 }, (_, j): [number, number, number] => [a.x + (b.x - a.x) * j / 80,
        a.y + (b.y - a.y) * j / 80 + Math.sin(j / 20) * 2, a.z + (b.z - a.z) * j / 80 + Math.sin(j / 30) * 3]),
      kind: i % 3 ? 'lane' : 'connector', osmWay: 900_000 + i, name: 'Café & Mission / Lombard', inferredLanes: false,
      layer: i % 4 ? 0 : 1, bridge: i % 4 === 0, tunnel: false, routable: true, next: i < 79 ? [`source-edge:${i + 1}`] : [] });
  }
  const original = packRoadGraph(graph), legacy = encodeRoadTransport(original), encoded = encodeRoadPointTransport(original, legacy);
  expect(decodeRoadTransport(encoded)).toEqual(original); expect(decodeRoadTransport(legacy)).toEqual(original);
  expect(gzipSync(encoded).length).toBeLessThan(gzipSync(legacy).length);
  const metadata = { transport: 'predictive-v1', decodedBytes: original.length, decodedSha256: digest(original) };
  const restored = await restoreMapArtifact(encoded.buffer, metadata, 'road', true), packed = decodePackedRoadGraph(restored);
  expect(packed.edge(12)).toEqual(decodePackedRoadGraph(original).edge(12));
  expect(packed.node(17).control).toBe('signal');
  await expect(restoreMapArtifact(encoded.buffer, metadata, 'road', false)).rejects.toThrow('COMPACT_MAP_ASSETS_DISABLED');
  expect(() => decodeRoadTransport(encoded.subarray(0, encoded.length - 1))).toThrow('ROAD_POINT_HEADER');
});
