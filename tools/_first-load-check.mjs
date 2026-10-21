// First-load check (lane D): serve an existing build (APP_DIR) on a local pool + preview, open the ferry spawn on phone Low and
// desktop HD, and sum CDP encoded transfer bytes of every request STARTED before window.__gtasf.ready. Lists the avatar/VAT
// requests and whether each started before or after READY. Budget: <=15 MB first load (AGENTS.md). Env: APP_DIR, OUT.
import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { startLocalPool } from './local-pool/pool.mjs';

const app = resolve(process.env.APP_DIR ?? 'web/dist'), out = process.env.OUT ? resolve(process.env.OUT) : '';
let server, browser, pool;
const results = {};
try {
  pool = await startLocalPool();
  server = await preview({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), build: { outDir: app }, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: pool.url.origin, ws: true } } } });
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  for (const [label, ctxOpts, query] of [
    ['phone-low', { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }, 'preset=low&touch=1'],
    ['desktop-hd', { viewport: { width: 1600, height: 900 } }, 'gfx=hd'],
  ]) {
    const context = await browser.newContext(ctxOpts), page = await context.newPage(), cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const reqs = new Map(); let readyAt = Infinity;
    cdp.on('Network.requestWillBeSent', e => reqs.set(e.requestId, { url: e.request.url, start: e.timestamp, bytes: 0 }));
    cdp.on('Network.dataReceived', e => { const r = reqs.get(e.requestId); if (r) r.bytes += e.encodedDataLength; });
    cdp.on('Network.loadingFinished', e => { const r = reqs.get(e.requestId); if (r) r.bytes = Math.max(r.bytes, e.encodedDataLength); });
    await page.goto(`${base}/?at=37.7955,-122.3937&${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__gtasf?.ready, undefined, { timeout: 180000 });
    readyAt = (await cdp.send('Runtime.evaluate', { expression: 'performance.timeOrigin/1000 + performance.now()/1000', returnByValue: true })).result.value;
    // Sample a monotonic CDP clock reference: requests carry CDP timestamps (seconds, monotonic); compare by order instead.
    const marker = await page.evaluate(() => fetch('/__ready_marker?' + Date.now()).catch(() => null) && Date.now());
    await page.waitForTimeout(15000); // let post-READY loads (avatars, VAT) happen so they are listed as AFTER
    const all = [...reqs.values()].sort((a, b) => a.start - b.start), markerReq = all.find(r => r.url.includes('/__ready_marker'));
    const cut = markerReq?.start ?? Infinity, before = all.filter(r => r.start < cut);
    const sum = list => list.reduce((n, r) => n + r.bytes, 0);
    const avatars = all.filter(r => /\/assets\/avatars\//.test(r.url)).map(r => ({ file: r.url.split('/assets/avatars/')[1], kb: Math.round(r.bytes / 1024), beforeReady: r.start < cut }));
    results[label] = { firstLoadBytes: sum(before), within15MB: sum(before) <= 15_000_000, requestsBeforeReady: before.length, avatars };
    console.log(`FIRSTLOAD ${label} ${JSON.stringify(results[label])}`);
    void readyAt; void marker;
    await context.close();
  }
  if (out) { await mkdir(dirname(out), { recursive: true }); await writeFile(out, JSON.stringify(results, null, 2) + '\n'); }
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser?.close(); try { await server?.httpServer?.close(); } catch {} try { await pool?.close(); } catch {} process.exit(); }
