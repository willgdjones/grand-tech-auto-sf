import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { ShapeUtils, Vector2 } from 'three';
import { COMPACT_MESH_MAGIC, COMPACT_MESH_LIMIT, decodeCompactMesh, type CompactMeshGroup, type DecodedMapMesh, type MapMeshDecoder } from '../../../../shared/mapMesh';
import { buildingRecipeHeader, isBuildingRecipe, type RecipeCollision, type RecipeTriangulator } from '../../../../shared/mapRecipe';
import { MAP_JOIN_MAGIC, generateJoinFaces, isJoinRecipe, joinFaceKey, joinRecipeHeader, meshJoinFaces, type JoinFace, type JoinRecipeHeader } from '../../../../shared/mapJoinRecipe';
import { heightPredictionDecoder, isHeightPredictedMesh, predictionField } from '../../../../shared/mapHeightPredictor';
import { MAP_SURFACE_MAGIC, decodeSurfaceContainer, decodeSurfaceRecipe, decodeSurfacePlan, generateSourceSurface, surfaceHeightPrediction, surfaceXZ,
  type SurfaceGroup, type SurfaceRecipeHeader, type SurfaceSourcePlan } from '../../../../shared/mapSurfaceRecipe';
import { surfaceSourceProject, type Bounds, type MeshData, type Pavement, type Road, type Tags } from '../../../../shared/mapSurfaceSourceV1';
import { unproject } from './settings';
import { atomicWrite, digest, parseOsm } from './sources';
import { restoreMapArtifact } from '../../../../shared/mapTransport';
import { extractRoads } from './osm';
import { overlaps, polygonBounds, SpatialIndex } from './geometry';
import { districtStreetDetail } from './districts';
import { pavementExclusions, preparePavements } from './pavement';
import { writeRuntimeInventory } from './runtime';
import type { Artifact, MapManifest, Polygon, Road as SourceRoad, SourceManifest } from './types';

const zip = (bytes: Uint8Array) => gzipSync(bytes, { level: 9 }).length;
const triangulate: RecipeTriangulator = rings => ShapeUtils.triangulateShape(rings[0]!.map(p => new Vector2(p[0], p[1])), rings.slice(1).map(r => r.map(p => new Vector2(p[0], p[1]))));
export interface SurfacePlanInputs { bounds: Bounds; carve: boolean; step: 16 | 32; roads: Road[]; pavements: Pavement[] }
const preserved = (bytes: Uint8Array, reason?: string) => ({ bytes: Uint8Array.from(bytes), used: false, selectedFaces: 0, fallbackFaces: 0, planBytes: 0, reason });
function writeUint(output: number[], n: number) {
  assert(Number.isInteger(n) && n >= 0 && n <= 0xffffffff, 'MAP_SURFACE_INTEGER');
  let value = n >>> 0; while (value >= 128) { output.push((value & 127) | 128); value >>>= 7; } output.push(value);
}
function writeInt(output: number[], n: number) {
  assert(Number.isInteger(n) && n >= -0x80000000 && n <= 0x7fffffff, 'MAP_SURFACE_INTEGER');
  writeUint(output, ((n << 1) ^ (n >> 31)) >>> 0);
}
export function surfaceFrame(magic: number, header: unknown, parts: Uint8Array[]): Buffer {
  const json = Buffer.from(JSON.stringify(header)), prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(magic); prefix.writeUInt32LE(1, 4); prefix.writeUInt32LE(json.length, 8);
  return Buffer.concat([prefix, json, ...parts]);
}
/** Original source coordinates only. E7 and millimetres are accepted only when
 * their decoded doubles equal the source; all others retain Float64 bits. */
export function encodeSurfacePlan(roads: Road[], pavements: Pavement[]): Uint8Array {
  const nodes: { x: number; z: number }[] = [], identifiers = new Map<string, number>(), tags = new Map<string, number>(), palette: Tags[] = [];
  const keys = ['highway', 'footway', 'surface', 'bridge', 'tunnel', 'layer', 'crossing:island', 'motorcar', 'motor_vehicle', 'vehicle', 'access', 'area'];
  function node(key: string, x: number, z: number) {
    const found = identifiers.get(key);
    if (found !== undefined) { assert.equal(nodes[found]!.x, x); assert.equal(nodes[found]!.z, z); return found; }
    const id = nodes.length; nodes.push({ x, z }); identifiers.set(key, id); return id;
  }
  const plan: SurfaceSourcePlan = { nodes: 0, tags: palette, roads: roads.map(road => {
    const kept = Object.fromEntries(keys.filter(k => road.tags[k] !== undefined).map(k => [k, road.tags[k]!])), key = JSON.stringify(kept);
    if (!tags.has(key)) { tags.set(key, tags.size); palette.push(kept); }
    return [road.width, tags.get(key)!, road.points.map(p => node(`road:${p.id}`, p.x, p.z))];
  }), pavements: pavements.map(({ polygon }) => polygon.map(ring => ring.map(([x, z]) => node(`pavement:${x},${z}`, x, z)))) };
  plan.nodes = nodes.length;
  const coordinates: number[] = []; let lat = 0, lon = 0, mx = 0, mz = 0;
  for (const { x, z } of nodes) {
    const geo = unproject(x, z), nextLat = Math.round(geo.lat * 1e7), nextLon = Math.round(geo.lon * 1e7);
    const restored = surfaceSourceProject(nextLon / 1e7, nextLat / 1e7), nextX = Math.round(x * 1000), nextZ = Math.round(z * 1000);
    if (restored[0] === x && restored[1] === z) {
      coordinates.push(0); writeInt(coordinates, nextLat - lat); writeInt(coordinates, nextLon - lon); lat = nextLat; lon = nextLon;
    } else if (nextX / 1000 === x && nextZ / 1000 === z) {
      coordinates.push(2); writeInt(coordinates, nextX - mx); writeInt(coordinates, nextZ - mz); mx = nextX; mz = nextZ;
    } else { coordinates.push(1); const bytes = Buffer.alloc(16); bytes.writeDoubleLE(x); bytes.writeDoubleLE(z, 8); coordinates.push(...bytes); }
  }
  const header = Buffer.from(JSON.stringify(plan)), prefix = Buffer.alloc(4); prefix.writeUInt32LE(header.length);
  const bytes = Buffer.concat([prefix, header, Uint8Array.from(coordinates)]), decoded = decodeSurfacePlan(bytes);
  assert.equal(decoded.roads.length, roads.length); assert.equal(decoded.pavements.length, pavements.length);
  for (const [i, road] of roads.entries()) for (const [j, p] of road.points.entries()) {
    assert.equal(decoded.roads[i]!.points[j]!.x, p.x); assert.equal(decoded.roads[i]!.points[j]!.z, p.z);
  }
  assert.deepEqual(decoded.pavements, pavements.map(p => ({ polygon: p.polygon })));
  return bytes;
}
/** Used for exact source exceptions and for the single focused codec fixture. */
export async function encodeSurfaceFallback(groups: DecodedMapMesh[]): Promise<Uint8Array> {
  await MeshoptEncoder.ready;
  const headers: CompactMeshGroup[] = [], body: Uint8Array[] = [];
  for (const mesh of groups) {
    if (!mesh.group.triangles) continue;
    const streams = [MeshoptEncoder.encodeVertexBuffer(new Uint8Array(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength), mesh.group.vertices, 8),
      MeshoptEncoder.encodeIndexBuffer(new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength), mesh.indices.length, 4),
      MeshoptEncoder.encodeVertexBuffer(mesh.colors, mesh.group.triangles, 4)];
    headers.push({ ...mesh.group, streams: streams.map(b => b.length) as [number, number, number] }); body.push(...streams);
  }
  return surfaceFrame(COMPACT_MESH_MAGIC, headers, body);
}
function selectedMesh(mesh: DecodedMapMesh, selected: number[]): DecodedMapMesh {
  const vertices = new Map<number, number>(), xyz: number[] = [], indices: number[] = [], rgb: number[] = [];
  for (const t of selected) {
    rgb.push(...mesh.colors.subarray(t * 4, t * 4 + 4));
    for (let c = 0; c < 3; c++) {
      const old = mesh.indices[t * 3 + c]!;
      if (!vertices.has(old)) { vertices.set(old, vertices.size); xyz.push(...mesh.positions.subarray(old * 4, old * 4 + 4)); }
      indices.push(vertices.get(old)!);
    }
  }
  return { group: { ...mesh.group, vertices: vertices.size, triangles: selected.length }, positions: new Int16Array(xyz), indices: new Uint32Array(indices), colors: new Uint8Array(rgb) };
}
function xzKey(points: number[][]): string {
  const p = points.map(p => p.join(',')); return [0, 1, 2].map(r => [0, 1, 2].map(c => p[(r + c) % 3]).join(';')).sort()[0]!;
}
export function surfaceFaceMultiset(meshes: DecodedMapMesh[]): string[] {
  return meshes.flatMap(mesh => meshJoinFaces(mesh).map(face => JSON.stringify([mesh.group.name, mesh.group.translation, mesh.group.scale, joinFaceKey(face)]))).sort();
}
function packGroup(mesh: DecodedMapMesh, data: MeshData, bounds: Bounds, field: ReturnType<typeof predictionField>) {
  assert(mesh.group.name === 'terrain' || mesh.group.name === 'roads');
  const generated = surfaceXZ(data, bounds, mesh.group), source = new Map<string, number[]>();
  const point = (t: number, c: number) => { const at = mesh.indices[t * 3 + c]! * 4; return [mesh.positions[at]!, mesh.positions[at + 2]!]; };
  for (let t = 0; t < mesh.group.triangles; t++) { const key = xzKey([0, 1, 2].map(c => point(t, c))), list = source.get(key) ?? []; list.push(t); source.set(key, list); }
  const mask = new Uint8Array(Math.ceil(generated.length / 6 / 8)), heights: number[] = [], exceptions: number[] = [], colors: number[] = [], known = new Map<string, number>();
  let corner = 0, exceptionAt = 0, exceptionCount = 0, selected = 0;
  for (let t = 0; t < generated.length / 6; t++) {
    const points = [0, 1, 2].map(c => [generated[t * 6 + c * 2]!, generated[t * 6 + c * 2 + 1]!]);
    const original = source.get(xzKey(points))?.pop(); if (original === undefined) continue;
    const rotation = [0, 1, 2].find(r => points.every((p, c) => p.every((v, a) => v === point(original, (c + r) % 3)[a])));
    assert(rotation !== undefined); mask[t >> 3]! |= 1 << (t & 7); selected++;
    for (const [c, [x, z]] of points.entries()) {
      const y = mesh.positions[mesh.indices[original * 3 + (c + rotation) % 3]! * 4 + 1]!, key = `${x},${z}`, prior = known.get(key);
      if (prior === undefined) { known.set(key, y); writeInt(heights, y - surfaceHeightPrediction(x!, z!, { ...mesh.group, name: mesh.group.name }, field)); }
      else if (prior !== y) { writeUint(exceptions, corner - exceptionAt); writeInt(exceptions, y - prior); exceptionAt = corner; exceptionCount++; }
      corner++;
    }
    colors.push(...mesh.colors.subarray(original * 4, original * 4 + 3));
  }
  const selection = selected === generated.length / 6 ? new Uint8Array() : mask;
  const header: SurfaceGroup = { name: mesh.group.name, translation: mesh.group.translation, scale: mesh.group.scale,
    generatedFaces: generated.length / 6, generatedSha256: digest(new Uint8Array(generated.buffer)), selectedFaces: selected,
    maskBytes: selection.length, heightBytes: heights.length, exceptionBytes: exceptions.length, exceptionCount, colorBytes: colors.length };
  return { header, parts: [selection, Uint8Array.from(heights), Uint8Array.from(exceptions), Uint8Array.from(colors)], fallback: [...source.values()].flat() };
}
async function explicitJoinFaces(faces: JoinFace[], transform: CompactMeshGroup): Promise<Uint8Array> {
  if (!faces.length) return new Uint8Array();
  const vertices = new Map<string, number>(), xyz: number[] = [], indices: number[] = [], rgb: number[] = [];
  for (const face of faces) { rgb.push(...face.rgb, 0); for (const point of face.points) {
    const key = point.join(','); if (!vertices.has(key)) { vertices.set(key, vertices.size); xyz.push(...point, 0); } indices.push(vertices.get(key)!);
  } }
  return encodeSurfaceFallback([{ group: { ...transform, vertices: vertices.size, triangles: faces.length }, positions: new Int16Array(xyz), indices: new Uint32Array(indices), colors: new Uint8Array(rgb) }]);
}
const ineligible = (error: unknown) => error instanceof Error && /MAP_(SURFACE_(GENERATION_LIMIT|DECODE_BUDGET|PLAN_SIZE|PLAN_HEADER|INTEGER)|JOIN_(LIMIT|RANGE|SURFACES|TRANSFORM))/.test(error.message);
/** Only complete, smaller, source-identical files are adopted. Existing height
 * wrappers are decoded, and seam selections are rebuilt for the new face order. */
export async function packSurfaceRecipes(source: Uint8Array, height: Uint8Array, collisionBytes: Uint8Array, input: SurfacePlanInputs) {
  try {
    const collision = JSON.parse(new TextDecoder().decode(collisionBytes)) as RecipeCollision, field = predictionField(height);
    let bytes = source, decoder: MapMeshDecoder = MeshoptDecoder, verify = () => {};
    if (isHeightPredictedMesh(bytes)) { const restored = await heightPredictionDecoder(bytes, height, MeshoptDecoder); bytes = restored.base; decoder = restored.decoder; verify = restored.verify; }
    const join = isJoinRecipe(bytes) ? joinRecipeHeader(bytes) : undefined, base = join?.base ?? bytes;
    const building = isBuildingRecipe(base) ? buildingRecipeHeader(base) : undefined;
    const leaf = building?.fallback ?? base, original = await decodeCompactMesh(leaf, decoder);
    const extra = join?.fallback.length ? await decodeCompactMesh(join.fallback, decoder) : []; verify();
    const plan = encodeSurfacePlan(input.roads, input.pavements), generated = generateSourceSurface(plan, input);
    const groups: SurfaceGroup[] = [], parts: Uint8Array[] = [], fallback: DecodedMapMesh[] = [];
    const names = new Set<string>(); let selectedFaces = 0, fallbackFaces = 0;
    for (const mesh of original) {
      if (mesh.group.name !== 'roads' && mesh.group.name !== 'terrain') { fallback.push(mesh); continue; }
      if (names.has(mesh.group.name)) return preserved(source, 'multiple source surface groups'); names.add(mesh.group.name);
      const packed = packGroup(mesh, generated[mesh.group.name], input.bounds, field);
      if (!packed.header.selectedFaces) { fallback.push(mesh); fallbackFaces += mesh.group.triangles; continue; }
      groups.push(packed.header); parts.push(...packed.parts); selectedFaces += packed.header.selectedFaces; fallbackFaces += packed.fallback.length;
      if (packed.fallback.length) fallback.push(selectedMesh(mesh, packed.fallback));
    }
    if (!selectedFaces) return preserved(source, 'no source faces matched');
    const fallbackMesh = await encodeSurfaceFallback(fallback);
    const remaining = building ? Buffer.concat([base.subarray(0, base.length - building.fallback.length), fallbackMesh]) : fallbackMesh;
    const header: SurfaceRecipeHeader = { bounds: input.bounds, carve: input.carve, step: input.step, planBytes: plan.length, baseBytes: remaining.length,
      heightSha256: digest(height), groups };
    let candidate: Uint8Array = surfaceFrame(MAP_SURFACE_MAGIC, header, [plan, remaining, ...parts]);
    const restoredBase = await decodeSurfaceRecipe(candidate, height, MeshoptDecoder, collision, triangulate);
    if (join) {
      const before = generateJoinFaces(original);
      assert.equal(before.faces.length, join.header.generatedFaces);
      const sourceFaces = before.faces.filter((_, i) => !join.mask.length || !!(join.mask[i >> 3]! & (1 << (i & 7)))).concat(extra.flatMap(meshJoinFaces));
      const after = generateJoinFaces(restoredBase), remainingFaces = new Map<string, JoinFace[]>();
      for (const face of sourceFaces) { const key = joinFaceKey(face), list = remainingFaces.get(key) ?? []; list.push(face); remainingFaces.set(key, list); }
      const mask = new Uint8Array(Math.ceil(after.faces.length / 8)); let selected = 0;
      for (const [i, face] of after.faces.entries()) if (remainingFaces.get(joinFaceKey(face))?.pop()) { selected++; mask[i >> 3]! |= 1 << (i & 7); }
      const selection = selected === after.faces.length ? new Uint8Array() : mask;
      const rest = await explicitJoinFaces([...remainingFaces.values()].flat(), after.transform);
      const joinHeader: JoinRecipeHeader = { baseBytes: candidate.length, generatedFaces: after.faces.length, selectedFaces: selected, maskBytes: selection.length, fallbackBytes: rest.length };
      candidate = surfaceFrame(MAP_JOIN_MAGIC, joinHeader, [candidate, selection, rest]);
    }
    if (candidate.length > COMPACT_MESH_LIMIT || zip(candidate) >= zip(source)) return preserved(source, 'complete file not smaller');
    const before = await decodeSurfaceContainer(source, height, MeshoptDecoder, collision, triangulate), after = await decodeSurfaceContainer(candidate, height, MeshoptDecoder, collision, triangulate);
    assert.deepEqual(surfaceFaceMultiset(after), surfaceFaceMultiset(before), 'Surface recipe changed oriented XYZ/RGB/transform faces');
    return { bytes: Uint8Array.from(candidate), used: true, selectedFaces, fallbackFaces, planBytes: plan.length, reason: undefined };
  } catch (error) { if (ineligible(error)) return preserved(source, (error as Error).message); throw error; }
}

/** Retain complete intersecting segments and two neighbours for offset context.
 * A trimmed plan authorizes no geometry loss: every missing face stays explicit. */
function trimSourceRoads(roads: SourceRoad[], bounds: Bounds): SourceRoad[] {
  return roads.flatMap(road => {
    const pad = road.width + 24, expanded: Bounds = [bounds[0] - pad, bounds[1] - pad, bounds[2] + pad, bounds[3] + pad];
    let first = Infinity, last = -Infinity;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!, b = road.points[i]!;
      if (overlaps([Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z)], expanded)) { first = Math.min(first, i - 1); last = Math.max(last, i); }
    }
    return Number.isFinite(first) ? [{ ...road, points: road.points.slice(Math.max(0, first - 2), last + 3) }] : [];
  });
}
/** d5-only isolated map conversion. Announce on Agent Mail, run via heavy.sh. */
export async function convertSurfaceMap(input: string | undefined, destination: string | undefined, optIn: string | undefined) {
  assert(input && destination && optIn === '--experimental-compact-map', 'Usage: tools/heavy.sh npx tsx tools/map/compact-surfaces.mts SOURCE NEW_OUTPUT --experimental-compact-map');
  const root = await realpath(input), output = resolve(destination);
  assert(output !== root && !root.startsWith(output + sep) && !output.startsWith(root + sep), 'Use a separate output directory');
  const sourceManifest = await readFile(join(root, 'manifest.json')), manifest = JSON.parse(sourceManifest.toString()) as MapManifest;
  assert.equal(manifest.version, 1); assert.deepEqual(manifest.requiredFeatures, ['compactMapAssets']);
  assert.equal(manifest.chunkSize, 256);
  const previousBytes = await readFile(join(root, 'transport-report.json')), previous = JSON.parse(previousBytes.toString()) as { sourceRoot: string };
  assert.equal(typeof previous.sourceRoot, 'string');
  const before = JSON.parse(await readFile(join(root, 'runtime-inventory.json'), 'utf8')) as { gzipBytes: number };
  async function raw(artifact: Artifact): Promise<Buffer> {
    assert(resolve(output, artifact.path).startsWith(output + sep), 'Artifact escapes destination');
    const path = await realpath(join(root, artifact.path)); assert(path.startsWith(root + sep), 'Artifact escapes source');
    const bytes = await readFile(path); assert.equal(bytes.length, artifact.bytes); assert.equal(digest(bytes), artifact.sha256, artifact.path); return bytes;
  }
  const sources = JSON.parse(await readFile(join(previous.sourceRoot, 'sources.json'), 'utf8')) as SourceManifest;
  const osmSource = sources.records.find(r => r.key === 'osm-pbf-normalized' || r.key === 'osm');
  assert(osmSource && manifest.sourceDigests.some(r => r.key === osmSource.key && r.sha256 === osmSource.sha256));
  const cacheRoot = await realpath('tools/map/out/cache/sf'), osmPath = await realpath(join(cacheRoot, osmSource.file));
  assert(osmPath.startsWith(cacheRoot + sep));
  const osmBytes = await readFile(osmPath); assert.equal(digest(osmBytes), osmSource.sha256);
  const osm = parseOsm(osmBytes), roads = extractRoads(osm, manifest.bounds), district = districtStreetDetail(roads), roadIndex = new SpatialIndex<SourceRoad>(256);
  for (const road of roads) { const bounds = polygonBounds([road.points.map(p => [p.x, p.z])]), pad = road.width + 4;
    roadIndex.add([bounds[0] - pad, bounds[1] - pad, bounds[2] + pad, bounds[3] + pad], road); }
  // Source collision rings delimit known building exclusions. Retaining only
  // exact matched faces makes missing/off-street exclusions an explicit fallback.
  const buildingPolygons = new Map<string, Polygon>();
  for (const chunk of manifest.chunks) {
    const collision = JSON.parse(new TextDecoder().decode(await restoreMapArtifact(Uint8Array.from(await raw(chunk.collision)).buffer, chunk.collision, 'collision', true))) as {
      origin: [number, number, number]; buildings: { id: string; rings: [number, number][][] }[];
    };
    for (const building of collision.buildings) if (!buildingPolygons.has(building.id)) buildingPolygons.set(building.id,
      building.rings.map(ring => ring.map(([x, z]) => [x + collision.origin[0], z + collision.origin[2]])));
  }
  const warnings: string[] = [], pavementIndex = new SpatialIndex<ReturnType<typeof preparePavements>[number]>(256);
  const pavements = preparePavements(roads, [...pavementExclusions(osm, warnings), ...buildingPolygons.values()]);
  for (const pavement of pavements) pavementIndex.add(polygonBounds(pavement.polygon), pavement);
  console.log(JSON.stringify({ surfaceInputs: { roads: roads.length, buildingExclusions: buildingPolygons.size, pavements: pavements.length } }));
  const eligible = new Map(manifest.chunks.filter(c => c.detail === 'low').flatMap(c => c.lods.map(a => [a.path, c] as const)));
  const artifacts = [manifest.roadGraph, ...Object.values(manifest.runtime ?? {}), ...(manifest.neighbourhoods ? [manifest.neighbourhoods] : []),
    ...(manifest.coastline ? [manifest.coastline] : []), ...manifest.chunks.flatMap(c => [...c.lods, c.terrain, c.collision])];
  const done = new Map<string, Artifact>(), records: { path: string; sourceSha256: string; sha256: string; sourceGzipBytes: number; gzipBytes: number; changed: boolean; selectedFaces: number; fallbackFaces: number; reason?: string }[] = [];
  await mkdir(output); // No replacement or activation of an existing map.
  let changed = 0, selectedFaces = 0, fallbackFaces = 0, visited = 0;
  for (const artifact of artifacts) {
    const prior = done.get(artifact.path); if (prior) { Object.assign(artifact, prior); continue; }
    const source = await raw(artifact), oldGzip = await readFile(join(root, artifact.path + '.gz'));
    assert.equal(oldGzip.length, artifact.gzipBytes); assert.deepEqual(gunzipSync(oldGzip), source, artifact.path);
    let bytes: Uint8Array = source, gzip = oldGzip, meshEncoding = artifact.meshEncoding, savedFaces = 0, retainedFaces = 0, reason: string | undefined;
    const chunk = eligible.get(artifact.path);
    if (chunk) {
      const height = new Uint8Array(await restoreMapArtifact(Uint8Array.from(await raw(chunk.terrain)).buffer, chunk.terrain, 'height', true));
      const collision = new Uint8Array(await restoreMapArtifact(Uint8Array.from(await raw(chunk.collision)).buffer, chunk.collision, 'collision', true));
      const field = predictionField(height), carve = field.step === 4;
      assert(field.step === 4 || field.step === 32, 'Supported source field spacing');
      const packed = await packSurfaceRecipes(source, height, collision, { bounds: chunk.bounds, carve, step: carve ? 16 : 32,
        roads: trimSourceRoads(roadIndex.query(chunk.bounds), chunk.bounds),
        pavements: carve ? pavementIndex.query(chunk.bounds).filter(p => district.keepPavement(p)) : [] });
      reason = packed.reason;
      if (packed.used) {
        bytes = packed.bytes; gzip = gzipSync(bytes, { level: 9 }); assert(gzip.length < oldGzip.length);
        meshEncoding = 'surfaces-v1'; changed++; savedFaces = packed.selectedFaces; retainedFaces = packed.fallbackFaces;
        selectedFaces += savedFaces; fallbackFaces += retainedFaces;
      }
      visited++;
      if (visited % 100 === 0) console.log(JSON.stringify({ visited, eligible: eligible.size, changed }));
    }
    const sha256 = digest(bytes), converted: Artifact = { ...artifact, bytes: bytes.length, gzipBytes: gzip.length, sha256, ...(meshEncoding ? { meshEncoding } : {}) };
    records.push({ path: artifact.path, sourceSha256: artifact.sha256, sha256, sourceGzipBytes: artifact.gzipBytes, gzipBytes: gzip.length,
      changed: sha256 !== artifact.sha256, selectedFaces: savedFaces, fallbackFaces: retainedFaces, reason });
    await atomicWrite(join(output, artifact.path), bytes); await atomicWrite(join(output, artifact.path + '.gz'), gzip);
    done.set(artifact.path, converted); Object.assign(artifact, converted);
  }
  manifest.generator += '+surface-source-v1'; manifest.stats.budgetBytes = Math.min(manifest.stats.budgetBytes, 25_000_000);
  manifest.stats.gzipBytes = [...done.values()].reduce((sum, a) => sum + a.gzipBytes, 0); manifest.stats.withinBudget = manifest.stats.gzipBytes <= manifest.stats.budgetBytes;
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  await atomicWrite(join(output, 'manifest.json'), manifestBytes); await atomicWrite(join(output, 'manifest.json.gz'), gzipSync(manifestBytes, { level: 9 }));
  await writeRuntimeInventory(output, manifest);
  const inventory = JSON.parse(await readFile(join(output, 'runtime-inventory.json'), 'utf8')) as { gzipBytes: number; withinMapBudget: boolean };
  await atomicWrite(join(output, 'transport-report.json'), JSON.stringify({ version: 1, sourceRoot: previous.sourceRoot, inputRoot: root, outputRoot: output,
    sourceManifestSha256: digest(sourceManifest), previousTransportReportSha256: digest(previousBytes), implementationSha256: digest(await readFile(new URL(import.meta.url))),
    requiresFeature: 'compactMapAssets', chunks: manifest.chunks.length, sourceDigests: manifest.sourceDigests, osmSha256: osmSource.sha256,
    surfaceRecipes: { eligible: eligible.size, changed, selectedFaces, fallbackFaces, everyOrientedXYZRGBTransformFaceExact: true },
    sourceInputs: { roads: roads.length, buildingExclusions: buildingPolygons.size, pavements: pavements.length, warnings: warnings.length },
    unchangedArtifacts: records.filter(r => !r.changed).length, beforeGzipBytes: before.gzipBytes, afterGzipBytes: inventory.gzipBytes,
    savedGzipBytes: before.gzipBytes - inventory.gzipBytes, withinMapBudget: inventory.withinMapBudget,
    note: 'Complete isolated source-plan conversion. All raw/gzip inputs verified, changed oriented geometry/RGB/transforms compared in full; original unmatched faces and every nonmesh asset retained. No activation, publication, browser, visual or device acceptance. Browser check belongs to pane6 under the founder Check budget.', records,
  }, null, 2) + '\n');
  assert(changed > 0 && inventory.gzipBytes < before.gzipBytes, 'No measured whole-map saving');
  console.log(JSON.stringify({ output, changed, gzipBytes: inventory.gzipBytes, savedGzipBytes: before.gzipBytes - inventory.gzipBytes, withinMapBudget: inventory.withinMapBudget }));
}
