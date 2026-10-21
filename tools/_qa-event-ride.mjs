// LANE E: hail a robotaxi to a Tech Week event from the events view ("Ride here · FREE"), ride it, and land near the
// event. Fresh is_bot device at the Ferry (uses one of that bot device's free rides; no money).
//   OUT=docs/qa/<day>/event-ride node tools/_qa-event-ride.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.env.OUT ?? 'docs/qa/event-ride'; mkdirSync(OUT, { recursive: true });
const BASE = process.env.GTASF_QA_URL ?? 'https://gtasf.com';
const O = { lat: 37.7842, lon: -122.4078 }; // SF_FRAME origin (+x east, -z north), small-area approximation
const proj = (lat, lon) => ({ x: (lon - O.lon) * 111320 * Math.cos(O.lat * Math.PI / 180), z: -(lat - O.lat) * 111320 });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Founder', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' })); } catch {} });
if (process.env.FRAMES) await ctx.addInitScript(() => { window.__rideLog = []; const t0 = performance.now(); // N19: every overlay class change, timestamped
  new MutationObserver(list => { for (const m of list) { const el = m.target; if (el instanceof Element && el.classList.contains('gt-quick-ride')) window.__rideLog.push(`${Math.round(performance.now() - t0)} ${el.hidden ? 'H' : 'V'} ${el.className}`); } })
    .observe(document, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] }); });
const page = await ctx.newPage(); const errs = [], bad = [];
page.on('pageerror', e => errs.push(e.message.slice(0, 140)));
page.on('response', r => { if (r.status() >= 400) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });
await page.goto(`${BASE}/?at=37.795570,-122.393900,270&bot=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
const R = { ready: await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 120000 }).then(() => true).catch(() => false) };
for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
await page.waitForTimeout(Number(process.env.WAIT ?? 35000)); // routing ready
await page.evaluate(() => document.querySelector('.gt-upcoming-open')?.click()); await page.waitForTimeout(1500);
if (process.env.SEARCH) { // pick a specific event (e.g. one inside the local stack's embedded road corridor; the dates tab may need 'all')
  for (const tab of await page.locator('.gt-upcoming button', { hasText: /^All/i }).all()) await tab.click().catch(() => {});
  await page.fill('.gt-upcoming-search', process.env.SEARCH); await page.waitForTimeout(800); }
const ride = page.locator('.gt-upcoming-actions button', { hasText: /Ride here|Hail robotaxi/i }).first();
R.button = (await ride.textContent().catch(() => null))?.trim();
R.event = await page.evaluate(() => document.querySelector('.gt-upcoming-choose')?.textContent?.trim().slice(0, 60));
const ev = await (await fetch(`${BASE}/api/events`)).json();
const target = (Array.isArray(ev) ? ev : ev.events).find(e => R.event && e.title && R.event.toUpperCase().startsWith(e.title.toUpperCase().slice(0, 20)));
R.target = target ? { title: target.title, lat: target.lat, lon: target.lon } : null;
const f0 = await page.evaluate(() => ({ x: window.__gtasf.world.foot.x, z: window.__gtasf.world.foot.z }));
await ride.click({ timeout: 8000 }).catch(e => { R.clickError = e.message.slice(0, 120); });
if (process.env.DRIVE_SHOT) { await page.waitForTimeout(1200); await page.screenshot({ path: `${OUT}/01x-driving.jpg`, type: 'jpeg', quality: 72 }); // eventRideDrive mid-drive
  R.titleEls = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && /RADIO SOMA|Radio SOMA/i.test(e.textContent || '') && e.checkVisibility?.())
    .map(e => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)} < ${e.parentElement?.tagName.toLowerCase()}.${String(e.parentElement?.className).slice(0, 40)}`)); }
if (!process.env.FRAMES) { await page.waitForTimeout(2500); await page.screenshot({ path: `${OUT}/01-hailed.jpg`, type: 'jpeg', quality: 70 }); } // FRAMES: poll from the click (the jump lands in ~1.2 s)
R.afterHail = await page.evaluate(() => ({ taxi: window.__gtasf.world.taxiState, mode: window.__gtasf.world.mode,
  notices: [...document.querySelectorAll('[class*="notice"], [class*="toast"], #prompt')].filter(e => e.checkVisibility()).map(e => e.textContent.trim()).filter(Boolean).join(' | ').slice(0, 160) }));
const t0 = Date.now(); let st, rode = false;
while (Date.now() - t0 < 180000) {
  st = await page.evaluate(() => { const w = window.__gtasf.world; return { mode: w.mode, taxi: w.taxiState, x: w.foot.x, z: w.foot.z }; });
  if (process.env.FRAMES && !R.fadeSeen && await page.evaluate(() => !!document.querySelector('.gt-quick-ride.gt-quick-fadein'))) { // eventRideArrival fade in progress
    R.fadeSeen = Date.now() - t0; await page.screenshot({ path: `${OUT}/01a-fading.jpg`, type: 'jpeg', quality: 70 }); }
  if (st.mode !== 'on-foot') rode = true;
  // robotaxiJump/quickRobotaxi: the ride can be an instant jump (player never boards; taxi 'arrived' within ~2 s).
  if (st.mode === 'on-foot' && Math.hypot(st.x - f0.x, st.z - f0.z) > 300) {
    if (process.env.FRAMES) { // critic N19 check: the arrival frames (fade) and whether the player faces the event
      await page.screenshot({ path: `${OUT}/01b-arrival.jpg`, type: 'jpeg', quality: 70 }); await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}/01c-arrival-250ms.jpg`, type: 'jpeg', quality: 70 });
      if (target) { const p = proj(target.lat, target.lon), yaw = await page.evaluate(() => window.__gtasf.world.foot.yaw);
        const want = Math.atan2(p.x - st.x, p.z - st.z); R.facingErrDeg = Math.round(Math.abs(((yaw - want + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 180 / Math.PI); }
    }
    break;
  }
  await page.waitForTimeout(process.env.FRAMES ? 80 : 1000);
}
R.rideS = Math.round((Date.now() - t0) / 1000); R.rode = rode; R.end = st; R.movedM = Math.round(Math.hypot(st.x - f0.x, st.z - f0.z));
if (target) { const p = proj(target.lat, target.lon); R.dropDistM = Math.round(Math.hypot(st.x - p.x, st.z - p.z)); }
await page.waitForTimeout(2000); await page.screenshot({ path: `${OUT}/02-dropped.jpg`, type: 'jpeg', quality: 70 });
// critic N19b (quickDropKerb): how far the drop is from the nearest drivable centreline (a kerb-side 2.6 m step should land
// ~1 lane + the step from the centreline of a one-lane-each-way street, i.e. past the kerb), plus that road's name/kind.
R.dropRoad = await page.evaluate(() => { const w = window.__gtasf.world, g = w.map?.graph; if (!g) return null; let best = null;
  for (const e of g.edges) { if (!e.routable) continue; const pts = e.points; for (let i = 1; i < pts.length; i++) { const [ax, , az] = pts[i - 1], [bx, , bz] = pts[i];
    const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((w.foot.x - ax) * dx + (w.foot.z - az) * dz) / L));
    const d = Math.hypot(w.foot.x - ax - t * dx, w.foot.z - az - t * dz); if (!best || d < best.d) best = { d: Math.round(d * 10) / 10, name: e.name, kind: e.kind, lane: e.lane }; } }
  return best; });
R.dropCam = await page.evaluate(() => { const w = window.__gtasf.world, c = w.camera?.camera?.position; if (!c) return null; const r = v => Math.round(v * 10) / 10;
  return { camToFootM: r(Math.hypot(c.x - w.foot.x, c.z - w.foot.z)), camAboveFootM: r(c.y - w.foot.y), footY: r(w.foot.y) }; });
if (process.env.LATE_SHOT) { await page.waitForTimeout(4000); await page.screenshot({ path: `${OUT}/03-settled.jpg`, type: 'jpeg', quality: 70 });
  if (target) { const p = proj(target.lat, target.lon); R.facingLateDeg = await page.evaluate(p => { const w = window.__gtasf.world, want = Math.atan2(p.x - w.foot.x, p.z - w.foot.z);
    return Math.round(Math.abs(((w.foot.yaw - want + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 180 / Math.PI); }, p); }
  R.settledCam = await page.evaluate(() => { const w = window.__gtasf.world, c = w.camera?.camera?.position; return c ? Math.round(Math.hypot(c.x - w.foot.x, c.z - w.foot.z, c.y - w.foot.y - 2.2) * 10) / 10 : null; }); }
if (process.env.FRAMES) R.rideLog = await page.evaluate(() => window.__rideLog.slice(-14));
R.errs = errs; R.http = bad;
R.pass = !!(R.ready && R.movedM > 300 && st.mode === 'on-foot' && R.dropDistM != null && R.dropDistM <= 150 && !errs.length);
console.log(JSON.stringify(R)); console.log(`RESULT: ${R.pass ? 'EVENT RIDE PASS' : 'CHECK FAILED'}`);
writeFileSync(`${OUT}/result.json`, JSON.stringify(R, null, 2));
setTimeout(() => process.exit(0), 8000).unref(); await browser.close();
