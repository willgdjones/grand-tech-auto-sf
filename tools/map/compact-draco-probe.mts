/** Read-only, exact-integer Draco comparison. Run through tools/heavy.sh.
 * Supply an unpacked draco3d@1.5.7 directory as argv[4]; do not add it to runtime
 * dependencies for this probe. API: https://github.com/google/draco .
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { MeshoptDecoder } from 'meshoptimizer';
import { compactMeshHeader, decodeCompactMesh, type DecodedMapMesh } from '../../shared/mapMesh';

const root = resolve(process.argv[2] ?? 'tools/map/out/compact-zzpr-ground');
const output = process.argv[3] ?? 'docs/perf/map-zzpr/draco-probe.json';
assert(process.argv[4], 'Supply the isolated unpacked draco3d@1.5.7 directory');
const packageRoot = resolve(process.argv[4]);
const packageInfo = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
assert.equal(packageInfo.name, 'draco3d'); assert.equal(packageInfo.version, '1.5.7');
const draco = createRequire(import.meta.url)(resolve(packageRoot, 'draco3d.js'));
const enc = await draco.createEncoderModule({}), dec = await draco.createDecoderModule({});
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(resolve(root, 'manifest.json'));
const manifest = JSON.parse(manifestBytes.toString());
const files: { path: string; bytes: number; sha256: string }[] = [...new Map<string, { path: string; bytes: number; sha256: string }>(manifest.chunks
  .filter((c: any) => c.detail === 'low').flatMap((c: any) => c.lods.map((a: any) => [a.path, a]))).values()];
const sample = [...new Map([...files.filter((_, i) => i % Math.max(1, Math.floor(files.length / 24)) === 0),
  ...[...files].sort((a, b) => b.bytes - a.bytes).slice(0, 8)].map(file => [file.path, file])).values()];
const gzip = (bytes: Uint8Array) => gzipSync(bytes, { level: 9 }).length;
const brotli = (bytes: Uint8Array) => brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }).length;
function key(corners: number[][]) {
  const points = corners.map(c => c.join(','));
  return points.map((_, i) => [points[i], points[(i + 1) % 3], points[(i + 2) % 3]].join(';')).sort()[0]!;
}
function probe(mesh: DecodedMapMesh) {
  const vertices = new Map<string, number>(), xyz: number[] = [], colors: number[] = [], faces: number[] = [];
  const fallback: number[][] = [], original: string[] = [];
  for (let t = 0; t < mesh.group.triangles; t++) {
    const corners = [0, 1, 2].map(c => Array.from(mesh.positions.subarray(mesh.indices[t * 3 + c]! * 4, mesh.indices[t * 3 + c]! * 4 + 3)));
    const rgb = Array.from(mesh.colors.subarray(t * 4, t * 4 + 3));
    // Draco's connectivity encoder drops coincident-index faces. Retain them
    // explicitly, including their orientation/color, even though they draw no area.
    if (new Set(corners.map(c => c.join(','))).size < 3) { fallback.push([...corners.flat(), ...rgb]); continue; }
    original.push(key(corners) + ':' + rgb.join(','));
    for (const corner of corners) {
      const signature = [...corner, ...rgb].join(','); let index = vertices.get(signature);
      if (index === undefined) { index = vertices.size; vertices.set(signature, index); xyz.push(...corner); colors.push(...rgb); }
      faces.push(index);
    }
  }
  if (!faces.length) return { status: 'no nondegenerate faces', fallbackFaces: fallback.length };
  const meshBuilder = new enc.MeshBuilder(), source = new enc.Mesh(), encoder = new enc.Encoder(), data = new enc.DracoInt8Array();
  let compressed: Uint8Array;
  const encodeStart = performance.now();
  try {
    meshBuilder.AddFacesToMesh(source, faces.length / 3, Uint32Array.from(faces));
    meshBuilder.AddInt32Attribute(source, enc.POSITION, vertices.size, 3, Int32Array.from(xyz));
    meshBuilder.AddUInt8Attribute(source, enc.COLOR, vertices.size, 3, Uint8Array.from(colors));
    encoder.SetSpeedOptions(0, 0); encoder.SetEncodingMethod(enc.MESH_EDGEBREAKER_ENCODING);
    const length = encoder.EncodeMeshToDracoBuffer(source, data); assert(length > 0, 'Draco encoding succeeds');
    compressed = Uint8Array.from({ length }, (_, i) => data.GetValue(i));
  } finally { for (const object of [data, source, encoder, meshBuilder]) enc.destroy(object); }
  const encodeMs = performance.now() - encodeStart;
  const buffer = new dec.DecoderBuffer(), decoder = new dec.Decoder(), restored = new dec.Mesh();
  const position = new dec.DracoInt32Array(), rgb = new dec.DracoInt32Array(), face = new dec.DracoInt32Array();
  const actual: string[] = [], decodeStart = performance.now(); let decodeMs = 0;
  try {
    buffer.Init(new Int8Array(compressed.buffer), compressed.length);
    const status = decoder.DecodeBufferToMesh(buffer, restored);
    try { assert(status.ok(), status.error_msg()); } finally { dec.destroy(status); }
    const posAttr = decoder.GetAttribute(restored, decoder.GetAttributeId(restored, dec.POSITION));
    const rgbAttr = decoder.GetAttribute(restored, decoder.GetAttributeId(restored, dec.COLOR));
    assert(decoder.GetAttributeInt32ForAllPoints(restored, posAttr, position));
    assert(decoder.GetAttributeInt32ForAllPoints(restored, rgbAttr, rgb));
    for (let t = 0; t < restored.num_faces(); t++) {
      assert(decoder.GetFaceFromMesh(restored, t, face));
      const indices = [0, 1, 2].map(c => face.GetValue(c));
      const color = indices.map(i => [0, 1, 2].map(axis => rgb.GetValue(i * 3 + axis)));
      assert.deepEqual(color[0], color[1]); assert.deepEqual(color[0], color[2]);
      actual.push(key(indices.map(i => [0, 1, 2].map(axis => position.GetValue(i * 3 + axis)))) + ':' + color[0]!.join(','));
    }
    decodeMs = performance.now() - decodeStart;
  } finally { for (const object of [face, rgb, position, restored, decoder, buffer]) dec.destroy(object); }
  original.sort(); actual.sort();
  const exact = original.length === actual.length && original.every((value, i) => value === actual[i]);
  const framing = Buffer.from(JSON.stringify({ group: mesh.group.name, translation: mesh.group.translation, scale: mesh.group.scale,
    fallback, bytes: compressed.length }) + '\n');
  const payload = Buffer.concat([framing, compressed]);
  return { status: exact ? 'exact oriented positions and RGB' : 'REJECTED parity mismatch', exact,
    sourceFaces: mesh.group.triangles, restoredFaces: actual.length, fallbackFaces: fallback.length,
    bytes: payload.length, gzip: gzip(payload), brotli6: brotli(payload), encodeMs, decodeMs };
}
const rows: any[] = [];
for (const file of sample) {
  const bytes = await readFile(resolve(root, file.path));
  assert.equal(bytes.length, file.bytes); assert.equal(sha(bytes), file.sha256);
  const parsed = compactMeshHeader(bytes);
  let at = parsed.dataOffset; const sources = new Map<string, Buffer>();
  for (const group of parsed.groups) {
    const count = group.streams.reduce((a, b) => a + b, 0);
    sources.set(group.name, bytes.subarray(at, at + count)); at += count;
  }
  for (const mesh of await decodeCompactMesh(bytes, MeshoptDecoder)) if (mesh.group.name === 'terrain' || mesh.group.name === 'roads') {
    const source = sources.get(mesh.group.name)!;
    rows.push({ file: file.path, group: mesh.group.name, sourceGzip: gzip(source), sourceBrotli6: brotli(source), ...probe(mesh) });
  }
}
const summary = ['terrain', 'roads'].map(group => {
  const selected = rows.filter(r => r.group === group), accepted = selected.filter(r => r.exact);
  const sum = (items: any[], field: string) => items.reduce((n, row) => n + (row[field] ?? 0), 0);
  return { group, files: selected.length, exact: accepted.length, rejected: selected.filter(r => r.exact === false).length,
    sourceGzip: sum(selected, 'sourceGzip'), sourceBrotli6: sum(selected, 'sourceBrotli6'),
    exactSubsetSourceGzip: sum(accepted, 'sourceGzip'), exactSubsetDracoGzip: sum(accepted, 'gzip'), exactSubsetDracoBrotli6: sum(accepted, 'brotli6'),
    fallbackFaces: sum(selected, 'fallbackFaces'), sourceFaces: sum(selected, 'sourceFaces'),
    encodeMs: sum(selected, 'encodeMs'), decodeMs: sum(selected, 'decodeMs') };
});
const report = { root, sourceManifestSha256: sha(manifestBytes), scriptSha256: sha(await readFile(new URL(import.meta.url))),
  package: { name: packageInfo.name, version: packageInfo.version, encoderSha256: sha(await readFile(resolve(packageRoot, 'draco_encoder.wasm'))),
    decoderSha256: sha(await readFile(resolve(packageRoot, 'draco_decoder.wasm'))) },
  sampledFiles: sample.length, totalFiles: files.length, summary, rows,
  note: 'Read-only sample; integer positions unchanged, no quantization setting. Source zero-area faces retained explicitly. Independent per-group compression plus candidate framing; no whole-city estimate or runtime implementation. Probe timings include JS preparation/parity validation, not isolated codec timing. Decoder payload/startup cost would be additional.' };
await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ output, summary }));
