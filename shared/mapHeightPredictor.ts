/** GTCY v1: lossless Int16 height residuals over the unchanged contact grid.
 * The embedded GTCM/GTCX/GTCJ structure and every vertex/face ordinal remain
 * unchanged. A decoder adapter restores positions before any recipe uses them.
 */
import { COMPACT_MESH_LIMIT, decodeCompactMesh, type CompactMeshGroup, type MapMeshDecoder } from './mapMesh';
import { decodeBuildingRecipe, isBuildingRecipe, type RecipeCollision, type RecipeTriangulator } from './mapRecipe';
import { decodeJoinRecipe, isJoinRecipe } from './mapJoinRecipe';

export const MAP_HEIGHT_MESH_MAGIC = 0x59435447;
export interface PredictionStream {
  offset: number; bytes: number; vertices: number;
  name: 'terrain' | 'roads'; translation: [number, number, number]; scale: [number, number, number];
}
export interface HeightPredictionHeader { heightSha256: string; baseBytes: number; streams: PredictionStream[] }
export interface PredictionField { size: number; step: number; offsetCm: number; values: Uint16Array }
export function predictionField(bytes: Uint8Array): PredictionField {
  if (bytes.length < 32 || bytes.length > COMPACT_MESH_LIMIT) throw new Error('MAP_HEIGHT_FIELD_SIZE');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), size = view.getUint16(6, true), step = view.getFloat32(8, true), units = view.getFloat32(24, true);
  if (view.getUint32(0, true) !== 0x46485447 || view.getUint16(4, true) !== 1 || size < 2
    || bytes.length !== 32 + size * size * 2 || !Number.isFinite(step) || step <= 0
    || !Number.isFinite(units) || Math.abs(units - .01) > 1e-8) throw new Error('MAP_HEIGHT_FIELD');
  const values = new Uint16Array(size * size);
  for (let i = 0; i < values.length; i++) values[i] = view.getUint16(32 + i * 2, true);
  return { size, step, offsetCm: view.getInt32(12, true), values };
}
function sample(field: PredictionField, x: number, z: number): number {
  const px = Math.max(0, Math.min(field.size - 1, x / field.step)), pz = Math.max(0, Math.min(field.size - 1, z / field.step));
  const ix = Math.min(field.size - 2, Math.floor(px)), iz = Math.min(field.size - 2, Math.floor(pz)), fx = px - ix, fz = pz - iz;
  const h = (a: number, b: number) => field.values[b * field.size + a]!;
  return (field.offsetCm + (h(ix, iz) * (1 - fx) + h(ix + 1, iz) * fx) * (1 - fz)
    + (h(ix, iz + 1) * (1 - fx) + h(ix + 1, iz + 1) * fx) * fz) / 100;
}
/** Modular Int16 residuals are exact even for elevated roads or steep slopes.
 * Keep this arithmetic/order pinned for GTCY v1; never resample source geometry. */
export function transformHeightWords(source: Int16Array, group: Pick<CompactMeshGroup, 'name' | 'translation' | 'scale'>,
  field: PredictionField, restoring: boolean): Int16Array<ArrayBuffer> {
  const result = Int16Array.from(source);
  for (let i = 0; i < result.length; i += 4) {
    const x = source[i]! / 32767 * group.scale[0] + group.translation[0];
    const z = source[i + 2]! / 32767 * group.scale[2] + group.translation[2];
    const y = sample(field, x, z) + (group.name === 'roads' ? .1 : 0);
    const prediction = Math.round((y - group.translation[1]) / group.scale[1] * 32767);
    if (!Number.isSafeInteger(prediction) || Math.abs(prediction) > 0x7fffffff) throw new Error('MAP_HEIGHT_PREDICTION_RANGE');
    result[i + 1] = source[i + 1]! + (restoring ? prediction : -prediction);
  }
  return result;
}
export function isHeightPredictedMesh(source: Uint8Array): boolean {
  return source.length >= 4 && new DataView(source.buffer, source.byteOffset, 4).getUint32(0, true) === MAP_HEIGHT_MESH_MAGIC;
}
export function heightPredictionHeader(source: Uint8Array) {
  if (source.length < 16 || source.length > COMPACT_MESH_LIMIT) throw new Error('MAP_HEIGHT_MESH_SIZE');
  const view = new DataView(source.buffer, source.byteOffset, 16), length = view.getUint32(8, true);
  if (!isHeightPredictedMesh(source) || view.getUint32(4, true) !== 1 || view.getUint32(12, true)
    || length > 32_000 || 16 + length >= source.length) throw new Error('MAP_HEIGHT_MESH_HEADER');
  const header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source.subarray(16, 16 + length))) as HeightPredictionHeader;
  if (!header || !/^[a-f0-9]{64}$/.test(header.heightSha256) || !Number.isSafeInteger(header.baseBytes)
    || header.baseBytes < 16 || 16 + length + header.baseBytes !== source.length
    || !Array.isArray(header.streams) || !header.streams.length || header.streams.length > 64) throw new Error('MAP_HEIGHT_MESH_HEADER');
  let end = 0, decoded = 0;
  for (const stream of header.streams) {
    if (!stream || !['terrain', 'roads'].includes(stream.name)
      || [stream.offset, stream.bytes, stream.vertices].some(n => !Number.isSafeInteger(n) || n < 0)
      || !stream.bytes || !stream.vertices || stream.offset < end || stream.offset + stream.bytes > header.baseBytes) throw new Error('MAP_HEIGHT_STREAM');
    for (const vector of [stream.translation, stream.scale]) if (!Array.isArray(vector) || vector.length !== 3 || !vector.every(Number.isFinite)) throw new Error('MAP_HEIGHT_TRANSFORM');
    if (stream.scale.some(n => n <= 0)) throw new Error('MAP_HEIGHT_TRANSFORM');
    end = stream.offset + stream.bytes; decoded += stream.vertices * 8;
    if (decoded > COMPACT_MESH_LIMIT) throw new Error('MAP_HEIGHT_DECODE_BUDGET');
  }
  const base = source.subarray(16 + length);
  if (isHeightPredictedMesh(base)) throw new Error('MAP_HEIGHT_NESTING');
  return { header, base };
}
export async function heightPredictionDecoder(source: Uint8Array, height: Uint8Array, decoder: MapMeshDecoder) {
  const { header, base } = heightPredictionHeader(source), field = predictionField(height);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(height)))].map(v => v.toString(16).padStart(2, '0')).join('');
  if (hash !== header.heightSha256) throw new Error('MAP_HEIGHT_FIELD_HASH');
  const streams = new Map(header.streams.map(stream => [base.byteOffset + stream.offset, stream]));
  const restored = new Set<number>();
  const adapter: MapMeshDecoder = { ready: decoder.ready, async decodeGltfBufferAsync(count, stride, encoded, mode) {
    const stream = encoded.buffer === base.buffer ? streams.get(encoded.byteOffset) : undefined;
    if (stream && (mode !== 'ATTRIBUTES' || stride !== 8 || count !== stream.vertices || encoded.length !== stream.bytes
      || restored.has(encoded.byteOffset))) throw new Error('MAP_HEIGHT_STREAM');
    const bytes = await decoder.decodeGltfBufferAsync(count, stride, encoded, mode);
    if (!stream) return bytes;
    restored.add(encoded.byteOffset);
    return new Uint8Array(transformHeightWords(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2), stream, field, true).buffer);
  } };
  return { base, decoder: adapter, verify() { if (restored.size !== streams.size) throw new Error('MAP_HEIGHT_UNUSED_STREAM'); } };
}
export async function decodeHeightPredictedMesh(source: Uint8Array, height: Uint8Array, decoder: MapMeshDecoder,
  collision: RecipeCollision | undefined, triangulate: RecipeTriangulator) {
  const restored = await heightPredictionDecoder(source, height, decoder), base = restored.base;
  if (isBuildingRecipe(base) && !collision) throw new Error('MAP_RECIPE_COLLISION_REQUIRED');
  const groups = isJoinRecipe(base) ? await decodeJoinRecipe(base, restored.decoder, collision, triangulate)
    : isBuildingRecipe(base) ? await decodeBuildingRecipe(base, collision!, triangulate, restored.decoder) : await decodeCompactMesh(base, restored.decoder);
  restored.verify(); return groups;
}
