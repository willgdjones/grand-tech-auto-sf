/** Reproduce native road pinholes, then patch only their isolated source chunks. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Document } from '@gltf-transform/core';
import { Mesh, Raycaster, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { readGlb } from './src/glb';
import { appendSurfaceJoinsToGlb } from './src/pipeline/appendSurfaceJoins';
import { validateMap } from './src/pipeline/build';
import { atomicWrite, digest } from './src/pipeline/sources';
import { writeRuntimeInventory } from './src/pipeline/runtime';
import { writeMapTransfer } from './src/pipeline/transfer';
import type { Artifact, MapManifest, XYZ } from './src/pipeline/types';

let smoke = false;
let rayPath = resolve('artifacts/district-seams-hbyf/pixel-rays-columbus-junction-desktop.json');
let root = resolve('tools/map/out/district-tm7m-columbus-gaps');
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--smoke') smoke = true;
  else if (arg === '--ray-report' && process.argv[i + 1]) rayPath = resolve(process.argv[++i]!);
  else if (arg === '--out' && process.argv[i + 1]) root = resolve(process.argv[++i]!);
  else throw new Error(`Unknown or incomplete argument: ${arg}`);
}
interface Rays {
  mapRoot: string; manifestSha256: string;
  inputs: { chunk: string; path: string; sha256: string }[];
  points: { pixel: number[]; ray: { origin: XYZ; direction: XYZ };
    hits: { distance: number; mesh: string; chunk: string }[] }[];
}
const rayBytes = await readFile(rayPath), rays = JSON.parse(rayBytes.toString()) as Rays;
const base = resolve(rays.mapRoot);
for (const path of [base, root]) {
  assert.equal(dirname(path), resolve('tools/map/out'));
  assert(/^[a-z0-9_-]+$/.test(basename(path)));
}
assert.notEqual(root, base);
const manifestBytes = await readFile(join(base, 'manifest.json'));
assert.equal(digest(manifestBytes), rays.manifestSha256);
const before = JSON.parse(manifestBytes.toString()) as MapManifest;
const targetIds = new Set(rays.points.flatMap(p => p.hits.filter(h => /^roads(?:_|$)/.test(h.mesh)).map(h => h.chunk)));
assert(targetIds.size > 0 && targetIds.size <= 4, 'Bounded neighboring road chunks required');
assert(rays.points.some(p => !p.hits.length), 'Recorded opening required');
const maximumDistance = Math.max(...rays.points.flatMap(p => p.hits.map(h => h.distance))) + 1;
const sourcePaths = ['tools/map/district-microseam-repair.mts', 'tools/map/src/glb.ts', ...[
  'appendSurfaceJoins', 'surfaceJoins', 'build', 'sources', 'runtime', 'transfer', 'types',
].map(name => `tools/map/src/pipeline/${name}.ts`)];
async function fingerprint() {
  const files = await Promise.all(sourcePaths.map(async path => ({ path, sha256: digest(await readFile(path)) })));
  return { sha256: digest(JSON.stringify(files)), files };
}
const source = await fingerprint(), startedAt = new Date().toISOString();
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
function meshSignatures(doc: Document) {
  return doc.getRoot().listNodes().map(node => ({ name: node.getName(), matrix: node.getMatrix(),
    primitives: node.getMesh()!.listPrimitives().map(p => ({ mode: p.getMode(), material: p.getMaterial()!.getName(),
      arrays: [...p.listSemantics().map(semantic => [semantic, p.getAttribute(semantic)!] as const), ['INDICES', p.getIndices()!] as const].map(([semantic, a]) => {
        const data = a.getArray()!;
        return { semantic, type: a.getType(), componentType: a.getComponentType(), normalized: a.getNormalized(),
          sha256: digest(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)) };
      }),
    })),
  }));
}
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const oldScenes: import('three').Group[] = [], newScenes: import('three').Group[] = [];
const converted = new Map<string, { bytes: Uint8Array; artifact: Artifact; trianglesAdded: number }>();
const samples: { id: string; path: string; inputSha256: string; outputSha256: string; trianglesAdded: number;
  joinedPairs: number; sourceMeshesPreserved: boolean; gzipBytes: number }[] = [];
for (const id of targetIds) {
  const chunk = before.chunks.find(c => c.id === id); assert(chunk);
  for (const lod of chunk.lods) {
    if (converted.has(lod.path)) continue;
    const input = await readFile(join(base, lod.path)); assert.equal(digest(input), lod.sha256);
    const original = meshSignatures(await readGlb(input)), result = await appendSurfaceJoinsToGlb(input);
    assert(result.trianglesAdded > 0, `Repair must add geometry: ${lod.path}`);
    const doc = await readGlb(result.bytes), restored = meshSignatures(doc);
    assert.deepEqual(restored.slice(0, original.length), original, 'All original decoded meshes preserved');
    for (const node of doc.getRoot().listNodes().slice(original.length)) for (const p of node.getMesh()!.listPrimitives()) {
      assert(p.getAttribute('POSITION')!.getCount() <= 3000);
      assert(p.listAttributes().reduce((sum, a) => sum + a.getByteLength(), 0) + p.getIndices()!.getByteLength() < 64 * 1024);
    }
    const artifact = { ...lod, bytes: result.bytes.length, gzipBytes: gzipSync(result.bytes, { level: 9 }).length, sha256: digest(result.bytes) };
    converted.set(lod.path, { bytes: result.bytes, artifact, trianglesAdded: result.trianglesAdded });
    samples.push({ id, path: lod.path, inputSha256: lod.sha256, outputSha256: artifact.sha256,
      trianglesAdded: result.trianglesAdded, joinedPairs: result.joinedPairs, sourceMeshesPreserved: true, gzipBytes: artifact.gzipBytes });
    const nativeInput = rays.inputs.find(item => item.path === lod.path);
    if (nativeInput) {
      assert.equal(nativeInput.sha256, lod.sha256);
      for (const [bytes, scenes] of [[input, oldScenes], [result.bytes, newScenes]] as const) {
        const scene = (await loader.parseAsync(Uint8Array.from(bytes).buffer, '')).scene;
        scene.position.set(chunk.x * 256, 0, chunk.z * 256); scene.updateMatrixWorld(true); scenes.push(scene);
      }
    }
  }
}
assert(newScenes.length, 'Native camera source geometry loaded');
const rayResults = rays.points.map(point => {
  const ray = new Raycaster(new Vector3(...point.ray.origin), new Vector3(...point.ray.direction), .05, 500);
  const oldHits = ray.intersectObjects(oldScenes, true), hit = ray.intersectObjects(newScenes, true)[0];
  if (!point.hits.length) assert.equal(oldHits.length, 0, 'Original pixel opening reproduced');
  assert(hit && hit.distance < maximumDistance, `Nearby surface required at ${point.pixel.join(',')}`);
  return { pixel: point.pixel, beforeHits: oldHits.length, repairedDistance: hit.distance, mesh: hit.object.name };
});
for (const scene of [...oldScenes, ...newScenes]) scene.traverse(object => { if (object instanceof Mesh) {
  object.geometry.dispose(); for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
} });
assert.equal(digest(await readFile(join(base, 'manifest.json'))), rays.manifestSha256);
assert.equal((await fingerprint()).sha256, source.sha256, 'Repair source changed');
const evidence = { startedAt, completedAt: new Date().toISOString(), sourceCommit, source,
  base, baseManifestSha256: rays.manifestSha256, rayReport: { path: rayPath, sha256: digest(rayBytes) }, samples, rayResults,
  visualAcceptance: 'pending native review', activated: false };
if (smoke) {
  const output = resolve('artifacts/district-seams-hbyf', `microseam-smoke-${basename(root)}.json`);
  await atomicWrite(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ output, samples, rayResults }, null, 2));
} else {
  assert.equal((await readdir(root).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; return []; })).length, 0, 'New isolated candidate required');
  await cp(base, root, { recursive: true, errorOnExist: true, force: false,
    filter: path => !['art', 'district-rollout.json', 'district-roads-smoke.json', 'build-start.json', 'validation.json', 'runtime-inventory.json', 'map-transfer.json'].some(name => path === join(base, name)) });
  const after = structuredClone(before);
  for (const chunk of after.chunks) for (const [i, lod] of chunk.lods.entries()) {
    const result = converted.get(lod.path); if (!result) continue;
    chunk.lods[i as 0 | 1] = result.artifact; chunk.triangles[i as 0 | 1] += result.trianglesAdded;
  }
  for (const [path, result] of converted) {
    await atomicWrite(join(root, path), result.bytes);
    await atomicWrite(join(root, path + '.gz'), gzipSync(result.bytes, { level: 9 }));
  }
  const unique = new Map<string, Artifact>();
  for (const a of [after.roadGraph, ...(after.neighbourhoods ? [after.neighbourhoods] : []), ...(after.coastline ? [after.coastline] : []),
    ...after.chunks.flatMap(c => [...c.lods, c.terrain, c.collision])]) unique.set(a.path, a);
  after.stats.gzipBytes = [...unique.values()].reduce((sum, a) => sum + a.gzipBytes, 0);
  after.stats.withinBudget = after.stats.gzipBytes <= after.stats.budgetBytes;
  const encoded = JSON.stringify(after, null, 2) + '\n';
  await atomicWrite(join(root, 'manifest.json'), encoded); await atomicWrite(join(root, 'manifest.json.gz'), gzipSync(encoded, { level: 9 }));
  await writeRuntimeInventory(root, after); await writeMapTransfer(root);
  const validation = await validateMap(root), inventory = JSON.parse(await readFile(join(root, 'runtime-inventory.json'), 'utf8'));
  const originals = new Map(before.chunks.map(c => [c.id, c]));
  assert.deepEqual(after.roadGraph, before.roadGraph); assert.equal(after.chunks.length, before.chunks.length);
  for (const chunk of after.chunks) {
    const original = originals.get(chunk.id)!;
    assert.deepEqual(chunk.terrain, original.terrain); assert.deepEqual(chunk.collision, original.collision);
    if (!targetIds.has(chunk.id)) assert.deepEqual(chunk, original);
  }
  assert.equal(digest(await readFile(join(base, 'manifest.json'))), rays.manifestSha256);
  assert.equal((await fingerprint()).sha256, source.sha256, 'Repair source changed during conversion');
  const report = { ...evidence, completedAt: new Date().toISOString(), candidate: root, sourceFingerprint: source.sha256,
    manifestSha256: digest(encoded), validation,
    repair: { kind: 'native-microseam-repair', base, manifestSha256: rays.manifestSha256,
      changedChunks: [...targetIds], retainedChunks: after.chunks.length - targetIds.size,
      allContactCollisionGraphArtifactsPreserved: true, repaired: samples },
    inventory: { files: inventory.files.length, rawBytes: inventory.rawBytes, gzipBytes: inventory.gzipBytes, maximumFileBytes: inventory.maximumFileBytes },
    budgets: { wholeCityCompressed25MB: inventory.gzipBytes <= 25_000_000, mapAloneBelowProduction80MB: inventory.gzipBytes <= 80_000_000,
      individualFile25MB: inventory.maximumFileBytes <= 25_000_000 }, uploaded: false, desktopPhoneLook: 'pending' };
  await atomicWrite(join(root, 'district-rollout.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ candidate: root, manifestSha256: report.manifestSha256, inventory: report.inventory, samples, rayResults }, null, 2));
}
