/** Offline real-data check for the coarse-district building occlusion/collision (gtasf-q3r6/ntcl).
 *
 * The camera occluder (world.collidesCamera) and the flag-gated player collision (world.collides)
 * both index coarse (detail:'low') chunks' rendered `buildings*` meshes into a StructureCollisionIndex.
 * That only works if the baked coarse chunks actually emit meshes named `buildings` — otherwise the
 * fix silently no-ops and the deep-link "grey box" clip is NOT fixed. Unit tests use synthetic meshes;
 * this validates the real sf bake. No browser/build/server, no app or source mutation, read-only.
 *
 *   node --import tsx tools/coarse-building-collision-check.mjs
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { readGlb } from './map/src/glb.ts';
import { StructureCollisionIndex } from '../web/src/render/chunks/structureCollision.ts';

const root = resolve(process.env.GTASF_MAP ?? 'tools/map/out/sf');
const out = resolve(process.env.GTASF_COARSE_OUT ?? 'artifacts/coarse-collision/report.json');
const want = Number(process.env.GTASF_COARSE_SAMPLE ?? 24); // coarse-with-buildings chunks to confirm
const scanCap = Number(process.env.GTASF_COARSE_SCAN ?? 200); // bound glbs read on this saturated box

const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const coarse = manifest.chunks.filter(c => c.detail === 'low');
assert.ok(coarse.length, 'expected coarse (detail:low) chunks in the sf bake');

/** Rebuild a chunk's `buildings` meshes exactly as the client mounts them (normalized Int16 +
 * node translation/scale + chunk offset), so StructureCollisionIndex sees real world-space triangles. */
function buildingsRoot(chunk, doc) {
  const group = new Group();
  group.position.set(chunk.x * 256, 0, chunk.z * 256);
  const material = new MeshBasicMaterial();
  let added = false;
  for (const node of doc.getRoot().listNodes().filter(n => n.getName() === 'buildings')) {
    const mesh3d = node.getMesh();
    if (!mesh3d) continue;
    for (const primitive of mesh3d.listPrimitives()) {
      const position = primitive.getAttribute('POSITION'), indices = primitive.getIndices();
      if (!position || !indices) continue;
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(position.getArray(), 3, position.getNormalized()));
      geometry.setIndex(new BufferAttribute(indices.getArray(), 1));
      const mesh = new Mesh(geometry, material);
      mesh.name = 'buildings';
      mesh.position.fromArray(node.getTranslation());
      mesh.scale.fromArray(node.getScale());
      group.add(mesh);
      added = true;
    }
  }
  return added ? group : null;
}

const results = [];
let scanned = 0, withBuildings = 0;
for (const chunk of coarse) {
  if (withBuildings >= want || scanned >= scanCap) break;
  scanned++;
  const bytes = await readFile(resolve(root, chunk.lods[0].path)); // lods[0]===lods[1] for coarse chunks
  const group = buildingsRoot(chunk, await readGlb(bytes));
  if (!group) continue; // coarse chunk with no >=400 m2 buildings; nothing to index (expected for many)
  withBuildings++;

  const index = new StructureCollisionIndex();
  index.setChunk(chunk.id, group, /^buildings(?:_|$)/);
  assert.ok(index.stats.triangles > 0, `coarse chunk ${chunk.id} buildings produced no collision triangles`);

  // The index must actually bite: a fat capsule on a real building vertex collides; far away is clear.
  group.updateWorldMatrix(true, true);
  const mesh = group.children.find(child => child.name === 'buildings');
  const vertex = new Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), 0).applyMatrix4(mesh.matrixWorld);
  const hit = index.collides(vertex.x, vertex.y, vertex.z, 2, 3);
  const farClear = index.collides(vertex.x + 1e4, vertex.y, vertex.z, 2, 3) === false;
  assert.ok(hit, `a capsule on a building vertex of ${chunk.id} should collide`);
  assert.ok(farClear, 'a point 10 km away must be clear');
  results.push({ chunk: chunk.id, triangles: index.stats.triangles, vertex: [vertex.x, vertex.y, vertex.z] });
}

assert.ok(withBuildings > 0,
  `no coarse chunk among ${scanned} scanned carried a buildings mesh — the q3r6/ntcl index would never bite`);

await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({
  map: root, coarseChunks: coarse.length, scanned, withBuildings, want, scanCap, results,
}, null, 2) + '\n');
console.log(`coarse-building-collision OK: ${withBuildings}/${scanned} scanned coarse chunks carry indexable buildings`
  + ` (${results.reduce((s, r) => s + r.triangles, 0)} triangles total); report -> ${out}`);
