/** Bake Muni 39 streets/stops from OSM; runtime makes no transit-provider requests. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { project } from '../map/src/pipeline/settings';
import { loadCableGround } from './profile-ground';

type XYZ = [number, number, number];
interface Geo { lat: number; lon: number }
interface Member extends Partial<Geo> { type: string; ref: number; role: string; geometry?: Geo[] }
interface Element extends Partial<Geo> { type: string; id: number; tags?: Record<string, string>; members?: Member[]; geometry?: Geo[] }
interface Extract { elements: Element[]; remark?: string; osm3s?: { timestamp_osm_base?: string } }
const sourceRoot = 'artifacts/muni/source', endpoint = 'https://overpass-api.de/api/interpreter';
const query = '[out:json][timeout:45];relation(id:2007467,2005406);(._;>;);out body geom;';
const mapAt = process.argv.indexOf('--map'), mapDirectory = process.argv[mapAt + 1];
assert(mapAt >= 0 && mapDirectory && !mapDirectory.startsWith('--'), '--map requires the existing baked city map');
const outputAt = process.argv.indexOf('--output');
const output = outputAt < 0 ? 'shared/transit/muniRoutes.ts' : process.argv[outputAt + 1];
assert(output && !output.startsWith('--'), '--output requires a file path');
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const round = (value: number) => Math.round(value * 1000) / 1000;
const distance = (a: XYZ, b: XYZ) => Math.hypot(b[0] - a[0], b[2] - a[2]);
await mkdir(sourceRoot, { recursive: true });
let bytes: string;
try { bytes = await readFile(join(sourceRoot, 'route-osm.json'), 'utf8'); }
catch (error) {
  if (!process.argv.includes('--fetch')) throw error;
  const response = await fetch(endpoint, { method: 'POST', headers: {
    'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'GTASF-map/0.1 (gtasf.com)',
  }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(55_000) });
  assert(response.ok, `OSM response ${response.status}`); bytes = await response.text();
  const result = JSON.parse(bytes) as Extract;
  assert(!result.remark && result.elements?.length, 'Complete route source');
  await writeFile(join(sourceRoot, 'route-osm.json'), bytes);
}
const source = JSON.parse(bytes) as Extract;
assert(!source.remark && source.elements?.length, 'Complete cached route source');
const elements = new Map(source.elements.map(element => [`${element.type}/${element.id}`, element]));
const relations = [2005406, 2007467].map(id => {
  const relation = elements.get(`relation/${id}`);
  assert(relation?.members?.length && relation.tags?.ref === '39' && relation.tags.route === 'bus', `Muni 39 relation ${id}`);
  return relation;
});
const geometry = relations.flatMap(route => route.members!.filter(m => m.type === 'way' && !m.role.startsWith('platform'))
  .flatMap(member => member.geometry ?? []));
assert(geometry.length && geometry.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)), 'Complete road geometry');
const projected = geometry.map(point => project(point.lon, point.lat));
const ground = await loadCableGround(mapDirectory, [Math.min(...projected.map(p => p[0])) - 8, Math.min(...projected.map(p => p[1])) - 8,
  Math.max(...projected.map(p => p[0])) + 8, Math.max(...projected.map(p => p[1])) + 8]);

function cumulative(points: XYZ[]): number[] {
  const values = [0];
  for (let i = 1; i < points.length; i++) values.push(values[i - 1]! + distance(points[i - 1]!, points[i]!));
  return values;
}
function projectStop(points: XYZ[], lengths: number[], position: XYZ, platform: XYZ | undefined, after: number) {
  let best = { score: Infinity, distance: Infinity, atM: 0, point: points[0]!, segment: 0 };
  for (let i = 1; i < points.length; i++) {
    if (lengths[i]! <= after) continue;
    const a = points[i - 1]!, b = points[i]!, dx = b[0] - a[0], dz = b[2] - a[2];
    const t = Math.max(0, Math.min(1, ((position[0] - a[0]) * dx + (position[2] - a[2]) * dz) / (dx * dx + dz * dz || 1)));
    const atM = lengths[i - 1]! + distance(a, b) * t;
    if (atM <= after) continue;
    const point: XYZ = [a[0] + dx * t, a[1] + (b[1] - a[1]) * t, a[2] + dz * t], d = distance(point, position);
    // The inbound Union Street out-and-back shares road-center stop nodes.
    // Its paired sidewalk platform identifies which pass/direction serves each stop.
    const score = d + (platform ? distance(point, platform) * .25 : 0);
    if (score < best.score) best = { score, distance: d, atM, point, segment: i };
  }
  return best;
}

const routes = relations.map((relation, index) => {
  const members = relation.members!, stopMembers = members.filter(m => m.type === 'node' && m.role.startsWith('stop'));
  assert.equal(stopMembers.length, index === 0 ? 17 : 22, 'Stops agree with the current SFMTA route description');
  const first = elements.get(`node/${stopMembers[0]!.ref}`)!;
  const [firstX, firstZ] = project(first.lon!, first.lat!);
  const center: XYZ[] = [], offsets: number[] = [], streets = new Set<string>();
  const remaining = members.filter(m => m.type === 'way' && !m.role.startsWith('platform'));
  while (remaining.length) {
    const previous = center.at(-1) ?? [firstX, 0, firstZ];
    // A recently split OSM way may be inserted next to, rather than before, its
    // predecessor. Join exact road endpoints, retaining member order at branches.
    let next = 0, closest = Infinity;
    for (const [i, candidate] of remaining.entries()) {
      assert(candidate.geometry && candidate.geometry.length > 1, `Road geometry ${candidate.ref}`);
      const endpoints = [candidate.geometry[0]!, candidate.geometry.at(-1)!].map(p => {
        const [x, z] = project(p.lon, p.lat); return [x, 0, z] as XYZ;
      });
      const d = Math.min(...endpoints.map(point => distance(previous, point)));
      if (d < closest - .001) { closest = d; next = i; }
    }
    const member = remaining.splice(next, 1)[0]!;
    const way = elements.get(`way/${member.ref}`)!;
    assert(member.geometry && member.geometry.length > 1, `Road geometry ${member.ref}`);
    if (way.tags?.name) streets.add(way.tags.name);
    let segment = member.geometry.map(p => { const [x, z] = project(p.lon, p.lat); return [x, 0, z] as XYZ; });
    if (distance(previous, segment.at(-1)!) < distance(previous, segment[0]!)) segment = segment.reverse();
    if (center.length) assert(distance(previous, segment[0]!) < .5, `Continuous route ${relation.id}, way ${member.ref}`);
    // Right side of two-way streets; one-way road geometry already identifies its carriageway.
    const offset = way.tags?.oneway === 'yes' || way.tags?.junction === 'roundabout' ? 0 : 1.4;
    for (const b of segment) {
      const a = center.at(-1);
      if (!a) { center.push(b); offsets.push(offset); continue; }
      const length = distance(a, b); if (length < .01) continue;
      const count = Math.ceil(length / 2.5);
      for (let k = 1; k <= count; k++) {
        center.push([a[0] + (b[0] - a[0]) * k / count, 0, a[2] + (b[2] - a[2]) * k / count]); offsets.push(offset);
      }
    }
  }
  let points = center.map((point, i): XYZ => {
    const a = center[Math.max(0, i - 1)]!, b = center[Math.min(center.length - 1, i + 1)]!;
    const dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz) || 1;
    const neighbours = offsets.slice(Math.max(0, i - 2), i + 3), offset = neighbours.reduce((sum, n) => sum + n, 0) / neighbours.length;
    return [point[0] - dz / length * offset, 0, point[2] + dx / length * offset];
  });
  for (const [i, point] of points.entries()) {
    const a = points[Math.max(0, i - 1)]!, b = points[Math.min(points.length - 1, i + 1)]!;
    point[1] = ground.sample(point[0], point[2], b[0] - a[0], b[2] - a[2]);
    for (let axis = 0; axis < 3; axis++) point[axis] = round(point[axis]!);
  }
  const lengths = cumulative(points);
  let after = -1;
  const stops = stopMembers.map((member, order) => {
    const node = elements.get(`node/${member.ref}`)!;
    assert(node.tags?.name && Number.isFinite(node.lat) && Number.isFinite(node.lon), `Named stop ${member.ref}`);
    const next = members[members.indexOf(member) + 1];
    const platform = next?.role.startsWith('platform') ? elements.get(`${next.type}/${next.ref}`) : undefined;
    let hint: XYZ | undefined;
    if (Number.isFinite(platform?.lon) && Number.isFinite(platform?.lat)) {
      const [x, z] = project(platform!.lon!, platform!.lat!); hint = [x, 0, z];
    }
    const [x, z] = project(node.lon!, node.lat!), found = projectStop(points, lengths, [x, 0, z], hint, after);
    assert(found.distance < 5, `Stop ${member.ref} lies on its ordered route: ${found.distance}m`);
    after = found.atM + .1;
    return { id: `${member.ref}-${order}`, osmNode: member.ref, name: node.tags.name, atM: found.atM, point: found.point, segment: found.segment };
  });
  // Relation ways may extend past terminal stops. The actual first/last stops define each direction.
  const start = stops[0]!, end = stops.at(-1)!, startM = start.atM;
  points = [start.point, ...points.slice(start.segment, end.segment), end.point].filter((point, i, all) => i === 0 || distance(point, all[i - 1]!) > .01);
  let maximumGrade = 0;
  for (let i = 1; i < points.length; i++) maximumGrade = Math.max(maximumGrade, Math.abs(points[i]![1] - points[i - 1]![1]) / distance(points[i - 1]!, points[i]!));
  assert(maximumGrade < .4, `Continuous road height ${relation.id}: grade ${maximumGrade}`);
  return { id: index === 0 ? '39-outbound' : '39-inbound', line: '39', relation: relation.id, title: 'Muni 39 Coit',
    destination: index === 0 ? 'Coit Tower' : "Fisherman’s Wharf", streets: [...streets], points,
    stops: stops.map(({ segment: _segment, ...stop }) => ({ ...stop, atM: round(stop.atM - startM), point: stop.point.map(round) as XYZ })),
    lengthM: round(cumulative(points).at(-1)!), maximumGrade };
});
const provenance = { osm: { endpoint, query, sha256: sha(bytes), timestamp: source.osm3s?.timestamp_osm_base },
  routeReference: 'https://www.sfmta.com/routes/39-coit', routeReferenceChecked: '2026-10-03',
  attribution: '© OpenStreetMap contributors — ODbL', mapSurface: ground.provenance,
  schedule: 'Fictional accelerated in-game service; no real-world arrival predictions.' };
const data = routes.map(({ points, ...route }) => `${JSON.stringify(route).slice(0, -1)},"points":[\n${points.map(point => `  ${JSON.stringify(point)}`).join(',\n')}\n]}`).join(',\n');
await writeFile(output, `/** Generated by tools/transit/prepare-muni-routes.ts. © OpenStreetMap contributors — ODbL. */\nexport interface MuniRoute { id: string; line: string; relation: number; title: string; destination: string; streets: readonly string[]; points: readonly (readonly [number, number, number])[]; stops: readonly { id: string; osmNode: number; name: string; atM: number; point: readonly [number, number, number] }[]; lengthM: number; maximumGrade: number }\nexport const muniRouteProvenance = ${JSON.stringify(provenance)};\nexport const muniRoutes: readonly MuniRoute[] = [\n${data}\n];\n`);
const report = { passed: true, routes: routes.map(route => ({ id: route.id, points: route.points.length, stops: route.stops.length,
  lengthM: route.lengthM, maximumGrade: route.maximumGrade, riseM: Math.max(...route.points.map(p => p[1])) - Math.min(...route.points.map(p => p[1])) })), provenance };
await writeFile('artifacts/muni/route-bake.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, routes: report.routes }));
