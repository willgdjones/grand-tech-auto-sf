// Lane D (gtasf-qvajw): what runs on the main thread in the first seconds after READY on a phone? CPU-profiles a built app
// (APP_DIR; build it with minify off so names survive) on the phone-perf profile (1080x2400 @2.75, 4x CPU throttle,
// preset=low), starting the profiler the moment window.__gtasf.ready flips and stopping it WINDOW_MS later (default 6000).
// Prints the top functions by self time and by inclusive time (per name + file:line), and writes the .cpuprofile.
//   APP_DIR=<built app> [AT=lat,lon] [WINDOW_MS=6000] [OUT=file.cpuprofile] node tools/_ready-profile.mjs
import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { startLocalPool } from './local-pool/pool.mjs';
const app = resolve(process.env.APP_DIR), at = process.env.AT ?? '37.7955,-122.3937', windowMs = Number(process.env.WINDOW_MS ?? 6000);
let server, browser, pool;
try {
  pool = await startLocalPool();
  server = await preview({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), build: { outDir: app },
    preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: pool.url.origin, ws: true } } } });
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
  await context.addInitScript(() => { try { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'Prof', foundedAt: Date.now(), billboardSeen: true })); } catch {} });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await page.goto(`${base}/?at=${at}&preset=low&touch=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__gtasf?.ready, undefined, { timeout: 180000, polling: 20 });
  await cdp.send('Profiler.start');
  await page.waitForTimeout(windowMs);
  const { profile } = await cdp.send('Profiler.stop');
  if (process.env.OUT) await writeFile(process.env.OUT, JSON.stringify(profile));
  // Self time per node from the sample stream, then inclusive time up the tree; group both by function + location.
  const byId = new Map(profile.nodes.map(n => [n.id, n])), parent = new Map(), self = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i + 1] ?? profile.timeDeltas[i] ?? 0)));
  const key = n => { const f = n.callFrame; const file = f.url ? f.url.split('/').pop() : ''; return `${f.functionName || '(anon)'} ${file}:${f.lineNumber + 1}`; };
  const selfBy = new Map(), inclBy = new Map();
  for (const [id, us] of self) {
    const n = byId.get(id); selfBy.set(key(n), (selfBy.get(key(n)) ?? 0) + us);
    const seen = new Set(); for (let q = id; q !== undefined; q = parent.get(q)) { const k = key(byId.get(q)); if (seen.has(k)) continue; seen.add(k); inclBy.set(k, (inclBy.get(k) ?? 0) + us); }
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, us]) => `${(us / 1000).toFixed(0).padStart(6)} ms  ${k}`).join('\n');
  console.log(`WINDOW ${windowMs} ms after READY, sampled ${(total / 1000).toFixed(0)} ms`);
  console.log('--- top self\n' + top(selfBy, 25));
  console.log('--- top inclusive\n' + top(inclBy, 40));
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser?.close(); await server?.close(); await pool?.close?.(); }
