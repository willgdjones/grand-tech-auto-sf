import { build, preview } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { arch, cpus, loadavg, platform } from 'node:os';

// Founder 21:40 playtest: unfiltered wall frames, frozen build so ongoing Vite HMR cannot reset samples.
const root = fileURLToPath(new URL('../', import.meta.url)), output = resolve(root, 'artifacts/frame-timing');
await mkdir(output, { recursive: true });
const config = resolve(root, 'web/vite.config.ts'), app = resolve(output, 'app');
await build({ configFile: config, root: resolve(root, 'web'), logLevel: 'warn', build: { outDir: app, emptyOutDir: true, reportCompressedSize: false } });
const server = await preview({ configFile: config, root: resolve(root, 'web'), build: { outDir: app }, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
const headed = process.env.GTASF_FRAME_HEADED === '1';
const browser = await chromium.launch({ headless: true, args: headed ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : [] });
const host = { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, loadAverage: loadavg(), browser: browser.version(), headed };
const errors = [], page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
page.setDefaultTimeout(15000);
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b), mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { frames: samples.length, meanMs: mean, fps: 1000 / mean, p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], maxMs: sorted.at(-1) };
}
try {
  await page.goto(new URL(process.env.GTASF_FRAME_PATH ?? '/go/lombard?perf=1', server.resolvedUrls.local[0]).href);
  await page.waitForFunction(() => window.__gtasf?.ready, undefined, { timeout: 45000 });
  await page.evaluate(() => {
    const world = window.__gtasf.world, costs = {};
    for (const [name, owner, method] of [['collision', world.map, 'collides'], ['camera', world.camera, 'update'], ['stream', world.map, 'update']]) {
      const original = owner[method]; costs[name] = { calls: 0, ms: 0, maxMs: 0 };
      owner[method] = function (...args) { const start = performance.now(); try { return original.apply(this, args); } finally { const duration = performance.now() - start; costs[name].calls++; costs[name].ms += duration; costs[name].maxMs = Math.max(costs[name].maxMs, duration); } };
    }
    window.frameCosts = costs;
    const context = document.querySelector('#world').getContext('webgl2'), debug = context.getExtension('WEBGL_debug_renderer_info');
    window.gpuInfo = debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER);
  });
  await cdp.send('Profiler.start');
  await page.waitForFunction(() => window.__gtasf.perf.samples.length >= 60, undefined, { timeout: 90000 });
  const baseline = await page.evaluate(() => ({ samples: [...window.__gtasf.perf.samples], costs: structuredClone(window.frameCosts), stream: { ...window.__gtasf.world.map.stats }, gpu: window.gpuInfo, pose: { ...window.__gtasf.world.foot } }));
  await writeFile(resolve(output, `${process.argv[2] ?? 'latest'}-baseline.json`), JSON.stringify(baseline, null, 2));
  console.log(JSON.stringify({ baseline: summarize(baseline.samples), costs: baseline.costs, gpu: baseline.gpu }));
  await page.evaluate(() => {
    window.__gtasf.input.virtual = { move: { x: 0, y: 1 }, actions: ['run'] };
    window.__gtasf.perf.samples.length = 0;
    for (const cost of Object.values(window.frameCosts)) { cost.calls = 0; cost.ms = 0; cost.maxMs = 0; }
  });
  await page.waitForFunction(() => window.__gtasf.perf.samples.length >= 60, undefined, { timeout: 90000 });
  const walking = await page.evaluate(() => ({ samples: [...window.__gtasf.perf.samples], costs: window.frameCosts, stream: { ...window.__gtasf.world.map.stats }, collision: window.__gtasf.world.map.collisionStats, pose: { ...window.__gtasf.world.foot } }));
  const { profile } = await cdp.send('Profiler.stop');
  const data = { host, baseline: { ...baseline, summary: summarize(baseline.samples) }, walking: { ...walking, summary: summarize(walking.samples) }, errors };
  const label = process.argv[2] ?? 'latest';
  await writeFile(resolve(output, `${label}.json`), JSON.stringify(data, null, 2));
  await writeFile(resolve(output, `${label}.cpuprofile`), JSON.stringify(profile));
  await page.screenshot({ path: resolve(output, `${label}.png`) });
  console.log(JSON.stringify({ baseline: data.baseline.summary, walking: data.walking.summary, costs: walking.costs, stream: walking.stream, gpu: baseline.gpu, errors }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ errors, diagnostic: await page.evaluate(() => ({ ready: window.__gtasf?.ready, frame: window.__gtasf?.frame, samples: window.__gtasf?.perf.samples, costs: window.frameCosts, gpu: window.gpuInfo, text: document.body.innerText })).catch(() => null) }));
  throw error;
} finally {
  await browser.close(); server.httpServer.closeAllConnections(); await new Promise(resolve => server.httpServer.close(resolve));
}
