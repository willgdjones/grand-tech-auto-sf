/** Bake real cable-car geometry once. Runtime simulation makes no map-provider requests. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeTerrarium, Terrain, tileKey, tilesForBbox, tileUrl } from '../map/src/pipeline/elevation';
import { project } from '../map/src/pipeline/settings';
import { SourceCache } from '../map/src/pipeline/sources';
import type { SourceManifest } from '../map/src/pipeline/types';
import { loadCableGround } from './profile-ground';

type Geo = { lat: number; lon: number };
interface Member extends Partial<Geo> { type: string; ref: number; role: string; geometry?: Geo[] }
interface Element extends Partial<Geo> { type: string; id: number; tags?: Record<string, string>; members?: Member[] }
interface Extract { elements: Element[]; remark?: string; osm3s?: { timestamp_osm_base?: string } }
type XYZ = [number, number, number];
const root = 'artifacts/world-systems/source';
const fetchEnabled = process.argv.includes('--fetch');
const mapAt = process.argv.indexOf('--map'), mapDirectory = mapAt >= 0 ? process.argv[mapAt + 1] : undefined;
assert(mapAt < 0 || (mapDirectory && !mapDirectory.startsWith('--')), '--map requires a baked map directory');
const outputAt = process.argv.indexOf('--output'), outputPath = outputAt >= 0 ? process.argv[outputAt + 1] : 'shared/transit/cableRoutes.ts';
assert(outputPath && !outputPath.startsWith('--'), '--output requires a file path');
const endpoint = 'https://overpass-api.de/api/interpreter';
const sha = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
const round = (value: number) => Math.round(value * 1000) / 1000;
const distance = (a: XYZ, b: XYZ) => Math.hypot(a[0] - b[0], a[2] - b[2]);
await mkdir(root, { recursive: true });
async function source(name: string, query: string): Promise<{ data: Extract; digest: string }> {
  const path = join(root, name);
  let bytes: string;
  try { bytes = await readFile(path, 'utf8'); }
  catch (error) {
    if (!fetchEnabled) throw error;
    const response = await fetch(endpoint, { method: 'POST', headers: {
      'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'GTASF-map/0.1 (gtasf.com)',
    }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(55_000) });
    assert(response.ok, `OSM response ${response.status}`);
    bytes = await response.text();
    const parsed = JSON.parse(bytes) as Extract;
    assert(!parsed.remark && parsed.elements?.length, 'Complete OSM extract');
    await writeFile(path, bytes);
  }
  const data = JSON.parse(bytes) as Extract;
  assert(!data.remark && data.elements?.length, 'Complete cached OSM extract');
  return { data, digest: sha(bytes) };
}
const osm = await source('cable-osm.json', '[out:json][timeout:45];(way["cable_tram"="cable"](37.782,-122.425,37.809,-122.393);relation["type"="route"]["route"="tram"](37.782,-122.425,37.809,-122.393););out body geom;');
const routeIds = [1959009, 3433158, 1959010, 3433157, 2852264, 2852265];
const relations = routeIds.map(id => {
  const relation = osm.data.elements.find(e => e.type === 'relation' && e.id === id);
  assert(relation?.members?.length && ['PH', 'PM', 'C'].includes(relation.tags?.ref ?? ''), `Cable route ${id}`);
  return relation;
});
const stopIds = [...new Set(relations.flatMap(r => r.members!.filter(m => m.type === 'node' && m.role === 'stop').map(m => m.ref)))];
const stops = await source('cable-stops.json', `[out:json][timeout:45];node(id:${stopIds.join(',')});out body;`);
const stopNames = new Map(stops.data.elements.map(e => [e.id, e.tags?.name]));
assert(stopIds.every(id => stopNames.get(id)), 'Every route stop has a sourced name');

const allGeometry = relations.flatMap(r => r.members!.filter(m => m.type === 'way' && m.role !== 'platform').flatMap(m => m.geometry ?? []));
assert(allGeometry.every(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)), 'Complete directional geometry');
const bbox: [number, number, number, number] = [Math.min(...allGeometry.map(p => p.lon)), Math.min(...allGeometry.map(p => p.lat)),
  Math.max(...allGeometry.map(p => p.lon)), Math.max(...allGeometry.map(p => p.lat))];
const existingRoot = 'tools/map/out/cache/lombard';
const existing = JSON.parse(await readFile(join(existingRoot, 'sources.json'), 'utf8')) as SourceManifest;
const terrainCache = new SourceCache(join(root, 'terrain'), fetchEnabled);
const tiles = new Map<string, Float32Array>();
const terrainDigests: { key: string; sha256: string }[] = [];
for (const tile of tilesForBbox(bbox, 15)) {
  const key = `terrain-${tileKey(tile)}`, record = existing.records.find(r => r.key === key);
  const bytes = record ? await readFile(join(existingRoot, record.file)) : await terrainCache.get(key, tileUrl(tile));
  if (record) assert.equal(sha(bytes), record.sha256, `Verified terrain ${key}`);
  tiles.set(tileKey(tile), decodeTerrarium(bytes)); terrainDigests.push({ key, sha256: sha(bytes) });
}
const terrain = new Terrain(15, tiles);
const projected = allGeometry.map(p => project(p.lon, p.lat));
const mapGround = mapDirectory ? await loadCableGround(mapDirectory, [Math.min(...projected.map(p => p[0])) - 4, Math.min(...projected.map(p => p[1])) - 4,
  Math.max(...projected.map(p => p[0])) + 4, Math.max(...projected.map(p => p[1])) + 4]) : undefined;
const routes = relations.map((r, index) => {
  const points: XYZ[] = [];
  for (const member of r.members!.filter(m => m.type === 'way' && m.role !== 'platform')) {
    assert(member.geometry && member.geometry.length >= 2, `Complete way ${member.ref}`);
    let segment: XYZ[] = member.geometry.map(p => { const [x, z] = project(p.lon, p.lat); return [x, 0, z]; });
    const firstStop = r.members!.find(m => m.type === 'node' && m.role === 'stop')!;
    const [sx, sz] = project(firstStop.lon!, firstStop.lat!);
    const previous = points.at(-1) ?? [sx, 0, sz];
    if (distance(previous, segment.at(-1)!) < distance(previous, segment[0]!)) segment = segment.reverse();
    if (points.length) assert(distance(previous, segment[0]!) < .5, `Contiguous route ${r.id} way ${member.ref}`);
    for (let i = 0; i < segment.length; i++) {
      const b = segment[i]!, a = points.at(-1);
      if (!a) { points.push(b); continue; }
      const length = distance(a, b);
      if (length < .01) continue;
      const count = Math.ceil(length / 4);
      for (let k = 1; k <= count; k++) points.push([a[0] + (b[0] - a[0]) * k / count, 0, a[2] + (b[2] - a[2]) * k / count]);
    }
  }
  for (const [i, point] of points.entries()) {
    const raw = terrain.sample(point[0], point[2]) + .12;
    const before = points[Math.max(0, i - 1)]!, after = points[Math.min(points.length - 1, i + 1)]!;
    point[1] = mapGround?.sample(point[0], point[2], after[0] - before[0], after[2] - before[2]) ?? raw;
    point.forEach((v, i) => { point[i] = round(v); });
  }
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, stepM = distance(a, b);
    if (mapGround) assert(Math.abs(b[1] - a[1]) / stepM < .4, `Continuous street deck for route ${r.id} at point ${i}`);
    cumulative.push(cumulative[i - 1]! + stepM);
  }
  const routeStops = r.members!.filter(m => m.type === 'node' && m.role === 'stop').map(m => {
    const [x, z] = project(m.lon!, m.lat!);
    let best = { d: Infinity, atM: 0, point: points[0]! };
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!, dx = b[0] - a[0], dz = b[2] - a[2];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz || 1)));
      const point: XYZ = [a[0] + dx * t, a[1] + (b[1] - a[1]) * t, a[2] + dz * t], d = Math.hypot(x - point[0], z - point[2]);
      if (d < best.d) best = { d, atM: cumulative[i - 1]! + distance(a, b) * t, point };
    }
    assert(best.d < 8, `Stop ${m.ref} on route ${r.id}: ${best.d}m`);
    return { id: m.ref, name: stopNames.get(m.ref)!, atM: round(best.atM), point: best.point.map(round) as XYZ };
  }).sort((a, b) => a.atM - b.atM);
  assert(routeStops.length >= 15 && cumulative.at(-1)! > 1500, `Full route ${r.id}`);
  return { id: `${r.tags!.ref}-${index % 2 ? 'inbound' : 'outbound'}`, line: r.tags!.ref as 'PH' | 'PM' | 'C', relation: r.id,
    title: r.tags!.ref === 'PH' ? 'Powell–Hyde' : r.tags!.ref === 'PM' ? 'Powell–Mason' : 'California',
    destination: r.tags!.to!, points, stops: routeStops, lengthM: round(cumulative.at(-1)!) };
});
const provenance = { osm: { endpoint, sha256: osm.digest, stopsSha256: stops.digest, timestamp: osm.data.osm3s?.timestamp_osm_base }, terrain: terrainDigests,
  routes: ['https://www.sfmta.com/routes/powell-hyde-cable-car', 'https://www.sfmta.com/routes/powell-mason-cable-car', 'https://www.sfmta.com/routes/california-cable-car'],
  attribution: ['© OpenStreetMap contributors — ODbL', 'Mapzen Terrain Tiles; USGS 3DEP; NOAA'], ...(mapGround ? { mapSurface: mapGround.provenance } : {}) };
await mkdir('shared/transit', { recursive: true });
await writeFile(outputPath, `/** Generated by tools/transit/prepare-cable-routes.ts from OSM track relations and terrain. */\nexport interface CableRoute { id: string; line: 'PH' | 'PM' | 'C'; relation: number; title: string; destination: string; points: readonly (readonly [number, number, number])[]; stops: readonly { id: number; name: string; atM: number; point: readonly [number, number, number] }[]; lengthM: number }\nexport const cableRouteProvenance = ${JSON.stringify(provenance)};\nexport const cableRoutes: readonly CableRoute[] = ${JSON.stringify(routes)};\n`);
const report = { passed: true, routes: routes.map(r => ({ id: r.id, points: r.points.length, stops: r.stops.length, lengthM: r.lengthM })), provenance };
await writeFile('artifacts/world-systems/route-bake.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, routes: report.routes }));
