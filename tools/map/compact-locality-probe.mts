/** Read-only mesh transport probes. Run through tools/heavy.sh. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { decodeCompactMesh, type DecodedMapMesh } from '../../shared/mapMesh';

const root = resolve(process.argv[2] ?? 'tools/map/out/compact-zzpr');
const output = process.argv[3] ?? 'docs/perf/map-zzpr/locality-probe.json';
const scriptSha256 = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const files = [...new Set<string>(manifest.chunks.flatMap((c: any) => c.lods.map((a: any) => a.path)))];
const selected = files.filter((_, i) => i % Math.max(1, Math.floor(files.length / 24)) === 0);
await MeshoptEncoder.ready;
function streams(mesh: DecodedMapMesh, level?: number, version?: number) {
  const encode = (bytes: Uint8Array, count: number, stride: number) => level === undefined
    ? MeshoptEncoder.encodeVertexBuffer(bytes, count, stride) : MeshoptEncoder.encodeVertexBufferLevel(bytes, count, stride, level, version);
  return [encode(new Uint8Array(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength), mesh.group.vertices, 8),
    MeshoptEncoder.encodeIndexBuffer(new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength), mesh.indices.length, 4),
    encode(mesh.colors, mesh.group.triangles, 4)];
}
function measure(parts: Uint8Array[]) {
  return { raw: parts.reduce((sum, part) => sum + part.length, 0), gzip: gzipSync(Buffer.concat(parts), { level: 9 }).length,
    streams: parts.map(part => gzipSync(part, { level: 9 }).length) };
}
function reorder(mesh: DecodedMapMesh): DecodedMapMesh {
  const batches = new Map<number, number[]>();
  for (let i = 0; i < mesh.group.triangles; i++) {
    const key = mesh.colors[i * 4]! | mesh.colors[i * 4 + 1]! << 8 | mesh.colors[i * 4 + 2]! << 16;
    const list = batches.get(key) ?? []; batches.set(key, list);
    list.push(...mesh.indices.subarray(i * 3, i * 3 + 3));
  }
  const indices = new Uint32Array(mesh.indices.length), colors = new Uint8Array(mesh.colors.length);
  const positions = new Int16Array(mesh.positions.length), vertexMap = new Map<number, number>();
  let at = 0;
  for (const [color, batch] of [...batches].sort((a, b) => a[0] - b[0])) {
    const source = new Uint32Array(batch), [remap, count] = MeshoptEncoder.reorderMesh(source, true, true);
    const inverse = new Uint32Array(count);
    for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) inverse[remap[i]!] = i;
    for (const local of source) {
      const old = inverse[local]!;
      let next = vertexMap.get(old);
      if (next === undefined) { next = vertexMap.size; vertexMap.set(old, next); positions.set(mesh.positions.subarray(old * 4, old * 4 + 4), next * 4); }
      indices[at++] = next;
    }
    for (let t = (at - source.length) / 3; t < at / 3; t++) colors.set([color & 255, color >> 8 & 255, color >> 16 & 255, 0], t * 4);
  }
  return { group: { ...mesh.group, vertices: vertexMap.size }, positions: positions.subarray(0, vertexMap.size * 4), indices, colors };
}
function orientedFaces(mesh: DecodedMapMesh) {
  const faces = [];
  for (let t = 0; t < mesh.group.triangles; t++) {
    const vertices = [0, 1, 2].map(c => Array.from(mesh.positions.subarray(mesh.indices[t * 3 + c]! * 4, mesh.indices[t * 3 + c]! * 4 + 3)).join(','));
    const rotations = vertices.map((_, i) => [vertices[i], vertices[(i + 1) % 3], vertices[(i + 2) % 3]].join(';')).sort();
    faces.push(`${rotations[0]}:${Array.from(mesh.colors.subarray(t * 4, t * 4 + 3)).join(',')}`);
  }
  return faces.sort();
}
// Measure bounded visual quantization separately from the exact variants. This
// never changes collision/contact/graph data and is not an accepted visual codec.
function quantize(mesh: DecodedMapMesh, horizontal: number, vertical: number) {
  const steps = [horizontal, vertical, horizontal], xyz: number[] = [], remap = new Uint32Array(mesh.group.vertices);
  const unique = new Map<string, number>(); let maxErrorM = 0;
  for (let i = 0; i < mesh.group.vertices; i++) {
    const position = steps.map((step, axis) => {
      const before = mesh.positions[i * 4 + axis]! / 32767 * mesh.group.scale[axis]! + mesh.group.translation[axis]!;
      const after = Math.round(before / step); assert(after >= -32768 && after <= 32767);
      maxErrorM = Math.max(maxErrorM, Math.abs(before - after * step)); return after;
    });
    const key = position.join(','); let index = unique.get(key);
    if (index === undefined) { index = unique.size; unique.set(key, index); xyz.push(...position, 0); }
    remap[i] = index;
  }
  const indices = Uint32Array.from(mesh.indices, index => remap[index]!);
  const changed: DecodedMapMesh = { group: { ...mesh.group, vertices: unique.size,
    translation: [0, 0, 0], scale: steps.map(step => step * 32767) as [number, number, number] },
    positions: new Int16Array(xyz), indices, colors: mesh.colors };
  let collapsedFaces = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const points = [0, 1, 2].map(c => xyz.slice(indices[i + c]! * 4, indices[i + c]! * 4 + 3));
    const u = points[1]!.map((v, a) => v - points[0]![a]!), v = points[2]!.map((v, a) => v - points[0]![a]!);
    if (u[1]! * v[2]! === u[2]! * v[1]! && u[2]! * v[0]! === u[0]! * v[2]! && u[0]! * v[1]! === u[1]! * v[0]!) collapsedFaces++;
  }
  return { horizontalM: horizontal, verticalM: vertical, maxErrorM, collapsedFaces, ...measure(streams(changed, 3, 0)) };
}
type Row = { path: string; name: string; source: ReturnType<typeof measure>; level3v0: ReturnType<typeof measure>;
  level3v1: ReturnType<typeof measure>; reorder: ReturnType<typeof measure>; triangles: number; quantized: ReturnType<typeof quantize>[] };
const rows: Row[] = [];
for (const path of selected) {
  for (const mesh of await decodeCompactMesh(await readFile(resolve(root, path)), MeshoptDecoder)) {
    const reordered = reorder(mesh);
    assert.deepEqual(orientedFaces(reordered), orientedFaces(mesh), 'Exact oriented colored triangle multiset');
    rows.push({ path, name: mesh.group.name, triangles: mesh.group.triangles, source: measure(streams(mesh)),
      level3v0: measure(streams(mesh, 3, 0)), level3v1: measure(streams(mesh, 3, 1)), reorder: measure(streams(reordered, 3, 1)),
      quantized: mesh.group.name === 'structures' ? [] : [[.05, .02], [.1, .02], [.25, .02]].map(([x, y]) => quantize(mesh, x!, y!)) });
  }
}
const summary = [...new Set(rows.map(row => row.name))].map(name => {
  const selected = rows.filter(row => row.name === name);
  return { name, ...Object.fromEntries((['source', 'level3v0', 'level3v1', 'reorder'] as const).map(variant => [variant, selected.reduce((sum, row) => sum + row[variant].gzip, 0)])),
    quantized: selected[0]!.quantized.map((variant, i) => ({ horizontalM: variant.horizontalM, verticalM: variant.verticalM,
      gzip: selected.reduce((sum, row) => sum + row.quantized[i]!.gzip, 0), collapsedFaces: selected.reduce((sum, row) => sum + row.quantized[i]!.collapsedFaces, 0),
      maxErrorM: Math.max(...selected.map(row => row.quantized[i]!.maxErrorM)) })) };
});
await writeFile(output, JSON.stringify({ root, scriptSha256, sampledFiles: selected.length, totalFiles: files.length,
  note: 'Read-only sample. The level/reorder variants preserve every oriented colored triangle. Quantized variants separately measure lossy visual candidates and count collapsed faces; none are accepted or used in production. No whole-city budget or visual acceptance.', summary, rows }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
