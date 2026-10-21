/** GTCB v1: source collision rings as exact millimetre deltas. No simplification.
 * Courtyards, vertical bounds, order and source IDs are retained. Runtime callers
 * must check compactMapAssets before using a manifest with this encoding.
 */
export const COLLISION_ENCODING = 'rings-v1' as const;
const MAGIC = 0x42435447, LIMIT = 25_000_000;
type Point = [number, number];
export interface MapCollision {
  version: 1; origin: [number, number, number];
  buildings: { id: string; minY: number; maxY: number; heightSource: string; rings: Point[][] }[];
}
type Metadata = [MapCollision['origin'], [string, string, number[]][]];
function fail(): never { throw new Error('COMPACT_COLLISION_INVALID'); }
function checkedInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < -2147483648 || value > 2147483647) fail();
  return value;
}
function millimetres(value: number): number {
  const scaled = checkedInteger(Math.round(value * 1000));
  if (scaled / 1000 !== value) fail();
  return scaled;
}
function validateMetadata(value: unknown): asserts value is Metadata {
  if (!Array.isArray(value) || value.length !== 2) fail();
  const [origin, buildings] = value;
  if (!Array.isArray(origin) || origin.length !== 3 || !origin.every(Number.isFinite) || !Array.isArray(buildings)) fail();
  let expanded = buildings.length * 128;
  for (const b of buildings) {
    if (!Array.isArray(b) || b.length !== 3 || typeof b[0] !== 'string' || b[0].length > 512
      || typeof b[1] !== 'string' || b[1].length > 128 || !Array.isArray(b[2]) || !b[2].length) fail();
    for (const length of b[2]) {
      if (!Number.isSafeInteger(length) || length < 3) fail();
      expanded += length * 16;
      if (expanded > LIMIT) fail();
    }
  }
}
export function encodeMapCollision(source: Uint8Array): Uint8Array<ArrayBuffer> {
  if (source.length > LIMIT) fail();
  const json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source)) as MapCollision;
  if (json.version !== 1 || !Array.isArray(json.buildings)) fail();
  const metadata: Metadata = [json.origin, []], body: number[] = [];
  function integer(value: number) {
    let word = ((checkedInteger(value) << 1) ^ (value >> 31)) >>> 0;
    while (word > 127) { body.push((word & 127) | 128); word >>>= 7; }
    body.push(word);
  }
  for (const b of json.buildings) {
    metadata[1].push([b.id, b.heightSource, b.rings.map(r => r.length)]);
    integer(millimetres(b.minY)); integer(millimetres(b.maxY));
    for (const ring of b.rings) {
      let x = 0, z = 0;
      for (const p of ring) {
        if (!Array.isArray(p) || p.length !== 2) fail();
        const nextX = millimetres(p[0]), nextZ = millimetres(p[1]);
        integer(nextX - x); integer(nextZ - z); x = nextX; z = nextZ;
      }
    }
  }
  validateMetadata(metadata);
  const header = new TextEncoder().encode(JSON.stringify(metadata));
  if (header.length > 1_000_000 || 16 + header.length + body.length > LIMIT) fail();
  const output = new Uint8Array(16 + header.length + body.length), view = new DataView(output.buffer);
  view.setUint32(0, MAGIC, true); view.setUint32(4, 1, true); view.setUint32(8, header.length, true);
  output.set(header, 16); output.set(body, 16 + header.length);
  // This rejects unknown fields or noncanonical source schemas rather than losing them.
  if (JSON.stringify(decodeMapCollision(output)) !== JSON.stringify(json)) fail();
  return output;
}
export function decodeMapCollision(source: Uint8Array): MapCollision {
  if (source.length < 16 || source.length > LIMIT) fail();
  const view = new DataView(source.buffer, source.byteOffset, 16), length = view.getUint32(8, true);
  if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== 1 || view.getUint32(12, true)
    || length > 1_000_000 || 16 + length > source.length) fail();
  const metadata: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source.subarray(16, 16 + length)));
  validateMetadata(metadata);
  let cursor = 16 + length;
  function integer(): number {
    let word = 0, shift = 0;
    while (true) {
      if (cursor >= source.length || shift > 28) fail();
      const byte = source[cursor++]!;
      if (shift === 28 && byte > 15) fail();
      word |= (byte & 127) << shift;
      if (!(byte & 128)) { if (shift > 0 && byte === 0) fail(); break; }
      shift += 7;
    }
    return (word >>> 1) ^ -(word & 1);
  }
  const buildings = metadata[1].map(([id, heightSource, lengths]) => {
    const minY = integer() / 1000, maxY = integer() / 1000;
    if (minY > maxY) fail();
    const rings = lengths.map(count => {
      const ring: Point[] = []; let x = 0, z = 0;
      for (let i = 0; i < count; i++) { x = checkedInteger(x + integer()); z = checkedInteger(z + integer()); ring.push([x / 1000, z / 1000]); }
      return ring;
    });
    return { id, minY, maxY, heightSource, rings };
  });
  if (cursor !== source.length) fail();
  return { version: 1, origin: metadata[0], buildings };
}
