import { decodePackedRoadGraph, roadPackLayout, ROAD_PACK_MAX_BYTES } from './roadgraphPacked';

/** GTRS v1 is lossless transport over GTRP v1. Existing consumers still receive
 * exactly the original packed bytes, including point samples and string order. */
export const ROAD_POINT_TRANSPORT_MAGIC = 0x53525447;
const HEADER = 40;
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
class Reader {
  at = 0;
  constructor(readonly bytes: Uint8Array) {}
  uint(): number {
    let value = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      if (this.at >= this.bytes.length) throw new Error('ROAD_POINT_VARINT');
      const byte = this.bytes[this.at++]!;
      if (shift === 28 && byte > 15) throw new Error('ROAD_POINT_VARINT');
      value = (value | (byte & 127) << shift) >>> 0;
      if (!(byte & 128)) return value;
    }
    throw new Error('ROAD_POINT_VARINT');
  }
  int(): number { const n = this.uint(); return (n >>> 1) ^ -(n & 1); }
  verify() { if (this.at !== this.bytes.length) throw new Error('ROAD_POINT_TRAILING'); }
}
function uint(out: number[], value: number) {
  let n = value >>> 0;
  while (n >= 128) { out.push((n & 127) | 128); n >>>= 7; } out.push(n);
}
function signed(out: number[], value: number) { uint(out, ((value << 1) ^ (value >> 31)) >>> 0); }
function equal(a: Uint8Array, b: Uint8Array) { return a.length === b.length && a.every((n, i) => n === b[i]); }

/** predicted is the established GTRD representation of the same source.
 * Canonical varints are required so reconstruction preserves every source byte. */
export function encodeRoadPointTransport(source: Uint8Array, predicted: Uint8Array): Uint8Array<ArrayBuffer> {
  const packed = decodePackedRoadGraph(source), c = packed.columns, offsets = roadPackLayout(packed.counts).offsets;
  if (predicted.length !== source.length || view(predicted).getUint32(0, true) !== 0x44525447) throw new Error('ROAD_POINT_BASE');
  const axes: number[][] = [[], [], []];
  for (let edge = 0; edge < packed.counts.edges; edge++) {
    const original = c.points.subarray(c.edgePointOffsets[edge]!, c.edgePointOffsets[edge + 1]!), reader = new Reader(original);
    const previous = [0, 0, 0], canonical: number[] = []; let count = 0;
    while (reader.at < original.length) {
      for (let axis = 0; axis < 3; axis++) {
        const delta = reader.int(); signed(canonical, delta);
        signed(axes[axis]!, (delta - previous[axis]!) | 0); previous[axis] = delta;
      }
      count++;
    }
    if (count < 2 || !equal(original, Uint8Array.from(canonical))) throw new Error('ROAD_POINT_CANONICAL');
  }
  const strings: number[] = [];
  for (let index = 0; index < packed.counts.strings; index++) {
    const current = c.strings.subarray(c.stringOffsets[index]!, c.stringOffsets[index + 1]!);
    let prefix = 0, back = 0;
    for (let distance = 1; distance <= Math.min(index, 16); distance++) {
      const prior = c.strings.subarray(c.stringOffsets[index - distance]!, c.stringOffsets[index - distance + 1]!);
      let length = 0; while (length < Math.min(current.length, prior.length) && current[length] === prior[length]) length++;
      if (length > prefix) { prefix = length; back = distance; }
    }
    if (prefix < 3) prefix = 0;
    uint(strings, prefix); if (prefix) uint(strings, back);
    for (let i = prefix; i < current.length; i++) strings.push(current[i]!);
  }
  const parts = [predicted.subarray(0, offsets.points), ...axes.map(a => Uint8Array.from(a)), Uint8Array.from(strings)];
  const output = new Uint8Array(HEADER + parts.reduce((sum, part) => sum + part.length, 0)), h = view(output);
  if (output.length > ROAD_PACK_MAX_BYTES) throw new Error('ROAD_POINT_SIZE');
  h.setUint32(0, ROAD_POINT_TRANSPORT_MAGIC, true); h.setUint32(4, 1, true); h.setUint32(8, source.length, true);
  parts.forEach((part, i) => h.setUint32(12 + i * 4, part.length, true));
  const padding = source.subarray(offsets.points + packed.counts.pointBytes, offsets.strings);
  output.set(padding, 32); // at most three alignment bytes; byte35 stays zero
  let at = HEADER; for (const part of parts) { output.set(part, at); at += part.length; }
  return output;
}

/** The callback restores the existing predicted columns. Framing/topology is
 * validated before point and string reconstruction; final metadata SHA remains
 * checked at the shared browser/Worker restoreMapArtifact boundary. */
export function decodeRoadPointTransport(source: Uint8Array, restoreColumns: (bytes: Uint8Array) => Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  if (source.length < HEADER || source.length > ROAD_PACK_MAX_BYTES) throw new Error('ROAD_POINT_SIZE');
  const h = view(source), size = h.getUint32(8, true), lengths = Array.from({ length: 5 }, (_, i) => h.getUint32(12 + i * 4, true));
  if (h.getUint32(0, true) !== ROAD_POINT_TRANSPORT_MAGIC || h.getUint32(4, true) !== 1 || h.getUint32(36, true)
    || source[35] || size < 40 || size > ROAD_PACK_MAX_BYTES || lengths[0]! < 40 || lengths[0]! > size
    || HEADER + lengths.reduce((sum, n) => sum + n, 0) !== source.length) throw new Error('ROAD_POINT_HEADER');
  let at = HEADER;
  const parts = lengths.map(length => source.subarray(at, at += length));
  const predicted = new Uint8Array(size); predicted.set(parts[0]!);
  if (view(predicted).getUint32(0, true) !== 0x44525447) throw new Error('ROAD_POINT_BASE');
  const output = restoreColumns(predicted), packed = decodePackedRoadGraph(output), c = packed.columns;
  const offsets = roadPackLayout(packed.counts).offsets;
  if (offsets.points !== lengths[0]) throw new Error('ROAD_POINT_HEADER');
  const readers = parts.slice(1, 4).map(bytes => new Reader(bytes));
  let cursor = 0;
  for (let edge = 0; edge < packed.counts.edges; edge++) {
    const end = c.edgePointOffsets[edge + 1]!, previous = [0, 0, 0]; let count = 0;
    while (cursor < end) {
      for (let axis = 0; axis < 3; axis++) {
        const delta = (previous[axis]! + readers[axis]!.int()) | 0; previous[axis] = delta;
        let word = ((delta << 1) ^ (delta >> 31)) >>> 0;
        do {
          if (cursor >= end) throw new Error('ROAD_POINT_LENGTH');
          c.points[cursor++] = word >= 128 ? (word & 127) | 128 : word; word >>>= 7;
        } while (word);
      }
      count++;
    }
    if (count < 2) throw new Error('ROAD_POINT_LENGTH');
  }
  readers.forEach(reader => reader.verify());
  const strings = new Reader(parts[4]!);
  for (let index = 0; index < packed.counts.strings; index++) {
    const start = c.stringOffsets[index]!, end = c.stringOffsets[index + 1]!, prefix = strings.uint();
    if (prefix > end - start) throw new Error('ROAD_POINT_PREFIX');
    if (prefix) {
      const back = strings.uint();
      if (back < 1 || back > Math.min(index, 16)) throw new Error('ROAD_POINT_PREFIX');
      const prior = c.stringOffsets[index - back]!;
      if (prefix > c.stringOffsets[index - back + 1]! - prior) throw new Error('ROAD_POINT_PREFIX');
      c.strings.set(c.strings.subarray(prior, prior + prefix), start);
    }
    const length = end - start - prefix;
    if (strings.at + length > strings.bytes.length) throw new Error('ROAD_POINT_STRINGS');
    c.strings.set(strings.bytes.subarray(strings.at, strings.at += length), start + prefix);
  }
  strings.verify();
  const padding = offsets.strings - offsets.points - packed.counts.pointBytes;
  output.set(source.subarray(32, 32 + padding), offsets.points + packed.counts.pointBytes);
  return output;
}
