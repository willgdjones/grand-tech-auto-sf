/** Read-only size/error probe for a possible contact-grid surface stencil.
 * Does not create runtime assets, change geometry or establish visual acceptance. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { decodeCompactMesh, type DecodedMapMesh } from '../../shared/mapMesh';
import { decodeHeightTransport } from '../../shared/mapTransport';
import { decodeHeightfield, type Heightfield } from './src/pipeline/heightfield';
import type { MapManifest } from './src/pipeline/types';

const root = resolve(process.argv[2] ?? 'tools/map/out/compact-zzpr-ground');
const output = process.argv[3] ?? 'docs/perf/map-zzpr/surface-probe.json';
const manifestBytes = await readFile(resolve(root, 'manifest.json')), manifest = JSON.parse(manifestBytes.toString()) as MapManifest;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const zip = (bytes: Uint8Array) => gzipSync(bytes, { level: 9 }).length;
await MeshoptEncoder.ready;
function sample(field: Heightfield, x: number, z: number) {
  const px = Math.max(0, Math.min(field.size - 1, x / field.step)), pz = Math.max(0, Math.min(field.size - 1, z / field.step));
  const ix = Math.min(field.size - 2, Math.floor(px)), iz = Math.min(field.size - 2, Math.floor(pz)), fx = px - ix, fz = pz - iz;
  const h = (a: number, b: number) => field.values[b * field.size + a]!;
  return (field.offsetCm + (h(ix, iz) * (1 - fx) + h(ix + 1, iz) * fx) * (1 - fz)
    + (h(ix, iz + 1) * (1 - fx) + h(ix + 1, iz + 1) * fx) * fz) / 100;
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
type Point = [number, number, number];
function point(mesh: DecodedMapMesh, index: number): Point {
  return [0, 1, 2].map(axis => mesh.positions[index * 4 + axis]! / 32767 * mesh.group.scale[axis]! + mesh.group.translation[axis]!) as Point;
}
function probe(meshes: DecodedMapMesh[], field: Heightfield, size: number, tolerance: number) {
  const mask = new Uint8Array(size * size), palette: number[][] = [[0, 0, 0, 0]], paletteIndex = new Map<string, number>();
  const roadErrors: number[] = [], terrainErrors: number[] = [], fallbacks: Uint8Array[] = [];
  let roadTriangles = 0, keptRoadTriangles = 0, verticalFaces = 0, groundTriangles = 0;
  for (const mesh of meshes.filter(m => ['terrain', 'roads'].includes(m.group.name))) {
    const fallback: number[] = [], isRoad = mesh.group.name === 'roads';
    for (let t = 0; t < mesh.group.triangles; t++) {
      const [a, b, c] = [0, 1, 2].map(i => point(mesh, mesh.indices[t * 3 + i]!)) as [Point, Point, Point];
      const area = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      let maxError = 0;
      for (const [wa, wb, wc] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [.5, .5, 0], [.5, 0, .5], [0, .5, .5], [1 / 3, 1 / 3, 1 / 3]]) {
        const p = [0, 1, 2].map(i => a[i]! * wa! + b[i]! * wb! + c[i]! * wc!);
        maxError = Math.max(maxError, Math.abs(p[1]! - sample(field, p[0]!, p[2]!)));
      }
      (isRoad ? roadErrors : terrainErrors).push(maxError);
      if (isRoad) roadTriangles++; else groundTriangles++;
      if (Math.abs(area) < 1e-8 || isRoad && maxError > tolerance) {
        fallback.push(t); if (isRoad) keptRoadTriangles++; if (Math.abs(area) < 1e-8) verticalFaces++; continue;
      }
      const color = [isRoad ? 1 : 2, ...mesh.colors.subarray(t * 4, t * 4 + 3)], key = color.join(',');
      let index = paletteIndex.get(key);
      if (index === undefined) { index = palette.length; if (index > 255) throw new Error('Stencil palette overflow'); paletteIndex.set(key, index); palette.push(color); }
      const xmin = Math.max(0, Math.ceil(Math.min(a[0], b[0], c[0]) / 256 * size - .5));
      const xmax = Math.min(size - 1, Math.floor(Math.max(a[0], b[0], c[0]) / 256 * size - .5));
      const zmin = Math.max(0, Math.ceil(Math.min(a[2], b[2], c[2]) / 256 * size - .5));
      const zmax = Math.min(size - 1, Math.floor(Math.max(a[2], b[2], c[2]) / 256 * size - .5));
      for (let z = zmin; z <= zmax; z++) for (let x = xmin; x <= xmax; x++) {
        const px = (x + .5) / size * 256, pz = (z + .5) / size * 256;
        const u = ((b[2] - c[2]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[2])) / area;
        const v = ((c[2] - a[2]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[2])) / area;
        if (u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9) mask[z * size + x] = index;
      }
    }
    fallbacks.push(subset(mesh, fallback));
  }
  const errors = (values: number[]) => { values.sort((a, b) => a - b); return { maximumM: values.at(-1) ?? 0,
    medianM: values[Math.floor(values.length / 2)] ?? 0, p95M: values[Math.floor(values.length * .95)] ?? 0 }; };
  const encoded = Buffer.concat([Buffer.from(JSON.stringify({ size, palette })), mask]);
  return { size, pixelMetres: 256 / size, toleranceM: tolerance, maskGzip: zip(encoded),
    combinedGzip: zip(Buffer.concat([encoded, ...fallbacks])), fallbackGzip: fallbacks.reduce((sum, b) => sum + (b.length ? zip(b) : 0), 0),
    roadTriangles, keptRoadTriangles, groundTriangles, verticalFaces,
    roadErrors: errors(roadErrors), terrainErrors: errors(terrainErrors), paletteEntries: palette.length,
    groundPixels: mask.filter(n => palette[n]?.[0] === 2).length, roadPixels: mask.filter(n => palette[n]?.[0] === 1).length };
}
const chunks = manifest.chunks.filter(c => c.detail === 'low');
const sampled = [...new Set([...chunks.filter((_, i) => i % Math.max(1, Math.floor(chunks.length / 24)) === 0),
  ...[...chunks].sort((a, b) => b.lods[0].gzipBytes - a.lods[0].gzipBytes).slice(0, 8)])];
const rows: { id: string; heightStepM: number; baselineGzip: number; variants: ReturnType<typeof probe>[] }[] = [];
for (const chunk of sampled) {
  const bytes = await readFile(resolve(root, chunk.lods[0].path));
  if (sha(bytes) !== chunk.lods[0].sha256) throw new Error('Source mesh hash changed');
  const meshes = await decodeCompactMesh(bytes, MeshoptDecoder);
  const raw = await readFile(resolve(root, chunk.terrain.path)); if (sha(raw) !== chunk.terrain.sha256) throw new Error('Source contact hash changed');
  const field = decodeHeightfield(decodeHeightTransport(raw));
  const baselineGzip = meshes.filter(m => ['terrain', 'roads'].includes(m.group.name)).reduce((sum, m) => sum + zip(subset(m, [...Array(m.group.triangles).keys()])), 0);
  const variants = [256, 512].flatMap(size => [.15, .3].map(tolerance => probe(meshes, field, size, tolerance)));
  rows.push({ id: chunk.id, heightStepM: field.step, baselineGzip, variants });
}
const summary = rows[0]!.variants.map((v, i) => ({ size: v.size, toleranceM: v.toleranceM,
  baselineGzip: rows.reduce((sum, row) => sum + row.baselineGzip, 0), combinedGzip: rows.reduce((sum, row) => sum + row.variants[i]!.combinedGzip, 0),
  maskGzip: rows.reduce((sum, row) => sum + row.variants[i]!.maskGzip, 0), fallbackGzip: rows.reduce((sum, row) => sum + row.variants[i]!.fallbackGzip, 0),
  roadTriangles: rows.reduce((sum, row) => sum + row.variants[i]!.roadTriangles, 0), keptRoadTriangles: rows.reduce((sum, row) => sum + row.variants[i]!.keptRoadTriangles, 0) }));
await writeFile(output, JSON.stringify({ root, manifestSha256: sha(manifestBytes), scriptSha256: sha(await readFile(new URL(import.meta.url))),
  sampledChunks: sampled.length, summary, rows,
  note: 'Diagnostic only. The stencil changes horizontal boundaries by its pixel size and uses the existing contact grid instead of visual triangulation. Error samples are seven barycentric points per source face, not exhaustive bounds. Vertical and road faces over tolerance remain explicit fallback. No renderer, output map, activation or visual/budget acceptance.' }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
