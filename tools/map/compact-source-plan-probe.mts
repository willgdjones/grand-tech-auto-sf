/** Read-only source-plan diagnostic. Run through tools/heavy.sh.
 * No runtime, generated-map or source-cache files are written.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { decodeCompactMesh, type DecodedMapMesh } from '../../shared/mapMesh';
import { decodeHeightTransport } from '../../shared/mapTransport';
import { decodeHeightfield, type Heightfield } from './src/pipeline/heightfield';
import { extractRoads } from './src/pipeline/osm';
import { parseOsm } from './src/pipeline/sources';
import { districtStreetDetail } from './src/pipeline/districts';
import { overlaps, polygonBounds, SpatialIndex } from './src/pipeline/geometry';
import { project, unproject } from './src/pipeline/settings';
import { ChunkMeshes, addRoadMeshes, addTerrainMeshes, type MeshData, type Cut } from './src/pipeline/meshes';
import type { Bounds, MapManifest, Road, SourceManifest, Tags } from './src/pipeline/types';

const root = resolve(process.argv[2] ?? 'tools/map/out/compact-zzpr-ground');
const sourceRoot = resolve(process.argv[3] ?? 'tools/map/out/district-tm7m-ground');
const output = process.argv[4] ?? 'docs/perf/map-zzpr/source-plan-probe.json';
const cache = resolve('tools/map/out/cache/sf');
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const zip = (data: Uint8Array) => gzipSync(data, { level: 9 }).length;
const manifestBytes = await readFile(resolve(root, 'manifest.json'));
const manifest = JSON.parse(manifestBytes.toString()) as MapManifest;
const sources = JSON.parse(await readFile(resolve(sourceRoot, 'sources.json'), 'utf8')) as SourceManifest;
const record = sources.records.find(r => r.key === 'osm-pbf-normalized' || r.key === 'osm')!;
assert(record && manifest.sourceDigests.some(r => r.key === record.key && r.sha256 === record.sha256));
const osmBytes = await readFile(resolve(cache, record.file)); assert.equal(sha(osmBytes), record.sha256);
const roads = extractRoads(parseOsm(osmBytes), manifest.bounds);
const districtDetail = districtStreetDetail(roads), roadIndex = new SpatialIndex<Road>(manifest.chunkSize);
for (const road of roads) {
  const box = polygonBounds([road.points.map(p => [p.x, p.z])]), pad = road.width + 4;
  roadIndex.add([box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad], road);
}
await MeshoptEncoder.ready;
function writeUint(output: number[], n: number) {
  assert(Number.isInteger(n) && n >= 0 && n <= 0xffffffff);
  let v = n >>> 0; while (v >= 128) { output.push((v & 127) | 128); v >>>= 7; } output.push(v);
}
const writeInt = (output: number[], n: number) => writeUint(output, ((n << 1) ^ (n >> 31)) >>> 0);
function reader(bytes: Uint8Array, offset = 0) {
  let at = offset;
  function uint() {
    let n = 0, shift = 0, b: number;
    do { assert(at < bytes.length && shift <= 28); b = bytes[at++]!; n |= (b & 127) << shift; shift += 7; } while (b & 128);
    return n >>> 0;
  }
  return { uint, int() { const n = uint(); return (n >>> 1) ^ -(n & 1); },
    float() { assert(at + 8 <= bytes.length); const n = new DataView(bytes.buffer, bytes.byteOffset + at, 8).getFloat64(0, true); at += 8; return n; },
    get at() { return at; } };
}
/** SpatialIndex returns whole buckets. Keep only intersecting segments plus
 * two source-point neighbours, preserving incoming offset/resampling context.
 * A failed exact face match still falls back; trimming never authorizes a loss.
 */
function trimRoads(local: Road[], bounds: Bounds): Road[] {
  return local.flatMap(road => {
    const pad = road.width + 24, expanded: Bounds = [bounds[0] - pad, bounds[1] - pad, bounds[2] + pad, bounds[3] + pad];
    let first = Infinity, last = -Infinity;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!, b = road.points[i]!;
      if (overlaps([Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z)], expanded)) {
        first = Math.min(first, i - 1); last = Math.max(last, i);
      }
    }
    return Number.isFinite(first) ? [{ ...road, points: road.points.slice(Math.max(0, first - 2), last + 3) }] : [];
  });
}
type Plan = { nodes: number; tags: Tags[]; roads: [number, number, number[]][] };
function encodePlan(local: Road[]) {
  const ids = new Map<string, number>(), nodes: Road['points'] = [], tags = new Map<string, number>(), palette: Tags[] = [];
  const keptTags = ['highway', 'footway', 'surface', 'bridge', 'tunnel', 'layer', 'crossing:island', 'motorcar', 'motor_vehicle', 'vehicle', 'access', 'area'];
  const plan: Plan = { nodes: 0, tags: palette, roads: local.map(r => {
    const tag = Object.fromEntries(keptTags.filter(k => r.tags[k] !== undefined).map(k => [k, r.tags[k]!])), key = JSON.stringify(tag);
    if (!tags.has(key)) { tags.set(key, tags.size); palette.push(tag); }
    return [r.width, tags.get(key)!, r.points.map(p => {
      if (!ids.has(p.id)) { ids.set(p.id, ids.size); nodes.push(p); }
      const i = ids.get(p.id)!; assert.equal(nodes[i]!.x, p.x); assert.equal(nodes[i]!.z, p.z); return i;
    })];
  }) };
  const coordinates: number[] = []; let lat = 0, lon = 0, e7Nodes = 0;
  for (const p of nodes) {
    const geo = unproject(p.x, p.z), nextLat = Math.round(geo.lat * 1e7), nextLon = Math.round(geo.lon * 1e7);
    const restored = project(nextLon / 1e7, nextLat / 1e7);
    // E7 is accepted only if the source projection is exactly reproducible.
    // Boundary/interpolated/non-E7 coordinates keep their full Float64 bits.
    if (restored[0] === p.x && restored[1] === p.z) {
      coordinates.push(0); writeInt(coordinates, nextLat - lat); writeInt(coordinates, nextLon - lon); lat = nextLat; lon = nextLon; e7Nodes++;
    } else {
      coordinates.push(1); const pair = Buffer.alloc(16); pair.writeDoubleLE(p.x); pair.writeDoubleLE(p.z, 8); coordinates.push(...pair);
    }
  }
  plan.nodes = nodes.length;
  const json = Buffer.from(JSON.stringify(plan)), header = Buffer.alloc(4); header.writeUInt32LE(json.length);
  return { bytes: Buffer.concat([header, json, Uint8Array.from(coordinates)]), nodes: nodes.length, e7Nodes, floatNodes: nodes.length - e7Nodes };
}
function decodePlan(bytes: Uint8Array): Road[] {
  const length = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  const plan = JSON.parse(Buffer.from(bytes.subarray(4, 4 + length)).toString()) as Plan, source = reader(bytes, 4 + length);
  const nodes: Road['points'] = []; let lat = 0, lon = 0;
  for (let id = 0; id < plan.nodes; id++) {
    const mode = source.uint(); let x: number, z: number;
    if (mode === 0) { lat += source.int(); lon += source.int(); [x, z] = project(lon / 1e7, lat / 1e7); }
    else { assert.equal(mode, 1); x = source.float(); z = source.float(); }
    nodes.push({ id: String(id), x, z });
  }
  assert.equal(source.at, bytes.length);
  return plan.roads.map(([width, tag, indices], i) => ({ id: String(i), osmWay: i, width, tags: plan.tags[tag]!, points: indices.map(id => nodes[id]!) }));
}
function sample(field: Heightfield, x: number, z: number): number {
  const px = Math.max(0, Math.min(field.size - 1, x / field.step)), pz = Math.max(0, Math.min(field.size - 1, z / field.step));
  const ix = Math.min(field.size - 2, Math.floor(px)), iz = Math.min(field.size - 2, Math.floor(pz)), fx = px - ix, fz = pz - iz;
  const h = (a: number, b: number) => field.values[b * field.size + a]!;
  return (field.offsetCm + (h(ix, iz) * (1 - fx) + h(ix + 1, iz) * fx) * (1 - fz)
    + (h(ix, iz + 1) * (1 - fx) + h(ix + 1, iz + 1) * fx) * fz) / 100;
}
function subset(mesh: DecodedMapMesh, selected: number[]): Uint8Array {
  if (!selected.length) return new Uint8Array();
  const remap = new Map<number, number>(), xyz: number[] = [], indices: number[] = [], colors: number[] = [];
  for (const t of selected) {
    colors.push(...mesh.colors.subarray(t * 4, t * 4 + 4));
    for (let c = 0; c < 3; c++) {
      const old = mesh.indices[t * 3 + c]!; let next = remap.get(old);
      if (next === undefined) { next = remap.size; remap.set(old, next); xyz.push(...mesh.positions.subarray(old * 4, old * 4 + 4)); }
      indices.push(next);
    }
  }
  const pos = new Int16Array(xyz), faces = new Uint32Array(indices);
  return Buffer.concat([MeshoptEncoder.encodeVertexBuffer(new Uint8Array(pos.buffer), remap.size, 8),
    MeshoptEncoder.encodeIndexBuffer(new Uint8Array(faces.buffer), faces.length, 4),
    MeshoptEncoder.encodeVertexBuffer(new Uint8Array(colors), selected.length, 4)]);
}
type Q = [number, number];
function key(points: Q[]) {
  return [0, 1, 2].map(r => [0, 1, 2].map(c => points[(r + c) % 3]!.join(',')).join(';')).sort()[0]!;
}
function generatedFaces(data: MeshData, origin: readonly number[], mesh: DecodedMapMesh): Q[][] {
  return Array.from({ length: data.indices.length / 3 }, (_, t) => [0, 1, 2].map(c => {
    const index = data.indices[t * 3 + c]! * 3;
    return [Math.round((data.positions[index]! - origin[0]! - mesh.group.translation[0]) / mesh.group.scale[0] * 32767),
      Math.round((data.positions[index + 2]! - origin[1]! - mesh.group.translation[2]) / mesh.group.scale[2] * 32767)];
  }));
}
function measure(mesh: DecodedMapMesh, data: MeshData, field: Heightfield, origin: readonly number[]) {
  const faces = generatedFaces(data, origin, mesh), source = new Map<string, number[]>();
  const sourceXZ = (t: number): Q[] => [0, 1, 2].map(c => { const at = mesh.indices[t * 3 + c]! * 4; return [mesh.positions[at]!, mesh.positions[at + 2]!]; });
  for (let t = 0; t < mesh.group.triangles; t++) { const k = key(sourceXZ(t)), bucket = source.get(k) ?? []; bucket.push(t); source.set(k, bucket); }
  const mask = new Uint8Array(Math.ceil(faces.length / 8)), heights: number[] = [], rgb: number[] = [], selected: number[] = [];
  const vertexHeights = new Map<string, number>(), exceptions: number[] = [];
  let corner = 0, lastException = 0, exceptionCount = 0;
  const predict = ([x, z]: Q) => Math.round((sample(field, x / 32767 * mesh.group.scale[0] + mesh.group.translation[0],
    z / 32767 * mesh.group.scale[2] + mesh.group.translation[2]) + (mesh.group.name === 'roads' ? .1 : 0)
    - mesh.group.translation[1]) / mesh.group.scale[1] * 32767);
  // Store one source height per shared XZ, with explicit corner overrides where
  // overlapping source surfaces differ. Winding and multiplicity are retained.
  for (const [i, points] of faces.entries()) {
    const t = source.get(key(points))?.pop(); if (t === undefined) continue;
    const target = sourceXZ(t), rotation = [0, 1, 2].find(r => points.every((p, c) => p[0] === target[(c + r) % 3]![0] && p[1] === target[(c + r) % 3]![1]));
    assert(rotation !== undefined); mask[i >> 3]! |= 1 << (i & 7); selected.push(t);
    for (const [c, p] of points.entries()) {
      const y = mesh.positions[mesh.indices[t * 3 + (c + rotation) % 3]! * 4 + 1]!, id = p.join(','), prior = vertexHeights.get(id);
      if (prior === undefined) { vertexHeights.set(id, y); writeInt(heights, y - predict(p)); }
      else if (prior !== y) { writeUint(exceptions, corner - lastException); writeInt(exceptions, y - prior); lastException = corner; exceptionCount++; }
      corner++;
    }
    rgb.push(...mesh.colors.subarray(t * 4, t * 4 + 3));
  }
  // Decode the actual varint stream and verify all reconstructed XYZ + color
  // tuples against the pinned source, including oriented multiplicity.
  let count = 0, restoredCorner = 0, exceptionCorner = 0;
  const heightReader = reader(Uint8Array.from(heights)), overrideReader = reader(Uint8Array.from(exceptions));
  const overrides = new Map<number, number>(), restoredHeights = new Map<string, number>();
  for (let i = 0; i < exceptionCount; i++) { exceptionCorner += overrideReader.uint(); overrides.set(exceptionCorner, overrideReader.int()); }
  for (const [i, points] of faces.entries()) if (mask[i >> 3]! & (1 << (i & 7))) {
    const t = selected[count]!, restored = points.map(p => {
      const id = p.join(','); if (!restoredHeights.has(id)) restoredHeights.set(id, predict(p) + heightReader.int());
      const y = restoredHeights.get(id)! + (overrides.get(restoredCorner++) ?? 0); return [p[0], y, p[1]];
    });
    assert([0, 1, 2].some(r => restored.every((p, c) => p.every((v, a) => v === mesh.positions[mesh.indices[t * 3 + (c + r) % 3]! * 4 + a]))));
    assert.deepEqual(rgb.slice(count * 3, count * 3 + 3), Array.from(mesh.colors.subarray(t * 4, t * 4 + 3))); count++;
  }
  assert.equal(heightReader.at, heights.length); assert.equal(overrideReader.at, exceptions.length); assert.equal(count, selected.length);
  const fallback = [...source.values()].flat(); assert.equal(fallback.length + selected.length, mesh.group.triangles);
  const explicit = subset(mesh, fallback), framing = Buffer.from(JSON.stringify({ group: mesh.group.name, translation: mesh.group.translation, scale: mesh.group.scale,
    generatedFaces: faces.length, selectedFaces: selected.length, maskBytes: mask.length, heightBytes: heights.length,
    exceptionBytes: exceptions.length, exceptionCount, colorBytes: rgb.length, fallbackBytes: explicit.length }));
  const payload = Buffer.concat([framing, mask, Uint8Array.from(heights), Uint8Array.from(exceptions), Uint8Array.from(rgb), explicit]);
  return { report: { group: mesh.group.name, sourceFaces: mesh.group.triangles, generatedFaces: faces.length, matchedFaces: selected.length, fallbackFaces: fallback.length,
    exactDecodedFaces: count, baselineGzip: zip(subset(mesh, Array.from({ length: mesh.group.triangles }, (_, t) => t))), payloadGzip: zip(payload),
    maskGzip: zip(mask), sharedHeightVertices: vertexHeights.size, heightsGzip: zip(Uint8Array.from(heights)), exceptionCount,
    exceptionsGzip: exceptions.length ? zip(Uint8Array.from(exceptions)) : 0, fallbackGzip: explicit.length ? zip(explicit) : 0 }, payload };
}
const chunks = manifest.chunks.filter(c => c.detail === 'low');
const sampled = [...new Set([...chunks.filter((_, i) => i % Math.max(1, Math.floor(chunks.length / 8)) === 0),
  ...[...chunks].sort((a, b) => b.lods[0].gzipBytes - a.lods[0].gzipBytes).slice(0, 4)])];
const rows: any[] = [];
for (const chunk of sampled) {
  const meshBytes = await readFile(resolve(root, chunk.lods[0].path)), fieldBytes = await readFile(resolve(root, chunk.terrain.path));
  assert.equal(sha(meshBytes), chunk.lods[0].sha256); assert.equal(sha(fieldBytes), chunk.terrain.sha256);
  const localRoads = roadIndex.query(chunk.bounds), trimmed = trimRoads(localRoads, chunk.bounds), plan = encodePlan(trimmed), planBytes = plan.bytes;
  const field = decodeHeightfield(decodeHeightTransport(fieldBytes));
  const decodedRoads = decodePlan(planBytes), start = performance.now(), generated = new ChunkMeshes(chunk.bounds, manifest.chunkSize);
  for (const [i, road] of trimmed.entries()) for (const [j, p] of road.points.entries()) {
    assert.equal(decodedRoads[i]!.points[j]!.x, p.x); assert.equal(decodedRoads[i]!.points[j]!.z, p.z);
  }
  const cuts = addRoadMeshes(generated, decodedRoads, { sample: () => 0 }, 1, [], true), streetDetail = districtDetail.hasDetail(chunk.bounds);
  addTerrainMeshes(generated, { sample: () => 0 }, streetDetail ? cuts : new SpatialIndex<Cut>(32), streetDetail ? 16 : 32, 4);
  const generationMs = performance.now() - start, data = generated.chunks.get(chunk.id)!;
  const groups = (await decodeCompactMesh(meshBytes, MeshoptDecoder)).filter(m => m.group.name === 'roads' || m.group.name === 'terrain')
    .map(mesh => measure(mesh, data[mesh.group.name as 'roads' | 'terrain'], field, [chunk.bounds[0], chunk.bounds[1]]));
  rows.push({ chunk: chunk.id, streetDetail, sourceRoads: localRoads.length, retainedRoads: decodedRoads.length, planNodes: plan.nodes,
    exactE7Nodes: plan.e7Nodes, explicitFloat64Nodes: plan.floatNodes, generationMs, planGzip: zip(planBytes),
    baselineGzip: groups.reduce((n, g) => n + g.report.baselineGzip, 0), combinedGzip: zip(Buffer.concat([planBytes, ...groups.map(g => g.payload)])),
    groups: groups.map(g => g.report) });
}
const groupRows = rows.flatMap(r => r.groups), sum = (items: any[], key: string) => items.reduce((n, r) => n + r[key], 0);
const summary = { chunks: rows.length, baselineGzip: sum(rows, 'baselineGzip'), combinedGzip: sum(rows, 'combinedGzip'),
  planGzip: sum(rows, 'planGzip'), generationMs: sum(rows, 'generationMs'), sourceFaces: sum(groupRows, 'sourceFaces'),
  planNodes: sum(rows, 'planNodes'), exactE7Nodes: sum(rows, 'exactE7Nodes'), explicitFloat64Nodes: sum(rows, 'explicitFloat64Nodes'),
  matchedFaces: sum(groupRows, 'matchedFaces'), fallbackFaces: sum(groupRows, 'fallbackFaces'), exactDecodedFaces: sum(groupRows, 'exactDecodedFaces') };
const dependencies = ['tools/map/src/pipeline/meshes.ts', 'tools/map/src/pipeline/roads.ts', 'tools/map/src/pipeline/geometry.ts',
  'tools/map/src/pipeline/boolean.ts', 'tools/map/src/pipeline/osm.ts', 'tools/map/src/pipeline/districts.ts', 'tools/map/src/geo.ts', 'tools/map/src/pipeline/settings.ts', 'package-lock.json'];
await writeFile(output, JSON.stringify({ root, sourceRoot, manifestSha256: sha(manifestBytes), osmSha256: record.sha256,
  scriptSha256: sha(await readFile(new URL(import.meta.url))), dependencies: await Promise.all(dependencies.map(async path => ({ path, sha256: sha(await readFile(path)) }))), summary, rows,
  note: 'Read-only diagnostic, no runtime output/activation. Spatially trimmed road source coordinates regenerate candidate XZ triangles. Exact E7 reprojection or explicit Float64 preserves every retained source point; no input quantization is accepted. An explicit mask selects only source-identical oriented faces, shared source Int16 heights plus corner exceptions/color streams restore their attributes exactly, unmatched source faces stay explicit. Pavements and height-dependent tunnel cuts are deliberately not reconstructed in this probe and fall back. Group framing/transport and browser decoder still need implementation and full-city/native validation before any shipping claim. Includes per-chunk road descriptor gzip cost; does not extrapolate 25 MB acceptance.' }, null, 2) + '\n');
console.log(JSON.stringify({ output, summary }));
