/** Read-only exact recipe probe; run through tools/heavy.sh. Never changes a map. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { compactMeshHeader, decodeCompactMesh, type DecodedMapMesh } from '../../shared/mapMesh';
import { decodeMapCollision } from '../../shared/mapCollision';
import { decodeHeightTransport } from '../../shared/mapTransport';
import { addBuildings, ChunkMeshes } from './src/pipeline/meshes';
import { decodeHeightfield, type Heightfield } from './src/pipeline/heightfield';
import type { MapManifest } from './src/pipeline/types';

const root = resolve(process.argv[2] ?? 'tools/map/out/compact-zzpr-ground');
const output = process.argv[3] ?? 'docs/perf/map-zzpr/recipe-probe.json';
const manifestBytes = await readFile(resolve(root, 'manifest.json'));
const manifest = JSON.parse(manifestBytes.toString()) as MapManifest;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const gzip = (parts: Uint8Array[]) => gzipSync(Buffer.concat(parts), { level: 9 }).length;
await MeshoptEncoder.ready;
function streams(mesh: DecodedMapMesh) {
  return [MeshoptEncoder.encodeVertexBuffer(new Uint8Array(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength), mesh.group.vertices, 8),
    MeshoptEncoder.encodeIndexBuffer(new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength), mesh.indices.length, 4),
    MeshoptEncoder.encodeVertexBuffer(mesh.colors, mesh.group.triangles, 4)];
}
function subset(mesh: DecodedMapMesh, selected: number[]) {
  if (!selected.length) return new Uint8Array();
  const remap = new Map<number, number>(), xyz: number[] = [], indices: number[] = [], rgb: number[] = [];
  for (const t of selected) {
    rgb.push(...mesh.colors.subarray(t * 4, t * 4 + 4));
    for (let c = 0; c < 3; c++) {
      const old = mesh.indices[t * 3 + c]!; let id = remap.get(old);
      if (id === undefined) { id = remap.size; remap.set(old, id); xyz.push(...mesh.positions.subarray(old * 4, old * 4 + 4)); }
      indices.push(id);
    }
  }
  return Buffer.concat(streams({ group: { ...mesh.group, vertices: remap.size, triangles: selected.length },
    positions: new Int16Array(xyz), indices: new Uint32Array(indices), colors: new Uint8Array(rgb) }));
}
function faceKey(points: number[][]) {
  const corners = points.map(p => p.join(','));
  return corners.map((_, i) => [corners[i], corners[(i + 1) % 3], corners[(i + 2) % 3]].join(';')).sort()[0]!;
}
function sample(field: Heightfield, x: number, z: number) {
  const px = Math.max(0, Math.min(field.size - 1, x / field.step)), pz = Math.max(0, Math.min(field.size - 1, z / field.step));
  const ix = Math.min(field.size - 2, Math.floor(px)), iz = Math.min(field.size - 2, Math.floor(pz));
  const fx = px - ix, fz = pz - iz, h = (a: number, b: number) => field.values[b * field.size + a]!;
  return (field.offsetCm + (h(ix, iz) * (1 - fx) + h(ix + 1, iz) * fx) * (1 - fz)
    + (h(ix, iz + 1) * (1 - fx) + h(ix + 1, iz + 1) * fx) * fz) / 100;
}
function heightPrediction(mesh: DecodedMapMesh, field: Heightfield) {
  const positions = new Int16Array(mesh.positions), residuals: number[] = []; let maximumResidualM = 0, exact = 0;
  for (let i = 0; i < mesh.group.vertices; i++) {
    const p = [0, 1, 2].map(axis => mesh.positions[i * 4 + axis]! / 32767 * mesh.group.scale[axis]! + mesh.group.translation[axis]!);
    const y = sample(field, p[0]!, p[2]!) + (mesh.group.name === 'roads' ? .1 : 0);
    const predicted = Math.round((y - mesh.group.translation[1]) / mesh.group.scale[1] * 32767);
    const residual = mesh.positions[i * 4 + 1]! - predicted;
    maximumResidualM = Math.max(maximumResidualM, Math.abs(p[1]! - y)); if (!residual) exact++;
    // Modular signed-16 delta is exactly reversible even outside the source range.
    positions[i * 4 + 1] = residual;
    const restored = new Int16Array([positions[i * 4 + 1]! + predicted])[0];
    assert.equal(restored, mesh.positions[i * 4 + 1]); residuals.push(residual);
  }
  return { baselineGzip: gzip(streams(mesh)), predictedGzip: gzip(streams({ ...mesh, positions })),
    vertices: mesh.group.vertices, exactHeightPredictions: exact, maximumResidualM,
    meanResidualM: residuals.reduce((sum, n) => sum + Math.abs(n) / 32767 * mesh.group.scale[1], 0) / residuals.length };
}
const chunks = manifest.chunks.filter(c => c.detail === 'low');
const sampled = [...new Set([...chunks.filter((_, i) => i % Math.max(1, Math.floor(chunks.length / 24)) === 0),
  ...[...chunks].sort((a, b) => b.lods[0].gzipBytes - a.lods[0].gzipBytes).slice(0, 8)])];
interface BuildingResult {
  sourceTriangles: number; collisionBuildings: number; generatedTriangles: number; coveredTriangles: number;
  fallbackTriangles: number; completeRecipes: number; recipes: number; sourceGzip: number;
  recipeAndFallbackGzip: number; recipeGzip: number; fallbackGzip: number;
}
const rows: { id: string; surface: (ReturnType<typeof heightPrediction> & { name: string })[]; buildings: BuildingResult | null }[] = [];
for (const chunk of sampled) {
  const meshes = await decodeCompactMesh(await readFile(resolve(root, chunk.lods[0].path)), MeshoptDecoder);
  const collision = decodeMapCollision(await readFile(resolve(root, chunk.collision.path)));
  const field = decodeHeightfield(decodeHeightTransport(await readFile(resolve(root, chunk.terrain.path))));
  const surface = meshes.filter(m => ['terrain', 'roads'].includes(m.group.name)).map(m => ({ name: m.group.name, ...heightPrediction(m, field) }));
  const mesh = meshes.find(m => m.group.name === 'buildings');
  if (!mesh) { rows.push({ id: chunk.id, surface, buildings: null }); continue; }
  const lookup = new Map<string, number[]>(), covered = new Set<number>(), recipes: unknown[] = [];
  for (let t = 0; t < mesh.group.triangles; t++) {
    const key = faceKey([0, 1, 2].map(c => Array.from(mesh.positions.subarray(mesh.indices[t * 3 + c]! * 4, mesh.indices[t * 3 + c]! * 4 + 3))));
    const list = lookup.get(key) ?? []; list.push(t); lookup.set(key, list);
  }
  let generated = 0, completeRecipes = 0;
  for (const [index, building] of collision.buildings.entries()) {
    // Collision polygons are local XZ. Full surveyed rings are extruded then clipped
    // to this chunk, just like the source mesher; no alternate footprint is assumed.
    const collection = new ChunkMeshes(chunk.bounds), roof = building.maxY;
    addBuildings(collection, [{ id: building.id, polygon: building.rings.map(r => r.map(([x, z]) => [x + chunk.bounds[0], z + chunk.bounds[1]])),
      base: 0, foundation: building.minY, height: roof, heightSource: 'fallback', colour: [1, 1, 1], landuse: '' }], 0);
    const data = collection.chunks.get(chunk.id)!.buildings, accepted: number[] = [], colors: number[] = [];
    const localCovered = new Set<number>();
    for (let t = 0; t < data.indices.length / 3; t++) {
      const key = faceKey([0, 1, 2].map(c => {
        const at = data.indices[t * 3 + c]! * 3;
        return [0, 1, 2].map(axis => Math.round((data.positions[at + axis]!
          - (axis === 0 ? chunk.bounds[0] : axis === 2 ? chunk.bounds[1] : 0) - mesh.group.translation[axis]!) / mesh.group.scale[axis]! * 32767));
      }));
      const original = lookup.get(key)?.find(id => !covered.has(id) && !localCovered.has(id));
      if (original === undefined) continue;
      accepted.push(t); colors.push(...mesh.colors.subarray(original * 4, original * 4 + 3)); localCovered.add(original);
    }
    generated += data.indices.length / 3;
    if (accepted.length) {
      if (accepted.length === data.indices.length / 3) completeRecipes++;
      recipes.push([index, accepted.length === data.indices.length / 3 ? null : accepted, colors]);
      for (const t of localCovered) covered.add(t);
    }
  }
  const fallback = [...Array(mesh.group.triangles).keys()].filter(t => !covered.has(t));
  const recipeBytes = Buffer.from(JSON.stringify(recipes)), fallbackBytes = subset(mesh, fallback);
  rows.push({ id: chunk.id, surface, buildings: { sourceTriangles: mesh.group.triangles, collisionBuildings: collision.buildings.length,
    generatedTriangles: generated, coveredTriangles: covered.size, fallbackTriangles: fallback.length, completeRecipes,
    recipes: recipes.length, sourceGzip: gzip(streams(mesh)), recipeAndFallbackGzip: gzip([recipeBytes, fallbackBytes]),
    recipeGzip: gzip([recipeBytes]), fallbackGzip: fallbackBytes.length ? gzip([fallbackBytes]) : 0 } });
}
// Count actual whole-city group bytes separately from sample coverage. Independent
// group gzip totals include extra stream boundaries and are not publication sizes.
const groups: Record<string, { streamBytes: number; separateGzipBytes: number; files: number }> = {};
const seen = new Set<string>();
for (const chunk of manifest.chunks) for (const artifact of chunk.lods) {
  if (seen.has(artifact.path)) continue; seen.add(artifact.path);
  const bytes = await readFile(resolve(root, artifact.path)), header = compactMeshHeader(bytes); let at = header.dataOffset;
  for (const group of header.groups) {
    const length = group.streams.reduce((sum, n) => sum + n, 0), key = `${chunk.detail ?? 'high'}:${group.name}`;
    const row = groups[key] ??= { streamBytes: 0, separateGzipBytes: 0, files: 0 };
    row.streamBytes += length; row.separateGzipBytes += gzip([bytes.subarray(at, at + length)]); row.files++; at += length;
  }
}
const b = rows.flatMap(row => row.buildings ? [row.buildings] : []);
const summary = { buildings: Object.fromEntries(['sourceTriangles', 'coveredTriangles', 'fallbackTriangles', 'sourceGzip', 'recipeAndFallbackGzip'].map(key =>
  [key, b.reduce((sum, row) => sum + row[key as keyof typeof row], 0)])),
  surfaces: ['terrain', 'roads'].map(name => { const s = rows.flatMap(row => row.surface).filter(row => row.name === name);
    return { name, baselineGzip: s.reduce((sum, row) => sum + row.baselineGzip, 0), predictedGzip: s.reduce((sum, row) => sum + row.predictedGzip, 0),
      maximumResidualM: Math.max(...s.map(row => row.maximumResidualM)) }; }) };
await writeFile(output, JSON.stringify({ root, manifestSha256: sha(manifestBytes), scriptSha256: sha(await readFile(new URL(import.meta.url))),
  sampledChunks: sampled.length, lowDetailChunks: chunks.length, summary, groups, rows,
  note: 'Read-only exact coverage probe. No runtime codec, activation, altered collision/terrain, lossy geometry or visual/budget acceptance. Building recipes select only exact oriented source triangles; all others are counted and encoded as fallback. Height prediction stores exact reversible residuals.' }, null, 2) + '\n');
console.log(JSON.stringify({ summary, groups }, null, 2));
