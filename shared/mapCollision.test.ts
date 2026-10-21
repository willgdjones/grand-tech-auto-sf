import { expect, it } from 'vitest';
import { decodeMapCollision, encodeMapCollision, type MapCollision } from './mapCollision';

it('retains courtyard rings, millimetres, below-ground bounds, order and surveyed source IDs', () => {
  const fixture: MapCollision = { version: 1, origin: [-256, 0, 1024], buildings: [
    { id: 'datasf:201006.0000497:0:0', minY: -8.884, maxY: 15.474, heightSource: 'datasf', rings: [
      [[237.544, 240.149], [297.508, 298.27], [-20.543, 300.964]],
      [[240.001, 250.002], [244.001, 254.002], [250.001, 250.002]],
    ] },
    { id: 'osm:survey', minY: 0, maxY: .001, heightSource: 'osm-levels', rings: [[[0, 0], [.001, 0], [0, .001]]] },
  ] };
  const encode = (json: unknown) => encodeMapCollision(new TextEncoder().encode(JSON.stringify(json) + '\n'));
  const packed = encode(fixture);
  expect(decodeMapCollision(packed)).toEqual(fixture);
  expect(decodeMapCollision(encode({ version: 1, origin: [0, 0, 0], buildings: [] }))).toEqual({ version: 1, origin: [0, 0, 0], buildings: [] });
  expect(() => decodeMapCollision(packed.subarray(0, -1))).toThrow();
  const oversized = packed.slice(); new DataView(oversized.buffer).setUint32(8, 0xffffffff, true);
  expect(() => decodeMapCollision(oversized)).toThrow();
  expect(() => encode({ ...fixture, importantSourceMetadata: 'must not disappear' })).toThrow();
});
