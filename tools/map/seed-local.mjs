import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = join(root, 'tools/map/out');
let area = process.env.GTASF_MAP_AREA;
if (!area && existsSync(join(output, 'active-map.json'))) area = JSON.parse(await readFile(join(output, 'active-map.json'), 'utf8')).area;
area ??= 'lombard';
if (!/^[a-z0-9_-]+$/.test(area)) throw new Error('Invalid GTASF_MAP_AREA');
const directory = join(output, area), manifestPath = join(directory, 'manifest.json');
if (!existsSync(manifestPath)) throw new Error(`Build the selected local map (${area}) before npm run dev.`);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')), graph = manifest.roadGraph;
if (graph?.encoding !== 'roadpack-v1' || typeof graph.path !== 'string' || !/^[a-f0-9]{64}$/.test(graph.sha256)) throw new Error('Local map needs a packed road graph');
const path = resolve(directory, graph.path);
if (!path.startsWith(directory + sep) || !path.endsWith('.bin')) throw new Error('Invalid local road graph path');
const bytes = await readFile(path);
if (createHash('sha256').update(bytes).digest('hex') !== graph.sha256) throw new Error('Local road graph hash mismatch');
const key = `map/releases/${graph.sha256}/roadgraph.bin`;
const temporary = await mkdtemp(join(tmpdir(), 'gtasf-map-'));
function put(key, file) {
  const result = spawnSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'),
    'r2', 'object', 'put', `gtasf-assets-local/${key}`, '--file', file, '--local', '--config', join(root, 'worker/wrangler.toml')],
  { cwd: root, encoding: 'utf8', maxBuffer: 2_000_000, env: { ...process.env, CI: '1' } });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write((result.stderr || result.stdout || '').slice(-4000));
    throw new Error('Local road graph seed failed');
  }
}
try {
  const localManifest = join(temporary, 'manifest.json');
  await writeFile(localManifest, JSON.stringify({ requiredFeatures: manifest.requiredFeatures, roadGraph: { ...graph, path: key } }));
  // Write immutable data first, then switch the local manifest. Never touches remote R2.
  put(key, path); put('map/lombard/manifest.json', localManifest);
  console.log(`Local Worker uses ${area} roads (${bytes.byteLength} bytes), matching the browser map.`);
} finally { await rm(temporary, { recursive: true, force: true }); }
