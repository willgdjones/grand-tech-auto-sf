// gtasf-7vt00 / critic 09:3x (nearRouterFirst): on a cold throttled phone, how soon after READY does the radar answer a route?
// Sets a destination 1.5 s after READY and polls the radar's navigation line until it shows a distance. Read-only.
//   BASE=http://localhost:5319 MBPS=9 RTT=60 DEST=near|far node tools/_near-router-check.mjs
import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://localhost:5319', mbps = Number(process.env.MBPS ?? 9), rtt = Number(process.env.RTT ?? 60);
const O = { lat: 37.7842, lon: -122.4078 }; // SF_FRAME origin (+x east, -z north), small-area approximation
const proj = (lat, lon) => ({ x: (lon - O.lon) * 111320 * Math.cos(O.lat * Math.PI / 180), z: -(lat - O.lat) * 111320 });
const dests = { near: { title: 'Embarcadero & Broadway', ...proj(37.79870, -122.39880) }, far: { title: 'Lombard switchbacks', ...proj(37.80210, -122.41870) },
  mission: { title: 'Mission St at Spear', ...proj(37.79225, -122.39420) } };
const dest = dests[process.env.DEST ?? 'near'];
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Founder', foundedAt: 1, billboardSeen: true, preSeedClosed: true })); } catch {} });
const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: rtt, downloadThroughput: mbps * 125_000, uploadThroughput: 1.5 * 125_000 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await page.goto(`${base}/?bot=1&preset=low`);
await page.waitForFunction(() => window.__gtasf?.ready, null, { timeout: 240000 });
const readyAt = await page.evaluate(() => performance.now());
await page.waitForTimeout(1500);
await page.evaluate(d => window.__gtasf.world.radar.setDestination({ title: d.title, x: d.x, y: 0, z: d.z }), dest);
const log = []; let routedAt = null, last = '';
for (let i = 0; i < 180 && routedAt === null; i++) { // up to ~90 s
  const s = await page.evaluate(() => ({ t: performance.now(), text: document.querySelector('.gt-radar-navigation')?.textContent ?? '' }));
  if (s.text !== last) { log.push(`${Math.round((s.t - readyAt) / 100) / 10}s ${s.text.slice(0, 70)}`); last = s.text; }
  if (/\d+(\.\d)? ?(m|km)\b/.test(s.text)) routedAt = s.t;
  await page.waitForTimeout(500);
}
// TRACE=1 (critic 13:5x): keep watching the drawn route through the city-router handover (player standing still) and log
// every change of its signature; 'route-identical' = one signature from the near route to 5 s after routing-ready.
if (process.env.TRACE) {
  const sig = () => page.evaluate(() => { const r = window.__gtasf.world.radar.route; if (!r) return 'none';
    let h = 0; for (const p of r.points) h = (h * 31 + Math.round(p[0]) * 7 + Math.round(p[2])) | 0; return `${Math.round(r.distanceM)}m/${r.points.length}pts/${h}`; });
  const changes = []; let prev = null, readyAt2 = null;
  for (let i = 0; i < 240; i++) { // up to ~120 s
    const now = await page.evaluate(() => ({ t: performance.now(), city: performance.getEntriesByName('gtasf:routing-ready').length > 0 }));
    const s = await sig(); if (s !== prev) { changes.push(`${((now.t - readyAt) / 1000).toFixed(1)}s ${s}${now.city ? ' (city router)' : ''}`); prev = s; }
    if (now.city && readyAt2 === null) readyAt2 = now.t;
    if (readyAt2 !== null && now.t - readyAt2 > 5000) break;
    await page.waitForTimeout(500);
  }
  console.log(`TRACE route signatures (${changes.length}): ${changes.length === 1 ? 'ROUTE-IDENTICAL through the handover' : 'changed'}`);
  for (const c of changes) console.log('  ' + c);
}
const marks = await page.evaluate(() => performance.getEntriesByType('mark').filter(m => /routing-ready|near-routing/.test(m.name)).map(m => `${m.name.replace('gtasf:', '')}@${Math.round(m.startTime)}`));
const build = await page.evaluate(() => performance.getEntriesByName('gtasf:near-router-build')[0]?.duration ?? null);
if (build !== null) marks.push(`near-router-build ${Math.round(build)} ms`);
console.log(`DEST=${process.env.DEST ?? 'near'} READY@${Math.round(readyAt)} routed ${routedAt === null ? 'NOT within 90 s' : `${((routedAt - readyAt) / 1000).toFixed(1)} s after READY`} | marks ${marks.join(' ')}`);
for (const l of log) console.log('  ' + l);
await b.close();
