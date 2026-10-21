/** Read-only complete manifest HTTP compression comparison. Run via tools/heavy.sh.
 * No asset, manifest, reader or publication changes. Each decoded body is verified.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';

const root = await realpath(resolve(process.argv[2] ?? 'tools/map/out/compact-zzpr-recipes'));
const output = process.argv[3] ?? 'docs/perf/map-zzpr/brotli-probe.json';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const inventoryBytes = await readFile(resolve(root, 'runtime-inventory.json'));
const inventory = JSON.parse(inventoryBytes.toString()) as { files: { path: string; bytes: number; gzipBytes: number; sha256: string }[]; gzipBytes: number };
const started = performance.now();
const records: { path: string; sha256: string; bytes: number; gzipBytes: number; brotli6Bytes: number }[] = [];
const groups = new Map<string, { files: number; bytes: number; gzipBytes: number; brotli6Bytes: number }>();
for (const file of inventory.files) {
  const path = await realpath(resolve(root, file.path)); assert(path.startsWith(root + sep));
  const body = await readFile(path); assert.equal(body.length, file.bytes); assert.equal(sha(body), file.sha256);
  const compressed = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } });
  assert(brotliDecompressSync(compressed).equals(body), `Exact decoded body: ${file.path}`);
  const name = file.path.split('/').at(-1)!;
  const group = groups.get(name) ?? { files: 0, bytes: 0, gzipBytes: 0, brotli6Bytes: 0 };
  group.files++; group.bytes += body.length; group.gzipBytes += file.gzipBytes; group.brotli6Bytes += compressed.length; groups.set(name, group);
  records.push({ path: file.path, sha256: file.sha256, bytes: body.length, gzipBytes: file.gzipBytes, brotli6Bytes: compressed.length });
}
const sum = (field: 'bytes' | 'gzipBytes' | 'brotli6Bytes') => records.reduce((n, record) => n + record[field], 0);
assert.equal(sum('gzipBytes'), inventory.gzipBytes);
const summary = { files: records.length, bytes: sum('bytes'), gzipBytes: sum('gzipBytes'), brotli6Bytes: sum('brotli6Bytes'),
  compressedTargetBytes: 25_000_000, belowTargetOffline: sum('brotli6Bytes') <= 25_000_000,
  maxEncodedArtifactBytes: Math.max(...records.map(r => r.bytes)), maxBrotli6Bytes: Math.max(...records.map(r => r.brotli6Bytes)),
  exactDecodedBodies: records.length, elapsedMs: performance.now() - started, groups: Object.fromEntries(groups) };
await writeFile(output, JSON.stringify({ root, inventorySha256: sha(inventoryBytes),
  manifestSha256: sha(await readFile(resolve(root, 'manifest.json'))), scriptSha256: sha(await readFile(new URL(import.meta.url))),
  node: process.version, summary, records,
  note: 'Offline encoded body sizes for every unique manifest runtime asset and the source manifest. This is not observed CDN transfer or a complete publication inventory: legacy runtime extras and dual publication manifests/app bytes are excluded. No Brotli runtime/publisher support, emitted Brotli siblings, activation or upload. All decoded bodies match the source hashes.' }, null, 2) + '\n');
console.log(JSON.stringify({ output, summary }));
