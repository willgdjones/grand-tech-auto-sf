/** Isolated, append-only district repair. Run --smoke before the full conversion. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Document } from '@gltf-transform/core';
import { Mesh, Raycaster, Vector3, type BufferAttribute, type InterleavedBufferAttribute } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { readGlb } from './src/glb';
import { appendSurfaceJoinsToGlb } from './src/pipeline/appendSurfaceJoins';
import { validateMap } from './src/pipeline/build';
import { atomicWrite, digest } from './src/pipeline/sources';
import { writeRuntimeInventory } from './src/pipeline/runtime';
import { writeMapTransfer } from './src/pipeline/transfer';
import type { Artifact, MapManifest } from './src/pipeline/types';

const base = resolve('tools/map/out/district-tm7m-ground'), rawAppend = resolve('tools/map/out/district-tm7m-seams');
let root = rawAppend, smoke = false, rayReportPath: string | undefined;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--smoke') smoke = true;
  else if (arg === '--out' && process.argv[i + 1]) root = resolve(process.argv[++i]!);
  else if (arg === '--ray-report' && process.argv[i + 1]) rayReportPath = resolve(process.argv[++i]!);
  else throw new Error(`Unknown or incomplete argument: ${arg}`);
}
assert(!rayReportPath || smoke, '--ray-report is a smoke diagnostic');
assert.equal(dirname(root), resolve('tools/map/out'));
assert(/^[a-z0-9_-]+$/.test(basename(root)));
const manifestBytes = await readFile(join(base, 'manifest.json'));
const before = JSON.parse(manifestBytes.toString()) as MapManifest;
const baseline = JSON.parse(await readFile(join(base, 'district-rollout.json'), 'utf8')) as {
  manifestSha256: string; sourceFingerprint: string; repair: { changedChunks: string[] };
};
assert.equal(digest(manifestBytes), baseline.manifestSha256);
const repairIds = new Set(baseline.repair.changedChunks);
const paths = ['tools/map/district-seam-repair.mts', 'tools/map/src/glb.ts', ...[
  'appendSurfaceJoins', 'surfaceJoins', 'build', 'sources', 'runtime', 'transfer', 'types',
].map(name => `tools/map/src/pipeline/${name}.ts`)];
async function fingerprint() {
  const files = await Promise.all(paths.map(async path => ({ path, sha256: digest(await readFile(path)) })));
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
if (smoke) {
  const rawManifest = JSON.parse(await readFile(join(rawAppend, 'manifest.json'), 'utf8')) as MapManifest;
  const rawReceipt = JSON.parse(await readFile(join(rawAppend, 'district-rollout.json'), 'utf8'));
  assert.equal(digest(await readFile(join(rawAppend, 'manifest.json'))), rawReceipt.manifestSha256);
  const rayBytes = rayReportPath ? await readFile(rayReportPath) : undefined;
  const rays = rayBytes ? JSON.parse(rayBytes.toString()) as {
    manifestSha256: string; inputs: { chunk: string; sha256: string }[];
    points: { pixel: number[]; ray: { origin: [number, number, number]; direction: [number, number, number] };
      hits: { distance: number }[] }[];
  } : undefined;
  if (rays) {
    assert.equal(rays.manifestSha256, rawReceipt.manifestSha256);
    assert(rays.points.some(point => !point.hits.length), 'Diagnostic contains the visible opening');
    assert(rays.points.some(point => point.hits.length), 'Diagnostic contains neighboring surface hits');
  }
  let repairedRayCount = 0;
  const samples = [];
  for (const id of ['-9_-4', '3_9', '-36_5']) {
    const chunk = before.chunks.find(c => c.id === id)!; assert(chunk && repairIds.has(id));
    const lod = chunk.lods[0], input = await readFile(join(base, lod.path)); assert.equal(digest(input), lod.sha256);
    const signature = meshSignatures(await readGlb(input)), converted = await appendSurfaceJoinsToGlb(input);
    assert(converted.trianglesAdded > 0);
    const doc = await readGlb(converted.bytes), restored = meshSignatures(doc);
    assert.deepEqual(restored.slice(0, signature.length), signature, `Original decoded meshes preserved: ${id}`);
    const rawLod = rawManifest.chunks.find(c => c.id === id)!.lods[0];
    const rawBytes = await readFile(join(rawAppend, rawLod.path)); assert.equal(digest(rawBytes), rawLod.sha256);
    // Compression-only checks retain every appended array. A geometry repair
    // instead has to close the recorded opening while preserving original meshes.
    if (!rays) assert.deepEqual(restored, meshSignatures(await readGlb(rawBytes)), `All raw-append decoded geometry preserved: ${id}`);
    let triangles = 0;
    for (const node of doc.getRoot().listNodes().slice(signature.length)) for (const p of node.getMesh()!.listPrimitives()) {
      assert(p.getAttribute('POSITION')!.getCount() <= 3000);
      assert(p.listAttributes().reduce((sum, a) => sum + a.getByteLength(), 0) + p.getIndices()!.getByteLength() < 64 * 1024);
      triangles += p.getIndices()!.getCount() / 3;
    }
    assert.equal(triangles, converted.trianglesAdded);
    const loaded = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(Uint8Array.from(converted.bytes).buffer, '');
    const rayResults: { pixel: number[]; beforeHits: number; repairedDistance: number }[] = [];
    const recordedInput = rays?.inputs.find(input => input.chunk === id);
    if (rays && recordedInput) {
      assert.equal(recordedInput.sha256, rawLod.sha256, 'Recorded camera uses this exact source asset');
      const oldScene = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(Uint8Array.from(rawBytes).buffer, '')).scene;
      for (const scene of [loaded.scene, oldScene]) { scene.position.set(chunk.x * 256, 0, chunk.z * 256); scene.updateMatrixWorld(true); }
      const maximumDistance = Math.max(...rays.points.flatMap(point => point.hits.map(hit => hit.distance))) + 1;
      for (const point of rays.points.filter(point => !point.hits.length)) {
        const ray = new Raycaster(new Vector3(...point.ray.origin), new Vector3(...point.ray.direction), .05, 500);
        assert.equal(ray.intersectObject(oldScene, true).length, 0, 'Original camera ray still reproduces the opening');
        const hit = ray.intersectObject(loaded.scene, true)[0];
        assert(hit && hit.distance < maximumDistance, `Recorded opening sealed at pixel ${point.pixel.join(',')}`);
        rayResults.push({ pixel: point.pixel, beforeHits: 0, repairedDistance: hit.distance }); repairedRayCount++;
      }
      oldScene.traverse(object => { if (object instanceof Mesh) {
        object.geometry.dispose(); for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
      } });
    }
    let loadedTriangles = 0;
    loaded.scene.traverse(object => {
      if (!(object instanceof Mesh)) return;
      if (object.name.startsWith('roads_surface_join')) {
        const attributes = Object.values(object.geometry.attributes) as (BufferAttribute | InterleavedBufferAttribute)[];
        const buffers = new Set<ArrayBufferLike>(attributes.map(a => a.array.buffer));
        if (object.geometry.index) buffers.add(object.geometry.index.array.buffer);
        assert([...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0) <= 64 * 1024, 'Native renderer upload bound');
      }
      loadedTriangles += (object.geometry.index?.count ?? object.geometry.attributes.position!.count) / 3;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
    });
    assert.equal(loadedTriangles, chunk.triangles[0] + converted.trianglesAdded, `Native Three loader: ${id}`);
    samples.push({ id, path: lod.path, inputSha256: lod.sha256, outputSha256: digest(converted.bytes),
      inputBytes: input.length, outputBytes: converted.bytes.length, gzipBytes: gzipSync(converted.bytes, { level: 9 }).length,
      originalNodes: signature.length, addedNodes: restored.length - signature.length,
      rawAppendSha256: rawLod.sha256, rawAppendBytes: rawBytes.length, rawAppendGzipBytes: rawLod.gzipBytes,
      allRawAppendMeshArraysTransformsMaterialsPreserved: !rays, repairedCameraRays: rayResults,
      trianglesAdded: converted.trianglesAdded, joinedPairs: converted.joinedPairs, rejectedWidePairs: converted.rejectedWidePairs,
      originalMeshArraysTransformsMaterialsPreserved: true, boundedAddedPrimitives: true, nativeThreeLoaderTriangles: loadedTriangles });
  }
  if (rays) assert.equal(repairedRayCount, rays.points.filter(point => !point.hits.length).length, 'Every recorded missing ray was checked once');
  assert.equal((await fingerprint()).sha256, source.sha256);
  const report = { startedAt, completedAt: new Date().toISOString(), sourceCommit, source,
    baseManifestSha256: baseline.manifestSha256, samples,
    ...(rayBytes ? { rayReport: { path: rayReportPath, sha256: digest(rayBytes), repairedRayCount } } : {}),
    visualAcceptance: 'pending native review', activated: false };
  const reportName = rays ? `append-smoke-${basename(root)}.json` : 'append-smoke.json';
  await atomicWrite(resolve('artifacts/district-seams-hbyf', reportName), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} else {
  const existing = await readdir(root).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; return []; });
  assert.equal(existing.length, 0, 'Candidate must be new and empty');
  await cp(base, root, { recursive: true, errorOnExist: true, force: false,
    filter: path => !['art', 'district-rollout.json', 'district-roads-smoke.json', 'build-start.json', 'validation.json', 'runtime-inventory.json', 'map-transfer.json'].some(name => path === join(base, name)) });
  await atomicWrite(join(root, 'build-start.json'), JSON.stringify({ startedAt, sourceCommit, source,
    repair: { kind: 'append-surface-joins', base, manifestSha256: baseline.manifestSha256 } }, null, 2) + '\n');
  const after = structuredClone(before), repaired: { id: string; path: string; trianglesAdded: number; joinedPairs: number; rejectedWidePairs: number }[] = [];
  let inspected = 0;
  for (const chunk of after.chunks) {
    if (!repairIds.has(chunk.id)) continue;
    const seen = new Map<string, { artifact: Artifact; trianglesAdded: number }>();
    for (const [i, lod] of chunk.lods.entries()) {
      let result = seen.get(lod.path);
      if (!result) {
        const input = await readFile(join(root, lod.path)); assert.equal(digest(input), lod.sha256, `Source asset: ${lod.path}`);
        const converted = await appendSurfaceJoinsToGlb(input);
        if (converted.trianglesAdded) {
          const compressed = gzipSync(converted.bytes, { level: 9 });
          await atomicWrite(join(root, lod.path), converted.bytes); await atomicWrite(join(root, `${lod.path}.gz`), compressed);
          result = { artifact: { ...lod, bytes: converted.bytes.length, gzipBytes: compressed.length, sha256: digest(converted.bytes) }, trianglesAdded: converted.trianglesAdded };
          repaired.push({ id: chunk.id, path: lod.path, trianglesAdded: converted.trianglesAdded,
            joinedPairs: converted.joinedPairs, rejectedWidePairs: converted.rejectedWidePairs });
        } else result = { artifact: lod, trianglesAdded: 0 };
        seen.set(lod.path, result);
      }
      chunk.lods[i as 0 | 1] = result.artifact; chunk.triangles[i as 0 | 1] += result.trianglesAdded;
    }
    inspected++; if (inspected % 50 === 0) console.log(`Inspected ${inspected}/${repairIds.size}; repaired ${repaired.length} unique LODs`);
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
  assert.equal(after.chunks.length, before.chunks.length); assert.deepEqual(after.roadGraph, before.roadGraph);
  const oldChunks = new Map(before.chunks.map(c => [c.id, c]));
  for (const chunk of after.chunks) {
    const old = oldChunks.get(chunk.id)!;
    assert.deepEqual(chunk.terrain, old.terrain); assert.deepEqual(chunk.collision, old.collision);
    if (!repairIds.has(chunk.id)) assert.deepEqual(chunk, old);
  }
  assert.equal(digest(await readFile(join(base, 'manifest.json'))), baseline.manifestSha256);
  assert.equal((await fingerprint()).sha256, source.sha256, 'Repair source changed during conversion');
  const changedChunks = [...new Set(repaired.map(r => r.id))];
  const report = { sourceCommit, sourceFingerprint: source.sha256, source, startedAt, completedAt: new Date().toISOString(), candidate: root,
    manifestSha256: digest(encoded), validation,
    repair: { kind: 'append-surface-joins', base, manifestSha256: baseline.manifestSha256, inspectedChunks: inspected,
      changedChunks, retainedChunks: after.chunks.length - changedChunks.length, repaired,
      trianglesAdded: repaired.reduce((sum, r) => sum + r.trianglesAdded, 0), originalMeshBytesPreserved: true,
      allContactCollisionGraphArtifactsPreserved: true },
    inventory: { files: inventory.files.length, rawBytes: inventory.rawBytes, gzipBytes: inventory.gzipBytes, maximumFileBytes: inventory.maximumFileBytes },
    budgets: { wholeCityCompressed25MB: inventory.gzipBytes <= 25_000_000, mapAloneBelowProduction80MB: inventory.gzipBytes <= 80_000_000,
      individualFile25MB: inventory.maximumFileBytes <= 25_000_000, productionTotal: 'pending combined inventory', coldReady15MB: 'pending actual browser trace' },
    activated: false, uploaded: false, desktopPhoneLook: 'pending' };
  await atomicWrite(join(root, 'district-rollout.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, source: { sha256: source.sha256 }, repair: { ...report.repair, repaired: `${repaired.length} records`, changedChunks: `${changedChunks.length} chunks` } }, null, 2));
}
