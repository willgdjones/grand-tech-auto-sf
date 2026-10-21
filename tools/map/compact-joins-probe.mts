/** Exact appended-join regeneration diagnostic. Run through tools/heavy.sh.
 * Writes only its report; no map, decoder, flag, or source-cache mutation.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { transform } from 'esbuild';
import { readGlb, writeGlb } from './src/glb';
import { packCompactMesh } from './src/pipeline/compactMesh';
import type { JoinSurface, SurfaceJoinResult } from './src/pipeline/surfaceJoins';
import { COMPACT_MESH_MAGIC, decodeCompactMesh, type CompactMeshGroup, type DecodedMapMesh } from '../../shared/mapMesh';
import type { MapManifest } from './src/pipeline/types';

const root = resolve(process.argv[2] ?? 'tools/map/out/district-tm7m-seams-meshopt');
const output = process.argv[3] ?? 'docs/perf/map-zzpr/joins-probe.json';
const ids = process.argv.slice(4); if (!ids.length) ids.push('3_9', '-22_6', '3_13');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const zip = (bytes: Uint8Array) => gzipSync(bytes, { level: 9 }).length;
const generatorPath = 'tools/map/src/pipeline/surfaceJoins.ts', generatorCommit = '88acbf9';
const generatorSource = execFileSync('git', ['show', `${generatorCommit}:${generatorPath}`]);
const generatorSha256 = sha(generatorSource);
// The map owner is repairing a newer cohort concurrently. Load this candidate's
// committed pure helper in memory; never replace or import its moving algorithm.
const compiled = await transform(generatorSource.toString(), { loader: 'ts', format: 'esm', target: 'es2022' });
const pinned = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`) as {
  createSurfaceJoins(terrain: JoinSurface, roads: JoinSurface): SurfaceJoinResult;
};
const manifestBytes = await readFile(resolve(root, 'manifest.json')), manifest = JSON.parse(manifestBytes.toString()) as MapManifest;
type Face = { points: number[][]; rgb: number[] };
function faceKey(face: Face) {
  const p = face.points.map(v => v.join(','));
  return [0, 1, 2].map(r => [0, 1, 2].map(c => p[(r + c) % 3]).join(';')).sort()[0] + ':' + face.rgb.join(',');
}
function meshFaces(mesh: DecodedMapMesh): Face[] {
  return Array.from({ length: mesh.group.triangles }, (_, t) => ({
    points: [0, 1, 2].map(c => { const at = mesh.indices[t * 3 + c]! * 4; return Array.from(mesh.positions.subarray(at, at + 3)); }),
    rgb: Array.from(mesh.colors.subarray(t * 4, t * 4 + 3)),
  }));
}
function surface(mesh: DecodedMapMesh): JoinSurface {
  const positions: number[] = [], indices: number[] = [], colours: number[] = [];
  for (const face of meshFaces(mesh)) for (const p of face.points) {
    indices.push(indices.length); positions.push(...p.map((n, axis) => n / 32767 * mesh.group.scale[axis]! + mesh.group.translation[axis]!)); colours.push(...face.rgb);
  }
  return { positions, indices, colours };
}
async function explicitFaces(faces: Face[], transform: CompactMeshGroup): Promise<Uint8Array> {
  if (!faces.length) return new Uint8Array();
  const vertices = new Map<string, number>(), xyz: number[] = [], indices: number[] = [], rgb: number[] = [];
  for (const face of faces) {
    rgb.push(...face.rgb, 0);
    for (const p of face.points) { const key = p.join(','); if (!vertices.has(key)) { vertices.set(key, vertices.size); xyz.push(...p, 0); } indices.push(vertices.get(key)!); }
  }
  await MeshoptEncoder.ready;
  const positions = new Int16Array(xyz), order = new Uint32Array(indices);
  const streams = [MeshoptEncoder.encodeVertexBuffer(new Uint8Array(positions.buffer), vertices.size, 8),
    MeshoptEncoder.encodeIndexBuffer(new Uint8Array(order.buffer), order.length, 4), MeshoptEncoder.encodeVertexBuffer(new Uint8Array(rgb), faces.length, 4)];
  const group: CompactMeshGroup = { ...transform, vertices: vertices.size, triangles: faces.length, streams: streams.map(b => b.length) as [number, number, number] };
  const json = Buffer.from(JSON.stringify([group])), framing = Buffer.alloc(16);
  framing.writeUInt32LE(COMPACT_MESH_MAGIC); framing.writeUInt32LE(1, 4); framing.writeUInt32LE(json.length, 8);
  const bytes = Buffer.concat([framing, json, ...streams]);
  const decoded = await decodeCompactMesh(bytes, MeshoptDecoder);
  assert.deepEqual(meshFaces(decoded[0]!).map(faceKey).sort(), faces.map(faceKey).sort());
  return bytes;
}
function allFaces(meshes: DecodedMapMesh[]) {
  return meshes.flatMap(mesh => meshFaces(mesh).map(face => JSON.stringify([mesh.group.name, mesh.group.translation, mesh.group.scale, faceKey(face)]))).sort();
}
const rows: any[] = [];
for (const id of ids) {
  const chunk = manifest.chunks.find(c => c.id === id); assert(chunk);
  const file = chunk.lods[0], bytes = await readFile(resolve(root, file.path)); assert.equal(sha(bytes), file.sha256);
  const doc = await readGlb(bytes), sourceFaces: Face[] = [];
  const appended = doc.getRoot().listNodes().filter(node => node.getName() === 'roads_surface_join');
  assert(appended.length, `${id} has source appended joins`);
  for (const node of appended) {
    const mesh = node.getMesh(); assert(mesh?.getName() === 'roads');
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute('POSITION')!.getArray(), colors = primitive.getAttribute('COLOR_0')!.getArray(), indices = primitive.getIndices()!.getArray();
      assert(positions instanceof Int16Array && colors instanceof Uint8Array && indices);
      for (let t = 0; t < indices.length; t += 3) sourceFaces.push({
        points: [0, 1, 2].map(c => Array.from(positions.subarray(indices[t + c]! * 3, indices[t + c]! * 3 + 3))),
        rgb: Array.from(colors.subarray(indices[t]! * 3, indices[t]! * 3 + 3)),
      });
    }
    node.dispose();
  }
  const compactAll = await packCompactMesh(bytes), compactBase = await packCompactMesh(await writeGlb(doc));
  const decodedBase = await decodeCompactMesh(compactBase, MeshoptDecoder), road = decodedBase.find(m => m.group.name === 'roads')!, terrain = decodedBase.find(m => m.group.name === 'terrain')!;
  assert(road && terrain); assert.deepEqual(road.group.translation, terrain.group.translation); assert.deepEqual(road.group.scale, terrain.group.scale);
  const start = performance.now(), generated = pinned.createSurfaceJoins(surface(terrain), surface(road)), generationMs = performance.now() - start;
  const faces: Face[] = generated.triangles.map(triangle => ({
    points: triangle.points.map(p => p.map((n, axis) => {
      const q = Math.round((n - road.group.translation[axis]!) / road.group.scale[axis]! * 32767); assert(q >= -32767 && q <= 32767); return q;
    })), rgb: triangle.colour.map(n => Math.round(n * 255)),
  }));
  const remaining = new Map<string, Face[]>();
  for (const face of sourceFaces) { const key = faceKey(face), list = remaining.get(key) ?? []; list.push(face); remaining.set(key, list); }
  const selected: Face[] = [], mask = new Uint8Array(Math.ceil(faces.length / 8));
  for (const [i, face] of faces.entries()) if (remaining.get(faceKey(face))?.pop()) { selected.push(face); mask[i >> 3]! |= 1 << (i & 7); }
  const fallback = [...remaining.values()].flat();
  assert.deepEqual([...selected, ...fallback].map(faceKey).sort(), sourceFaces.map(faceKey).sort());
  const explicit = await explicitFaces(fallback, road.group), maskBytes = selected.length === faces.length ? new Uint8Array() : mask;
  const restoredKeys = [...allFaces(decodedBase), ...[...selected, ...fallback].map(face => JSON.stringify(['roads', road.group.translation, road.group.scale, faceKey(face)]))].sort();
  assert.deepEqual(restoredKeys, allFaces(await decodeCompactMesh(compactAll, MeshoptDecoder)));
  const header = Buffer.from(JSON.stringify({ version: 1, generatorSha256, baseBytes: compactBase.length, generatedFaces: faces.length,
    selectedFaces: selected.length, maskBytes: maskBytes.length, fallbackBytes: explicit.length }));
  const framing = Buffer.alloc(16); framing.writeUInt32LE(header.length, 8);
  const recipe = Buffer.concat([framing, header, compactBase, maskBytes, explicit]);
  rows.push({ chunk: id, sourceSha256: file.sha256, sourceGlbGzip: file.gzipBytes, compactAllGzip: zip(compactAll), compactBaseGzip: zip(compactBase),
    diagnosticRecipeGzip: zip(recipe), sourceJoinFaces: sourceFaces.length, generatedJoinFaces: faces.length, exactRecipeFaces: selected.length,
    fallbackFaces: fallback.length, fallbackGzip: explicit.length ? zip(explicit) : 0, maskGzip: maskBytes.length ? zip(maskBytes) : 0,
    generationMs, allSourceOrientedColorFacesPreserved: true });
}
const sum = (key: string) => rows.reduce((n, row) => n + row[key], 0);
const summary = Object.fromEntries(['sourceGlbGzip', 'compactAllGzip', 'compactBaseGzip', 'diagnosticRecipeGzip', 'sourceJoinFaces', 'generatedJoinFaces',
  'exactRecipeFaces', 'fallbackFaces', 'generationMs'].map(key => [key, sum(key)]));
await writeFile(output, JSON.stringify({ root, manifestSha256: sha(manifestBytes), generatorPath, generatorCommit, generatorSha256,
  appendAdapterSha256: sha(execFileSync('git', ['show', `${generatorCommit}:tools/map/src/pipeline/appendSurfaceJoins.ts`])),
  scriptSha256: sha(await readFile(new URL(import.meta.url))), chunks: rows.length, summary, rows,
  note: 'Read-only diagnostic. Remove only explicit roads_surface_join nodes from the base; derive candidate joins from compact-decoded base geometry. Select exact source-oriented quantized XYZ/RGB matches and retain every unmatched source face in a decoded-and-verified compact fallback. Whole source face multiset parity checked, including the untouched base. Payload sizes include base, recipe header, selection mask, and complete fallback container. No browser recipe decoder, native acceptance, whole-city budget result, source modification or activation is claimed.' }, null, 2) + '\n');
console.log(JSON.stringify({ output, summary }));
