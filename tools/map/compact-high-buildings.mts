/** Incremental exact building recipes for detailed districts. Run through heavy.sh.
 * Existing low-detail recipes, seams, routing, contact, collision and legacy files
 * remain unchanged. A fresh output directory is required; never activates a map.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { MeshoptDecoder } from 'meshoptimizer';
import { ShapeUtils, Vector2 } from 'three';
import { decodeCompactMesh, type DecodedMapMesh } from '../../shared/mapMesh';
import { decodeBuildingRecipe, isBuildingRecipe, type RecipeCollision, type RecipeTriangulator } from '../../shared/mapRecipe';
import { decodeJoinRecipe, isJoinRecipe, joinFaceKey, joinRecipeHeader, MAP_JOIN_MAGIC, meshJoinFaces } from '../../shared/mapJoinRecipe';
import { restoreMapArtifact } from '../../shared/mapTransport';
import { packBuildingRecipes } from './src/pipeline/compactRecipe';
import { writeRuntimeInventory } from './src/pipeline/runtime';
import { atomicWrite, digest } from './src/pipeline/sources';
import type { Artifact, MapManifest } from './src/pipeline/types';

const [input, destination, optIn] = process.argv.slice(2);
assert(input && destination && optIn === '--experimental-compact-map', 'Usage: tools/heavy.sh npx tsx tools/map/compact-high-buildings.mts SOURCE NEW_OUTPUT --experimental-compact-map');
const root = await realpath(input), output = resolve(destination);
assert(output !== root && !root.startsWith(output + sep) && !output.startsWith(root + sep), 'Use a separate output directory');
const sourceManifest = await readFile(join(root, 'manifest.json')), manifest = JSON.parse(sourceManifest.toString()) as MapManifest;
assert.equal(manifest.version, 1); assert.deepEqual(manifest.requiredFeatures, ['compactMapAssets']);
const previousReportBytes = await readFile(join(root, 'transport-report.json'));
const previous = JSON.parse(previousReportBytes.toString()) as { sourceRoot: string };
assert.equal(typeof previous.sourceRoot, 'string');
const beforeInventory = JSON.parse(await readFile(join(root, 'runtime-inventory.json'), 'utf8')) as { gzipBytes: number };
const high = new Map(manifest.chunks.filter(c => c.detail !== 'low').flatMap(c => c.lods.map(a => [a.path, { ...c.collision }] as const)));
const all = [manifest.roadGraph, ...Object.values(manifest.runtime ?? {}), ...(manifest.neighbourhoods ? [manifest.neighbourhoods] : []),
  ...(manifest.coastline ? [manifest.coastline] : []), ...manifest.chunks.flatMap(c => [...c.lods, c.terrain, c.collision])];
const triangulate: RecipeTriangulator = rings => ShapeUtils.triangulateShape(rings[0]!.map(p => new Vector2(p[0], p[1])),
  rings.slice(1).map(r => r.map(p => new Vector2(p[0], p[1]))));
const zip = (bytes: Uint8Array) => gzipSync(bytes, { level: 9 });
const faceKeys = (meshes: DecodedMapMesh[]) => meshes.flatMap(mesh => meshJoinFaces(mesh).map(face =>
  JSON.stringify([mesh.group.name, mesh.group.translation, mesh.group.scale, joinFaceKey(face)]))).sort();
const decode = (bytes: Uint8Array, collision: RecipeCollision) => isJoinRecipe(bytes) ? decodeJoinRecipe(bytes, MeshoptDecoder, collision, triangulate)
  : isBuildingRecipe(bytes) ? decodeBuildingRecipe(bytes, collision, triangulate, MeshoptDecoder) : decodeCompactMesh(bytes, MeshoptDecoder);
async function checkedRead(asset: Artifact): Promise<Buffer> {
  assert(resolve(output, asset.path).startsWith(output + sep), 'Artifact escapes destination');
  const path = await realpath(join(root, asset.path)); assert(path.startsWith(root + sep), 'Artifact escapes source');
  const bytes = await readFile(path); assert.equal(bytes.length, asset.bytes); assert.equal(digest(bytes), asset.sha256, asset.path);
  return bytes;
}
await mkdir(output); // EEXIST intentionally rejects replacing any existing candidate.
let changed = 0, recipeTriangles = 0, fallbackTriangles = 0;
const done = new Map<string, Artifact>(), records: { path: string; sourceSha256: string; sha256: string; sourceGzipBytes: number; gzipBytes: number; changed: boolean }[] = [];
for (const artifact of all) {
  const prior = done.get(artifact.path); if (prior) { Object.assign(artifact, prior); continue; }
  const source = await checkedRead(artifact), oldGzip = await readFile(join(root, artifact.path + '.gz'));
  assert.equal(oldGzip.length, artifact.gzipBytes); assert.deepEqual(gunzipSync(oldGzip), source, `Source gzip ${artifact.path}`);
  let bytes: Uint8Array = source, gzip = oldGzip, meshEncoding = artifact.meshEncoding;
  const collisionArtifact = high.get(artifact.path);
  if (collisionArtifact) {
    const joined = isJoinRecipe(source) ? joinRecipeHeader(source) : undefined, base = joined?.base ?? source;
    if (!isBuildingRecipe(base)) {
      const collisionSource = await checkedRead(collisionArtifact);
      const collisionBytes = new Uint8Array(await restoreMapArtifact(Uint8Array.from(collisionSource).buffer, collisionArtifact, 'collision', true));
      const collision = JSON.parse(new TextDecoder().decode(collisionBytes)) as RecipeCollision;
      const packed = await packBuildingRecipes(Uint8Array.from(base), collisionBytes);
      if (packed.used) {
        let candidate: Uint8Array = packed.bytes;
        if (joined) {
          const header = Buffer.from(JSON.stringify({ ...joined.header, baseBytes: candidate.length })), framing = Buffer.alloc(16);
          framing.writeUInt32LE(MAP_JOIN_MAGIC); framing.writeUInt32LE(1, 4); framing.writeUInt32LE(header.length, 8);
          candidate = Buffer.concat([framing, header, candidate, joined.mask, joined.fallback]);
        }
        const compressed = zip(candidate);
        if (compressed.length < oldGzip.length) {
          // Includes all seam faces, unchanged base surfaces and every unmatched
          // building face, not only the building recipe subset.
          assert.deepEqual(faceKeys(await decode(candidate, collision)), faceKeys(await decode(source, collision)), `Geometry ${artifact.path}`);
          bytes = candidate; gzip = compressed; meshEncoding = joined ? 'joins-v1' : 'recipes-v1';
          changed++; recipeTriangles += packed.recipeTriangles; fallbackTriangles += packed.fallbackTriangles;
        }
      }
    }
  }
  const hash = digest(bytes), converted: Artifact = { ...artifact, bytes: bytes.length, gzipBytes: gzip.length, sha256: hash,
    ...(meshEncoding ? { meshEncoding } : {}) };
  records.push({ path: artifact.path, sourceSha256: artifact.sha256, sha256: hash, sourceGzipBytes: artifact.gzipBytes, gzipBytes: gzip.length, changed: hash !== artifact.sha256 });
  await atomicWrite(join(output, artifact.path), bytes); await atomicWrite(join(output, artifact.path + '.gz'), gzip);
  done.set(artifact.path, converted); Object.assign(artifact, converted);
}
manifest.generator += '+high-building-recipes-v1';
manifest.stats.budgetBytes = Math.min(manifest.stats.budgetBytes, 25_000_000);
manifest.stats.gzipBytes = [...done.values()].reduce((sum, a) => sum + a.gzipBytes, 0);
manifest.stats.withinBudget = manifest.stats.gzipBytes <= manifest.stats.budgetBytes;
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
await atomicWrite(join(output, 'manifest.json'), manifestBytes); await atomicWrite(join(output, 'manifest.json.gz'), zip(manifestBytes));
await writeRuntimeInventory(output, manifest);
const inventory = JSON.parse(await readFile(join(output, 'runtime-inventory.json'), 'utf8')) as { gzipBytes: number; withinMapBudget: boolean };
await atomicWrite(join(output, 'transport-report.json'), JSON.stringify({ version: 1, sourceRoot: previous.sourceRoot, inputRoot: root, outputRoot: output,
  sourceManifestSha256: digest(sourceManifest), previousTransportReportSha256: digest(previousReportBytes), scriptSha256: digest(await readFile(new URL(import.meta.url))),
  requiresFeature: 'compactMapAssets', chunks: manifest.chunks.length, sourceDigests: manifest.sourceDigests, legacyRuntimePaths: Object.keys(manifest.runtime ?? {}),
  highBuildingRecipes: { eligibleFiles: high.size, changed, recipeTriangles, fallbackTriangles, everyOrientedXYZRGBTransformFaceExact: true },
  unchangedArtifacts: records.filter(r => !r.changed).length, beforeGzipBytes: beforeInventory.gzipBytes, afterGzipBytes: inventory.gzipBytes,
  savedGzipBytes: beforeInventory.gzipBytes - inventory.gzipBytes, withinMapBudget: inventory.withinMapBudget,
  note: 'Complete isolated incremental candidate. Every input raw/gzip artifact checked; every changed mesh decoded and compared in full. Original ordinary source root retained only to pair its authored street-detail assets. No activation, publication or visual/device acceptance.', records,
}, null, 2) + '\n');
assert(changed > 0 && inventory.gzipBytes < beforeInventory.gzipBytes, 'No measured whole-candidate saving');
console.log(JSON.stringify({ output, changed, beforeGzipBytes: beforeInventory.gzipBytes, afterGzipBytes: inventory.gzipBytes,
  savedGzipBytes: beforeInventory.gzipBytes - inventory.gzipBytes, withinMapBudget: inventory.withinMapBudget, activated: false }));
