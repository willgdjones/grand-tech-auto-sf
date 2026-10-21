/** Read-only vector/contact reuse diagnostic; run through tools/heavy.sh.
 * This does not produce runtime geometry or establish visual acceptance.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import clipping from 'polygon-clipping';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { decodeCompactMesh, type DecodedMapMesh } from '../../shared/mapMesh';
import { decodeHeightTransport } from '../../shared/mapTransport';
import { decodeHeightfield, type Heightfield } from './src/pipeline/heightfield';
import { simplifyRing } from './src/pipeline/geometry';
import type { MapManifest, XZ } from './src/pipeline/types';

type Point = [number, number, number];
type Polygon = XZ[][];
type MultiPolygon = Polygon[];
const root = resolve(process.argv[2] ?? 'tools/map/out/compact-zzpr-ground');
const output = process.argv[3] ?? 'docs/perf/map-zzpr/vector-probe.json';
const bytes = await readFile(resolve(root, 'manifest.json'));
const manifest = JSON.parse(bytes.toString()) as MapManifest;
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const zip = (data: Uint8Array) => gzipSync(data, { level: 9 }).length;
await MeshoptEncoder.ready;
function sample(field: Heightfield, x: number, z: number) {
  const px = Math.max(0, Math.min(field.size - 1, x / field.step)), pz = Math.max(0, Math.min(field.size - 1, z / field.step));
  const ix = Math.min(field.size - 2, Math.floor(px)), iz = Math.min(field.size - 2, Math.floor(pz)), fx = px - ix, fz = pz - iz;
  const h = (a: number, b: number) => field.values[b * field.size + a]!;
  return (field.offsetCm + (h(ix, iz) * (1 - fx) + h(ix + 1, iz) * fx) * (1 - fz)
    + (h(ix, iz + 1) * (1 - fx) + h(ix + 1, iz + 1) * fx) * fz) / 100;
}
function point(mesh: DecodedMapMesh, index: number): Point {
  return [0, 1, 2].map(axis => mesh.positions[index * 4 + axis]! / 32767 * mesh.group.scale[axis]! + mesh.group.translation[axis]!) as Point;
}
function clip(polygon: Point[], axis: 0 | 2, edge: number, greater: boolean): Point[] {
  const result: Point[] = [];
  for (const [i, a] of polygon.entries()) {
    const b = polygon[(i + 1) % polygon.length]!;
    const insideA = greater ? a[axis] >= edge : a[axis] <= edge, insideB = greater ? b[axis] >= edge : b[axis] <= edge;
    if (insideA) result.push(a);
    if (insideA !== insideB) {
      const t = (edge - a[axis]) / (b[axis] - a[axis]);
      const p = a.map((value, k) => value + (b[k]! - value) * t) as Point; p[axis] = edge; result.push(p);
    }
  }
  return result;
}
/** On each grid cell the height difference is bilinear minus a plane. Its
 * interior stationary point is a saddle, so extrema lie on the boundary.
 * Along each clipped edge the difference is quadratic; check its extremum too.
 * This bounds source-versus-contact, not a future renderer's tessellation error.
 */
function contactError(triangle: Point[], field: Heightfield, bias: number): number {
  const [a, b, c] = triangle as [Point, Point, Point];
  if (Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])) < 1e-8) return Infinity;
  const span = (field.size - 1) * field.step;
  if (triangle.some(p => p[0] < -1e-8 || p[2] < -1e-8 || p[0] > span + 1e-8 || p[2] > span + 1e-8)) return Infinity;
  const grid = (n: number) => Math.max(0, Math.min(field.size - 2, Math.floor(n / field.step)));
  const minX = grid(Math.min(...triangle.map(p => p[0]))), maxX = grid(Math.max(...triangle.map(p => p[0])));
  const minZ = grid(Math.min(...triangle.map(p => p[2]))), maxZ = grid(Math.max(...triangle.map(p => p[2])));
  const delta = (p: Point) => p[1] - sample(field, p[0], p[2]) - bias;
  let maximum = 0;
  for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
    let polygon = clip(triangle, 0, x * field.step, true);
    polygon = clip(polygon, 0, (x + 1) * field.step, false);
    polygon = clip(polygon, 2, z * field.step, true);
    polygon = clip(polygon, 2, (z + 1) * field.step, false);
    for (const [i, start] of polygon.entries()) {
      const end = polygon[(i + 1) % polygon.length]!, middle = start.map((value, k) => (value + end[k]!) / 2) as Point;
      const d0 = delta(start), d1 = delta(end), dm = delta(middle);
      maximum = Math.max(maximum, Math.abs(d0), Math.abs(d1), Math.abs(dm));
      const qa = 2 * (d0 + d1 - 2 * dm), qb = d1 - d0 - qa;
      if (Math.abs(qa) > 1e-12) {
        const t = -qb / (2 * qa);
        if (t > 0 && t < 1) maximum = Math.max(maximum, Math.abs(d0 + qb * t + qa * t * t));
      }
    }
  }
  return maximum;
}
function subset(mesh: DecodedMapMesh, selected: number[]) {
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
function union(polygons: MultiPolygon[]): MultiPolygon {
  while (polygons.length > 1) {
    const next: MultiPolygon[] = [];
    for (let i = 0; i < polygons.length; i += 2) next.push(polygons[i + 1] ? clipping.union(polygons[i]!, polygons[i + 1]!) : polygons[i]!);
    polygons = next;
  }
  return polygons[0] ?? [];
}
function variant(mesh: DecodedMapMesh, errors: number[], tolerance: number) {
  const fallback: number[] = [], byColor = new Map<number, MultiPolygon[]>();
  for (let t = 0; t < mesh.group.triangles; t++) {
    if (errors[t]! > tolerance) { fallback.push(t); continue; }
    const color = mesh.colors[t * 4]! | mesh.colors[t * 4 + 1]! << 8 | mesh.colors[t * 4 + 2]! << 16;
    const triangles = byColor.get(color) ?? []; byColor.set(color, triangles);
    const ring: XZ[] = [0, 1, 2].map(c => {
      const index = mesh.indices[t * 3 + c]! * 4; return [mesh.positions[index]!, mesh.positions[index + 2]!] as XZ;
    });
    triangles.push([[ring]]);
  }
  const words: number[] = [], palette: { color: number; rings: number[][] }[] = [];
  const write = (number: number) => { let v = ((number << 1) ^ (number >> 31)) >>> 0;
    while (v >= 128) { words.push((v & 127) | 128); v >>>= 7; } words.push(v); };
  let boundaryVertices = 0, simplifiedVertices = 0;
  for (const [color, triangles] of byColor) {
    const shapes = union(triangles), lengths: number[][] = [];
    for (const polygon of shapes) {
      const rings: number[] = [];
      for (const ring of polygon) {
        boundaryVertices += ring.length - 1;
        const simplified = simplifyRing(ring, .008 * 32767 / Math.max(mesh.group.scale[0], mesh.group.scale[2]));
        assert(simplified.length >= 3, 'Every source ring retained');
        let x = 0, z = 0; rings.push(simplified.length); simplifiedVertices += simplified.length;
        for (const p of simplified) {
          const px = Math.round(p[0]), pz = Math.round(p[1]); write(px - x); write(pz - z); x = px; z = pz;
        }
      }
      lengths.push(rings);
    }
    palette.push({ color, rings: lengths });
  }
  const original = subset(mesh, fallback), body = Uint8Array.from(words);
  const framing = Buffer.from(JSON.stringify({ kind: mesh.group.name, translation: mesh.group.translation, scale: mesh.group.scale,
    sourceToContactLimitM: tolerance, surfaceOffsetM: mesh.group.name === 'roads' ? .1 : 0, palette, vectorBytes: body.length,
    fallbackBytes: original.length, fallbackFaces: fallback.length }));
  return { toleranceM: tolerance, fallbackFaces: fallback.length, replacedFaces: mesh.group.triangles - fallback.length,
    boundaryVertices, simplifiedVertices, vectorGzip: zip(Buffer.concat([framing, body])),
    fallbackGzip: original.length ? zip(original) : 0, combinedGzip: zip(Buffer.concat([framing, body, original])) };
}
const chunks = manifest.chunks.filter(c => c.detail === 'low');
const sampled = [...new Set([...chunks.filter((_, i) => i % Math.max(1, Math.floor(chunks.length / 8)) === 0),
  ...[...chunks].sort((a, b) => b.lods[0].gzipBytes - a.lods[0].gzipBytes).slice(0, 4)])];
const rows: any[] = [];
for (const chunk of sampled) {
  const meshBytes = await readFile(resolve(root, chunk.lods[0].path)), fieldBytes = await readFile(resolve(root, chunk.terrain.path));
  assert.equal(sha(meshBytes), chunk.lods[0].sha256); assert.equal(sha(fieldBytes), chunk.terrain.sha256);
  const field = decodeHeightfield(decodeHeightTransport(fieldBytes));
  for (const mesh of await decodeCompactMesh(meshBytes, MeshoptDecoder)) if (['terrain', 'roads'].includes(mesh.group.name)) {
    const errors = Array.from({ length: mesh.group.triangles }, (_, t) => contactError(
      [0, 1, 2].map(c => point(mesh, mesh.indices[t * 3 + c]!)), field, mesh.group.name === 'roads' ? .1 : 0));
    const baselineGzip = zip(subset(mesh, [...errors.keys()]));
    const variants = (mesh.group.name === 'roads' ? [.15] : [.25, 1]).map(tolerance => {
      try { return variant(mesh, errors, tolerance); }
      catch (error) { return { toleranceM: tolerance, rejected: String(error), combinedGzip: baselineGzip, replacedFaces: 0,
        fallbackFaces: mesh.group.triangles, boundaryVertices: 0, simplifiedVertices: 0 }; }
    });
    const finite = errors.filter(Number.isFinite).sort((a, b) => a - b);
    rows.push({ chunk: chunk.id, group: mesh.group.name, triangles: mesh.group.triangles, heightStepM: field.step, baselineGzip,
      sourceContactError: { maximumM: finite.at(-1) ?? 0, p95M: finite[Math.floor(finite.length * .95)] ?? 0, nonPlanarFaces: errors.length - finite.length }, variants });
  }
}
const summary = [{ group: 'roads', tolerance: .15 }, { group: 'terrain', tolerance: .25 }, { group: 'terrain', tolerance: 1 }].map(({ group, tolerance }) => {
  const selected = rows.filter(row => row.group === group), entries = selected.map(row => row.variants.find((v: any) => v.toleranceM === tolerance));
  const sum = (items: any[], key: string) => items.reduce((n, item) => n + (item[key] ?? 0), 0);
  return { group, sourceToContactLimitM: tolerance, groups: selected.length, rejected: entries.filter(v => v.rejected).length,
    baselineGzip: sum(selected, 'baselineGzip'), combinedGzip: sum(entries, 'combinedGzip'), triangles: sum(selected, 'triangles'),
    replacedFaces: sum(entries, 'replacedFaces'), fallbackFaces: sum(entries, 'fallbackFaces'), boundaryVertices: sum(entries, 'boundaryVertices'),
    simplifiedVertices: sum(entries, 'simplifiedVertices') };
});
await writeFile(output, JSON.stringify({ root, manifestSha256: sha(bytes), scriptSha256: sha(await readFile(new URL(import.meta.url))),
  sampledChunks: sampled.length, summary, rows,
  note: 'Diagnostic only: vector plan plus unchanged contact grid, original exceptional/vertical faces retained. Source-to-bilinear-contact error is evaluated at all cell-boundary quadratic extrema, not just seven triangle samples. Target road plane uses contact+0.1m. Outline RDP tolerance is8mm plus existing lattice rounding; no rasterization. A runtime would additionally need bounded tessellation, preserved edge heights/seams and final geometry/visual validation. These byte counts do not demonstrate a whole-city size target or acceptable replacement geometry. No renderer/map/activation changes.' }, null, 2) + '\n');
console.log(JSON.stringify({ output, summary }));
