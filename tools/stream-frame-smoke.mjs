import { build, preview } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { arch, cpus, loadavg } from 'node:os';
import { createMapRouter } from '../web/src/radar/routing.ts';

// Real RAF, actual driver input and production collision/streaming. No teleports/fixed-step frames.
const root = fileURLToPath(new URL('../', import.meta.url)), out = resolve(root, 'artifacts/stream-frame');
await mkdir(out, { recursive: true });
const configFile = resolve(root, 'web/vite.config.ts'), app = resolve(out, 'app');
if (process.env.GTASF_STREAM_REUSE !== '1') await build({ configFile, root: resolve(root, 'web'), logLevel: 'warn', build: { outDir: app, emptyOutDir: true, reportCompressedSize: false } });
const server = await preview({ configFile, root: resolve(root, 'web'), build: { outDir: app }, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const cdp = await page.context().newCDPSession(page);
function summary(samples) {
  const sorted = [...samples].sort((a, b) => a - b), mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { frames: samples.length, meanMs: mean, fps: 1000 / mean, p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], maxMs: sorted.at(-1), over50: samples.filter(n => n > 50).length };
}
try {
  await page.addInitScript(() => {
    window.gpuUploads = { calls: 0, bytes: 0, ms: 0, maxMs: 0 };
    window.longTasks = [];
    new PerformanceObserver(list => { for (const e of list.getEntries()) window.longTasks.push({ start: e.startTime, duration: e.duration }); }).observe({ type: 'longtask', buffered: true });
    for (const method of ['bufferData', 'bufferSubData']) {
      const original = WebGL2RenderingContext.prototype[method];
      WebGL2RenderingContext.prototype[method] = function (...args) {
        const start = performance.now();
        try { return original.apply(this, args); }
        finally {
          const time = performance.now() - start, source = args[method === 'bufferData' ? 1 : 2];
          window.gpuUploads.calls++; window.gpuUploads.ms += time; window.gpuUploads.maxMs = Math.max(window.gpuUploads.maxMs, time);
          window.gpuUploads.bytes += typeof source === 'number' ? source : source?.byteLength ?? 0;
        }
      };
    }
  });
  await page.goto(`${server.resolvedUrls.local[0]}go/lombard?perf=1`);
  await page.waitForFunction(() => window.__gtasf?.ready, undefined, { timeout: 45000 });
  await page.waitForFunction(() => window.__gtasf.perf.samples.length >= 60, undefined, { timeout: 30000 });
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__gtasf.world.mode === 'driver', undefined, { timeout: 10000 });
  const start = await page.evaluate(() => ({ ...window.__gtasf.world.foot }));
  const graph = JSON.parse(await readFile(resolve(root, 'tools/map/out/lombard/roadgraph-playable.json'), 'utf8'));
  const route = createMapRouter(graph).route(start, { x: -897.138, z: -1999.980 });
  if (!route) throw new Error('No real road route for driver smoke');
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
  await page.evaluate(points => {
    const h = window.__gtasf, trace = [], start = performance.now(), goal = points.at(-1);
    let nearest = 0, previous, stopped = false;
    const gl = document.querySelector('#world').getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info');
    window.streamRun = { trace, started: start, done: false, gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', routePoints: points.length };
    window.gpuUploads = { calls: 0, bytes: 0, ms: 0, maxMs: 0 };
    function frame(now) {
      const w = h.world, p = w.foot;
      if (previous !== undefined) trace.push({ now, dt: now - previous, mode: w.mode, x: p.x, y: p.y, z: p.z, yaw: p.yaw, speed: p.speed, cameraSafe: w.camera.safe, stream: { ...w.map.stats }, uploads: { ...window.gpuUploads } });
      previous = now; window.gpuUploads = { calls: 0, bytes: 0, ms: 0, maxMs: 0 };
      if (w.mode !== 'driver') { stopped = true; window.streamRun.interrupted = `Driver ended during trace: ${w.mode}`; }
      if (Math.hypot(p.x - goal[0], p.z - goal[2]) < 4) { stopped = true; window.streamRun.arrived = true; }
      if (now - start > 65000) { stopped = true; window.streamRun.timedOut = true; }
      if (stopped) { h.input.virtual = { actions: ['handbrake'] }; window.streamRun.done = true; return; }
      let best = Infinity;
      for (let i = Math.max(0, nearest - 2); i < Math.min(points.length, nearest + 24); i++) {
        const q = points[i], distance = Math.hypot(p.x - q[0], p.z - q[2]);
        if (distance < best) { best = distance; nearest = i; }
      }
      let target = nearest, along = 0;
      while (target < points.length - 1 && along < 5) {
        const a = points[target], b = points[++target]; along += Math.hypot(b[0] - a[0], b[2] - a[2]);
      }
      const q = points[target], dx = q[0] - p.x, dz = q[2] - p.z, distance = Math.max(1, Math.hypot(dx, dz));
      const alpha = Math.atan2(Math.sin(Math.atan2(dx, dz) - p.yaw), Math.cos(Math.atan2(dx, dz) - p.yaw));
      const desired = Math.atan2(2 * 2.8 * Math.sin(alpha), distance);
      const speed = Math.abs(p.speed ?? 0), steer = -desired / (.55 / (1 + speed * .035));
      h.input.virtual = { steer: Math.max(-1, Math.min(1, steer)), throttle: speed < 4.1 ? .65 : 0, brake: speed > 4.5 ? .25 : 0 };
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }, route.points);
  console.log(JSON.stringify({ phase: 'driving', start, routeMetres: route.distanceM }));
  await page.waitForFunction(() => window.streamRun.done, undefined, { timeout: 75000 });
  const result = await page.evaluate(() => ({ ...window.streamRun, longTasks: window.longTasks, end: { ...window.__gtasf.world.foot }, finalStream: { ...window.__gtasf.world.map.stats } }));
  const { profile } = await cdp.send('Profiler.stop');
  const samples = result.trace.map(f => f.dt), loaded = result.trace.filter(f => f.stream.bytesThisFrame > 0);
  const evidence = { host: { arch: arch(), cpu: cpus()[0]?.model, loadAverage: loadavg() }, ...result, summary: summary(samples), uploadFrames: loaded.map(f => ({ ms: f.dt, bytes: f.stream.bytesThisFrame, gpu: f.uploads, now: f.now })), errors };
  await writeFile(resolve(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
  await writeFile(resolve(out, 'drive.cpuprofile'), JSON.stringify(profile));
  await page.screenshot({ path: resolve(out, 'drive.png') });
  console.log(JSON.stringify({ gpu: result.gpu, summary: evidence.summary, start, end: result.end, arrived: result.arrived ?? false, interrupted: result.interrupted, uploadFrames: evidence.uploadFrames, activeLongTasks: result.longTasks.filter(task => task.start >= result.started), errors }, null, 2));
  if (result.interrupted) throw new Error(result.interrupted);
} catch (error) {
  const diagnostic = { failure: String(error), errors, page: await page.evaluate(() => ({ text: document.body.innerText, ready: window.__gtasf?.ready, status: window.__gtasf?.status, errors: window.__gtasf?.errors })).catch(() => null) };
  await writeFile(resolve(out, 'failure.json'), JSON.stringify(diagnostic, null, 2));
  console.log(JSON.stringify(diagnostic, null, 2)); throw error;
} finally { await browser.close(); server.httpServer.closeAllConnections(); await new Promise(resolve => server.httpServer.close(resolve)); }
