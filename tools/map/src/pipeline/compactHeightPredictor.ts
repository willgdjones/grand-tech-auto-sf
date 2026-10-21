import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { COMPACT_MESH_MAGIC, COMPACT_MESH_LIMIT, compactMeshHeader, decodeCompactMesh, type MapMeshDecoder } from '../../../../shared/mapMesh';
import { buildingRecipeHeader, isBuildingRecipe } from '../../../../shared/mapRecipe';
import { isJoinRecipe, joinRecipeHeader, MAP_JOIN_MAGIC } from '../../../../shared/mapJoinRecipe';
import { heightPredictionDecoder, MAP_HEIGHT_MESH_MAGIC, predictionField, transformHeightWords,
  type HeightPredictionHeader, type PredictionStream } from '../../../../shared/mapHeightPredictor';
import { digest } from './sources';

const zip = (bytes: Uint8Array) => gzipSync(bytes, { level: 9 }).length;
function frame(magic: number, header: unknown, body: Uint8Array[]): Buffer {
  const json = Buffer.from(JSON.stringify(header)), prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(magic); prefix.writeUInt32LE(1, 4); prefix.writeUInt32LE(json.length, 8);
  return Buffer.concat([prefix, json, ...body]);
}
function leaves(bytes: Uint8Array): Uint8Array[] {
  if (isJoinRecipe(bytes)) { const part = joinRecipeHeader(bytes); return [...leaves(part.base), ...(part.fallback.length ? leaves(part.fallback) : [])]; }
  if (isBuildingRecipe(bytes)) return leaves(buildingRecipeHeader(bytes).fallback);
  compactMeshHeader(bytes); return [bytes];
}
/** Only encoded position streams change. Every topology/color stream, recipe
 * record, selection mask and transform retains its original meaning and order. */
export async function packHeightPredictedMesh(source: Uint8Array, heightBytes: Uint8Array) {
  const field = predictionField(heightBytes); await MeshoptEncoder.ready;
  type Packed = { bytes: Uint8Array; streams: PredictionStream[] };
  const shift = (streams: PredictionStream[], offset: number) => streams.map(stream => ({ ...stream, offset: stream.offset + offset }));
  async function pack(bytes: Uint8Array): Promise<Packed> {
    if (isJoinRecipe(bytes)) {
      const part = joinRecipeHeader(bytes), base = await pack(part.base);
      const fallback = part.fallback.length ? await pack(part.fallback) : { bytes: part.fallback, streams: [] };
      if (!base.streams.length && !fallback.streams.length) return { bytes, streams: [] };
      const header = { ...part.header, baseBytes: base.bytes.length, fallbackBytes: fallback.bytes.length };
      const prefixLength = 16 + Buffer.byteLength(JSON.stringify(header));
      return { bytes: frame(MAP_JOIN_MAGIC, header, [base.bytes, part.mask, fallback.bytes]),
        streams: [...shift(base.streams, prefixLength), ...shift(fallback.streams, prefixLength + base.bytes.length + part.mask.length)] };
    }
    if (isBuildingRecipe(bytes)) {
      const part = buildingRecipeHeader(bytes), fallback = await pack(part.fallback);
      const prefixLength = bytes.length - part.fallback.length;
      return fallback.streams.length ? { bytes: Buffer.concat([bytes.subarray(0, prefixLength), fallback.bytes]),
        streams: shift(fallback.streams, prefixLength) } : { bytes, streams: [] };
    }
    const { groups, dataOffset } = compactMeshHeader(bytes), decoded = await decodeCompactMesh(bytes, MeshoptDecoder);
    const body: Uint8Array[] = [], streams: PredictionStream[] = []; let from = dataOffset, to = 0;
    for (const [i, group] of groups.entries()) {
      const sourceStreams = group.streams.map(length => { const stream = bytes.subarray(from, from + length); from += length; return stream; });
      if (group.name === 'terrain' || group.name === 'roads') {
        const words = transformHeightWords(decoded[i]!.positions, group, field, false);
        const encoded = MeshoptEncoder.encodeVertexBuffer(new Uint8Array(words.buffer), group.vertices, 8);
        if (zip(encoded) < zip(sourceStreams[0]!)) {
          sourceStreams[0] = encoded;
          streams.push({ offset: to, bytes: encoded.length, vertices: group.vertices, name: group.name,
            translation: group.translation, scale: group.scale });
        }
      }
      group.streams = sourceStreams.map(s => s.length) as [number, number, number];
      body.push(...sourceStreams); to += sourceStreams.reduce((sum, s) => sum + s.length, 0);
    }
    if (!streams.length) return { bytes, streams: [] };
    const output = frame(COMPACT_MESH_MAGIC, groups, body), prefixLength = 16 + Buffer.byteLength(JSON.stringify(groups));
    return { bytes: output, streams: shift(streams, prefixLength) };
  }
  const packed = await pack(source);
  if (!packed.streams.length) return { bytes: Uint8Array.from(source), used: false, predictedVertices: 0, streams: 0 };
  const header: HeightPredictionHeader = { heightSha256: digest(heightBytes), baseBytes: packed.bytes.length, streams: packed.streams };
  const candidate = frame(MAP_HEIGHT_MESH_MAGIC, header, [packed.bytes]);
  if (candidate.length > COMPACT_MESH_LIMIT || zip(candidate) >= zip(source)) return { bytes: Uint8Array.from(source), used: false, predictedVertices: 0, streams: 0 };
  // Validate the actual adapter at each embedded compact leaf. This preserves
  // every position/index/color ordinal without repeating expensive seam generation.
  const restored = await heightPredictionDecoder(candidate, heightBytes, MeshoptDecoder);
  const originalLeaves = leaves(source), restoredLeaves = leaves(restored.base);
  assert.equal(originalLeaves.length, restoredLeaves.length);
  const decode = (bytes: Uint8Array, decoder: MapMeshDecoder) => decodeCompactMesh(bytes, decoder);
  for (let i = 0; i < originalLeaves.length; i++) {
    const before = await decode(originalLeaves[i]!, MeshoptDecoder), after = await decode(restoredLeaves[i]!, restored.decoder);
    assert.equal(before.length, after.length);
    for (let j = 0; j < before.length; j++) {
      const a = before[j]!, b = after[j]!;
      assert.deepEqual({ ...a.group, streams: [] }, { ...b.group, streams: [] });
      assert.deepEqual(a.positions, b.positions); assert.deepEqual(a.indices, b.indices); assert.deepEqual(a.colors, b.colors);
    }
  }
  restored.verify();
  return { bytes: Uint8Array.from(candidate), used: true, predictedVertices: packed.streams.reduce((sum, s) => sum + s.vertices, 0), streams: packed.streams.length };
}
