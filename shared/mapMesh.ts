/** GTCM v1: merged quantized positions, oriented triangle indices and flat triangle RGB.
 * Source normals are redundant for flat-shaded city geometry; consumers derive them
 * from the retained positions. Source GLBs remain audit inputs, outside this format.
 */
export const COMPACT_MESH_MAGIC = 0x4d435447;
export const COMPACT_MESH_ENCODING = 'triangles-v1' as const;
export const COMPACT_MESH_LIMIT = 25_000_000;
export interface CompactMeshGroup {
  name: 'terrain' | 'roads' | 'buildings' | 'structures';
  translation: [number, number, number]; scale: [number, number, number];
  vertices: number; triangles: number; streams: [number, number, number];
}
export interface DecodedMapMesh { group: CompactMeshGroup; positions: Int16Array; indices: Uint32Array; colors: Uint8Array }
export interface MapMeshDecoder {
  ready: Promise<void>;
  decodeGltfBufferAsync(count: number, size: number, source: Uint8Array, mode: 'ATTRIBUTES' | 'TRIANGLES'): Promise<Uint8Array>;
}
export function compactMeshHeader(source: Uint8Array): { groups: CompactMeshGroup[]; dataOffset: number } {
  if (source.length < 16 || source.length > COMPACT_MESH_LIMIT) throw new Error('COMPACT_MESH_SIZE');
  const header = new DataView(source.buffer, source.byteOffset, 16), length = header.getUint32(8, true);
  if (header.getUint32(0, true) !== COMPACT_MESH_MAGIC || header.getUint32(4, true) !== 1 || header.getUint32(12, true)) throw new Error('COMPACT_MESH_VERSION');
  if (length > 64_000 || 16 + length > source.length) throw new Error('COMPACT_MESH_HEADER');
  const groups = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source.subarray(16, 16 + length))) as CompactMeshGroup[];
  if (!Array.isArray(groups) || groups.length > 16) throw new Error('COMPACT_MESH_GROUPS');
  let encoded = 16 + length, expanded = 0;
  for (const group of groups) {
    if (!group || !['terrain', 'roads', 'buildings', 'structures'].includes(group.name)) throw new Error('COMPACT_MESH_GROUP');
    if (!Array.isArray(group.streams) || group.streams.length !== 3) throw new Error('COMPACT_MESH_COUNT');
    for (const v of [group.vertices, group.triangles, ...group.streams]) if (!Number.isSafeInteger(v) || v <= 0) throw new Error('COMPACT_MESH_COUNT');
    for (const vector of [group.translation, group.scale]) if (!Array.isArray(vector) || vector.length !== 3 || !vector.every(Number.isFinite)) throw new Error('COMPACT_MESH_TRANSFORM');
    if (group.scale.some(v => v <= 0) || !Array.isArray(group.streams) || group.streams.length !== 3) throw new Error('COMPACT_MESH_TRANSFORM');
    encoded += group.streams.reduce((n, v) => n + v, 0);
    // Includes bounded decode streams and the flat position/normal/RGB render attributes.
    expanded += group.vertices * 8 + group.triangles * (16 + 36);
    if (expanded > COMPACT_MESH_LIMIT) throw new Error('COMPACT_MESH_DECODE_BUDGET');
  }
  if (encoded !== source.length) throw new Error('COMPACT_MESH_SIZE');
  return { groups, dataOffset: 16 + length };
}
export async function decodeCompactMesh(source: Uint8Array, decoder: MapMeshDecoder): Promise<DecodedMapMesh[]> {
  const { groups, dataOffset } = compactMeshHeader(source), result: DecodedMapMesh[] = [];
  await decoder.ready;
  let at = dataOffset;
  for (const group of groups) {
    const streams = group.streams.map(length => { const bytes = source.subarray(at, at + length); at += length; return bytes; });
    const positions = await decoder.decodeGltfBufferAsync(group.vertices, 8, streams[0]!, 'ATTRIBUTES');
    const indices = await decoder.decodeGltfBufferAsync(group.triangles * 3, 4, streams[1]!, 'TRIANGLES');
    const colors = await decoder.decodeGltfBufferAsync(group.triangles, 4, streams[2]!, 'ATTRIBUTES');
    const xyz = new Int16Array(positions.buffer, positions.byteOffset, positions.byteLength / 2);
    const faces = new Uint32Array(indices.buffer, indices.byteOffset, indices.byteLength / 4);
    for (const index of faces) if (index >= group.vertices) throw new Error('COMPACT_MESH_INDEX');
    result.push({ group, positions: xyz, indices: faces, colors });
  }
  return result;
}
