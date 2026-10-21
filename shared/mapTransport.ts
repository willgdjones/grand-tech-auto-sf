import {
  decodePackedRoadGraph, roadPackColumns, roadPackLayout, ROAD_PACK_HEADER_BYTES,
  ROAD_PACK_MAGIC, ROAD_PACK_MAX_BYTES, ROAD_PACK_VERSION, type RoadPackCounts,
} from './roadgraphPacked';
import { decodeMapCollision } from './mapCollision';
import { decodeRoadPointTransport, ROAD_POINT_TRANSPORT_MAGIC } from './mapRoadPointTransport';

/** Reversible transport only: routing/contact consumers still receive the original bytes.
 * HTTP gzip/Brotli compress the predicted streams. These magic values prevent an old
 * client from silently interpreting predicted data as coordinates. Callers must gate
 * predictive-v1 manifests with compactMapAssets; this module contains no flag override.
 */
const ROAD_DELTA_MAGIC = 0x44525447; // GTRD, little endian
const HEIGHT_MAGIC = 0x46485447; // GTHF
const HEIGHT_DELTA_MAGIC = 0x44485447; // GTHD
export const MAP_TRANSPORT = 'predictive-v1' as const;
export type MapTransport = typeof MAP_TRANSPORT;
export interface TransportMetadata { transport?: string; decodedBytes?: number; decodedSha256?: string }
const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function roadCounts(bytes: Uint8Array): RoadPackCounts {
  if (bytes.length < ROAD_PACK_HEADER_BYTES || bytes.length > ROAD_PACK_MAX_BYTES) throw new Error('MAP_TRANSPORT_SIZE');
  const h = viewOf(bytes);
  if (h.getUint32(4, true) !== ROAD_PACK_VERSION || h.getUint32(36, true)) throw new Error('MAP_TRANSPORT_VERSION');
  return { nodes: h.getUint32(8, true), edges: h.getUint32(12, true), pointBytes: h.getUint32(16, true),
    next: h.getUint32(20, true), strings: h.getUint32(24, true), stringBytes: h.getUint32(28, true), warnings: h.getUint32(32, true) };
}

/** Exact bitwise delta plus byte shuffle on each 32-bit column, including float bits. */
export function encodeRoadTransport(source: Uint8Array): Uint8Array<ArrayBuffer> {
  const packed = decodePackedRoadGraph(source), output = Uint8Array.from(source);
  const offsets = roadPackLayout(packed.counts).offsets;
  for (const [name, column] of Object.entries(packed.columns)) {
    if (column.BYTES_PER_ELEMENT !== 4) continue;
    const words = new Uint32Array(column.buffer, column.byteOffset, column.byteLength / 4);
    const stride = name === 'nodeXYZ' ? 3 : 1, at = offsets[name as keyof typeof offsets];
    for (let i = 0; i < words.length; i++) {
      const delta = (words[i]! - (i >= stride ? words[i - stride]! : 0)) >>> 0;
      for (let byte = 0; byte < 4; byte++) output[at + byte * words.length + i] = delta >>> (byte * 8);
    }
  }
  viewOf(output).setUint32(0, ROAD_DELTA_MAGIC, true);
  return output;
}

export function decodeRoadTransport(source: Uint8Array): Uint8Array<ArrayBuffer> {
  if (source.length >= 4 && viewOf(source).getUint32(0, true) === ROAD_POINT_TRANSPORT_MAGIC)
    return decodeRoadPointTransport(source, decodeRoadTransport);
  const counts = roadCounts(source);
  if (viewOf(source).getUint32(0, true) !== ROAD_DELTA_MAGIC) throw new Error('MAP_TRANSPORT_MAGIC');
  const output = Uint8Array.from(source), columns = roadPackColumns(output, counts), offsets = roadPackLayout(counts).offsets;
  for (const [name, column] of Object.entries(columns)) {
    if (column.BYTES_PER_ELEMENT !== 4) continue;
    const words = new Uint32Array(column.buffer, column.byteOffset, column.byteLength / 4);
    const stride = name === 'nodeXYZ' ? 3 : 1, at = offsets[name as keyof typeof offsets];
    for (let i = 0; i < words.length; i++) {
      let delta = 0;
      for (let byte = 0; byte < 4; byte++) delta |= source[at + byte * words.length + i]! << (byte * 8);
      words[i] = (delta + (i >= stride ? words[i - stride]! : 0)) >>> 0;
    }
  }
  viewOf(output).setUint32(0, ROAD_PACK_MAGIC, true);
  decodePackedRoadGraph(output); // framing and all topology indices before either consumer sees it
  return output;
}

function heightSize(source: Uint8Array, magic: number): number {
  if (source.length < 32 || source.length > ROAD_PACK_MAX_BYTES) throw new Error('MAP_TRANSPORT_SIZE');
  const h = viewOf(source), size = h.getUint16(6, true), step = h.getFloat32(8, true);
  if (h.getUint32(0, true) !== magic || h.getUint16(4, true) !== 1) throw new Error('MAP_TRANSPORT_VERSION');
  const units = h.getFloat32(24, true);
  if (size < 2 || 32 + size * size * 2 > ROAD_PACK_MAX_BYTES || !Number.isFinite(step) || step <= 0
    || !Number.isFinite(units) || Math.abs(units - .01) > 1e-8) throw new Error('MAP_TRANSPORT_DIMENSIONS');
  return size;
}

/** Retains every centimetre contact sample and all 32 header bytes, without resampling. */
export function encodeHeightTransport(source: Uint8Array): Uint8Array<ArrayBuffer> {
  const size = heightSize(source, HEIGHT_MAGIC), h = viewOf(source);
  if (source.length !== 32 + size * size * 2) throw new Error('MAP_TRANSPORT_SIZE');
  const output: number[] = Array.from(source.subarray(0, 32));
  const value = (i: number) => h.getUint16(32 + i * 2, true);
  for (let i = 0; i < size * size; i++) {
    const residual = value(i) - (i % size ? value(i - 1) : 0) - (i >= size ? value(i - size) : 0)
      + (i >= size && i % size ? value(i - size - 1) : 0);
    let word = ((residual << 1) ^ (residual >> 31)) >>> 0;
    while (word >= 128) { output.push((word & 127) | 128); word >>>= 7; }
    output.push(word);
  }
  const bytes = Uint8Array.from(output); viewOf(bytes).setUint32(0, HEIGHT_DELTA_MAGIC, true); return bytes;
}

export function decodeHeightTransport(source: Uint8Array): Uint8Array<ArrayBuffer> {
  const size = heightSize(source, HEIGHT_DELTA_MAGIC), output = new Uint8Array(32 + size * size * 2), h = viewOf(output);
  output.set(source.subarray(0, 32)); h.setUint32(0, HEIGHT_MAGIC, true);
  let cursor = 32;
  const value = (i: number) => h.getUint16(32 + i * 2, true);
  for (let i = 0; i < size * size; i++) {
    let word = 0, shift = 0;
    while (true) {
      if (cursor >= source.length || shift > 14) throw new Error('MAP_TRANSPORT_VARINT');
      const byte = source[cursor++]!; word |= (byte & 127) << shift;
      if (!(byte & 128)) break;
      shift += 7;
    }
    const residual = (word >>> 1) ^ -(word & 1);
    const sample = residual + (i % size ? value(i - 1) : 0) + (i >= size ? value(i - size) : 0)
      - (i >= size && i % size ? value(i - size - 1) : 0);
    if (sample < 0 || sample > 65535) throw new Error('MAP_TRANSPORT_HEIGHT');
    h.setUint16(32 + i * 2, sample, true);
  }
  if (cursor !== source.length) throw new Error('MAP_TRANSPORT_SIZE');
  return output;
}

/** Shared browser/Worker boundary: unknown or disabled codecs never silently fall back. */
export async function restoreMapArtifact(buffer: ArrayBuffer, metadata: TransportMetadata, kind: 'road' | 'height' | 'collision', enabled: boolean): Promise<ArrayBuffer> {
  if (!metadata.transport) return buffer;
  if (metadata.transport !== MAP_TRANSPORT || !enabled) throw new Error('COMPACT_MAP_ASSETS_DISABLED');
  if (!Number.isSafeInteger(metadata.decodedBytes) || !metadata.decodedSha256 || !/^[a-f0-9]{64}$/.test(metadata.decodedSha256)) throw new Error('MAP_TRANSPORT_METADATA');
  const source = new Uint8Array(buffer);
  const decoded = kind === 'road' ? decodeRoadTransport(source) : kind === 'height' ? decodeHeightTransport(source)
    : new TextEncoder().encode(JSON.stringify(decodeMapCollision(source)) + '\n');
  if (decoded.length !== metadata.decodedBytes) throw new Error('MAP_TRANSPORT_SIZE');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', decoded.buffer))].map(v => v.toString(16).padStart(2, '0')).join('');
  if (hash !== metadata.decodedSha256) throw new Error('MAP_TRANSPORT_HASH');
  return decoded.buffer;
}
