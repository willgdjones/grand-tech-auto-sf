import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { resolve, join } from 'node:path';
const sources = JSON.parse(await readFile(new URL('./sources.json', import.meta.url), 'utf8'));
const cache = resolve(process.argv[2] || 'tools/assets/cache');
await mkdir(cache, { recursive: true });
for (const key of ['kenney', 'train', 'hoodie', 'rgsdev']) {
  const source = sources[key], path = join(cache, `${key}.${key === 'hoodie' ? 'glb' : 'zip'}`);
  let bytes;
  try { bytes = await readFile(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`${key}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    // Fetch normally decodes HTTP Content-Encoding already. Handle raw .br downloads too.
    if (key === 'hoodie' && bytes.toString('utf8', 0, 4) !== 'glTF') bytes = brotliDecompressSync(bytes);
  }
  if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`${key}: source checksum changed; review provenance before updating`);
  await writeFile(path, bytes);
  if (key !== 'hoodie') execFileSync('unzip', ['-q', '-o', path, '-d', join(cache, key)]);
  console.log(`Verified ${key}`);
}
