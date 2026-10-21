/** Run with tools/heavy.sh. Reads an existing build; never builds or deploys.
 * GTASF_COLD_INVENTORY_ONLY=1 writes inventory/source receipts without opening a browser.
 */
import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, brotliDecompressSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { cpus, loadavg } from 'node:os';

const root = process.cwd();
const app = resolve(process.env.GTASF_COLD_APP ?? 'web/dist');
const out = resolve(process.env.GTASF_COLD_OUT ?? 'docs/perf/d5-2026-10-04/baseline');
const area = process.env.GTASF_MAP_AREA ?? JSON.parse(await readFile('tools/map/out/active-map.json', 'utf8')).area;
process.env.GTASF_MAP_AREA = area;
const mapRoot = resolve('tools/map/out', area);
const sha = b => createHash('sha256').update(b).digest('hex');
const sharp = createRequire(new URL('./assets/package.json', import.meta.url))('sharp');
await mkdir(out, { recursive: true });
const write = (name, value) => writeFile(resolve(out, name), JSON.stringify(value, null, 2) + '\n');
async function walk(path) {
  const files = [];
  for (const item of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, item.name);
    if (item.isDirectory()) files.push(...await walk(child));
    else if (item.isFile()) files.push(child);
  }
  return files.sort();
}
async function imageInfo(buffer) {
  try {
    const m = await sharp(buffer).metadata();
    return { width: m.width, height: m.height, rgba8Bytes: m.width * m.height * 4 };
  } catch { return undefined; }
}
async function describe(path, base) {
  const bytes = await readFile(path), suffix = extname(path).toLowerCase();
  const entry = { path: relative(base, path), fileBytes: bytes.length, sha256: sha(bytes),
    gzipEstimateBytes: gzipSync(bytes, { level: 6 }).length };
  if (['.webp', '.png', '.jpg', '.jpeg', '.avif'].includes(suffix)) entry.decodedImage = await imageInfo(bytes);
  if (suffix === '.glb' && bytes.readUInt32LE(0) === 0x46546c67) {
    const jsonLength = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
    const bin = bytes.subarray(28 + jsonLength);
    entry.embeddedImages = [];
    for (const image of json.images ?? []) {
      const view = json.bufferViews?.[image.bufferView];
      if (view) entry.embeddedImages.push(await imageInfo(bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)) ?? { mimeType: image.mimeType });
    }
  }
  return entry;
}
const emitted = [];
for (const path of await walk(app)) emitted.push(await describe(path, app));
const manifestBytes = await readFile(resolve(mapRoot, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const mapPaths = new Set(['manifest.json', manifest.roadGraph.path]);
if (manifest.neighbourhoods) mapPaths.add(manifest.neighbourhoods.path);
if (manifest.coastline) mapPaths.add(manifest.coastline.path);
for (const chunk of manifest.chunks) for (const file of [...chunk.lods, chunk.terrain, chunk.collision]) mapPaths.add(file.path);
const mapFiles = [];
for (const path of [...mapPaths].sort()) {
  const bytes = await readFile(resolve(mapRoot, path));
  let servedBytes = bytes.length, encoding = 'identity';
  try {
    const br = await readFile(resolve(mapRoot, path + '.br'));
    const receipt = JSON.parse(await readFile(resolve(mapRoot, path + '.br.json'), 'utf8'));
    if (receipt.sha256 === sha(bytes) && receipt.brotliSha256 === sha(br) && brotliDecompressSync(br).equals(bytes)) {
      servedBytes = br.length; encoding = 'br';
    }
  } catch { /* Preview falls back to gzip or identity when no verified Brotli exists. */ }
  if (encoding === 'identity') try {
    const gz = await readFile(resolve(mapRoot, path + '.gz'));
    servedBytes = gz.length; encoding = 'gzip';
  } catch { /* identity */ }
  mapFiles.push({ path, decodedBodyBytes: bytes.length, servedBodyBytes: servedBytes, encoding, sha256: sha(bytes) });
}
const sum = (list, field) => list.reduce((n, entry) => n + entry[field], 0);
const inventory = { recordedAt: new Date().toISOString(), app, mapArea: area,
  definitions: { fileBytes: 'Emitted file bytes before HTTP content-encoding.', gzipEstimateBytes: 'Local gzip level 6 estimate, NOT observed CDN transfer.',
    decodedBodyBytes: 'Bytes after HTTP decompression, NOT GPU allocations.', rgba8Bytes: 'Image width × height × 4, excludes mipmaps, PMREM and geometry.' },
  emittedFileBytes: sum(emitted, 'fileBytes'), emittedGzipEstimateBytes: sum(emitted, 'gzipEstimateBytes'),
  mapDecodedBodyBytes: sum(mapFiles, 'decodedBodyBytes'), mapServedBodyBytes: sum(mapFiles, 'servedBodyBytes'),
  emitted, mapFiles };
inventory.budgets = { emittedWithin80MB: inventory.emittedFileBytes <= 80_000_000,
  emittedPlusServedMapWithin80MB: inventory.emittedFileBytes + inventory.mapServedBodyBytes <= 80_000_000,
  mapWithin25MB: inventory.mapServedBodyBytes <= 25_000_000,
  emittedFilesOver25MB: emitted.filter(f => f.fileBytes > 25_000_000).map(f => f.path),
  mapFilesOver25MB: mapFiles.filter(f => f.servedBodyBytes > 25_000_000 || f.decodedBodyBytes > 25_000_000).map(f => f.path) };
await write('inventory.json', inventory);
await write('source.json', { recordedAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirtyPaths: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim().split('\n'),
  flagsSha256: sha(await readFile('shared/flags.ts')), mapManifestSha256: sha(manifestBytes),
  node: process.version, cpu: cpus()[0]?.model, loadAverage: loadavg(),
  query: Object.fromEntries([...new URLSearchParams(process.env.GTASF_COLD_QUERY ?? '')].map(([k, v]) => [k, ['gfx', 'preset', 'at'].includes(k) ? v : '[redacted]'])),
  note: 'Existing local source-flags build. Local active map and API, not production/CDN evidence. Source can advance in the shared checkout; emitted hashes pin the tested build.' });

if (process.env.GTASF_COLD_INVENTORY_ONLY === '1') {
  console.log(JSON.stringify({ scope: 'inventory-only; no READY or browser acceptance', emittedFileBytes: inventory.emittedFileBytes,
    mapServedBodyBytes: inventory.mapServedBodyBytes, budgets: inventory.budgets }));
  process.exit(0);
}

const server = await preview({ configFile: resolve(root, 'web/vite.config.ts'), root: resolve(root, 'web'),
  build: { outDir: app }, preview: { host: '127.0.0.1', port: 0,
    proxy: { '/api': { target: process.env.GTASF_COLD_API ?? 'http://127.0.0.1:8787', ws: true } } } });
let browser;
const errors = [], requests = new Map(), events = [];
const safeUrl = raw => {
  try { const url = new URL(raw); if (url.protocol === 'blob:') return 'blob:local-worker'; return url.origin.replace(/http:\/\/127\.0\.0\.1:\d+/, 'http://local-preview') + url.pathname; }
  catch { return raw.split('?')[0]; }
};
try {
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  page.on('pageerror', e => errors.push({ kind: 'pageerror', message: e.message }));
  page.on('console', e => { if (e.type() === 'error') errors.push({ kind: 'console', message: e.text() }); });
  let navigationTs;
  cdp.on('Network.requestWillBeSent', e => {
    if (e.type === 'Document' && navigationTs === undefined) navigationTs = e.timestamp;
    const request = { id: e.requestId, url: safeUrl(e.request.url), method: e.request.method, type: e.type, start: e.timestamp,
      initiator: e.initiator.type, receivedBodyBytes: 0, receivedEncodedBytes: 0 };
    requests.set(e.requestId, request); events.push({ event: 'request', timestamp: e.timestamp, ...request });
  });
  cdp.on('Network.responseReceived', e => {
    const fields = { status: e.response.status, mimeType: e.response.mimeType,
      encoding: e.response.headers['content-encoding'] ?? e.response.headers['Content-Encoding'] ?? 'identity',
      fromDiskCache: e.response.fromDiskCache ?? false, fromServiceWorker: e.response.fromServiceWorker ?? false };
    Object.assign(requests.get(e.requestId) ?? {}, fields);
    events.push({ event: 'response', id: e.requestId, timestamp: e.timestamp, ...fields });
  });
  cdp.on('Network.dataReceived', e => {
    events.push({ event: 'data', id: e.requestId, timestamp: e.timestamp, decodedBytes: e.dataLength, encodedBytes: e.encodedDataLength });
  });
  cdp.on('Network.loadingFinished', e => events.push({ event: 'finished', id: e.requestId, timestamp: e.timestamp, transferredBytes: e.encodedDataLength }));
  cdp.on('Network.loadingFailed', e => events.push({ event: 'failed', id: e.requestId, timestamp: e.timestamp, error: e.errorText }));
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(3000);
    window.__cold = { readyAt: null, loadingCardHiddenAt: null, failed: false, loadingStages: [], longTasks: [] };
    new PerformanceObserver(list => { for (const e of list.getEntries()) window.__cold.longTasks.push({ start: e.startTime, duration: e.duration }); }).observe({ type: 'longtask', buffered: true });
    const observer = new MutationObserver(() => {
      const card = document.querySelector('#loading'), canvas = document.querySelector('#world');
      const stage = document.querySelector('#loading-detail')?.textContent;
      if (stage && stage !== window.__cold.loadingStages.at(-1)?.text) window.__cold.loadingStages.push({ at: performance.now(), text: stage });
      if (card?.classList.contains('failed')) window.__cold.failed = true;
      if (card?.hidden && window.__cold.loadingCardHiddenAt === null) window.__cold.loadingCardHiddenAt = performance.now();
      // main hides the card before awaiting onboarding and starting the render loop.
      // Its data-ready mutation runs in update; this observer runs after that frame renders.
      if (card?.hidden && canvas?.style.visibility === 'visible' && canvas?.dataset.ready === 'true'
        && window.__cold.readyAt === null) window.__cold.readyAt = performance.now();
    });
    observer.observe(document, { subtree: true, attributes: true, childList: true, characterData: true });
  });
  let failure;
  try {
    await page.goto(server.resolvedUrls.local[0] + (process.env.GTASF_COLD_QUERY ?? ''), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__cold && (window.__cold.readyAt !== null || window.__cold.failed), undefined, { timeout: 120000 });
    if (await page.evaluate(() => window.__cold.failed)) failure = 'Loading card failed; see loadingStages and errors.';
  } catch (error) { failure = String(error); }
  const state = await page.evaluate(() => ({ ...window.__cold, sampledAt: performance.now(),
    connected: document.querySelector('#world')?.dataset.connected,
    resources: performance.getEntriesByType('resource').map(e => ({ url: e.name, startTime: e.startTime, responseEnd: e.responseEnd,
      transferBytes: e.transferSize, encodedBodyBytes: e.encodedBodySize, decodedBodyBytes: e.decodedBodySize, duration: e.duration })) }));
  const through = navigationTs + (state.readyAt ?? state.sampledAt) / 1000;
  const trace = events.filter(e => e.timestamp <= through);
  const rows = [...requests.values()].filter(r => r.start <= through).map(r => {
    const data = trace.filter(e => e.id === r.id), end = data.find(e => e.event === 'finished');
    return { ...r, startMs: (r.start - navigationTs) * 1000, finishMs: end ? (end.timestamp - navigationTs) * 1000 : null,
      decodedBytesReceived: sum(data.filter(e => e.event === 'data'), 'decodedBytes'),
      transferBytes: end?.transferredBytes ?? sum(data.filter(e => e.event === 'data'), 'encodedBytes'), completeAtReady: Boolean(end),
      failed: data.find(e => e.event === 'failed')?.error };
  });
  const transferBytes = sum(rows, 'transferBytes');
  await write('network.json', { navigationTimestamp: navigationTs, throughTimestamp: through, events: trace });
  await write('cold-load.json', { ...state, resources: state.resources.filter(r => r.responseEnd <= (state.readyAt ?? state.sampledAt)).map(r => ({ ...r, url: safeUrl(r.url) })),
    failure, errors, readyDefinition: 'Loading card hidden, canvas visible, and ordinary render-loop data-ready observed after the first frame.',
    cache: 'Fresh browser context; HTTP cache disabled; service workers blocked.',
    transferDefinition: 'CDP encodedDataLength includes headers for completed requests; in-flight requests count received encoded body chunks only (lower bound). No WebSocket frames counted.',
    transferBytes, within15MB: !failure && errors.length === 0 && transferBytes <= 15_000_000, requests: rows });
  await page.screenshot({ path: resolve(out, 'ready.png') });
  console.log(JSON.stringify({ readyMs: state.readyAt, transferBytes, requests: rows.length, errors: errors.length, failure,
    emittedFileBytes: inventory.emittedFileBytes, mapServedBodyBytes: inventory.mapServedBodyBytes, budgets: inventory.budgets }));
  if (failure || errors.length) process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(done => server.httpServer.close(done));
}
