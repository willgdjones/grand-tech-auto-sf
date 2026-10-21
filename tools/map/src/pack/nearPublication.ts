/**
 * gtasf-0k01: publish ONLY the near-spawn road graph against the map that is already live, so a routine
 * deploy (`--skip-map`, no ~7600-object city upload) can still ship flags.nearRoadGraph. The near graph is a
 * subset of the full graph, so it is only valid for the live manifest whose roadGraph it was cut from: we
 * refuse unless the local subset's sourceSha256 equals the live roadGraph sha256. Objects go under a
 * content-addressed prefix (map/near/<sha>/), and the patched stable alias manifest is uploaded last, so an
 * interrupted run leaves the previous manifest live (the client then simply loads the full graph).
 */
import { readFile, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { atomicWrite, digest } from '../pipeline/sources';
import type { Artifact, MapManifest } from '../pipeline/types';
import type { PublishedObject } from './publication';

type Near = NonNullable<MapManifest['roadGraphNear']>;
type LiveManifest = MapManifest & { release?: string };

/** The live manifest with roadGraphNear added (paths rewritten under `prefix`), or null if it is already there. */
export function patchManifestWithNear(live: LiveManifest, near: Near, prefix: string): LiveManifest | null {
  if (!live?.roadGraph?.sha256 || live.version !== 1) throw new Error('Live map manifest is not a published version-1 manifest');
  if (near.sourceSha256 !== live.roadGraph.sha256)
    throw new Error(`Near graph was cut from roadGraph ${near.sourceSha256.slice(0, 12)}, but live serves ${live.roadGraph.sha256.slice(0, 12)}: publish the full map instead`);
  if (live.roadGraphNear?.sha256 === near.sha256) return null;
  if (!/^\/map\/near\/[0-9a-f]{64}$/.test(prefix)) throw new Error('Near prefix must be /map/near/<sha256>');
  const at = (asset: Artifact) => `${prefix}/${asset.path}`;
  return { ...live, roadGraphNear: { ...near, path: at(near), ...(near.parts ? { parts: near.parts.map(part => ({ ...part, path: at(part) })) } : {}) } };
}

/** Verify the local near artifacts and build the upload plan: near objects first, the alias manifest last. */
export async function prepareNearPublication(root: string, liveBytes: Buffer, alias: string, directory: string): Promise<{ objects: PublishedObject[]; manifest: LiveManifest } | null> {
  if (!/^[a-z0-9-]+$/.test(alias)) throw new Error('Alias must be a slug');
  root = await realpath(root);
  const local = JSON.parse((await readFile(join(root, 'manifest.json'))).toString()) as MapManifest;
  const near = local.roadGraphNear;
  if (!near) throw new Error('Local bake has no roadGraphNear: run tools/map/roadgraph-subset.mts first');
  const live = JSON.parse(liveBytes.toString()) as LiveManifest;
  const prefix = `/map/near/${near.sha256}`;
  const manifest = patchManifestWithNear(live, near, prefix);
  if (!manifest) return null;
  const objects: PublishedObject[] = [];
  for (const asset of [near, ...(near.parts ?? [])]) {
    if (!/^roadgraph-near(?:-[A-Za-z0-9_-]+)?\.bin$/.test(asset.path)) throw new Error(`Not a near-graph artifact: ${asset.path}`);
    const rawPath = await realpath(join(root, asset.path)), gzPath = await realpath(join(root, `${asset.path}.gz`));
    if (![rawPath, gzPath].every(p => p.startsWith(root + sep))) throw new Error('Near artifact escapes output directory');
    const raw = await readFile(rawPath), compressed = await readFile(gzPath);
    if (raw.length !== asset.bytes || compressed.length !== asset.gzipBytes || digest(raw) !== asset.sha256 || digest(gunzipSync(compressed)) !== asset.sha256)
      throw new Error(`Corrupt near artifact or gzip sibling: ${asset.path}`);
    const file = join(directory, near.sha256, `${asset.path}.gz`);
    await atomicWrite(file, compressed);
    objects.push({ key: `${prefix.slice(1)}/${asset.path}`, file, bytes: compressed.length, decodedBytes: raw.length, sha256: digest(compressed),
      contentType: 'application/octet-stream', contentEncoding: 'gzip', cacheControl: 'public, max-age=31536000, immutable' });
  }
  const encoded = Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), gz = gzipSync(encoded, { level: 9 });
  const file = join(directory, near.sha256, `manifest-${alias}.json.gz`);
  await atomicWrite(file, gz);
  // Intentionally last: until it lands, the previous manifest (full graph only) stays live.
  objects.push({ key: `map/${alias}/manifest.json`, file, bytes: gz.length, decodedBytes: encoded.length, sha256: digest(gz),
    contentType: 'application/json', contentEncoding: 'gzip', cacheControl: 'public, max-age=0, must-revalidate' });
  return { objects, manifest };
}
