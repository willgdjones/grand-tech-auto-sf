/** Offline source export for cosmetic road detail. Does not rebake or mutate contact assets. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { decodeTerrarium, Terrain } from '../map/src/pipeline/elevation';
import { extractRoads, isDrivable, laneCounts, metric } from '../map/src/pipeline/osm';
import { gradeSeparated, prepareRoadSurfaces, resample, RoadTerrain, surfaceHeight } from '../map/src/pipeline/roads';
import { SpatialIndex } from '../map/src/pipeline/geometry';
import { settings, SF_FRAME } from '../map/src/pipeline/settings';
import type { Bounds, MapManifest, OsmExtract, Road, RoadGraph, SourceManifest, XYZ } from '../map/src/pipeline/types';
import { pavementSidewalkTags, preparePavements } from '../map/src/pipeline/pavement';

type Range = [number, number];
export interface RoadDetail {
  id: string; osmWay: number; name: string; highway: string; points: XYZ[]; width: number;
  forward: number; backward: number; shared: boolean; inferredLanes: boolean; oneway: -1 | 0 | 1;
  sidewalk?: string; sidewalkLeft?: string; sidewalkRight?: string; surface: string;
  /** Horizontal arclength intervals outside shared-node intersections and crossings. */
  markingRanges: Range[];
}
export interface TrackDetail { id: string; osmWay: number; name: string; kind: 'cable' | 'tram'; gaugeM: number; points: XYZ[] }
export interface CrossingDetail { id: string; osmWay: number; points: XYZ[]; width: number; markings: string }

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const round = (n: number) => Math.round(n * 1000) / 1000 || 0;
const rounded = (points: XYZ[]): XYZ[] => points.map(([x, y, z]) => [round(x), round(y), round(z)]);
const lengths = (points: XYZ[]) => {
  const result = [0];
  for (let i = 1; i < points.length; i++) result.push(result.at(-1)! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![2] - points[i - 1]![2]));
  return result;
};
function nearest(points: XYZ[], distances: number[], x: number, z: number) {
  let distance = Infinity, at = 0, y = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, dx = b[0] - a[0], dz = b[2] - a[2];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz || 1)));
    const d = Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t);
    if (d < distance) { distance = d; at = distances[i - 1]! + (distances[i]! - distances[i - 1]!) * t; y = a[1] + (b[1] - a[1]) * t; }
  }
  return { distance, at, y };
}
function bounds(points: XYZ[], padding = 0): Bounds {
  return [Math.min(...points.map(p => p[0])) - padding, Math.min(...points.map(p => p[2])) - padding,
    Math.max(...points.map(p => p[0])) + padding, Math.max(...points.map(p => p[2])) + padding];
}
function allowed(total: number, gaps: Range[]): Range[] {
  const ranges: Range[] = []; let cursor = 0;
  for (const [from, to] of gaps.sort((a, b) => a[0] - b[0])) {
    if (from > cursor + 0.2) ranges.push([round(cursor), round(Math.min(total, from))]);
    cursor = Math.max(cursor, Math.min(total, to));
  }
  if (total > cursor + 0.2) ranges.push([round(cursor), round(total)]);
  return ranges.filter(([a, b]) => b > a + 0.2);
}

export async function prepareRoadDetails(area = 'lombard', options: { write?: boolean; mapRoot?: string } = {}) {
  const s = { ...settings(area), ...(options.mapRoot ? { out: resolve(options.mapRoot) } : {}) }, warnings: string[] = [];
  const map = JSON.parse(await readFile(join(s.out, 'manifest.json'), 'utf8')) as MapManifest;
  // An isolated candidate must use its pinned source records, not a newer cache
  // catalogue another baker might write. The underlying cached bytes are hashed below.
  const source = JSON.parse(await readFile(join(options.mapRoot ? s.out : s.cache, 'sources.json'), 'utf8')) as SourceManifest;
  assert.deepEqual(map.bounds, s.bounds, 'Source extent must match the baked map');
  assert.deepEqual(map.frame, SF_FRAME);
  const records = source.records.filter(record => record.key === 'osm' || record.key === 'osm-pbf-normalized' || record.key.startsWith('terrain-'));
  let osm: OsmExtract | undefined;
  const tiles = new Map<string, Float32Array>();
  for (const record of records) {
    const bytes = await readFile(join(s.cache, record.file));
    assert.equal(bytes.length, record.bytes, `Source byte count ${record.key}`);
    assert.equal(sha256(bytes), record.sha256, `Source digest ${record.key}`);
    assert.equal(map.sourceDigests.find(item => item.key === record.key)?.sha256, record.sha256, `Baked source ${record.key}`);
    if (record.key === 'osm' || record.key === 'osm-pbf-normalized') osm = JSON.parse(bytes.toString('utf8')) as OsmExtract;
    else tiles.set(record.key.slice('terrain-'.length), decodeTerrarium(bytes));
  }
  assert(osm, 'Cached OSM is required');
  const terrain = new Terrain(s.zoom, tiles), all = extractRoads(osm, s.bounds);
  prepareRoadSurfaces(all, terrain, warnings);
  const carved = new RoadTerrain(terrain, all);
  const drivable = all.filter(road => isDrivable(road.tags) && !gradeSeparated(road));
  const mappedPavementRoads=new Set(preparePavements(all).flatMap(p=>p.roadIds));
  const usage = new Map<string, Set<Road>>(), neighbours = new Map<string, Set<string>>();
  for (const road of drivable) for (let i = 0; i < road.points.length; i++) {
    const point = road.points[i]!;
    const roads = usage.get(point.id) ?? new Set<Road>(); roads.add(road); usage.set(point.id, roads);
    const links = neighbours.get(point.id) ?? new Set<string>();
    for (const adjacent of [road.points[i - 1], road.points[i + 1]]) if (adjacent) links.add(adjacent.id);
    neighbours.set(point.id, links);
  }
  const crossingRoads = all.filter(road => road.tags.footway === 'crossing' && !gradeSeparated(road));
  const crossings: CrossingDetail[] = crossingRoads.map(road => ({
    id: road.id, osmWay: road.osmWay, points: rounded(road.profile!.map(([x, y, z]) => [x, y + .1, z])),
    width: metric(road.tags.width) ?? 2.5,
    markings: road.tags['crossing:markings'] ?? (road.tags.crossing === 'unmarked' ? 'no' : 'unknown'),
  }));
  const crossingIndex = new SpatialIndex<typeof crossingRoads[number]>(32);
  for (const crossing of crossingRoads) crossingIndex.add(bounds(crossing.profile!, 3), crossing);
  let intersectionGaps = 0, crossingGaps = 0;
  const roads: RoadDetail[] = drivable.map((road): RoadDetail => {
    const profile = road.profile!, distances = lengths(profile), total = distances.at(-1)!, gaps: Range[] = [];
    for (const point of road.points) {
      const others = [...(usage.get(point.id) ?? [])].filter(other => other !== road);
      // Degree two is only a source-way split or bend, even when its street name changes.
      const junction = (neighbours.get(point.id)?.size ?? 0) > 2 ? others : [];
      if (!junction.length && !point.control && !point.yield) continue;
      const at = nearest(profile, distances, point.x, point.z).at;
      const radius = Math.max(2.5, ...junction.map(other => other.width / 2 + 1));
      gaps.push([Math.max(0, at - radius), Math.min(total, at + radius)]); intersectionGaps++;
    }
    // Crossing ways preserve the actual pedestrian orientation; only real line intersections cut paint.
    for (const crossing of crossingIndex.query(bounds(profile, road.width / 2))) {
      for (let i = 1; i < profile.length; i++) for (let j = 1; j < crossing.profile!.length; j++) {
        const a = profile[i - 1]!, b = profile[i]!, c = crossing.profile![j - 1]!, d = crossing.profile![j]!;
        const dx = b[0] - a[0], dz = b[2] - a[2], ex = d[0] - c[0], ez = d[2] - c[2];
        const det = dx * ez - dz * ex;
        if (Math.abs(det) < 1e-8) continue;
        const t = ((c[0] - a[0]) * ez - (c[2] - a[2]) * ex) / det;
        const u = ((c[0] - a[0]) * dz - (c[2] - a[2]) * dx) / det;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const at = distances[i - 1]! + (distances[i]! - distances[i - 1]!) * t;
        const radius = (metric(crossing.tags.width) ?? 2.5) / 2 + 1;
        gaps.push([Math.max(0, at - radius), Math.min(total, at + radius)]); crossingGaps++;
      }
    }
    const lanes = laneCounts(road.tags);
    return {
      id: road.id, osmWay: road.osmWay, name: road.tags.name ?? '', highway: road.tags.highway!,
      points: rounded(profile.map(([x, y, z]) => [x, y + .1, z])), width: round(road.width),
      forward: lanes.forward, backward: lanes.backward, shared: lanes.shared, inferredLanes: lanes.inferred,
      oneway: lanes.backward === 0 ? 1 : lanes.forward === 0 ? -1 : 0,
      // These streets already have source sidewalk meshes. Inferred shoulders
      // at the driving-lane edge would place concrete strips inside the street.
      ...pavementSidewalkTags(road,mappedPavementRoads),
      surface: road.tags.surface ?? 'unknown', markingRanges: allowed(total, gaps),
    };
  });
  const roadIndex = new SpatialIndex<Road>(32);
  for (const road of drivable) roadIndex.add(bounds(road.profile!, road.width / 2), road);
  const trackHeight = (x: number, z: number) => {
    let distance = Infinity, height = carved.sample(x, z) + .1;
    for (const road of roadIndex.query([x, z, x, z])) {
      const near = nearest(road.profile!, lengths(road.profile!), x, z);
      if (near.distance <= road.width / 2 && near.distance < distance) { distance = near.distance; height = surfaceHeight(road, carved, x, z); }
    }
    return height;
  };
  // Reuse source clipping/projection while retaining original railway IDs and tags.
  const railWays = osm.elements.filter(e => e.type === 'way' && e.tags?.railway === 'tram'
    && e.tags.tunnel !== 'yes' && (!e.tags.layer || e.tags.layer === '0') && e.tags.bridge !== 'yes');
  const railSource: OsmExtract = { elements: railWays.map(way => ({ ...way, tags: { ...way.tags, highway: 'rail-detail' } })) };
  const railById = new Map(railWays.map(way => [way.id, way.tags!]));
  const tracks: TrackDetail[] = [];
  for (const line of extractRoads(railSource, s.bounds)) {
    const tags = railById.get(line.osmWay)!, gaugeM = Number(tags.gauge) / 1000;
    if (!Number.isFinite(gaugeM) || gaugeM < .5 || gaugeM > 2) { warnings.push(`Rail ${line.osmWay} has no supported source gauge`); continue; }
    tracks.push({ id: line.id, osmWay: line.osmWay, name: tags.name ?? '', kind: tags.cable_tram === 'cable' ? 'cable' : 'tram', gaugeM,
      points: rounded(resample(line.points.map(p => [p.x, p.z]), 2).map(([x, z]) => [x, trackHeight(x, z), z])) });
  }
  const artifact = { version: 1, frame: map.frame, bounds: s.bounds,
    sourceDigests: records.map(({ key, sha256 }) => ({ key, sha256 })),
    attribution: map.attribution.filter(item => /OpenStreetMap|terrain|elevation/i.test(item.label)),
    roads, tracks, crossings };
  // One smoke over the real source output: bounds, hill, lane directions, genuine track gauges and source-contact identity.
  for (const item of [...roads, ...tracks, ...crossings]) {
    assert(item.points.length >= 2 && item.points.every(p => p.every(Number.isFinite)), `Finite path ${item.id}`);
    assert(item.points.every(([x, , z]) => x >= s.bounds[0] - .001 && x <= s.bounds[2] + .001 && z >= s.bounds[1] - .001 && z <= s.bounds[3] + .001), `Clipped ${item.id}`);
  }
  const lombard = roads.find(road => road.osmWay === 402111597);
  let lombardBakedHeightErrorM: number | undefined;
  let lombardGraphVertexErrorM: number | undefined;
  if (area === 'lombard') {
    assert(lombard && lombard.points.length >= 150 && lombard.forward > 0 && lombard.backward === 0);
    const heights = lombard.points.map(p => p[1]); assert(Math.max(...heights) - Math.min(...heights) > 30, 'Preserve real crooked-street drop');
    assert(tracks.some(track => track.kind === 'cable' && track.gaugeM === 1.067));
    assert(crossings.some(crossing => crossing.markings === 'zebra'));
    const graphBytes = await readFile(join(s.out, map.roadGraph.path));
    assert.equal(sha256(graphBytes), map.roadGraph.sha256, 'Existing contact graph digest');
    const graph = JSON.parse(graphBytes.toString('utf8')) as RoadGraph;
    const lanes = graph.edges.filter(edge => edge.osmWay === 402111597 && edge.kind === 'lane');
    assert(lanes.length > 0);
    lombardBakedHeightErrorM = 0;
    for (const [x, y, z] of lombard.points) {
      const closest = lanes.map(lane => nearest(lane.points, lengths(lane.points), x, z)).sort((a, b) => a.distance - b.distance)[0]!;
      assert(closest.distance < .01, 'One-lane Lombard centreline must match existing contact graph');
      lombardBakedHeightErrorM = Math.max(lombardBakedHeightErrorM, Math.abs(y - closest.y));
    }
    // Graph segments are sampled at 3 m; the source visual profile retains 1 m hill curvature.
    assert(lombardBakedHeightErrorM < .05, 'Source detail must remain close to the coarser contact graph');
    lombardGraphVertexErrorM = 0;
    const detailDistances = lengths(lombard.points);
    for (const lane of lanes) for (const [x, y, z] of lane.points) {
      const point = nearest(lombard.points, detailDistances, x, z);
      assert(point.distance < .002);
      lombardGraphVertexErrorM = Math.max(lombardGraphVertexErrorM, Math.abs(y - point.y));
    }
    assert(lombardGraphVertexErrorM < .003, 'Existing graph samples must retain their source-profile height');
  }
  if (options.write === false) return artifact;
  const bytes = Buffer.from(JSON.stringify(artifact) + '\n');
  const output = resolve('web/public/art/road-details.json');
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, bytes);
  const report = { passed: true, sourceRoads: all.length, roads: roads.length, tracks: tracks.length,
    cableTracks: tracks.filter(track => track.kind === 'cable').length, crossings: crossings.length,
    markedCrossings: crossings.filter(crossing => crossing.markings !== 'no' && crossing.markings !== 'unknown').length,
    intersectionGaps, crossingGaps, lombardBakedHeightErrorM, lombardGraphVertexErrorM,
    bytes: bytes.length, gzipBytes: gzipSync(bytes).length, sha256: sha256(bytes), warnings };
  await writeFile(join(s.out, 'road-details-smoke.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  return artifact;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await prepareRoadDetails(process.argv.find(arg => arg.startsWith('--area='))?.slice(7) ?? 'lombard');
}
