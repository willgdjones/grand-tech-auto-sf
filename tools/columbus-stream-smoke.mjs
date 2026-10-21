/** Actual wall frames and controller-driven travel; never mutates poses or game time. */
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { arch, cpus, loadavg } from 'node:os';
import { createMapRouter } from '../web/src/radar/routing.ts';

const root = process.cwd(), out = resolve(process.env.GTASF_STREAM_OUT ?? 'artifacts/columbus-stream');
const area = process.env.GTASF_MAP_AREA ?? 'sf';
process.env.GTASF_MAP_AREA = area;
await mkdir(out, { recursive: true });
const configFile = resolve(root, 'web/vite.config.ts'), app = resolve(process.env.GTASF_STREAM_APP ?? `${out}/app`);
if (!process.env.GTASF_STREAM_APP) await build({ configFile, root: resolve(root, 'web'), logLevel: 'warn', build: { outDir: app, emptyOutDir: true, reportCompressedSize: false } });
const server = await preview({ configFile, root: resolve(root, 'web'), build: { outDir: app }, preview: { host: '127.0.0.1', port: 0 } });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } }), errors = [], httpErrors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) httpErrors.push({ url: r.url(), status: r.status() }); });
const cdp = await page.context().newCDPSession(page);
const network = new Map();
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
cdp.on('Network.requestWillBeSent', e => network.set(e.requestId, { url: e.request.url, started: e.timestamp, type: e.type }));
cdp.on('Network.responseReceived', e => Object.assign(network.get(e.requestId) ?? {}, {
  status: e.response.status, mimeType: e.response.mimeType, encoding: e.response.headers['Content-Encoding'] ?? e.response.headers['content-encoding'],
  fromDiskCache: e.response.fromDiskCache, fromServiceWorker: e.response.fromServiceWorker,
}));
cdp.on('Network.loadingFinished', e => Object.assign(network.get(e.requestId) ?? {}, { transferredBytes: e.encodedDataLength, finished: e.timestamp }));
function summary(frames) {
  const times = frames.map(f => f.dt), sorted = [...times].sort((a, b) => a - b), mean = times.reduce((a, b) => a + b, 0) / times.length;
  return { frames: times.length, meanMs: mean, fps: 1000 / mean, p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], maxMs: sorted.at(-1), over50: times.filter(n => n > 50).length };
}
function densify(points) {
  const result = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], steps = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]));
    for (let n = 0; n < steps; n++) result.push(a.map((v, k) => v + (b[k] - v) * n / steps));
  }
  return [...result, points.at(-1)];
}
try {
  await page.addInitScript(() => {
    window.gpuUploads = { calls: 0, bytes: 0, ms: 0, maxMs: 0 }; window.longTasks = [];
    new PerformanceObserver(list => { for (const e of list.getEntries()) window.longTasks.push({ start: e.startTime, duration: e.duration }); }).observe({ type: 'longtask', buffered: true });
    for (const method of ['bufferData', 'bufferSubData']) {
      const original = WebGL2RenderingContext.prototype[method];
      WebGL2RenderingContext.prototype[method] = function (...args) {
        const start = performance.now();
        try { return original.apply(this, args); } finally {
          const ms = performance.now() - start, source = args[method === 'bufferData' ? 1 : 2];
          window.gpuUploads.calls++; window.gpuUploads.ms += ms; window.gpuUploads.maxMs = Math.max(window.gpuUploads.maxMs, ms);
          window.gpuUploads.bytes += typeof source === 'number' ? source : source?.byteLength ?? 0;
        }
      };
    }
  });
  await page.goto(`${server.resolvedUrls.local[0]}?perf=1`);
  await page.waitForSelector('#world[data-ready="true"][data-connected="true"]', { timeout: 60000 });
  await page.waitForSelector('#loading', { state: 'hidden' });
  const coldResources = await page.evaluate(() => performance.getEntriesByType('resource').map(e => ({
    url: e.name, transferBytes: e.transferSize, encodedBodyBytes: e.encodedBodySize, decodedBodyBytes: e.decodedBodySize, duration: e.duration,
  })));
  const coldLoad = { readyAt: await page.evaluate(() => performance.now()), resources: coldResources,
    transferredBytes: [...network.values()].reduce((sum, r) => sum + (r.transferredBytes ?? 0), 0), requests: [...network.values()] };
  coldLoad.within15MB = coldLoad.transferredBytes <= 15_000_000;
  await writeFile(resolve(out, 'cold-load.json'), JSON.stringify(coldLoad, null, 2));
  const onboarding = page.locator('.gt-funding-onboarding[open]');
  await onboarding.waitFor();
  await page.getByLabel('Startup name', { exact: true }).fill(`Columbus QA ${Date.now().toString(36)}`);
  await page.getByLabel('Your nickname', { exact: true }).fill('City Driver');
  await onboarding.getByRole('button', { name: 'Save startup', exact: true }).click();
  await onboarding.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.__gtasf.capture), false);
  await page.screenshot({ path: resolve(out, 'ferry-start.png') });
  // Shared local players may have moved the starter. Walk to its actual server
  // position through ordinary movement before entering; never reset the fleet.
  await page.evaluate(() => {
    const h=window.__gtasf,w=h.world,started=performance.now();
    const cars=[...w.fleet.cars.values()].filter(c=>!c.data.driverId&&!(c.data.flags&0x20)&&!['robotaxi','cable-car'].includes(c.data.kind))
      .sort((a,b)=>a.model.root.position.distanceTo(w.feet)-b.model.root.position.distanceTo(w.feet));
    const car=cars[0];
    if(!car||car.model.root.position.distanceTo(w.feet)>100)throw new Error('No available parked car within walking distance');
    window.carWalk={done:false};
    function walk(now) {
      const p=w.foot,q=car.model.root.position,dx=q.x-p.x,dz=q.z-p.z,d=Math.hypot(dx,dz);
      if(d<3.8||now-started>30000) { h.input.virtual=null;h.input.release();window.carWalk={done:true,arrived:d<3.8,distance:d};return; }
      const sin=Math.sin(w.camera.yaw),cos=Math.cos(w.camera.yaw);
      h.input.virtual={move:{x:(dx*cos-dz*sin)/d,y:-(dx*sin+dz*cos)/d}};
      requestAnimationFrame(walk);
    }
    requestAnimationFrame(walk);
  });
  await page.waitForFunction(()=>window.carWalk.done,undefined,{timeout:35000});
  assert.equal(await page.evaluate(()=>window.carWalk.arrived),true,'Walk reaches an available car');
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__gtasf.world.mode === 'driver', undefined, { timeout: 10000 });
  const start = await page.evaluate(() => ({ ...window.__gtasf.world.foot }));
  const graph = JSON.parse(await readFile(resolve(root, `tools/map/out/${area}/roadgraph-playable.json`), 'utf8'));
  const columbus = graph.edges.filter(e => e.kind === 'lane' && e.name === 'Columbus Avenue' && e.points[0][2] > e.points.at(-1)[2]);
  assert.ok(columbus.length > 10, 'Source graph contains northbound Columbus lanes');
  // Start/end inside a northbound lane: a shared junction endpoint can snap to
  // the opposing lane and force an unrelated one-way detour through nearby blocks.
  const south = columbus.reduce((a,b)=>a.points[0][2]>b.points[0][2]?a:b);
  const north = columbus.reduce((a,b)=>a.points.at(-1)[2]<b.points.at(-1)[2]?a:b);
  const along = (edge, fraction) => {
    const points = densify(edge.points), p = points[Math.floor((points.length - 1) * fraction)]; return { x: p[0], z: p[2] };
  };
  const router = createMapRouter(graph), beginning = along(south,.15), end = along(north,.85);
  const approach = router.route(start, beginning), drive = router.route(beginning, end);
  assert.ok(approach && drive && drive.distanceM > 900, 'A connected Columbus route covers at least 900 m');
  const points = densify([...approach.points, ...drive.points]), firstColumbus = densify(approach.points).length - 1;
  await writeFile(resolve(out, 'route.json'), JSON.stringify({ start, firstColumbus, approachMetres: approach.distanceM, columbusMetres: drive.distanceM, points }));
  await page.waitForTimeout(2000);
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
  const profileTiming = { metrics: (await cdp.send('Performance.getMetrics')).metrics,
    pageNow: await page.evaluate(() => performance.now()) };
  await page.evaluate(({ points, firstColumbus }) => {
    const h = window.__gtasf, trace = [], started = performance.now(), goal = points.at(-1);
    let nearest = 0, previous, lastProgress = started, lastX = h.world.foot.x, lastZ = h.world.foot.z;
    const gl = document.querySelector('#world').getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info');
    window.streamRun = { trace, started, done: false, gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', firstColumbus,
      heapStartBytes: performance.memory?.usedJSHeapSize ?? null };
    function frame(now) {
      const w = h.world, p = w.foot, speed = Math.abs(p.speed ?? 0);
      if (previous !== undefined) trace.push({ now, dt: now - previous, phase: nearest >= firstColumbus ? 'columbus' : 'approach', mode: w.mode,
        x: p.x, y: p.y, z: p.z, yaw: p.yaw, speed, nearest, cameraSafe: w.camera.safe,
        ground: w.map.surfaceHeightAt(p.x, p.z, p.y), stream: { ...w.map.stats }, uploads: { ...window.gpuUploads },
        heapBytes: performance.memory?.usedJSHeapSize ?? null });
      previous = now; window.gpuUploads = { calls: 0, bytes: 0, ms: 0, maxMs: 0 };
      if (Math.hypot(p.x - lastX, p.z - lastZ) > .5) { lastX = p.x; lastZ = p.z; lastProgress = now; }
      if (w.mode !== 'driver') window.streamRun.failure = `Driver ended: ${w.mode}`;
      if (now - lastProgress > 7000) window.streamRun.failure = `Driving stalled at ${nearest}/${points.length}`;
      if (now - started > 240000) window.streamRun.failure = 'Drive timed out';
      if (nearest > points.length - 20 && Math.hypot(p.x - goal[0], p.z - goal[2]) < 6) window.streamRun.arrived = true;
      if (window.streamRun.failure || window.streamRun.arrived) { h.input.virtual = { actions: ['handbrake'] }; window.streamRun.done = true; return; }
      let best = Infinity;
      for (let i = Math.max(0, nearest - 3); i < Math.min(points.length, nearest + 45); i++) {
        const q = points[i], distance = Math.hypot(p.x - q[0], p.z - q[2]);
        if (distance < best) { best = distance; nearest = i; }
      }
      const look = Math.max(4, Math.min(16, speed * .7)), target = Math.min(points.length - 1, nearest + Math.ceil(look));
      const q = points[target], dx = q[0] - p.x, dz = q[2] - p.z, distance = Math.max(1, Math.hypot(dx, dz));
      const alpha = Math.atan2(Math.sin(Math.atan2(dx, dz) - p.yaw), Math.cos(Math.atan2(dx, dz) - p.yaw));
      const curvature = 2 * Math.sin(alpha) / distance, desired = Math.atan(2.8 * curvature);
      const ahead = points[Math.min(points.length - 1, target + 18)];
      const bend = Math.abs(Math.atan2(Math.sin(Math.atan2(ahead[0] - q[0], ahead[2] - q[2]) - Math.atan2(dx, dz)), Math.cos(Math.atan2(ahead[0] - q[0], ahead[2] - q[2]) - Math.atan2(dx, dz))));
      const targetSpeed = Math.max(3, Math.min(nearest >= firstColumbus ? 19 : 13, Math.sqrt(3.5 / Math.max(.01, Math.abs(curvature))), bend > .5 ? 7 : 19));
      h.input.virtual = { steer: Math.max(-1, Math.min(1, -desired / (.55 / (1 + speed * .035)))),
        throttle: speed < targetSpeed ? Math.min(1, .35 + (targetSpeed - speed) * .3) : 0, brake: speed > targetSpeed + .3 ? Math.min(.8, (speed - targetSpeed) * .25) : 0 };
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }, { points, firstColumbus });
  console.log(JSON.stringify({ phase: 'driving', start, approachMetres: approach.distanceM, columbusMetres: drive.distanceM }));
  // Sourced event markers can open their normal card while driving. Dismiss
  // through the keyboard and retain every frame, including the modal pause.
  const eventsEncountered = [], deadline = Date.now() + 250000;
  while (!await page.evaluate(() => window.streamRun.done)) {
    if (Date.now() > deadline) throw new Error('Browser drive did not finish');
    const card = await page.evaluate(() => document.querySelector('.gt-event-card')?.hidden === false
      ? { title: document.querySelector('.gt-event-title')?.textContent, at: performance.now() } : null);
    if (card) { eventsEncountered.push(card); await page.keyboard.press('Escape'); }
    await page.waitForTimeout(500);
  }
  const result = await page.evaluate(() => ({ ...window.streamRun, longTasks: window.longTasks, end: { ...window.__gtasf.world.foot } }));
  const { profile } = await cdp.send('Profiler.stop');
  const frames = result.trace.filter(f => f.phase === 'columbus'), active = frames.filter(f => f.stream.loading || f.stream.queuedUploads || f.stream.bytesThisFrame);
  const chunks = new Set(frames.map(f => `${Math.floor(f.x / 256)}_${Math.floor(f.z / 256)}`));
  const distanceM = frames.reduce((sum, f, i) => sum + (i ? Math.hypot(f.x - frames[i - 1].x, f.z - frames[i - 1].z) : 0), 0);
  const evidence = { host: { arch: arch(), cpu: cpus()[0]?.model, loadAverage: loadavg() }, area, coldLoad: { transferredBytes: coldLoad.transferredBytes, within15MB: coldLoad.within15MB }, ...result,
    allFrames: summary(result.trace), columbus: summary(frames), streaming: summary(active), distanceM, chunks: [...chunks],
    fastFrames: frames.filter(f => f.speed >= 15).length, eventsEncountered, errors, httpErrors };
  await writeFile(resolve(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
  await writeFile(resolve(out, 'drive.cpuprofile'), JSON.stringify(profile));
  await writeFile(resolve(out, 'profile-timing.json'), JSON.stringify({ ...profileTiming, profileStartUs: profile.startTime, profileEndUs: profile.endTime }, null, 2));
  await page.screenshot({ path: resolve(out, 'drive.png') });
  console.log(JSON.stringify({ ...evidence, trace: undefined, longTasks: result.longTasks.filter(t => t.start >= result.started) }, null, 2));
  assert.ok(!result.failure && result.arrived, result.failure ?? 'Route did not finish');
  assert.ok(distanceM >= 900 && chunks.size >= 4 && evidence.fastFrames >= 300, 'Fast Columbus drive crosses at least four chunks');
  assert.ok(frames.every(f => f.ground !== null && f.cameraSafe && !f.stream.errors.length), 'Ground, camera and stream remain valid');
  assert.ok(active.length >= 60, 'Streaming occurred throughout measured real frames');
  assert.equal(evidence.columbus.over50, 0, 'No unfiltered Columbus frame exceeds 50 ms');
  assert.deepEqual(errors, []); assert.deepEqual(httpErrors, []);
} catch (error) {
  await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
  const unfinished = await page.evaluate(() => window.streamRun ? ({ ...window.streamRun, longTasks: window.longTasks, end: { ...window.__gtasf.world.foot } }) : null).catch(() => null);
  if (unfinished) await writeFile(resolve(out, 'unfinished-drive.json'), JSON.stringify(unfinished, null, 2));
  const diagnostic = { failure: String(error), errors, httpErrors, page: await page.evaluate(() => ({ text: document.body.innerText, ready: window.__gtasf?.ready, status: window.__gtasf?.status, errors: window.__gtasf?.errors })).catch(() => null) };
  await writeFile(resolve(out, 'failure.json'), JSON.stringify(diagnostic, null, 2)); console.log(JSON.stringify(diagnostic, null, 2)); throw error;
} finally { await browser.close(); server.httpServer.closeAllConnections(); await new Promise(resolve => server.httpServer.close(resolve)); }
