import { build } from 'vite';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, 'artifacts/render-foundation');
const mapIndex = process.argv.indexOf('--map');
const map = mapIndex === -1 ? undefined : resolve(root, process.argv[mapIndex + 1] ?? 'tools/map/out/lombard');
if (map) await readFile(resolve(map, 'manifest.json')); // Real-map acceptance must not silently use a fixture.
await mkdir(out, { recursive: true });
await build({
  configFile: false, root: resolve(root, 'web'), logLevel: 'warn',
  build: { outDir: out, emptyOutDir: false, minify: true, reportCompressedSize: false,
    lib: { entry: resolve(root, 'web/src/render/check.ts'), formats: ['es'], fileName: 'check' } },
});
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/') {
    response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}canvas{width:100vw;height:100vh;display:block}</style><canvas></canvas><script type="module" src="/check.js"></script>');
    return;
  }
  const mapRequest = url.pathname.startsWith('/map/');
  const base = mapRequest ? map : out;
  if (!base) { response.writeHead(404).end(); return; }
  const path = resolve(base, `.${decodeURIComponent(mapRequest ? url.pathname.slice(4) : url.pathname)}`);
  if (!path.startsWith(`${base}${sep}`)) { response.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(path);
    response.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.json') ? 'application/json' : 'application/octet-stream');
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true });
  for (const device of [{ name: 'desktop', width: 1100, height: 720, dpr: 1, tier: 'medium' }, { name: 'mobile', width: 390, height: 844, dpr: 3, tier: 'low' }]) {
    const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, deviceScaleFactor: device.dpr });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${url}/?tier=${device.tier}`);
    await page.waitForFunction(() => document.querySelector('canvas')?.dataset.ready === 'true');
    const pixels = await page.evaluate(() => ({ plain: window.renderCheck.samples(false), bloom: window.renderCheck.samples(true), proof: window.renderCheck.bloomProof(), fog: window.renderCheck.farSamples(), sky: window.renderCheck.skySamples(), stats: window.renderCheck.stats() }));
    // Actual GPU output: linear gain then one sRGB encoding. Wrong input/output gamma misses gray badly.
    const expected = [[231,231,231], [115,115,115], [0,0,0], [231,0,0], [0,231,0], [0,0,231], [231,231,0], [0,231,231]];
    pixels.plain.forEach((colour, i) => colour.forEach((value, c) => assert(Math.abs(value - expected[i][c]) <= 4, `${device.name} patch ${i} channel ${c}: ${value}, expected ${expected[i][c]}`)));
    assert(pixels.bloom[0].every(c => c < 245), 'white ad retains highlight headroom');
    assert(pixels.bloom[2].every(c => c < 4), 'bloom preserves black lettering');
    assert(pixels.proof.some(p => p.bloom[0] > p.plain[0]), 'bounded bloom contributes actual GPU pixels');
    for (const colour of pixels.fog) colour.forEach((value, c) => assert(Math.abs(value - [197,205,197][c]) <= 4, 'billboard fades into horizon haze'));
    assert.notDeepEqual(pixels.sky[0], pixels.sky[1], 'sky has a visible vertical gradient');
    assert(pixels.stats.width * pixels.stats.height <= (device.tier === 'low' ? 800_000 : 1_500_000), 'DPR budget');
    await page.screenshot({ path: resolve(out, `${device.name}-text.png`) });
    let geometry;
    if (map) {
      geometry = await page.evaluate(() => window.renderCheck.mountMap());
      assert(geometry.chunks.length > 0 && geometry.sources > 0 && geometry.vertices > 0, 'real sourced geometry mounted');
      assert.equal(geometry.vertices, geometry.colourVertices, 'all real map vertices retain COLOR_0');
      assert(geometry.bounds[1][1] - geometry.bounds[0][1] > 20, 'real relief preserved');
      await page.screenshot({ path: resolve(out, `${device.name}-lombard.png`) });
    }
    assert.deepEqual(errors, [], 'shader/runtime errors');
    results.push({ device: device.name, pixels, geometry, errors });
    await context.close();
  }
  await writeFile(resolve(out, 'evidence.json'), JSON.stringify({ checkedAt: new Date().toISOString(), map: map ?? null, results }, null, 2));
  console.log(JSON.stringify({ ok: true, realMap: Boolean(map), screenshots: out, results }, null, 2));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
