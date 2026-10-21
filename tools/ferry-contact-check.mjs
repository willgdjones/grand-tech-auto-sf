/** Offline current-map diagnosis. No browser/build/server or app mutation.
 * Run at the agreed CPU boundary: node --import tsx tools/ferry-contact-check.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { readGlb } from './map/src/glb.ts';
import { SpatialIndex } from './map/src/pipeline/geometry.ts';
import { decodePackedRoadGraph } from '../shared/roadgraphPacked.ts';
import { decodeHeightfield, sampleHeight, createRoadSampler } from '../web/src/render/chunks/terrain.ts';
import { createPlacedLandmarks, updateLandmarkTerrain, withLandmarkSurfaces, disposeLandmark } from '../web/src/render/landmarks/landmarks.ts';
import { FERRY_PEDESTRIAN_ROUTES } from '../web/src/render/ferryPedestrians.ts';
import { COFFEE_CART, COFFEE_QUEUE, COFFEE_YIELD_DISTANCE, COFFEE_CART_EXTENTS } from '../web/src/render/coffeeQueue.ts';
import { FERRY_APRON } from '../web/src/render/landmarks/ferryApron.ts';
import { RenderedGroundIndex } from '../web/src/render/chunks/renderedGround.ts';

const root = resolve(process.env.GTASF_CONTACT_MAP ?? 'tools/map/out/sf');
const nativePath = resolve(process.env.GTASF_CONTACT_NATIVE ?? 'artifacts/ferry-pedestrians/game-1341/report.json');
const output = resolve(process.env.GTASF_CONTACT_OUT ?? 'artifacts/ferry-contact/baseline.json');
// Explicit offline candidate sampling does not change the source or running game.
const coffeeCandidate = process.env.GTASF_CONTACT_COFFEE_CANDIDATE ? JSON.parse(process.env.GTASF_CONTACT_COFFEE_CANDIDATE) : null;
const coffee = coffeeCandidate ?? { cart: COFFEE_CART, queue: COFFEE_QUEUE, yieldDistance: COFFEE_YIELD_DISTANCE };
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const native = await json(nativePath), source = await json(resolve(dirname(native.app), 'source.json'));
const manifestBytes = await readFile(resolve(root, 'manifest.json')), manifest = JSON.parse(manifestBytes);
assert.equal(digest(manifestBytes), source.assetHashes['tools/map/out/sf/manifest.json']);
const graphBytes = await readFile(resolve(root, manifest.roadGraph.path));
assert.equal(digest(graphBytes), manifest.roadGraph.sha256);
assert.equal(manifest.roadGraph.sha256, source.assetHashes['tools/map/out/sf/roadgraph.bin']);
const packed = decodePackedRoadGraph(Uint8Array.from(graphBytes));
const actors = native.views.flatMap(view => view.actors);
assert.ok(native.passed && actors.length);
const city = createPlacedLandmarks({ enabled: true, ids: ['ferry-building'], heightAt: () => actors[0].position[1] });
const ferry = city.children[0]; city.updateMatrixWorld(true);
const initialMatrixError = Math.max(...actors.map(actor => new Vector3(...actor.local).applyMatrix4(ferry.matrixWorld).distanceTo(new Vector3(...actor.position))));
assert.ok(initialMatrixError < 1e-6, 'Current factory must reproduce the recorded native transform');
const paving = ferry.userData.walkableSurfaces[0];
const corners = [[paving.minX, paving.minZ], [paving.maxX, paving.minZ], [paving.maxX, FERRY_APRON.maxZ], [paving.minX, FERRY_APRON.maxZ]]
  .map(([x, z]) => ferry.localToWorld(new Vector3(x, 0, z)));
const bounds = [Math.min(...corners.map(p => p.x)), Math.min(...corners.map(p => p.z)), Math.max(...corners.map(p => p.x)), Math.max(...corners.map(p => p.z))];
const emitted = [0, 1].map(() => new RenderedGroundIndex([{ minX: bounds[0], minZ: bounds[1], maxX: bounds[2], maxZ: bounds[3] }]));
const emittedRoots = [], emittedMaterial = new MeshBasicMaterial();
const roads = [];
for (let i = 0; i < packed.counts.edges; i++) {
  const c = packed.columns, from = c.edgeFrom[i] * 3, to = c.edgeTo[i] * 3;
  if (Math.max(c.nodeXYZ[from], c.nodeXYZ[to]) / 100 < bounds[0] - 100 || Math.min(c.nodeXYZ[from], c.nodeXYZ[to]) / 100 > bounds[2] + 100
    || Math.max(c.nodeXYZ[from + 2], c.nodeXYZ[to + 2]) / 100 < bounds[1] - 100 || Math.min(c.nodeXYZ[from + 2], c.nodeXYZ[to + 2]) / 100 > bounds[3] + 100) continue;
  roads.push(packed.edge(i));
}
const roadAt = createRoadSampler({ nodes: [], edges: roads }), fields = new Map();
const indices = [0, 1].map(() => ({ roads: new SpatialIndex(16), terrain: new SpatialIndex(16) })), receipts = [];
const chunks = manifest.chunks.filter(c => (c.x + 1) * 256 >= bounds[0] && c.x * 256 <= bounds[2] && (c.z + 1) * 256 >= bounds[1] && c.z * 256 <= bounds[3]);
for (const chunk of chunks) {
  const bytes = await readFile(resolve(root, chunk.terrain.path));
  assert.equal(digest(bytes), chunk.terrain.sha256);
  fields.set(chunk.id, decodeHeightfield(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
  for (const lod of [0, 1]) {
    const artifact = chunk.lods[lod], bytes = await readFile(resolve(root, artifact.path));
    assert.equal(digest(bytes), artifact.sha256);
    const doc = await readGlb(bytes), triangles = { roads: 0, terrain: 0 }, emittedRoot = new Group();
    emittedRoot.position.set(chunk.x * 256, 0, chunk.z * 256);
    for (const node of doc.getRoot().listNodes().filter(node => ['roads', 'terrain'].includes(node.getName()))) {
      const kind = node.getName();
      const translation = node.getTranslation(), scale = node.getScale();
      assert.deepEqual(node.getRotation(), [0, 0, 0, 1]);
      for (const primitive of node.getMesh().listPrimitives()) {
        const position = primitive.getAttribute('POSITION'), array = position.getArray(), ids = primitive.getIndices().getArray();
        assert.ok(array instanceof Int16Array && position.getNormalized());
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(array, 3, true)); geometry.setIndex(new BufferAttribute(ids, 1));
        const mesh = new Mesh(geometry, emittedMaterial); mesh.name = kind;
        mesh.position.fromArray(translation); mesh.scale.fromArray(scale); emittedRoot.add(mesh);
        const vertex = i => [Math.max(-1, array[i * 3] / 32767) * scale[0] + translation[0] + chunk.x * 256,
          Math.max(-1, array[i * 3 + 1] / 32767) * scale[1] + translation[1],
          Math.max(-1, array[i * 3 + 2] / 32767) * scale[2] + translation[2] + chunk.z * 256];
        for (let i = 0; i < ids.length; i += 3) {
          const triangle = [vertex(ids[i]), vertex(ids[i + 1]), vertex(ids[i + 2])];
          indices[lod][kind].add([Math.min(...triangle.map(p => p[0])), Math.min(...triangle.map(p => p[2])), Math.max(...triangle.map(p => p[0])), Math.max(...triangle.map(p => p[2]))], triangle); triangles[kind]++;
        }
      }
    }
    const began = performance.now(); emitted[lod].setChunk(chunk.id, emittedRoot);
    receipts.push({ chunk: chunk.id, lod, path: artifact.path, sha256: artifact.sha256, triangles,
      scopedIndexBuildMs: performance.now() - began });
    emittedRoots.push(emittedRoot);
  }
}
const terrainAt = (x, z) => { const field = fields.get(`${Math.floor(x / 256)}_${Math.floor(z / 256)}`); return field ? sampleHeight(field, x, z) : null; };
const base = { heightAt(x, z) { const ground = terrainAt(x, z); return ground === null ? null : roadAt(x, z) ?? ground; } };
updateLandmarkTerrain(city, base.heightAt); city.updateMatrixWorld(true);
const matrixError = Math.max(...actors.map(actor => new Vector3(...actor.local).applyMatrix4(ferry.matrixWorld).distanceTo(new Vector3(...actor.position))));
assert.ok(matrixError < 1e-6, 'Actual current map must reproduce native landmark placement');
const surface = withLandmarkSurfaces(base, city);
function triangleHeight([a, b, c], x, z) {
  const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  if (Math.abs(denominator) < 1e-10) return null;
  const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator;
  const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator;
  return u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6 ? null : u * a[1] + v * b[1] + (1 - u - v) * c[1];
}
const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
function inspect(x, z, label) {
  const contact = surface.heightAt(x, z), road = roadAt(x, z), local = ferry.worldToLocal(new Vector3(x, contact ?? 0, z)).toArray();
  const rendered = kind => indices.map(index => index[kind].query([x, z, x, z]).map(triangle => triangleHeight(triangle, x, z))
    .filter(y => y !== null && y < (contact ?? 0) + 1.8).sort((a, b) => b - a)[0] ?? null);
  const renderedRoad = rendered('roads'), renderedTerrain = rendered('terrain');
  // Start below roofs and tree crowns: this is the walking surface, not top-down visibility.
  ray.ray.origin.set(x, (contact ?? 0) + 1.8, z);
  const pavingHit = ray.intersectObject(ferry, true)[0]?.point.y ?? null;
  // The bake cuts terrain beneath road polygons. Require actual emitted or
  // authored support, without inventing heightfield triangles in those holes.
  const visible = renderedRoad.map((y, lod) => Math.max(y ?? -Infinity, pavingHit ?? -Infinity, renderedTerrain[lod] ?? -Infinity));
  assert.ok(visible.every(Number.isFinite), 'Both LODs must have visible support at every sample');
  const renderedContact = emitted.map(index => index.heightAt(x, z));
  const independentGround = renderedRoad.map((y, lod) => Math.max(y ?? -Infinity, renderedTerrain[lod] ?? -Infinity));
  for (let lod = 0; lod < 2; lod++) if (Number.isFinite(independentGround[lod]))
    assert.ok(renderedContact[lod] !== null && Math.abs(renderedContact[lod] - independentGround[lod]) < 1e-6,
      'Runtime optional index must match independent emitted-triangle interpolation');
  return { label, world: [x, z], local, contact, laneHeight: road, renderedRoad, renderedTerrain, renderedContact,
    heightfield: terrainAt(x, z), pavingHeight: pavingHit, visible,
    contactMinusLane: road === null || contact === null ? null : contact - road,
    contactMinusVisible: visible.map(y => contact === null || !Number.isFinite(y) ? null : contact - y) };
}
const samples = [], seen = new Set();
for (const road of roads.filter(road => !road.bridge && !road.tunnel && !road.layer)) for (let i = 1; i < road.points.length; i++) {
  const a = road.points[i - 1], b = road.points[i], count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 4));
  for (let j = 0; j <= count; j++) {
    const x = a[0] + (b[0] - a[0]) * j / count, z = a[2] + (b[2] - a[2]) * j / count;
    const p = ferry.worldToLocal(new Vector3(x, 0, z)), key = `${x.toFixed(3)},${z.toFixed(3)}`;
    if (p.x < paving.minX || p.x > paving.maxX || p.z < 20 || p.z > paving.maxZ || seen.has(key)) continue;
    seen.add(key); samples.push(inspect(x, z, road.id));
  }
}
assert.ok(samples.length, 'Current road lanes must overlap the authored plaza to reproduce this issue');
const atmosphere = [];
for (const [i, route] of FERRY_PEDESTRIAN_ROUTES.entries()) for (const [x, z] of route) {
  const p = ferry.localToWorld(new Vector3(x, .18, z)); atmosphere.push(inspect(p.x, p.z, `pedestrian-${i}`));
}
for (const [i, [dx, dz]] of coffee.queue.entries()) for (let step = 0; step <= 5; step++) for (let angle = 0; angle < 16; angle++) {
  const p = ferry.localToWorld(new Vector3(coffee.cart.x + dx - coffee.yieldDistance * step / 5 + .35 * Math.cos(angle * Math.PI / 8), coffee.cart.y,
    coffee.cart.z + dz + .35 * Math.sin(angle * Math.PI / 8)));
  atmosphere.push(inspect(p.x, p.z, `coffee-${i}`));
}
for (let x = COFFEE_CART_EXTENTS.minX; x <= COFFEE_CART_EXTENTS.maxX + .001; x += (COFFEE_CART_EXTENTS.maxX - COFFEE_CART_EXTENTS.minX) / 12)
  for (let z = COFFEE_CART_EXTENTS.minZ; z <= COFFEE_CART_EXTENTS.maxZ + .001; z += (COFFEE_CART_EXTENTS.maxZ - COFFEE_CART_EXTENTS.minZ) / 8) {
    const p = ferry.localToWorld(new Vector3(coffee.cart.x + x, coffee.cart.y, coffee.cart.z + z)); atmosphere.push(inspect(p.x, p.z, 'coffee-cart'));
}
const magnitude = values => Math.max(0, ...values.filter(value => value !== null).map(Math.abs));
const summary = { samples: samples.length, laneDisagreement: magnitude(samples.map(p => p.contactMinusLane)),
  visibleDisagreement: [0, 1].map(lod => magnitude(samples.map(p => p.contactMinusVisible[lod]))),
  over10cm: samples.filter(p => Math.abs(p.contactMinusLane) > .1).length,
  over35cm: samples.filter(p => Math.abs(p.contactMinusLane) > .35).length,
  coffeeSamples: atmosphere.filter(p => p.label.startsWith('coffee')).length,
  renderedGroundTriangles: emitted.map(index => index.stats.triangles),
  renderedGroundQueries: emitted.map(index => ({ ...index.stats })),
  coffeeVisibleDisagreement: [0, 1].map(lod => magnitude(atmosphere.filter(p => p.label.startsWith('coffee')).map(p => p.contactMinusVisible[lod]))) };
const report = { checkedAt: new Date().toISOString(), nativePath, sourceCommit: source.commit, graph: manifest.roadGraph.sha256, matrixError,
  scope: 'Actual emitted road and terrain triangles at both LODs include driving and non-driving paths; authored Ferry paving is raycast below roofs. Moving actors and street props are excluded from this ground diagnosis. Heightfield contact is recorded separately from visible emitted terrain. No native or performance acceptance.',
  transform: { position: ferry.position.toArray(), yaw: ferry.rotation.y }, coffeeCandidate, receipts, summary, samples, atmosphere };
await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
disposeLandmark(city);
for (const index of emitted) index.clear();
for (const root of emittedRoots) root.traverse(object => { if (object instanceof Mesh) object.geometry.dispose(); });
emittedMaterial.dispose();
console.log(JSON.stringify({ output, matrixError, summary, worst: [...samples].sort((a, b) => Math.abs(b.contactMinusLane) - Math.abs(a.contactMinusLane)).slice(0, 5) }, null, 2));
