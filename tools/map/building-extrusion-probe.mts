/** Read-only exact building-wall transport experiment (gtasf-s319).
 * Run through tools/heavy.sh. Writes evidence only; does not change any map or codec.
 * 2026-10-04 result: 57 actual files / 104,530 triangles round-trip exactly;
 * 33,524 wall quads plus 37,482 fallback triangles. Isolated group gzip grows
 * 374,784 -> 383,556 bytes (+2.34%); selecting the smaller format per group saves
 * only 18 bytes. Do not add this codec to production. Keep the generic format.
 * Source manifest: 2d93015525d887a894312001a86091c03f2a758e9220f2e2041985bc9b753a18.
 * Full measurement: artifacts/building-extrusion-s319/report.json (ignored).
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { decodeCompactMesh, type DecodedMapMesh } from '../../shared/mapMesh';
import { DISTRICTS } from './src/districts/index';
import { project } from './src/pipeline/settings';

type XYZ = [number, number, number];
type RGB = [number, number, number];
type Face = { points: [XYZ, XYZ, XYZ]; color: RGB };
type Wall = { columns: [number, number]; low: number; high: number; color: RGB; mode: number };
type Header = { translation: number[]; scale: number[]; columns: number; walls: number;
  vertices: number; triangles: number; streams: number[] };
type Asset = { path: string; sha256: string; gzipBytes: number; meshEncoding?: string };
type Manifest = { chunkSize: number; chunks: { id: string; lods: Asset[] }[] };
type Sample = { path: string; sha256: string; buildings: boolean; vertices?: number; triangles?: number;
  walls?: number; fallbackTriangles?: number; columns?: number; sourceBytes?: number; candidateBytes?: number;
  sourceGzip?: number; candidateGzip?: number; selectedGzip?: number; exactRoundtrip?: boolean };
const root = resolve(process.argv[2] ?? 'tools/map/out/compact-zzpr');
const out = resolve(process.argv[3] ?? 'artifacts/building-extrusion-s319/report.json');
assert(out.startsWith(resolve('artifacts') + sep), 'Evidence belongs under ignored artifacts/');
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(resolve(root, 'manifest.json'));
const manifest = JSON.parse(manifestBytes.toString()) as Manifest;
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);

// Winding matters. Only cyclic rotation, never reflection, has the same key.
function faceKey(face: Face): string {
  const vertices = face.points.map(p => p.join(','));
  const rotations = [0, 1, 2].map(i => [vertices[i], vertices[(i + 1) % 3], vertices[(i + 2) % 3]].join(';'));
  return `${face.color.join(',')}:${rotations.sort()[0]}`;
}
function sourceFaces(group: DecodedMapMesh): Face[] {
  const point = (index: number): XYZ => [group.positions[index * 4]!, group.positions[index * 4 + 1]!, group.positions[index * 4 + 2]!];
  return Array.from({ length: group.group.triangles }, (_, t) => ({
    points: [point(group.indices[t * 3]!), point(group.indices[t * 3 + 1]!), point(group.indices[t * 3 + 2]!)],
    color: [group.colors[t * 4]!, group.colors[t * 4 + 1]!, group.colors[t * 4 + 2]!],
  }));
}
function wallFaces(wall: Wall, columns: [number, number][]): Face[] {
  const a = columns[wall.columns[0]]!, b = columns[wall.columns[1]]!;
  const p: XYZ[] = [[a[0], wall.low, a[1]], [b[0], wall.low, b[1]], [b[0], wall.high, b[1]], [a[0], wall.high, a[1]]];
  const triangles = wall.mode & 1 ? [[0, 1, 3], [1, 2, 3]] : [[0, 1, 2], [0, 2, 3]];
  return triangles.map(triangle => {
    if (wall.mode & 2) [triangle[1], triangle[2]] = [triangle[2]!, triangle[1]!];
    return { points: triangle.map(i => p[i]!) as [XYZ, XYZ, XYZ], color: wall.color };
  });
}
function vertexStream(data: ArrayBufferView, count: number, stride: number): Uint8Array {
  return count ? MeshoptEncoder.encodeVertexBuffer(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), count, stride) : new Uint8Array();
}
function indexStream(data: Uint32Array): Uint8Array {
  return data.length ? MeshoptEncoder.encodeIndexBuffer(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), data.length, 4) : new Uint8Array();
}
function container(header: unknown, streams: Uint8Array[]): Buffer {
  const json = Buffer.from(JSON.stringify(header)), size = Buffer.alloc(4);
  size.writeUInt32LE(json.length);
  return Buffer.concat([size, json, ...streams]);
}
function propose(group: DecodedMapMesh, faces: Face[]) {
  const columns: [number, number][] = [], columnIds = new Map<string, number>();
  const column = (p: XYZ): number => {
    const key = `${p[0]},${p[2]}`;
    let id = columnIds.get(key);
    if (id === undefined) { id = columns.length; columns.push([p[0], p[2]]); columnIds.set(key, id); }
    return id;
  };
  const candidates = new Map<string, { wall: Wall; triangles: number[] }>();
  faces.forEach((face, triangle) => {
    const ids = [...new Set(face.points.map(column))].sort((a, b) => a - b);
    const ys = [...new Set(face.points.map(p => p[1]))].sort((a, b) => a - b);
    if (ids.length !== 2 || ys.length !== 2) return;
    const key = `${ids}:${ys}:${face.color}`;
    let candidate = candidates.get(key);
    if (!candidate) { candidate = { wall: { columns: ids as [number, number], low: ys[0]!, high: ys[1]!, color: face.color, mode: 0 }, triangles: [] }; candidates.set(key, candidate); }
    candidate.triangles.push(triangle);
  });
  const walls: Wall[] = [], consumed = new Set<number>();
  for (const candidate of candidates.values()) {
    // Ambiguous/overlapping faces and chunk-clipped triangles retain the exact fallback.
    if (candidate.triangles.length !== 2) continue;
    const source = candidate.triangles.map(i => faceKey(faces[i]!)).sort();
    for (let mode = 0; mode < 4; mode++) {
      const wall = { ...candidate.wall, mode };
      if (wallFaces(wall, columns).map(faceKey).sort().every((key, i) => key === source[i])) {
        walls.push(wall); for (const triangle of candidate.triangles) consumed.add(triangle); break;
      }
    }
  }
  // Only columns used by a recovered wall are transmitted. Other geometry is exact triangles.
  const usedColumns = new Map<number, number>(), xz: number[] = [], wallColumns: number[] = [], heights: number[] = [], wallColors: number[] = [];
  for (const wall of walls) {
    for (const id of wall.columns) {
      let mapped = usedColumns.get(id);
      if (mapped === undefined) { mapped = usedColumns.size; usedColumns.set(id, mapped); xz.push(...columns[id]!); }
      wallColumns.push(mapped);
    }
    heights.push(wall.low, wall.high); wallColors.push(...wall.color, wall.mode);
  }
  const fallbackVertices = new Map<string, number>(), xyz: number[] = [], indices: number[] = [], colors: number[] = [];
  faces.forEach((face, t) => {
    if (consumed.has(t)) return;
    for (const p of face.points) {
      const key = p.join(','); let id = fallbackVertices.get(key);
      if (id === undefined) { id = fallbackVertices.size; fallbackVertices.set(key, id); xyz.push(...p, 0); }
      indices.push(id);
    }
    colors.push(...face.color, 0);
  });
  const streams = [vertexStream(new Int16Array(xz), xz.length / 2, 4),
    vertexStream(new Uint32Array(wallColumns), walls.length, 8), vertexStream(new Int16Array(heights), walls.length, 4),
    vertexStream(new Uint8Array(wallColors), walls.length, 4), vertexStream(new Int16Array(xyz), xyz.length / 4, 8),
    indexStream(new Uint32Array(indices)), vertexStream(new Uint8Array(colors), colors.length / 4, 4)];
  const header: Header = { translation: group.group.translation, scale: group.group.scale, columns: usedColumns.size,
    walls: walls.length, vertices: fallbackVertices.size, triangles: indices.length / 3, streams: streams.map(s => s.length) };
  return { bytes: container(header, streams), header };
}
function restore(bytes: Buffer): Face[] {
  const size = bytes.readUInt32LE(), header = JSON.parse(bytes.subarray(4, 4 + size).toString()) as Header;
  let at = 4 + size;
  const streams = header.streams.map(length => { const value = bytes.subarray(at, at + length); at += length; return value; });
  assert.equal(at, bytes.length);
  function decode(stream: number, count: number, stride: number, indices = false): Uint8Array<ArrayBuffer> {
    const target = new Uint8Array(count * stride);
    if (count) (indices ? MeshoptDecoder.decodeIndexBuffer : MeshoptDecoder.decodeVertexBuffer)(target, count, stride, streams[stream]!);
    else assert.equal(streams[stream]!.length, 0);
    return target;
  }
  const xz = new Int16Array(decode(0, header.columns, 4).buffer), wallColumns = new Uint32Array(decode(1, header.walls, 8).buffer);
  const heights = new Int16Array(decode(2, header.walls, 4).buffer), wallColors = decode(3, header.walls, 4);
  const xyz = new Int16Array(decode(4, header.vertices, 8).buffer), indices = new Uint32Array(decode(5, header.triangles * 3, 4, true).buffer), colors = decode(6, header.triangles, 4);
  const columns = Array.from({ length: header.columns }, (_, i): [number, number] => [xz[i * 2]!, xz[i * 2 + 1]!]);
  const result: Face[] = [];
  for (let i = 0; i < header.walls; i++) result.push(...wallFaces({ columns: [wallColumns[i * 2]!, wallColumns[i * 2 + 1]!],
    low: heights[i * 2]!, high: heights[i * 2 + 1]!, color: [wallColors[i * 4]!, wallColors[i * 4 + 1]!, wallColors[i * 4 + 2]!], mode: wallColors[i * 4 + 3]! }, columns));
  const point = (index: number): XYZ => [xyz[index * 4]!, xyz[index * 4 + 1]!, xyz[index * 4 + 2]!];
  for (let t = 0; t < header.triangles; t++) result.push({ points: [point(indices[t * 3]!), point(indices[t * 3 + 1]!), point(indices[t * 3 + 2]!)],
    color: [colors[t * 4]!, colors[t * 4 + 1]!, colors[t * 4 + 2]!] });
  return result;
}

const unique = new Map(manifest.chunks.flatMap(chunk => chunk.lods.map(asset => [asset.path, asset] as const)));
const all = [...unique.values()].sort((a, b) => a.path.localeCompare(b.path));
const selection = new Set(all.filter((_, i) => i % Math.max(1, Math.floor(all.length / 32)) === 0).map(a => a.path));
const districtChunks = DISTRICTS.map(d => {
  const [x, z] = project(d.spawn.lon, d.spawn.lat), id = `${Math.floor(x / manifest.chunkSize)}_${Math.floor(z / manifest.chunkSize)}`;
  const chunk = manifest.chunks.find(c => c.id === id); assert(chunk, `${d.id}: source arrival chunk exists`);
  for (const asset of chunk.lods) selection.add(asset.path);
  return { district: d.id, chunk: id };
});
const results: Sample[] = [];
for (const path of selection) {
  const asset = unique.get(path)!; assert.equal(asset.meshEncoding, 'triangles-v1');
  const absolute = resolve(root, path); assert(absolute.startsWith(root + sep));
  const bytes = await readFile(absolute); assert.equal(digest(bytes), asset.sha256, path);
  const group = (await decodeCompactMesh(bytes, MeshoptDecoder)).find(g => g.group.name === 'buildings');
  if (!group) { results.push({ path, sha256: asset.sha256, buildings: false }); continue; }
  const faces = sourceFaces(group), candidate = propose(group, faces), restored = restore(candidate.bytes);
  assert.deepEqual(restored.map(faceKey).sort(), faces.map(faceKey).sort(), `${path}: exact oriented coloured triangles`);
  const baselineStreams = [vertexStream(group.positions, group.group.vertices, 8), indexStream(group.indices), vertexStream(group.colors, group.group.triangles, 4)];
  const baseline = container({ translation: group.group.translation, scale: group.group.scale, vertices: group.group.vertices,
    triangles: group.group.triangles, streams: baselineStreams.map(s => s.length) }, baselineStreams);
  const sourceGzip = gzipSync(baseline, { level: 9 }).length, candidateGzip = gzipSync(candidate.bytes, { level: 9 }).length;
  results.push({ path, sha256: asset.sha256, buildings: true, vertices: group.group.vertices, triangles: faces.length,
    walls: candidate.header.walls, fallbackTriangles: candidate.header.triangles, columns: candidate.header.columns,
    sourceBytes: baseline.length, candidateBytes: candidate.bytes.length, sourceGzip, candidateGzip,
    selectedGzip: Math.min(sourceGzip, candidateGzip), exactRoundtrip: true });
}
assert.equal(digest(await readFile(resolve(root, 'manifest.json'))), digest(manifestBytes), 'Immutable source manifest');
const sum = (key: 'sourceGzip' | 'candidateGzip' | 'selectedGzip' | 'triangles' | 'walls' | 'fallbackTriangles') => results.reduce((n, r) => n + (r[key] ?? 0), 0);
const report = { passed: true, root, manifestSha256: digest(manifestBytes), sampledFiles: results.length, totalMeshFiles: all.length,
  definitions: { geometry: 'Exact quantized coordinates, RGB and oriented triangle multiset. No omitted faces, quantization changes, roof retriangulation or building/terrain/collision edits.',
    comparison: 'Isolated building group plus counts/transforms/stream metadata, gzip level 9 on both sides. Wall codec is measured only; not a supported production format.',
    limits: '32 evenly spaced file samples plus both LODs at all 24 district arrivals. Sums are comparative group estimates, not additive whole-map gzip savings or budget acceptance.' },
  summary: { sourceGzip: sum('sourceGzip'), candidateGzip: sum('candidateGzip'), selectedGzip: sum('selectedGzip'),
    triangles: sum('triangles'), walls: sum('walls'), fallbackTriangles: sum('fallbackTriangles') }, districtChunks, results };
await mkdir(dirname(out), { recursive: true }); await writeFile(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, results: undefined, districtChunks: undefined }, null, 2));
