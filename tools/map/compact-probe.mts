/** Read-only representation experiment. Run through tools/heavy.sh; never writes a map. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { MeshoptEncoder } from 'meshoptimizer';
import { readGlb } from './src/glb';
import { decodePackedRoadGraph, roadPackLayout } from '../../shared/roadgraphPacked';

const root = resolve(process.argv[2] ?? 'tools/map/out/district-tm7m');
const out = resolve(process.argv[3] ?? 'docs/perf/map-zzpr/probe.json');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
await MeshoptEncoder.ready;
const measure = (bytes: Uint8Array) => ({ raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length,
  brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }).length });
const all = [...new Map<string, any>(manifest.chunks.flatMap((c: any) => c.lods.map((a: any) => [a.path, { ...a, detail: c.detail ?? 'high' }]))).values()];
const selected = process.env.GTASF_COMPACT_ALL === '1' ? all : all.filter((_, i) => i % Math.max(1, Math.floor(all.length / 24)) === 0);
const meshes = [];
for (const artifact of selected) {
  const source = await readFile(resolve(root, artifact.path)), doc = await readGlb(source);
  const parts: Uint8Array[] = [], metadata = [];
  const groups = new Map<string, { positions: number[]; faces: number[]; colors: number[]; keys: Map<string, number>; transform: unknown }>();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const name = mesh.getName();
    let group = groups.get(name);
    const transform = { translation: node.getTranslation(), scale: node.getScale() };
    if (!group) { group = { positions: [], faces: [], colors: [], keys: new Map(), transform }; groups.set(name, group); }
    if (JSON.stringify(group.transform) !== JSON.stringify(transform)) throw new Error('Shared group transforms differ');
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION')!.getArray()!, color = primitive.getAttribute('COLOR_0')!.getArray()!;
      const indices = primitive.getIndices()!.getArray()!;
      if (!(position instanceof Int16Array) || !(color instanceof Uint8Array)) throw new Error('Unexpected source quantization');
      for (let t = 0; t < indices.length; t += 3) {
        const c = indices[t]! * 3;
        group.colors.push(color[c]!, color[c + 1]!, color[c + 2]!, 0);
        for (let corner = 0; corner < 3; corner++) {
          const at = indices[t + corner]! * 3;
          for (let axis = 0; axis < 3; axis++) if (color[at + axis] !== color[c + axis]) throw new Error('Source needs interpolated triangle colors');
          const key = `${position[at]},${position[at + 1]},${position[at + 2]}`;
          let id = group.keys.get(key);
          if (id === undefined) { id = group.keys.size; group.keys.set(key, id); group.positions.push(position[at]!, position[at + 1]!, position[at + 2]!, 0); }
          group.faces.push(id);
        }
      }
    }
  }
  for (const [name, group] of groups) {
    const positions = new Int16Array(group.positions), indices = new Uint32Array(group.faces), colors = Uint8Array.from(group.colors);
    const streams = [
      MeshoptEncoder.encodeVertexBuffer(new Uint8Array(positions.buffer), positions.length / 4, 8),
      MeshoptEncoder.encodeIndexBuffer(new Uint8Array(indices.buffer), indices.length, 4),
      MeshoptEncoder.encodeVertexBuffer(colors, colors.length / 4, 4),
    ];
    metadata.push({ name, transform: group.transform, vertices: positions.length / 4, triangles: indices.length / 3,
      streamBytes: streams.map(s => s.length) });
    parts.push(...streams);
  }
  const header = Buffer.from(JSON.stringify(metadata));
  const packed = Buffer.concat([header, ...parts]);
  meshes.push({ path: artifact.path, detail: artifact.detail, source: measure(source), positionTopology: measure(packed), groups: metadata });
  console.log(`${artifact.path}: ${gzipSync(source).length} -> ${gzipSync(packed).length} gzip`);
}
// Test a reversible transport transform over existing packed graph columns. It changes no topology,
// coordinates, strings or float bits; prototype only, not a runtime format contract.
const sourceGraph = await readFile(resolve(root, manifest.roadGraph.path));
const packedGraph = decodePackedRoadGraph(sourceGraph), transformed = new Uint8Array(sourceGraph);
const offsets = roadPackLayout(packedGraph.counts).offsets;
for (const [name, column] of Object.entries(packedGraph.columns)) {
  if (column.BYTES_PER_ELEMENT !== 4) continue;
  const words = new Uint32Array(column.buffer, column.byteOffset, column.byteLength / 4), stride = name === 'nodeXYZ' ? 3 : 1;
  const delta = new Uint32Array(words.length);
  for (let i = 0; i < words.length; i++) delta[i] = (words[i]! - (i >= stride ? words[i - stride]! : 0)) >>> 0;
  const bytes = new Uint8Array(delta.buffer), at = offsets[name as keyof typeof offsets];
  for (let byte = 0; byte < 4; byte++) for (let i = 0; i < words.length; i++) transformed[at + byte * words.length + i] = bytes[i * 4 + byte]!;
}
// Lossless 2D height residuals; every source contact sample is retained (no coarsening).
const fields = [];
for (const c of manifest.chunks.filter((_: unknown, i: number) => i % Math.max(1, Math.floor(manifest.chunks.length / 24)) === 0)) {
  const source = await readFile(resolve(root, c.terrain.path)), size = source.readUInt16LE(6), values: number[] = [];
  const encoded: number[] = [...source.subarray(0, 32)];
  for (let i = 0; i < size * size; i++) {
    const v = source.readUInt16LE(32 + i * 2), left = i % size ? values[i - 1]! : 0,
      above = i >= size ? values[i - size]! : 0, corner = i >= size && i % size ? values[i - size - 1]! : 0;
    values.push(v); const delta = v - left - above + corner;
    let word = ((delta << 1) ^ (delta >> 31)) >>> 0;
    while (word >= 128) { encoded.push((word & 127) | 128); word >>>= 7; } encoded.push(word);
  }
  fields.push({ path: c.terrain.path, source: measure(source), residual: measure(Uint8Array.from(encoded)) });
}
await mkdir(resolve(out, '..'), { recursive: true });
await writeFile(out, JSON.stringify({ sourceRoot: root, sampled: selected.length, totalMeshFiles: all.length,
  note: 'Representation probe only; samples are not whole-city acceptance. Geometry positions/winding/colors retained; flat normals would be derived on decode.',
  meshes, graph: { source: measure(sourceGraph), columnDeltaShuffle: measure(transformed), counts: packedGraph.counts }, fields }, null, 2) + '\n');
