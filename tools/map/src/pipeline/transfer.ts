import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { atomicWrite, digest } from './sources';
import type { MapManifest } from './types';

/** Optional local transport only: never rewrite the manifest or publication inventory. */
export async function writeMapTransfer(root: string): Promise<{
  version: 1; path: string; sha256: string; bytes: number; brotliSha256: string; brotliBytes: number;
}> {
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8')) as MapManifest;
  const artifact = manifest.roadGraph;
  const path = resolve(root, artifact.path);
  if (!path.startsWith(resolve(root) + sep) || !path.endsWith('.bin')) {
    throw new Error('Transfer sidecar requires a packed graph inside the map directory');
  }
  const raw = await readFile(path);
  if (raw.length !== artifact.bytes || digest(raw) !== artifact.sha256) {
    throw new Error('Graph does not match its manifest; refusing transfer sidecar');
  }
  const encoded = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } });
  if (digest(brotliDecompressSync(encoded)) !== artifact.sha256) throw new Error('Brotli round trip failed');
  const receipt = { version: 1 as const, path: artifact.path, sha256: artifact.sha256,
    bytes: raw.length, brotliSha256: digest(encoded), brotliBytes: encoded.length };
  // Metadata is last: a partial/replaced pair fails verification and falls back safely.
  await atomicWrite(`${path}.br`, encoded);
  await atomicWrite(`${path}.br.json`, JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
