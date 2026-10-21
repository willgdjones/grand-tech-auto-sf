/** Pinned SF source → small road-detail cells outside the original playable corridor. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { prepareRoadDetails, type RoadDetail, type TrackDetail, type CrossingDetail } from './prepare-road-details';
import { settings } from '../map/src/pipeline/settings';
import type { XYZ } from '../map/src/pipeline/types';
import { DISTRICT_ROAD_MAX_CELLS, ROAD_DETAIL_CELL_METRES, LEGACY_ROAD_DETAIL_BOUNDS,
  districtRoadCellBounds, districtRoadPartOwners, roadDetailCellWithin, selectDistrictRoadCells, splitRoadDetailCells } from '../map/src/districts/roadDetailCells';

const CELL = ROAD_DETAIL_CELL_METRES;
let checkOnly = false, mapRoot = resolve('tools/map/out/sf'), artRoot = resolve('web/public/art');
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--check') { checkOnly = true; continue; }
  if (arg !== '--map-root' && arg !== '--art-root') throw new Error(`Unknown argument ${arg}`);
  const value = process.argv[++i];
  if (!value || value.startsWith('--')) throw new Error(`Missing path for ${arg}`);
  if (arg === '--map-root') mapRoot = resolve(value);
  else artRoot = resolve(value);
}
const round = (n: number) => Math.round(n * 100) / 100 || 0;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Cell = { version: 1; roads: (RoadDetail & { offsetM: number })[]; tracks: (TrackDetail & { offsetM: number })[]; crossings: (CrossingDetail & { offsetM: number })[] };
const source = await prepareRoadDetails('sf', { write: false, mapRoot });
const corridor = settings('lombard').bounds;
const cells = new Map<string, Cell>();
// Preserve every existing eastern cell, including a source crossing/track-only cell.
const legacyCells = new Set<string>();
for (const type of ['roads', 'tracks', 'crossings'] as const) for (const item of source[type])
  for (const part of splitRoadDetailCells(item.points))
    if (roadDetailCellWithin(part.key, LEGACY_ROAD_DETAIL_BOUNDS) && !roadDetailCellWithin(part.key, corridor)) legacyCells.add(part.key);
const selected = selectDistrictRoadCells(source.roads, corridor, legacyCells);
function cell(key: string) { const value = cells.get(key) ?? { version: 1, roads: [], tracks: [], crossings: [] }; cells.set(key, value); return value; }
for (const type of ['roads', 'tracks', 'crossings'] as const) for (const item of source[type]) {
  for (const [index, part] of splitRoadDetailCells(item.points).entries()) {
    if (!selected.cells.has(part.key)) continue;
    // Keep expansion proportional to the configured frontage streets, not every
    // side street or freeway that happens to share a selected 256m cell.
    if (type === 'roads' && !legacyCells.has(part.key) && !districtRoadPartOwners(item as RoadDetail, part).length) continue;
    const points = part.points.map(p => p.map(round) as XYZ);
    const common = { ...item, id: `${item.id}@${index}`, points, offsetM: round(part.from) };
    if (type === 'roads') {
      const road = item as RoadDetail;
      const markingRanges = road.markingRanges.map(([a, b]): [number, number] => [round(Math.max(a, part.from) - part.from), round(Math.min(b, part.to) - part.from)]).filter(([a, b]) => b > a + .02);
      cell(part.key).roads.push({ ...common, markingRanges } as RoadDetail & { offsetM: number });
    } else if (type === 'tracks') cell(part.key).tracks.push(common as TrackDetail & { offsetM: number });
    else cell(part.key).crossings.push(common as CrossingDetail & { offsetM: number });
  }
}
assert(cells.size > 100 && cells.size <= DISTRICT_ROAD_MAX_CELLS, 'District road cell count exceeds the coordinated runtime index contract');
const out = resolve(artRoot, 'district-roads');
const encoded = new Map<string, Buffer>();
const entries: { key: string; path: string; bytes: number; sha256: string }[] = [];
let totalBytes = 0, totalGzipBytes = 0, roads = 0, tracks = 0, crossings = 0;
for (const [key, value] of [...cells].sort(([a], [b]) => a.localeCompare(b))) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  assert(bytes.length <= 300_000, `Cell ${key} exceeds 300 KB`);
  const file = `${key}.json`; encoded.set(file, bytes);
  entries.push({ key, path: `/art/district-roads/${file}`, bytes: bytes.length, sha256: sha256(bytes) });
  totalBytes += bytes.length; totalGzipBytes += gzipSync(bytes).length;
  roads += value.roads.length; tracks += value.tracks.length; crossings += value.crossings.length;
}
// Keep the 150 KB runtime index budget. Complete source hashes live in a checked
// provenance sidecar instead of repeating ~33 KB of terrain records in the index.
const bounds = districtRoadCellBounds(cells.keys());
const provenance = Buffer.from(JSON.stringify({ version: 1, frame: source.frame,
  sourceDigests: source.sourceDigests, attribution: source.attribution }) + '\n');
assert(provenance.length < 150_000, 'District provenance byte budget');
const manifest = { version: 1, cellSize: CELL, frame: source.frame, bounds,
  provenance: { path: '/art/district-roads/provenance.json', bytes: provenance.length, sha256: sha256(provenance) },
  attribution: source.attribution, cells: entries };
const manifestBytes = Buffer.from(JSON.stringify(manifest) + '\n');
assert(manifestBytes.length < 150_000, 'District runtime index byte budget');
const payloadBytes = totalBytes + manifestBytes.length + provenance.length;
assert(payloadBytes < 15_000_000, 'Regional road detail byte budget including metadata');
// Keep the existing detailed corridor source arrays, even when writing a fully
// isolated candidate art tree. Its own source digests remain in this base asset.
const baseBytes = await readFile(resolve('web/public/art/road-details.json'));
const legacy = JSON.parse(baseBytes.toString('utf8'));
legacy.districts = { path: '/art/district-roads/manifest.json' };
const report = { passed: true, checkOnly, mapRoot, artRoot, baseRoadDetailsSha256: sha256(baseBytes),
  cells: entries.length, legacyCells: legacyCells.size,
  byDistrict: Object.fromEntries([...selected.byDistrict].sort(([a],[b])=>a.localeCompare(b)).map(([id,keys])=>[id,keys.size])),
  roads, tracks, crossings, bytes: totalBytes, payloadBytes, gzipBytes: totalGzipBytes,
  manifestBytes: manifestBytes.length, provenanceBytes: provenance.length,
  maxCellBytes: Math.max(...entries.map(e => e.bytes)), bounds };
if (!checkOnly) {
  // Validate the entire source result before replacing any generated assets.
  await mkdir(out, { recursive: true });
  for (const [file, bytes] of encoded) await writeFile(resolve(out, file), bytes);
  await writeFile(resolve(out, 'provenance.json'), provenance);
  await writeFile(resolve(out, 'manifest.json'), manifestBytes);
  // Existing corridor readers keep their arrays; the runtime follows this small index.
  const legacyPath = resolve(artRoot, 'road-details.json');
  await writeFile(legacyPath, JSON.stringify(legacy) + '\n');
  await writeFile(resolve(mapRoot, 'district-roads-smoke.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report));
