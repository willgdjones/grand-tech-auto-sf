import polygonClipping from 'polygon-clipping';
import { canonicalJson } from '../canonical';
import type { Bbox, Source } from './lock';

type Point = [number, number];
type Geometry =
  | { type: 'Point'; coordinates: Point }
  | { type: 'LineString'; coordinates: Point[] }
  | { type: 'MultiLineString' | 'Polygon'; coordinates: Point[][] }
  | { type: 'MultiPolygon'; coordinates: Point[][][] };
interface Element {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags: Record<string, string>;
  point?: Point;
  line?: Point[];
  members?: { role: string; line: Point[] }[];
}
interface Family {
  name: string;
  keys: string[];
  matches: (e: Element) => boolean;
}
const tag =
  (key: string, value: string) =>
  (e: Element): boolean =>
    e.tags[key] === value;
export const OSM_FAMILIES: readonly Family[] = [
  { name: 'streets', keys: ['highway', 'name'], matches: (e) => e.type === 'way' && Boolean(e.tags.highway) },
  {
    name: 'crossings',
    keys: ['highway', 'footway', 'crossing'],
    matches: (e) =>
      (e.type === 'node' && e.tags.highway === 'crossing') ||
      (e.type === 'way' && e.tags.footway === 'crossing'),
  },
  { name: 'subway-entrances', keys: ['railway', 'direction'], matches: tag('railway', 'subway_entrance') },
  { name: 'street-lamps', keys: ['highway', 'direction'], matches: tag('highway', 'street_lamp') },
  { name: 'bus-stops', keys: ['highway'], matches: tag('highway', 'bus_stop') },
  { name: 'traffic-signals', keys: ['highway', 'direction'], matches: tag('highway', 'traffic_signals') },
  { name: 'hydrants', keys: ['emergency'], matches: tag('emergency', 'fire_hydrant') },
  { name: 'benches', keys: ['amenity', 'direction'], matches: tag('amenity', 'bench') },
  { name: 'bollards', keys: ['barrier'], matches: tag('barrier', 'bollard') },
  { name: 'waste-baskets', keys: ['amenity'], matches: tag('amenity', 'waste_basket') },
  { name: 'trees', keys: ['natural'], matches: tag('natural', 'tree') },
  {
    name: 'buildings-crosscheck',
    keys: ['building', 'building:levels'],
    matches: (e) => e.type !== 'node' && Boolean(e.tags.building),
  },
];
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('OSM_INVALID_OBJECT');
  return value as Record<string, unknown>;
}
function point(value: unknown): Point {
  const p = record(value);
  if (
    typeof p.lon !== 'number' ||
    typeof p.lat !== 'number' ||
    !Number.isFinite(p.lon) ||
    !Number.isFinite(p.lat) ||
    Math.abs(p.lon) > 180 ||
    Math.abs(p.lat) > 90
  )
    throw new Error('OSM_INVALID_COORDINATES');
  return [p.lon, p.lat];
}
function line(value: unknown): Point[] {
  if (!Array.isArray(value) || value.length < 2) throw new Error('OSM_MISSING_GEOMETRY');
  return value.map(point);
}
function elements(raw: unknown): Element[] {
  const data = record(raw);
  if (!Array.isArray(data.elements) || data.remark) throw new Error('OSM_INCOMPLETE_EXTRACT');
  const seen = new Set<string>();
  return data.elements
    .map((value: unknown): Element => {
      const e = record(value);
      if (
        (e.type !== 'node' && e.type !== 'way' && e.type !== 'relation') ||
        !Number.isSafeInteger(e.id) ||
        Number(e.id) <= 0
      )
        throw new Error('OSM_INVALID_ID');
      const key = `${e.type}/${String(e.id)}`;
      if (seen.has(key)) throw new Error(`OSM_DUPLICATE_ID(${key})`);
      seen.add(key);
      const tags = record(e.tags ?? {});
      if (Object.values(tags).some((value) => typeof value !== 'string')) throw new Error('OSM_INVALID_TAG');
      const result: Element = { type: e.type, id: e.id as number, tags: tags as Record<string, string> };
      if (e.type === 'node') result.point = point(e);
      if (e.type === 'way') result.line = line(e.geometry);
      if (e.type === 'relation') {
        if (!Array.isArray(e.members)) throw new Error('OSM_MISSING_MEMBERS');
        result.members = e.members.flatMap((value: unknown) => {
          const member = record(value);
          if (member.type !== 'way') return [];
          if (member.role !== 'outer' && member.role !== 'inner' && member.role !== '') return [];
          return [{ role: member.role === 'inner' ? 'inner' : 'outer', line: line(member.geometry) }];
        });
      }
      return result;
    })
    .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.id - b.id));
}
const same = (a: Point, b: Point): boolean => a[0] === b[0] && a[1] === b[1];
const rounded = (p: Point): Point => [Number(p[0].toFixed(7)), Number(p[1].toFixed(7))];
const inside = (p: Point, b: Bbox): boolean => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];

/** Liang–Barsky clips each segment, preserving disconnected pieces rather than joining across the box. */
function clipLine(points: Point[], bbox: Bbox): Point[][] {
  const result: Point[][] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    let start = 0,
      end = 1,
      keep = true;
    for (const [p, q] of [
      [-dx, a[0] - bbox[0]],
      [dx, bbox[2] - a[0]],
      [-dy, a[1] - bbox[1]],
      [dy, bbox[3] - a[1]],
    ] as [number, number][]) {
      if (p === 0) {
        if (q < 0) keep = false;
        continue;
      }
      const t = q / p;
      if (p < 0) start = Math.max(start, t);
      else end = Math.min(end, t);
    }
    if (!keep || start > end) continue;
    const from = rounded([a[0] + start * dx, a[1] + start * dy]);
    const to = rounded([a[0] + end * dx, a[1] + end * dy]);
    if (same(from, to)) continue;
    const previous = result.at(-1);
    if (previous && same(previous.at(-1)!, from)) previous.push(to);
    else result.push([from, to]);
  }
  return result;
}
function rings(parts: Point[][]): Point[][] {
  const remaining = parts.map((part) => [...part]);
  const result: Point[][] = [];
  while (remaining.length) {
    const current = remaining.shift()!;
    while (!same(current[0]!, current.at(-1)!)) {
      const end = current.at(-1)!;
      const index = remaining.findIndex((part) => same(part[0]!, end) || same(part.at(-1)!, end));
      if (index < 0) throw new Error('OSM_UNCLOSED_BUILDING_RELATION');
      const next = remaining.splice(index, 1)[0]!;
      if (!same(next[0]!, end)) next.reverse();
      current.push(...next.slice(1));
    }
    if (current.length < 4) throw new Error('OSM_INVALID_BUILDING_RING');
    result.push(current);
  }
  return result;
}
function building(e: Element, bbox: Bbox): Geometry | undefined {
  let polygons: Point[][][];
  if (e.line) polygons = rings([e.line]).map((ring) => [ring]);
  else {
    const members = e.members ?? [];
    const outers = rings(members.filter((m) => m.role === 'outer').map((m) => m.line));
    const inners = rings(members.filter((m) => m.role === 'inner').map((m) => m.line));
    if (!outers.length) throw new Error('OSM_BUILDING_MISSING_OUTER');
    polygons = polygonClipping.union(
      ...(outers.map((ring): Point[][] => [ring]) as [Point[][], ...Point[][][]]),
    );
    if (inners.length) polygons = polygonClipping.difference(polygons, ...inners.map((ring) => [ring]));
  }
  const [x0, y0, x1, y1] = bbox;
  const clipped = polygonClipping.intersection(polygons, [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
  ]);
  // Re-normalize after rounding: sub-centimetre slivers may collapse at export precision.
  const snapped = clipped.map((polygon) => polygon.map((ring) => ring.map(rounded)));
  if (!snapped.length) return undefined;
  const normalized = polygonClipping.union(snapped);
  if (!normalized.length) return undefined;
  return normalized.length === 1
    ? { type: 'Polygon', coordinates: normalized[0]! }
    : { type: 'MultiPolygon', coordinates: normalized };
}
function geometry(e: Element, bbox: Bbox, isBuilding: boolean): Geometry | undefined {
  if (isBuilding) return building(e, bbox);
  if (e.point) return inside(e.point, bbox) ? { type: 'Point', coordinates: rounded(e.point) } : undefined;
  if (e.line) {
    const lines = clipLine(e.line, bbox);
    return lines.length === 0
      ? undefined
      : lines.length === 1
        ? { type: 'LineString', coordinates: lines[0]! }
        : { type: 'MultiLineString', coordinates: lines };
  }
  return undefined;
}
function coordinateJson(value: number | readonly unknown[]): string {
  if (typeof value === 'number') return value.toFixed(7);
  return `[${value.map((item) => coordinateJson(item as number | readonly unknown[])).join(',')}]`;
}
/** Emit only allowlisted fields; raw tags never enter an output object. */
export function exportOsm(raw: unknown, source: Source): Map<string, string> {
  if (source.id !== 'osm-extract' || !source.osmExportBbox || !source.extractDate)
    throw new Error('OSM_SOURCE_REQUIRED');
  if (record(raw).osm3s !== undefined && osmExtractDate(raw) !== source.extractDate)
    throw new Error('OSM_EXTRACT_DATE_MISMATCH');
  const input = elements(raw);
  const output = new Map<string, string>();
  for (const family of OSM_FAMILIES) {
    const features: string[] = [];
    for (const e of input) {
      if (!family.matches(e)) continue;
      const shape = geometry(e, source.osmExportBbox, family.name === 'buildings-crosscheck');
      if (!shape) continue;
      const properties: Record<string, string> = { osm: `${e.type}/${e.id}` };
      for (const key of family.keys) if (Object.hasOwn(e.tags, key)) properties[key] = e.tags[key]!;
      features.push(
        `{"type":"Feature","geometry":{"type":${JSON.stringify(shape.type)},"coordinates":${coordinateJson(shape.coordinates)}},"properties":${canonicalJson(properties).trimEnd()}}`,
      );
    }
    output.set(`${family.name}.geojson`, `{"type":"FeatureCollection","features":[${features.join(',')}]}\n`);
  }
  output.set('LICENSE', osmLicense(source));
  return output;
}
export function osmExtractDate(raw: unknown): string {
  const timestamp = record(record(raw).osm3s).timestamp_osm_base;
  if (
    typeof timestamp !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(timestamp) ||
    !Number.isFinite(Date.parse(timestamp))
  )
    throw new Error('OSM_EXTRACT_TIMESTAMP_INVALID');
  return timestamp.slice(0, 10);
}
export function osmLicense(source: Source): string {
  return `This database is made available under the Open Database License (ODbL) 1.0.\nhttps://opendatacommons.org/licenses/odbl/1-0/\nAny rights in individual contents of the database are licensed under the Database\nContents License (DbCL) 1.0: https://opendatacommons.org/licenses/dbcl/1-0/\n\n© OpenStreetMap contributors\nhttps://www.openstreetmap.org/copyright\nSource: osm-extract; extract date: ${source.extractDate}; SHA-256: ${source.sha256}\nBounding box: ${source.osmExportBbox?.join(', ')} (WGS84 longitude, latitude).\n\nTransformations: tools/layout/src/stages/fetch.ts and tools/layout/src/fetch/osm.ts;\nsee tools/layout/docs/fetch.md. Selected feature families, allowlisted tags only,\nclipped to the pinned box, coordinates rounded to seven decimal places.\nBuyer creatives and original project artwork are not part of this database.\n`;
}
