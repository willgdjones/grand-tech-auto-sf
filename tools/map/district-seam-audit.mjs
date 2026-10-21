/** Read-only emitted boundary diagnosis for gtasf-hbyf; no map writes.
 * tools/heavy.sh node --import tsx tools/map/district-seam-audit.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Matrix4, Vector3 } from 'three';
import { readGlb } from './src/glb.ts';
import { DISTRICTS } from './src/districts/index.ts';
import { project } from './src/pipeline/settings.ts';

const root = resolve(process.argv[2] ?? 'tools/map/out/district-tm7m-ground');
const output = resolve(process.argv[3] ?? 'artifacts/district-seams-hbyf/before.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(join(root, 'manifest.json')), manifest = JSON.parse(manifestBytes);
const receipt = JSON.parse(await readFile(join(root, 'district-rollout.json'), 'utf8'));
assert.equal(sha(manifestBytes), receipt.manifestSha256);
const pointKey = p => [p.x, p.y, p.z].map(n => n.toFixed(5)).join(',');
function cells(edge) {
  const result = [];
  for (let x = Math.floor((Math.min(edge.a.x, edge.b.x) - .03) / 16); x <= Math.floor((Math.max(edge.a.x, edge.b.x) + .03) / 16); x++)
    for (let z = Math.floor((Math.min(edge.a.z, edge.b.z) - .03) / 16); z <= Math.floor((Math.max(edge.a.z, edge.b.z) + .03) / 16); z++) result.push(`${x},${z}`);
  return result;
}
function overlap(a, b) {
  const dx = a.b.x - a.a.x, dz = a.b.z - a.a.z, length = Math.hypot(dx, dz);
  const t = p => ((p.x - a.a.x) * dx + (p.z - a.a.z) * dz) / (length * length);
  const perpendicular = p => Math.abs((p.x - a.a.x) * dz - (p.z - a.a.z) * dx) / length;
  if (perpendicular(b.a) > .03 || perpendicular(b.b) > .03) return null;
  const t0 = t(b.a), t1 = t(b.b), start = Math.max(0, Math.min(t0, t1)), end = Math.min(1, Math.max(t0, t1));
  if ((end - start) * length < .1 || Math.abs(t1 - t0) < 1e-8) return null;
  const gap = s => (a.a.y + s * (a.b.y - a.a.y)) - (b.a.y + (s - t0) / (t1 - t0) * (b.b.y - b.a.y));
  return { overlapM: (end - start) * length, startGapM: gap(start), endGapM: gap(end), maxGapM: Math.max(Math.abs(gap(start)), Math.abs(gap(end))) };
}
const records = [];
for (const id of ['pacific-heights', 'potrero-hill', 'ocean-beach']) {
  const district = DISTRICTS.find(d => d.id === id); assert(district);
  const [x, z] = project(district.spawn.lon, district.spawn.lat);
  const chunk = manifest.chunks.find(c => c.id === `${Math.floor(x / 256)}_${Math.floor(z / 256)}`); assert(chunk);
  const artifact = chunk.lods[0], bytes = await readFile(join(root, artifact.path)); assert.equal(sha(bytes), artifact.sha256);
  const doc = await readGlb(bytes), groups = { roads: new Map(), terrain: new Map() };
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(), kind = mesh?.getName(); if (!groups[kind]) continue;
    const matrix = new Matrix4().fromArray(node.getWorldMatrix());
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION'), indices = primitive.getIndices(), element = [];
      const vertex = i => { position.getElement(i, element); const p = new Vector3(...element).applyMatrix4(matrix); p.x += chunk.bounds[0]; p.z += chunk.bounds[1]; return p; };
      for (let i = 0; i < indices.getCount(); i += 3) {
        const points = [0, 1, 2].map(j => vertex(indices.getScalar(i + j)));
        for (let j = 0; j < 3; j++) {
          const a = points[j], b = points[(j + 1) % 3], key = [pointKey(a), pointKey(b)].sort().join('|');
          const edge = groups[kind].get(key);
          if (edge) edge.count++;
          else groups[kind].set(key, { a, b, count: 1, kind });
        }
      }
    }
  }
  const boundary = Object.values(groups).flatMap(group => [...group.values()]).filter(edge => edge.count === 1
    && Math.hypot(edge.a.x - edge.b.x, edge.a.z - edge.b.z) >= .1
    && Math.hypot((edge.a.x + edge.b.x) / 2 - x, (edge.a.z + edge.b.z) / 2 - z) < 80);
  const grid = new Map();
  boundary.forEach((edge, i) => { for (const cell of cells(edge)) { const list = grid.get(cell) ?? []; list.push(i); grid.set(cell, list); } });
  const mismatches = [], seen = new Set();
  boundary.forEach((edge, i) => {
    if (edge.kind !== 'roads') return;
    for (const j of new Set(cells(edge).flatMap(cell => grid.get(cell) ?? []))) {
      if (i === j) continue;
      const pair = [i, j].sort((a, b) => a - b).join(','); if (seen.has(pair)) continue; seen.add(pair);
      const other = boundary[j], match = overlap(edge, other);
      if (match && match.maxGapM > .03) mismatches.push({ ...match, kinds: [edge.kind, other.kind],
        a: [edge.a.toArray(), edge.b.toArray()], b: [other.a.toArray(), other.b.toArray()] });
    }
  });
  mismatches.sort((a, b) => b.maxGapM - a.maxGapM);
  records.push({ district: id, chunk: chunk.id, path: artifact.path, sha256: artifact.sha256,
    roadBoundaries: boundary.filter(e => e.kind === 'roads').length, terrainBoundaries: boundary.filter(e => e.kind === 'terrain').length,
    mismatchedBoundaryPairs: mismatches.length, roadRoadPairs: mismatches.filter(m => m.kinds[1] === 'roads').length,
    roadTerrainPairs: mismatches.filter(m => m.kinds[1] === 'terrain').length, maximumGapM: mismatches[0]?.maxGapM ?? 0,
    examples: mismatches.slice(0, 24) });
}
assert.equal(sha(await readFile(join(root, 'manifest.json'))), receipt.manifestSha256);
const report = { root, manifestSha256: receipt.manifestSha256, inspectedAt: new Date().toISOString(),
  scope: 'Actual quantized road/terrain triangle boundary edges within 80m of three arrivals. Collinear overlap >=0.1m, XZ tolerance0.03m, vertical mismatch >0.03m. Counts diagnose emitted joins, not contact or visual acceptance. No assets mutated.', records };
await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, records: records.map(({ examples, ...record }) => record) }, null, 2));
