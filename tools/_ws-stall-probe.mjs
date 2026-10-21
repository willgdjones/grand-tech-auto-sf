// gtasf-j7wvv: does a stalled page main thread kill the world socket? Browser-native sockets drop (lane E: 5/14 armed)
// but a Node pipe never did (0/8): the pipe keeps reading while the page is busy, Chrome applies backpressure. Join prod
// (or GTASF_URL), then block the main thread for increasing durations (STALLS, seconds) with recovery between, and
// log whether/when the world socket closes.   node tools/_ws-stall-probe.mjs
import { chromium } from '@playwright/test';
setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 600_000).unref();
const base = process.env.GTASF_URL ?? 'https://gtasf.com';
const stalls = (process.env.STALLS ?? '3,6,12,20,30').split(',').map(Number);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { const W = window.WebSocket; window.__wsLog = [];
  window.WebSocket = class extends W { constructor(...a) { super(...a); if (/\/api\/world/.test(String(a[0]))) {
    this.addEventListener('open', () => window.__wsLog.push({ t: Date.now(), e: 'open' }));
    this.addEventListener('close', e => window.__wsLog.push({ t: Date.now(), e: 'close', code: e.code, clean: e.wasClean })); } } }; });
const page = await ctx.newPage(); page.setDefaultTimeout(60000);
const log = s => console.log(`[stall] ${new Date().toISOString().slice(11, 23)} ${s}`);
try {
  await page.goto(`${base}/?at=37.795570,-122.393900,270&preset=low&bot=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 150000 });
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
  await page.waitForTimeout(5000);
  for (const s of stalls) {
    const before = await page.evaluate(() => window.__wsLog.length);
    log(`blocking the main thread for ${s} s`);
    page.evaluate(ms => { const end = Date.now() + ms; while (Date.now() < end) { /* busy: no rAF, no message events */ } }, s * 1000).catch(() => {});
    await page.waitForTimeout(s * 1000 + 8000); // the block, then 8 s for events to drain / a reconnect
    const events = await page.evaluate(n => window.__wsLog.slice(n), before);
    const closed = events.find(e => e.e === 'close');
    log(`after ${s} s block: ${closed ? `CLOSED code ${closed.code} clean=${closed.clean}` : 'socket survived'} ${JSON.stringify(events)}`);
    if (closed) await page.waitForFunction(() => document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 30000 }).catch(() => log('no reconnect in 30 s'));
    await page.waitForTimeout(5000);
  }
} catch (e) { log(`ABORTED: ${String(e.message).split('\n')[0]}`); }
await browser.close();
