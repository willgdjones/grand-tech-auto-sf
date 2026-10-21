/** Phone cold-load trace (headless): 390x844 DPR3, 4x CPU, 4G 9 Mbps/85 ms. Usage: node tools/perf/phone-cold-load.mjs [url] */
import { chromium } from 'playwright';
import { gzipSync } from 'node:zlib';
// Locally fulfilled responses bypass CDP throttling; wait for their gzip size at 9 Mbps + 85 ms RTT.
const throttled = (body) => new Promise(r => setTimeout(r, 85 + gzipSync(body).length * 8 / 9e6 * 1000));
const url = process.argv[2] ?? 'https://gtasf.com/?bot=1&utm_source=x&utm_content=trailer_wasted';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
if (process.env.LOCAL_DIST) {
  // Serve a local build's HTML/JS/CSS; map, art and API still come from the target origin.
  const { readFile } = await import('node:fs/promises'); const { existsSync } = await import('node:fs');
  await c.route(u => { const x = new URL(u); return x.origin === new URL(url).origin && (x.pathname === '/' || /^\/(e|go)\//.test(x.pathname) || x.pathname.startsWith('/assets/') && existsSync(process.env.LOCAL_DIST + x.pathname)); }, async route => {
    // Page navigations (/, /e/<id>, /go/<slug>) get the local index.html; hashed assets the local files.
    const path = new URL(route.request().url()).pathname, page = !path.startsWith('/assets/'), file = process.env.LOCAL_DIST + (page ? '/index.html' : path);
    const type = page ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'application/octet-stream';
    const body = await readFile(file); await throttled(body);
    await route.fulfill({ body, contentType: type });
  });
}
if (process.env.NEAR_DIR) {
  // gtasf-0k01 trial: add a locally generated roadGraphNear (tools/map/roadgraph-subset.mts) to the target's manifest.
  const { readFile } = await import('node:fs/promises');
  const near = JSON.parse(await readFile(process.env.NEAR_DIR + '/manifest.json', 'utf8')).roadGraphNear;
  for (const file of [near, ...(near.parts ?? [])]) file.path = `/map/near-trial/${file.path}`;
  await c.route(u => new URL(u).pathname === '/map/lombard/manifest.json', async route => {
    const response = await route.fetch(); const manifest = await response.json(); manifest.roadGraphNear = near;
    await route.fulfill({ response, json: manifest });
  });
  await c.route(u => new URL(u).pathname.startsWith('/map/near-trial/'), async route => {
    const body = await readFile(process.env.NEAR_DIR + '/' + new URL(route.request().url()).pathname.slice('/map/near-trial/'.length)); await throttled(body);
    await route.fulfill({ body, contentType: 'application/octet-stream' });
  });
}
const p = await c.newPage(); const s = await c.newCDPSession(p);
await s.send('Network.enable'); await s.send('Network.setCacheDisabled', { cacheDisabled: true });
await s.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await s.send('Network.emulateNetworkConditions', { offline: false, latency: 85, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
const reqs = new Map(), files = []; let t0 = 0;
s.on('Network.requestWillBeSent', e => reqs.set(e.requestId, { url: e.request.url, start: e.timestamp }));
s.on('Network.loadingFinished', e => { const r = reqs.get(e.requestId); if (r) files.push({ url: r.url.replace(/^https:\/\/[^/]+/, '').slice(0, 90), kb: Math.round(e.encodedDataLength / 1024), start: r.start, end: e.timestamp }); });
const errors = []; p.on('pageerror', e => errors.push(String(e).slice(0, 200)));
await s.send('Profiler.enable'); await s.send('Profiler.setSamplingInterval', { interval: 1000 }); if (process.env.PROFILE) await s.send('Profiler.start');
t0 = Date.now();
await p.goto(url, { waitUntil: 'commit' });
const navT = await s.send('Runtime.evaluate', { expression: 'performance.timeOrigin', returnByValue: true });
let poster = null, ready = null, worldReady = null;
for (let i = 0; i < 1800 && ready === null; i++) {
  const st = await p.evaluate(() => { const l = document.querySelector('#loading'); return { posterOk: !!l && !l.hidden && getComputedStyle(l).backgroundImage !== 'none' || !!document.querySelector('#loading img'), ready: !!l && l.hidden, worldReady: performance.getEntriesByName('gtasf:world-ready')[0]?.startTime ?? null, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null, detail: document.querySelector('#loading-detail')?.textContent }; }).catch(() => null);
  const t = Date.now() - t0;
  if (st?.posterOk && poster === null) poster = t;
  if (st?.worldReady != null && worldReady === null) { worldReady = Math.round(st.worldReady); if (process.env.LOCAL_DIST) ready = -1; }
  if (st?.ready) { ready = t; var fcp = st.fcp; }
  if (i % 50 === 0 && st) console.error(`${(t / 1000).toFixed(0)}s ${st.detail}`);
  if (st && !fcp) var fcp = st.fcp;
  await p.waitForTimeout(100);
  if (t > 180000) break;
}
if (process.env.PROFILE) { const { profile } = await s.send('Profiler.stop'); const self = new Map(); const byId = new Map(profile.nodes.map(n => [n.id, n])); const dt = profile.timeDeltas; profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}:${n.callFrame.columnNumber}`; self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0)); }); console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${(v / 1000).toFixed(0)}ms ${k}`).join('\n')); }
if (process.env.TIMELINE) { const f0 = Math.min(...[...reqs.values()].map(r => r.start)); for (const f of [...files].sort((a, b) => a.start - b.start)) console.log(`${(f.start - f0).toFixed(1)}-${(f.end - f0).toFixed(1)}s ${f.kb}KB ${f.url}`); }
if (process.env.AFTER_READY) {
  // Long main-thread tasks in the first N seconds of play (e.g. the full road graph swap after READY).
  const longTasks = await p.evaluate(async seconds => {
    const found = []; new PerformanceObserver(list => { for (const e of list.getEntries()) found.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: false });
    await new Promise(r => setTimeout(r, seconds * 1000)); return found;
  }, Number(process.env.AFTER_READY)).catch(() => []);
  const total = longTasks.reduce((n, [, d]) => n + d, 0), worst = Math.max(0, ...longTasks.map(([, d]) => d));
  console.log('AFTER_READY', JSON.stringify({ count: longTasks.length, totalMs: total, worstMs: worst, top: longTasks.sort((a, b) => b[1] - a[1]).slice(0, 6) }));
}
const stages = await p.evaluate(() => performance.getEntriesByType('mark').filter(m => m.name.startsWith('gtasf:')).map(m => `${m.name} ${Math.round(m.startTime)}`)).catch(() => []);
console.log('STAGES', stages.join(' | '));
const fcpNow = await p.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null).catch(() => null);
const total = files.reduce((n, f) => n + f.kb, 0);
const first = Math.min(...[...reqs.values()].map(r => r.start));
const base = files.length ? Math.min(...files.map(f => f.end)) : 0;
console.log(JSON.stringify({ url, fcpMs: Math.round(fcpNow ?? fcp ?? -1), posterMs: poster, readyMs: ready, worldReadyMs: worldReady, transferMB: +(total / 1024).toFixed(2), requests: files.length, errors,
  biggest: files.sort((a, b) => b.kb - a.kb).slice(0, 15).map(f => `${f.kb}KB ${(f.start - first).toFixed(1)}-${(f.end - first).toFixed(1)}s ${f.url}`),
  lastFileBeforeReady: files.filter(f => (f.end - first) * 1000 < (ready ?? 1e9)).sort((a, b) => b.end - a.end).slice(0, 6).map(f => `${(f.start - first).toFixed(1)}-${(f.end - first).toFixed(1)}s ${f.kb}KB ${f.url}`) }, null, 1));
await b.close();
