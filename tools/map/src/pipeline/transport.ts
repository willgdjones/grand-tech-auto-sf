import { mkdir, readFile, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  MAP_TRANSPORT, decodeHeightTransport, decodeRoadTransport, encodeHeightTransport, encodeRoadTransport,
} from '../../../../shared/mapTransport';
import { decodeMapCollision, encodeMapCollision } from '../../../../shared/mapCollision';
import { atomicWrite, digest } from './sources';
import { writeRuntimeInventory } from './runtime';
import type { Artifact, MapManifest } from './types';
import { packCompactMesh } from './compactMesh';
import { packBuildingRecipes } from './compactRecipe';
import { packJoinRecipes } from './compactJoinRecipe';

/** An isolated candidate conversion, never an activation or publication. Existing GLBs,
 * source footprints, district profiles, grade-separated routing and metadata are retained.
 * The caller must explicitly request the experiment; both runtime consumers require the
 * compactMapAssets feature flag before accepting its manifest.
 */
export async function packMapTransport(sourceRoot: string, outputRoot: string, options: { enabled: boolean; meshes?: boolean; collisions?: boolean; buildingRecipes?: boolean; joinRecipes?: boolean }): Promise<MapManifest> {
  if (!options.enabled) throw new Error('Enable the experimental compact map conversion explicitly');
  if (options.buildingRecipes && !options.meshes) throw new Error('Building recipes require compact meshes');
  if (options.joinRecipes && !options.meshes) throw new Error('Join recipes require compact meshes');
  const root = await realpath(sourceRoot), output = resolve(outputRoot);
  if (output === root || root.startsWith(output + sep) || output.startsWith(root + sep)) throw new Error('Use a separate output directory');
  const originalManifest = await readFile(join(root, 'manifest.json'));
  const manifest = JSON.parse(originalManifest.toString('utf8')) as MapManifest;
  if (manifest.version !== 1 || manifest.roadGraph.encoding !== 'roadpack-v1' || manifest.requiredFeatures?.length) throw new Error('Expected an ordinary packed map');
  // Cinematic and fallback route consumers predate manifest references. Retain
  // their source bytes and account for them; a smaller inventory cannot omit a
  // reachable feature. Tiny test/slice inputs may have none, but never a partial set.
  const legacyPaths = ['roadgraph-playable.json', 'roadgraph-local-play.json', 'local-play.json'];
  const runtime: Record<string, Artifact> = {};
  for (const name of legacyPaths) {
    const path = await realpath(join(root, name)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined; throw error;
    });
    if (!path) continue;
    if (!path.startsWith(root + sep)) throw new Error('Runtime map artifact escapes source directory');
    const raw = await readFile(path), value = JSON.parse(raw.toString('utf8')) as { version?: number };
    if (value.version !== 1) throw new Error(`Unsupported runtime map artifact: ${name}`);
    runtime[name] = { path: name, bytes: raw.length, gzipBytes: gzipSync(raw, { level: 9 }).length, sha256: digest(raw) };
  }
  if (Object.keys(runtime).length && Object.keys(runtime).length !== legacyPaths.length) throw new Error('Incomplete legacy runtime map artifacts');
  for (const [name, asset] of Object.entries(manifest.runtime ?? {})) {
    const retained = runtime[name];
    if (!retained || asset.path !== name || asset.bytes !== retained.bytes || asset.sha256 !== retained.sha256)
      throw new Error(`Unsupported or changed runtime map artifact: ${name}`);
  }
  if (Object.keys(runtime).length) manifest.runtime = runtime;
  await mkdir(output); // EEXIST is intentional: never overwrite an active or peer-owned bake.
  const all = [manifest.roadGraph, ...Object.values(manifest.runtime ?? {}), ...(manifest.neighbourhoods ? [manifest.neighbourhoods] : []),
    ...(manifest.coastline ? [manifest.coastline] : []), ...manifest.chunks.flatMap(c => [...c.lods, c.terrain, c.collision])];
  const heights = new Set(manifest.chunks.map(c => c.terrain.path)), meshes = new Set(manifest.chunks.flatMap(c => c.lods.map(a => a.path)));
  const collisions = new Set(manifest.chunks.map(c => c.collision.path));
  const recipes = new Map(manifest.chunks.filter(c => c.detail === 'low').flatMap(c => c.lods.map(a => [a.path, { ...c.collision }] as const)));
  let recipeFiles = 0, recipeTriangles = 0, fallbackBuildingTriangles = 0;
  let joinRecipeFiles = 0, joinTriangles = 0, fallbackJoinTriangles = 0;
  const done = new Map<string, Artifact>(), records: { path: string; sourceSha256: string; sourceBytes: number; sourceGzipBytes: number; bytes: number; gzipBytes: number; restoredExactly: boolean }[] = [];
  for (const artifact of all) {
    const sourcePath = artifact.path, previous = done.get(sourcePath);
    if (previous) { Object.assign(artifact, previous); continue; }
    const path = await realpath(join(root, artifact.path));
    if (!path.startsWith(root + sep)) throw new Error('Source artifact escapes map directory');
    const source = await readFile(path);
    if (source.length !== artifact.bytes || digest(source) !== artifact.sha256) throw new Error(`Source artifact changed: ${artifact.path}`);
    let bytes: Uint8Array = source, restored: Uint8Array = source;
    const graph = sourcePath === manifest.roadGraph.path, height = heights.has(sourcePath), mesh = options.meshes && meshes.has(sourcePath);
    const collision = options.collisions && collisions.has(sourcePath);
    if (graph) { bytes = encodeRoadTransport(source); restored = decodeRoadTransport(bytes); }
    else if (height) { bytes = encodeHeightTransport(source); restored = decodeHeightTransport(bytes); }
    else if (collision) { bytes = encodeMapCollision(source); restored = new TextEncoder().encode(JSON.stringify(decodeMapCollision(bytes)) + '\n'); }
    let meshEncoding: 'triangles-v1' | 'recipes-v1' | 'joins-v1' = 'triangles-v1';
    if (mesh) {
      bytes = await packCompactMesh(source);
      const collision = options.buildingRecipes ? recipes.get(sourcePath) : undefined;
      let raw: Uint8Array | undefined;
      if (collision) {
        raw = await readFile(join(root, collision.path));
        if (digest(raw) !== collision.sha256) throw new Error(`Recipe collision source changed: ${collision.path}`);
      }
      if (options.joinRecipes) {
        const packed = await packJoinRecipes(source, Uint8Array.from(bytes), raw); bytes = packed.bytes;
        recipeTriangles += packed.recipeTriangles; fallbackBuildingTriangles += packed.fallbackTriangles;
        joinTriangles += packed.joinTriangles; fallbackJoinTriangles += packed.fallbackJoinTriangles;
        if (packed.buildingRecipesUsed) { meshEncoding = 'recipes-v1'; recipeFiles++; }
        if (packed.used) { meshEncoding = 'joins-v1'; joinRecipeFiles++; }
      } else if (raw) {
        const packed = await packBuildingRecipes(Uint8Array.from(bytes), raw); bytes = packed.bytes;
        recipeTriangles += packed.recipeTriangles; fallbackBuildingTriangles += packed.fallbackTriangles;
        if (packed.used) { meshEncoding = 'recipes-v1'; recipeFiles++; }
      }
    }
    if (!Buffer.from(restored).equals(source)) throw new Error(`Transport changed decoded artifact: ${artifact.path}`);
    const compressed = gzipSync(bytes, { level: 9 });
    const encoded: Artifact = { ...artifact, path: mesh ? sourcePath.replace(/\.glb$/, '.bin') : collision ? sourcePath.replace(/\.json$/, '.bin') : sourcePath,
      bytes: bytes.length, gzipBytes: compressed.length, sha256: digest(bytes),
      ...(mesh ? { meshEncoding } : {}),
      ...(graph || height || collision ? { transport: MAP_TRANSPORT, decodedBytes: source.length, decodedSha256: artifact.sha256 } : {}) };
    records.push({ path: sourcePath, sourceSha256: artifact.sha256, sourceBytes: source.length,
      sourceGzipBytes: artifact.gzipBytes, bytes: bytes.length, gzipBytes: compressed.length, restoredExactly: !mesh });
    done.set(sourcePath, encoded); Object.assign(artifact, encoded);
    await atomicWrite(join(output, artifact.path), bytes); await atomicWrite(join(output, artifact.path + '.gz'), compressed);
  }
  manifest.requiredFeatures = ['compactMapAssets'];
  manifest.generator += '+predictive-v1' + (options.buildingRecipes ? '+recipes-v1' : '') + (options.joinRecipes ? '+joins-v1' : '');
  manifest.stats.budgetBytes = Math.min(manifest.stats.budgetBytes, 25_000_000);
  manifest.stats.gzipBytes = [...done.values()].reduce((sum, a) => sum + a.gzipBytes, 0);
  manifest.stats.withinBudget = manifest.stats.gzipBytes <= manifest.stats.budgetBytes;
  const bytes = JSON.stringify(manifest, null, 2) + '\n';
  await atomicWrite(join(output, 'manifest.json'), bytes); await atomicWrite(join(output, 'manifest.json.gz'), gzipSync(bytes, { level: 9 }));
  await writeRuntimeInventory(output, manifest);
  await atomicWrite(join(output, 'transport-report.json'), JSON.stringify({
    version: 1, sourceManifestSha256: digest(originalManifest), sourceRoot: root, outputRoot: output,
    requiresFeature: 'compactMapAssets', sourceFilesRetained: true, roadAndHeightBytesExact: true,
    meshMode: options.meshes ? 'triangles-v1: exact quantized positions/winding/RGB; normals derived' : 'original GLBs',
    buildingRecipes: { enabled: options.buildingRecipes ?? false, recipeFiles, recipeTriangles, fallbackBuildingTriangles,
      parity: 'Every recipe output oriented quantized triangle, transform and RGB checked against source; recipes apply only to low-detail chunks' },
    joinRecipes: { enabled: options.joinRecipes ?? false, joinRecipeFiles, joinTriangles, fallbackJoinTriangles,
      algorithm: 'surfaceJoins.ts at 88acbf9, GTCJ v1; exact source-selected output plus unmatched source face fallback',
      parity: 'Every output oriented quantized triangle, transform and RGB checked against source; may embed low-detail building recipes' },
    collisionMode: options.collisions ? 'exact source rings/IDs/heights as millimetre deltas' : 'original JSON',
    legacyRuntimePaths: Object.keys(manifest.runtime ?? {}),
    chunks: manifest.chunks.length, sourceDigests: manifest.sourceDigests,
    note: 'Manifest runtime inventory; no publication, activation, visual acceptance or deployment gate claimed.', records,
  }, null, 2) + '\n');
  return manifest;
}
