import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { COMPACT_MESH_MAGIC, compactMeshHeader, decodeCompactMesh, type CompactMeshGroup } from '../../../../shared/mapMesh';
import { readGlb } from '../glb';

/** Keeps every quantized position, triangle winding, per-face color and material group.
 * Joining the old upload partitions is transport-only; the browser repartitions each
 * flat render batch below 64 KiB before mounting it into the existing upload queue.
 */
export async function packCompactMesh(source: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  await MeshoptEncoder.ready;
  const doc = await readGlb(source), records = new Map<string, { meta: CompactMeshGroup; xyz: number[]; indices: number[]; rgb: number[]; vertices: Map<string, number> }>();
  if (doc.getRoot().listTextures().length) throw new Error('Textured source needs another codec');
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const name = mesh.getName();
    if (!['terrain', 'roads', 'buildings', 'structures'].includes(name) || node.getParentNode()
      || node.getRotation().some((v, i) => v !== (i === 3 ? 1 : 0))) throw new Error('Unsupported compact map node');
    const translation = node.getTranslation(), scale = node.getScale();
    let record = records.get(name);
    if (!record) {
      record = { meta: { name: name as CompactMeshGroup['name'], translation, scale, vertices: 0, triangles: 0, streams: [0, 0, 0] },
        xyz: [], indices: [], rgb: [], vertices: new Map() }; records.set(name, record);
    }
    if (JSON.stringify([record.meta.translation, record.meta.scale]) !== JSON.stringify([translation, scale])) throw new Error('Inconsistent map transforms');
    for (const primitive of mesh.listPrimitives()) {
      const material = primitive.getMaterial();
      if (primitive.getMode() !== 4 || !material || material.getName() !== name || material.getBaseColorFactor().some(v => v !== 1)
        || material.getDoubleSided() || material.getAlphaMode() !== 'OPAQUE') throw new Error('Unsupported compact map material');
      const pos = primitive.getAttribute('POSITION'), rgb = primitive.getAttribute('COLOR_0');
      const positions = pos?.getArray(), colors = rgb?.getArray(), indices = primitive.getIndices()?.getArray();
      if (!(positions instanceof Int16Array) || !pos?.getNormalized() || !(colors instanceof Uint8Array) || !rgb?.getNormalized()
        || pos.getType() !== 'VEC3' || rgb.getType() !== 'VEC3' || !indices || indices.length % 3) throw new Error('Unsupported compact map attributes');
      for (const semantic of primitive.listSemantics()) if (!['POSITION', 'NORMAL', 'COLOR_0'].includes(semantic)) throw new Error('Unsupported compact map attribute');
      for (let i = 0; i < indices.length; i += 3) {
        const first = indices[i]! * 3;
        record.rgb.push(colors[first]!, colors[first + 1]!, colors[first + 2]!, 0);
        for (let corner = 0; corner < 3; corner++) {
          const at = indices[i + corner]! * 3;
          if (at + 2 >= positions.length) throw new Error('Invalid compact source index');
          for (let axis = 0; axis < 3; axis++) if (colors[at + axis] !== colors[first + axis]) throw new Error('Interpolated source colors need another codec');
          const key = `${positions[at]},${positions[at + 1]},${positions[at + 2]}`;
          let index = record.vertices.get(key);
          if (index === undefined) { index = record.vertices.size; record.vertices.set(key, index); record.xyz.push(positions[at]!, positions[at + 1]!, positions[at + 2]!, 0); }
          record.indices.push(index);
        }
      }
    }
  }
  const groups: CompactMeshGroup[] = [], body: Uint8Array[] = [];
  for (const record of records.values()) {
    const xyz = new Int16Array(record.xyz), indices = new Uint32Array(record.indices), rgb = new Uint8Array(record.rgb);
    const streams = [MeshoptEncoder.encodeVertexBuffer(new Uint8Array(xyz.buffer), xyz.length / 4, 8),
      MeshoptEncoder.encodeIndexBuffer(new Uint8Array(indices.buffer), indices.length, 4), MeshoptEncoder.encodeVertexBuffer(rgb, rgb.length / 4, 4)];
    Object.assign(record.meta, { vertices: xyz.length / 4, triangles: indices.length / 3, streams: streams.map(s => s.length) });
    groups.push(record.meta); body.push(...streams);
  }
  const json = new TextEncoder().encode(JSON.stringify(groups));
  const output = new Uint8Array(16 + json.length + body.reduce((n, b) => n + b.length, 0)), header = new DataView(output.buffer);
  header.setUint32(0, COMPACT_MESH_MAGIC, true); header.setUint32(4, 1, true); header.setUint32(8, json.length, true);
  output.set(json, 16); let at = 16 + json.length;
  for (const bytes of body) { output.set(bytes, at); at += bytes.length; }
  compactMeshHeader(output);
  // Every converted file verifies vertex/color bit parity and oriented triangle parity.
  // The index codec may rotate a triangle's starting corner; it must never reverse it.
  for (const decoded of await decodeCompactMesh(output, MeshoptDecoder)) {
    const record = records.get(decoded.group.name)!;
    if (!Buffer.from(decoded.positions.buffer, decoded.positions.byteOffset, decoded.positions.byteLength).equals(Buffer.from(new Int16Array(record.xyz).buffer))
      || !Buffer.from(decoded.colors).equals(Buffer.from(record.rgb))) throw new Error('Compact mesh attribute roundtrip failed');
    for (let i = 0; i < record.indices.length; i += 3) {
      let matches = false;
      for (let rotation = 0; rotation < 3; rotation++) if ([0, 1, 2].every(c => decoded.indices[i + c] === record.indices[i + (c + rotation) % 3])) matches = true;
      if (!matches) throw new Error('Compact mesh winding roundtrip failed');
    }
  }
  return output;
}
