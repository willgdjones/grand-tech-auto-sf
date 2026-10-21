import { build, preview } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { localMapPlugin } from '../web/mapLocalPlugin.ts';

const root = fileURLToPath(new URL('../', import.meta.url)), out = resolve(root, 'artifacts/map-stream');
await mkdir(out, { recursive: true });
await build({ configFile: false, root: resolve(root, 'web'), logLevel: 'warn', build: {
  outDir: out, emptyOutDir: false, minify: true, reportCompressedSize: false, target: 'es2022',
  lib: { entry: resolve(root, 'web/src/render/chunks/check.ts'), formats: ['es'], fileName: 'check' },
} });
await writeFile(resolve(out, 'index.html'), '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}canvas{width:100vw;height:100vh;display:block}</style><canvas></canvas><script type="module" src="/check.js"></script>');
const server = await preview({ configFile: false, root: resolve(root, 'web'), plugins: [localMapPlugin()], build: { outDir: out }, preview: { host: '127.0.0.1', port: 0, strictPort: false } });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } }), errors = [], workers = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('worker', worker => workers.push(worker.url()));
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => window.mapSmoke?.ready(), undefined, { timeout: 45_000 });
  const loaded = await page.evaluate(() => window.mapSmoke.evidence());
  assert.equal(loaded.maxUploads, 1); assert.equal(loaded.errors.length, 0);
  assert(Math.abs(loaded.surface - 85.954) < .02); assert.equal(loaded.colliding, false);
  assert(loaded.cameraBoxes > 100 && loaded.geometries >= 5); assert(workers.length >= 2);
  await page.screenshot({ path: resolve(out, 'lombard.png') });
  const moved = await page.evaluate(() => window.mapSmoke.move());
  assert(Number.isFinite(moved.ground));
  const disposed = await page.evaluate(() => window.mapSmoke.dispose());
  assert.equal(disposed.boxes, 0); assert(disposed.geometries < loaded.geometries);
  assert.deepEqual(errors, []);
  const evidence = { loaded, moved, disposed, workers: workers.length, errors };
  await writeFile(resolve(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser?.close(); server.httpServer.closeAllConnections(); await new Promise(resolve => server.httpServer.close(resolve));
}
