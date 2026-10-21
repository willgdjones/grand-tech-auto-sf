/** Read-only map intersections from a recorded native camera; no rendered pixel is invented.
 * tools/heavy.sh node --import tsx tools/map/district-pixel-ray.mjs MAP_ROOT REPORT VIEW X,Y [X,Y...]
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Group, Mesh, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const [rootArg, reportArg, name, ...pixelArgs] = process.argv.slice(2);
assert(rootArg && reportArg && name && pixelArgs.length, 'MAP_ROOT REPORT VIEW X,Y [X,Y...] required');
const root = resolve(rootArg), reportPath = resolve(reportArg), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(join(root, 'manifest.json')), manifest = JSON.parse(manifestBytes);
const reportBytes = await readFile(reportPath), report = JSON.parse(reportBytes);
const record = report.records.find(view => view.name === name); assert(record?.passed && record.contact?.camera);
assert.equal(record.sourceBefore.manifestSha256, sha(manifestBytes));
const { matrixWorld, projectionMatrix, viewport } = record.contact.camera;
const camera = new PerspectiveCamera(); camera.matrixWorld.fromArray(matrixWorld);
camera.matrixWorldInverse.copy(camera.matrixWorld).invert(); camera.projectionMatrix.fromArray(projectionMatrix);
camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), scene = new Group(), inputs = [];
for (const chunk of manifest.chunks) {
  const asset = chunk.lods.find(lod => record.network.some(request => request.path?.endsWith(`/${lod.path}`)));
  if (!asset) continue;
  const bytes = await readFile(join(root, asset.path)); assert.equal(sha(bytes), asset.sha256);
  const loaded = await loader.parseAsync(Uint8Array.from(bytes).buffer, '');
  loaded.scene.position.set(chunk.x * 256, 0, chunk.z * 256);
  loaded.scene.traverse(object => { if (object instanceof Mesh) object.userData.sourceChunk = chunk.id; });
  scene.add(loaded.scene); inputs.push({ chunk: chunk.id, path: asset.path, sha256: asset.sha256 });
}
assert(inputs.length, 'Actual requested map meshes are available'); scene.updateMatrixWorld(true);
const ray = new Raycaster(), points = [];
for (const text of pixelArgs) {
  const [x, y] = text.split(',').map(Number);
  assert(Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x < viewport.width && y >= 0 && y < viewport.height);
  ray.setFromCamera(new Vector2(2 * (x + .5) / viewport.width - 1, 1 - 2 * (y + .5) / viewport.height), camera);
  ray.near = .05; ray.far = 500;
  const hits = ray.intersectObject(scene, true).slice(0, 6).map(hit => {
    const geometry = hit.object.geometry, face = hit.face;
    return { distance: hit.distance, point: hit.point.toArray(), chunk: hit.object.userData.sourceChunk,
      mesh: hit.object.name, faceIndex: hit.faceIndex,
      facePoints: face ? [face.a, face.b, face.c].map(index => new Vector3().fromBufferAttribute(geometry.attributes.position, index).applyMatrix4(hit.object.matrixWorld).toArray()) : [],
      faceNormal: face?.normal.toArray() };
  });
  points.push({ pixel: [x, y], ray: { origin: ray.ray.origin.toArray(), direction: ray.ray.direction.toArray() }, hits });
}
const output = resolve('artifacts/district-seams-hbyf', `pixel-rays-${name}.json`);
assert(/^[a-z0-9-]+$/.test(name));
await mkdir(resolve('artifacts/district-seams-hbyf'), { recursive: true });
await writeFile(output, JSON.stringify({ mapRoot: root, manifestSha256: sha(manifestBytes), reportPath, reportSha256: sha(reportBytes),
  view: name, camera: record.contact.camera, inputs, points,
  scope: 'Source map meshes only. Runtime kerbs, props, GPS and materials are not represented by these rays.' }, null, 2) + '\n');
console.log(JSON.stringify({ output, chunks: inputs.length, points }, null, 2));
scene.traverse(object => { if (object instanceof Mesh) {
  object.geometry.dispose(); for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
} });
