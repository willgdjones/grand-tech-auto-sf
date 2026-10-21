/** A03 real-source smoke; no network, map build, renderer or golden snapshots. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { decodeTerrarium, Terrain } from '../pipeline/elevation';
import { project, settings } from '../pipeline/settings';
import type { OsmExtract, SourceManifest, SourceRecord } from '../pipeline/types';

const root = resolve(process.argv[2] ?? settings('lombard').cache);
const manifest = JSON.parse(await readFile(join(root, 'sources.json'), 'utf8')) as SourceManifest;
const rawTiles = new Map<string, ReturnType<typeof PNG.sync.read>>();
const decoded = new Map<string, Float32Array>();
async function pinned(record: SourceRecord): Promise<Buffer> {
  assert.match(record.file, /^raw\/[a-f0-9]{64}\.bin$/, 'Unexpected cache source path');
  const bytes = await readFile(join(root, record.file));
  assert.equal(bytes.length, record.bytes, `Source length changed: ${record.key}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256,
    `Source checksum changed: ${record.key}`);
  return bytes;
}
const source = manifest.records.find(record => record.key === 'osm');
assert(source, 'The Lombard smoke needs the pinned Overpass source from the first slice');
const osm = JSON.parse((await pinned(source)).toString('utf8')) as OsmExtract;
const way = osm.elements.find(element => element.type === 'way' && element.id === 402111597);
assert(way?.geometry && way.geometry.length > 2, 'Missing Lombard switchback way 402111597');
const sources = manifest.records.filter(record => record.key.startsWith('terrain-'));
assert(sources.length > 0, 'No cached terrain sources');
const zooms = new Set(sources.map(record => Number(record.key.split('/')[0]!.slice(8))));
assert.equal(zooms.size, 1, 'Mixed terrain zooms');
const zoom = [...zooms][0]!;
for (const record of sources) {
  const bytes = await pinned(record), key = record.key.slice(8);
  rawTiles.set(key, PNG.sync.read(bytes));
  decoded.set(key, decodeTerrarium(bytes));
}
const terrain = new Terrain(zoom, decoded), scale = 256 * 2 ** zoom;
// Separate raw-RGB reference calculation. Neither tilePosition nor Terrain.pixel
// is used here, so the comparison also detects a half-pixel or row/column error.
function reference(lon: number, lat: number): number {
  const px = (lon + 180) / 360 * scale - .5;
  const py = (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * scale - .5;
  const x = Math.floor(px), y = Math.floor(py), u = px - x, v = py - y;
  function pixel(x: number, y: number): number {
    const tx = Math.floor(x / 256), ty = Math.floor(y / 256);
    const png = rawTiles.get(`${zoom}/${tx}/${ty}`);
    assert(png, 'Reference sample requires a missing source tile');
    const p = ((y - ty * 256) * 256 + x - tx * 256) * 4;
    assert.equal(png.data[p + 3], 255, 'Reference sample contains no-data');
    return png.data[p]! * 256 + png.data[p + 1]! + png.data[p + 2]! / 256 - 32768;
  }
  return pixel(x, y) * (1-u) * (1-v) + pixel(x+1, y) * u * (1-v)
    + pixel(x, y+1) * (1-u) * v + pixel(x+1, y+1) * u * v;
}
const samples = way.geometry.map(({lon, lat}) => {
  const [x, z] = project(lon, lat), heightM = terrain.sample(x, z), sourceM = reference(lon, lat);
  assert(Number.isFinite(heightM), 'Non-finite Lombard elevation');
  assert(Math.abs(heightM - sourceM) < 1e-6, 'World elevation differs from source RGB samples');
  return {lon, lat, x, z, heightM, sourceM};
});
const first = samples[0]!, last = samples.at(-1)!;
const lengthM = samples.slice(1).reduce((sum, p, i) =>
  sum + Math.hypot(p.x - samples[i]!.x, p.z - samples[i]!.z), 0);
const dropM = first.heightM - last.heightM, gradePct = -dropM / lengthM * 100;
const taggedGradePct = Number(way.tags?.incline?.replace('%', ''));
assert(dropM > 0 && lengthM > 0, 'Lombard must descend in its one-way direction');
assert(Number.isFinite(taggedGradePct) && Math.abs(gradePct - taggedGradePct) < 2,
  'Source DEM mean grade differs from the mapped incline by more than 2 percentage points');
console.log(JSON.stringify({
  status: 'pass', osmWay: way.id, osmSha256: source.sha256, sampleCount: samples.length,
  terrainSources: sources.map(({key, sha256, imagerySources}) => ({key, sha256, imagerySources})),
  start: first, end: last, lengthM, dropM, gradePct, taggedGradePct,
  maxSourceErrorM: Math.max(...samples.map(p => Math.abs(p.heightM - p.sourceM))),
  scope: 'Source terrain only. Rendered road grades, vehicle contact and G1 remain separate acceptance.',
}, null, 2));
