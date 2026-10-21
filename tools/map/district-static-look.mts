/** Reuse a frozen app build with the candidate map and a disposable real Worker.
 * Run through tools/heavy.sh with Node from .nvmrc; this never builds the web app.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, relative, sep, join, basename, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { preview, type PreviewServer } from 'vite';
import { startLocalPool } from '../local-pool/pool.mjs';

const appInventoryPath = process.env.GTASF_DISTRICT_APP_INVENTORY ?? 'docs/perf/d5-2026-10-04/after/inventory.json';
const baseline = JSON.parse(await readFile(appInventoryPath, 'utf8')) as {
  app: string; emitted: { path: string; fileBytes: number; sha256: string; gzipEstimateBytes: number; [key: string]: unknown }[];
};
const app = resolve(baseline.app), root = resolve(process.env.GTASF_DISTRICT_MAP_ROOT ?? 'tools/map/out/district-tm7m'), art = resolve(root, 'art');
assert.equal(dirname(root),resolve('tools/map/out'),'Candidate belongs to local map output');
assert(/^[a-z0-9_-]+$/.test(basename(root)),'Candidate name matches the local map selector');
const out = resolve('artifacts/district-static', new Date().toISOString().replaceAll(':', '-'));
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const rollout = JSON.parse(await readFile(join(root, 'district-rollout.json'), 'utf8'));
assert.equal(sha(await readFile(join(root, 'manifest.json'))), rollout.manifestSha256);
const kerbs = JSON.parse(await readFile(join(root, 'district-roads-smoke.json'), 'utf8'));
assert(kerbs.passed && !kerbs.checkOnly && kerbs.mapRoot === root && kerbs.artRoot === art, 'Paired kerbs required');
await mkdir(out, { recursive: true });
async function verifyFrozenApp() {
  for (const file of baseline.emitted) {
    const path = resolve(app, file.path);
    assert(path.startsWith(app + sep), 'App inventory path stays inside the frozen build');
    const bytes = await readFile(path);
    assert.equal(bytes.length, file.fileBytes, file.path);
    assert.equal(sha(bytes), file.sha256, `Frozen app changed: ${file.path}`);
  }
}
await verifyFrozenApp();
const emitted = baseline.emitted.filter(file => file.path !== 'art/road-details.json' && !file.path.startsWith('art/district-roads/'));
for (const path of [join(art, 'road-details.json'), ...(await readdir(join(art, 'district-roads'))).map(file => join(art, 'district-roads', file))]) {
  const bytes = await readFile(path);
  emitted.push({ path: `art/${relative(art, path)}`, fileBytes: bytes.length, sha256: sha(bytes), gzipEstimateBytes: gzipSync(bytes, { level: 6 }).length });
}
emitted.sort((a, b) => a.path.localeCompare(b.path));
const map = JSON.parse(await readFile(join(root, 'runtime-inventory.json'), 'utf8'));
const mapTransfer = JSON.parse(await readFile(join(root, 'roadgraph.bin.br.json'), 'utf8'));
assert.equal(mapTransfer.sha256, sha(await readFile(join(root, 'roadgraph.bin'))));
assert.equal(mapTransfer.brotliSha256, sha(await readFile(join(root, 'roadgraph.bin.br'))));
const servedMapBytes = map.gzipBytes - map.files.find((file: { path: string }) => file.path === 'roadgraph.bin').gzipBytes + mapTransfer.brotliBytes;
const emittedRawBytes = emitted.reduce((sum, file) => sum + file.fileBytes, 0);
const emittedGzipEstimateBytes = emitted.reduce((sum, file) => sum + file.gzipEstimateBytes, 0);
const inventory = { app, mapRoot: root, reusedAppInventory: resolve(appInventoryPath), emitted, mapFiles: map.files,
  emittedRawBytes, emittedGzipEstimateBytes, mapRawBytes: map.rawBytes, mapGzipBytes: map.gzipBytes, locallyServedMapBytes: servedMapBytes,
  budgets: { map25MB: map.gzipBytes <= 25_000_000,
    total80MB: emittedGzipEstimateBytes + servedMapBytes <= 80_000_000,
    individual25MB: Math.max(map.maximumFileBytes, ...emitted.map(file => file.fileBytes)) <= 25_000_000 },
  definitions: { emittedGzipEstimateBytes: 'Local gzip level 6 estimate, not measured CDN transfer.',
    locallyServedMapBytes: 'Verified Brotli graph plus gzip map artifacts, including manifest.',
    rawBytes: 'HTTP-decoded file bytes, not GPU or JS heap allocations.' },
};
await writeFile(join(out, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
const frozen = { kind: 'frozen-local-build', app, sourceSha256: sha(JSON.stringify(baseline.emitted.map(file => [file.path, file.sha256]))),
  manifestSha256: rollout.manifestSha256, inventory: join(out, 'inventory.json'), productionAccepted: false };
const receipt = join(out, 'source.json');
await writeFile(receipt, JSON.stringify(frozen, null, 2) + '\n');

process.env.GTASF_MAP_AREA = basename(root);
let pool: Awaited<ReturnType<typeof startLocalPool>> | undefined, server: PreviewServer | undefined;
try {
  pool = await startLocalPool();
  await writeFile(join(out, 'worker.json'), JSON.stringify({ bundleSha256: sha(await readFile(pool.bundlePath)),
    eventCount: pool.eventCount, migrations: pool.migrations, disposable: true }, null, 2) + '\n');
  server = await preview({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), build: { outDir: app },
    preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: pool.url.origin, ws: true }, '/claim': { target: pool.url.origin } } },
    plugins: [{ name: 'district-candidate-art', configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '/').split('?')[0]!;
        if (pathname !== '/art/road-details.json' && !pathname.startsWith('/art/district-roads/')) return next();
        void (async () => {
          const path = resolve(art, decodeURIComponent(pathname.slice('/art/'.length)));
          if (!path.startsWith(art + sep) || !path.endsWith('.json')) { res.writeHead(403).end(); return; }
          const info = await stat(path); assert(info.isFile());
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': info.size, 'Cache-Control': 'no-cache' });
          if (req.method === 'HEAD') res.end(); else createReadStream(path).on('error', () => res.destroy()).pipe(res);
        })().catch(() => { if (!res.headersSent) res.writeHead(404); res.end('Candidate art missing'); });
      });
    } }],
  });
  const base = server.resolvedUrls!.local[0]!;
  assert.equal(sha(Buffer.from(await (await fetch(new URL('/map/lombard/manifest.json', base))).arrayBuffer())), rollout.manifestSha256);
  assert.equal((await (await fetch(new URL('/art/district-roads/manifest.json', base))).json()).cells.length, 823);
  console.log(`FROZEN_DISTRICT_PREVIEW ${base} ${out}`);
  const child = spawn(process.execPath, ['--import', 'tsx', 'tools/map/district-look.mjs', ...process.argv.slice(2)], {
    stdio: 'inherit', env: { ...process.env, GTASF_LOOK_URL: base, GTASF_LOOK_SOURCE_RECEIPT: receipt, GTASF_LOOK_OUTPUT_DIR: join(out, 'views') },
  });
  const forward = (signal: NodeJS.Signals) => { child.kill(signal); };
  const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  try { process.exitCode = await new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); }); }
  finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }
  await verifyFrozenApp();
} finally {
  if (server) {
    if ('closeAllConnections' in server.httpServer) server.httpServer.closeAllConnections();
    await new Promise<void>(resolve => server!.httpServer.close(() => resolve()));
  }
  await pool?.close();
  console.log(`FROZEN_DISTRICT_REPORT ${out}`);
}
