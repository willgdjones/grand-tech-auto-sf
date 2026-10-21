// gtasf-g8ty9 deferFarLandmarks: in-build A/B on a LOCAL stack. '/' (default arrival: far landmarks after READY) vs
// '/?at=<Ferry spawn>' (a deep link at the same place: everything before READY). Cold phone, 4x CPU, 9 Mbps.
//   BASE=http://localhost:5319 RUNS=3 node tools/_defer-landmarks-ab.mjs
import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://localhost:5319', runs = Number(process.env.RUNS ?? 3);
const DEFERRED = ['painted-ladies', 'cablecar-turntable', 'fishermans-wharf-sign', 'peace-pagoda', 'dragon-gate', 'harvey-milk-flag',
  'city-lights-sign', 'castro-crossing', 'haight-ashbury-sign', 'castro-theatre', 'mission-mural', 'ghirardelli-sign', 'vesuvio-sign'];
async function load(path) {
  const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.opener.v1', 'skipped');
    localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Defer', foundedAt: 1, billboardSeen: true, preSeedClosed: true })); } catch {} });
  const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page), errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 140)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push(m.text().slice(0, 140)); });
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 9 * 125_000, uploadThroughput: 1.5 * 125_000 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(`${base}${path}`);
  await page.waitForFunction(() => window.__gtasf?.ready, null, { timeout: 240000 });
  await page.waitForTimeout(12000); // let the after-READY build land
  const r = await page.evaluate(ids => {
    const mark = n => Math.round(performance.getEntriesByName('gtasf:' + n)[0]?.startTime ?? -1);
    const kids = window.__gtasf.world.landmarks?.children ?? [];
    const have = new Set(kids.map(k => k.userData.landmarkId));
    return { worldLoaded: mark('world-loaded'), deferredDone: mark('landmarks-deferred-done'), landmarks: kids.length, deferredPresent: ids.filter(id => have.has(id)).length };
  }, DEFERRED);
  r.errors = errs.length; await b.close(); return r;
}
const at = '/?at=37.795570,-122.393900,64&bot=1&preset=low';
const rows = { defer: [], all: [] };
for (let i = 0; i < runs; i++) for (const [arm, path] of i % 2 ? [['all', at], ['defer', '/?bot=1&preset=low']] : [['defer', '/?bot=1&preset=low'], ['all', at]]) {
  const r = await load(path); rows[arm].push(r); console.log(arm, JSON.stringify(r));
}
const mean = a => Math.round(a.reduce((s, x) => s + x, 0) / a.length);
for (const arm of ['defer', 'all']) console.log(`${arm}: world-loaded mean ${mean(rows[arm].map(r => r.worldLoaded))} ms (${rows[arm].map(r => r.worldLoaded).join(', ')})`);
