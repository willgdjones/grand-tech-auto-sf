import { expect, it } from 'vitest';
import { packRoadGraph } from '../tools/map/src/pipeline/roadPack';
import { decodeHeightTransport, decodeRoadTransport, encodeHeightTransport, encodeRoadTransport } from './mapTransport';
import { decodePackedRoadGraph, unpackRoadGraph } from './roadgraphPacked';

it('restores the exact roadpack bytes used by browser and server, including metadata and float bits', () => {
  const original = packRoadGraph({ version: 1, warnings: ['Survey retained'], nodes: [
    { id: 'a', osmNode: 'source:1', x: -300, y: -2.31, z: 500, control: 'signal', yield: true },
    { id: 'b', osmNode: 'source:2', x: -290, y: 6.18, z: 700, control: 'stop' },
  ], edges: [{ id: 'lane:1', from: 'a', to: 'b', points: [[-300, -2.31, 500], [-291.38, 4.8, 610], [-290, 6.18, 700]],
    lengthM: 222.03873, speedMps: 9.83, lane: 0, kind: 'lane', osmWay: 1234, name: 'Lombard 🌉',
    inferredLanes: false, layer: -1, bridge: false, tunnel: true, next: [] }] }, { routableEdgeIds: new Set() });
  const encoded = encodeRoadTransport(original), padded = new Uint8Array(encoded.length + 1);
  padded.set(encoded, 1);
  const decoded = decodeRoadTransport(padded.subarray(1));
  expect(decoded).toEqual(original);
  expect(unpackRoadGraph(decodePackedRoadGraph(decoded))).toEqual(unpackRoadGraph(decodePackedRoadGraph(original)));
  expect(() => decodePackedRoadGraph(encoded)).toThrow(); // an old consumer fails explicitly
  expect(() => decodeRoadTransport(encoded.subarray(0, -1))).toThrow();
  const oversized = encoded.slice(); new DataView(oversized.buffer).setUint32(8, 0xffffffff, true);
  expect(() => decodeRoadTransport(oversized)).toThrow();
});

it('restores every height sample at extremes, steep breaks and boundaries; rejects malformed streams', () => {
  const raw = new Uint8Array(32 + 9 * 2), h = new DataView(raw.buffer);
  h.setUint32(0, 0x46485447, true); h.setUint16(4, 1, true); h.setUint16(6, 3, true);
  h.setFloat32(8, 128, true); h.setInt32(12, -400, true); h.setInt32(16, -4, true); h.setInt32(20, 7, true); h.setFloat32(24, .01, true);
  [0, 65535, 0, 65535, 0, 65535, 2, 4, 6].forEach((v, i) => h.setUint16(32 + i * 2, v, true));
  const encoded = encodeHeightTransport(raw);
  expect(decodeHeightTransport(encoded)).toEqual(raw);
  expect(() => decodeHeightTransport(encoded.subarray(0, -1))).toThrow();
  expect(() => decodeHeightTransport(Uint8Array.from([...encoded, 0]))).toThrow();
  const corrupt = encoded.slice(); corrupt.fill(255, 32, 36);
  expect(() => decodeHeightTransport(corrupt)).toThrow();
  const huge = encoded.slice(); new DataView(huge.buffer).setUint16(6, 65535, true);
  expect(() => decodeHeightTransport(huge)).toThrow();
});
