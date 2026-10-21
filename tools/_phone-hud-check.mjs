// One-off (lane C): phone HUD after hudFocus/hudMenuFold on a LOCAL stack (missions on). Pixel 7: start the co-founder
// job at its giver, capture the NEW JOB slab + the objective line, and check STATION / 🎙 are off the HUD with nobody near.
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 300_000).unref();
const out = process.env.OUT ?? 'docs/sf-data/hud-focus'; mkdirSync(out, { recursive: true });
const GIVER = { lat: 37.785418, lon: -122.397022 };
const project = (lat, lon) => { const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f);
  const ecef = (la, lo) => { const phi = la * rad, lam = lo * rad, n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2); return [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - e2) * Math.sin(phi)]; };
  const o = { lat: 37.7842, lon: -122.4078 }, a = ecef(o.lat, o.lon), b = ecef(lat, lon), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], phi = o.lat * rad, lam = o.lon * rad;
  return { x: -Math.sin(lam) * d[0] + Math.cos(lam) * d[1], z: -(-Math.sin(phi) * Math.cos(lam) * d[0] - Math.sin(phi) * Math.sin(lam) * d[1] + Math.cos(phi) * d[2]) }; };
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ ...devices['Pixel 7'] });
await ctx.addInitScript(() => { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'Phone Labs', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' })); localStorage.setItem('gtasf.founder.bucket.v2', 'ladder'); });
const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 140)));
const r = {};
try {
  await page.goto(`${process.env.BASE ?? 'http://localhost:5319'}/?at=${(GIVER.lat + 0.0003).toFixed(6)},${GIVER.lon.toFixed(6)},180&bot=1&preset=low`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120000 });
  await page.waitForTimeout(4000);
  for (const sel of ['.gt-sa-intro__skip', '.gt-identity-go']) await page.evaluate(s => document.querySelector(s)?.click(), sel);
  await page.waitForSelector('.gt-mission-phone', { state: 'attached', timeout: 60000 }).catch(() => {});
  const vis = s => page.evaluate(sel => { const e = document.querySelector(sel); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; }, s);
  r.stationOnHud = await page.evaluate(() => { const e = document.querySelector('.gt-radio-next'); return !!e && !e.closest('.gt-pause-menu') && e.getClientRects().length > 0; });
  r.micOnHud = await vis('.gt-voice-ptt--touch');
  const g = project(GIVER.lat, GIVER.lon);
  for (let i = 0; i < 600; i++) { const d = await page.evaluate(({ x, z }) => { const f = window.__gtasf.world.foot, dx = x - f.x, dz = z - f.z, d = Math.hypot(dx, dz); if (d > 3) { const k = Math.min(0.7, d - 3) / d; f.x += dx * k; f.z += dz * k; } return d; }, g); if (d <= 3.3) break; await page.waitForTimeout(110); }
  await page.keyboard.down('KeyE'); await page.waitForTimeout(90); await page.keyboard.up('KeyE');
  await page.waitForSelector('.gt-mission-slab.is-in', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  r.slab = await vis('.gt-mission-slab');
  r.pillDuringSlab = await vis('.gt-founder-valuation');
  r.blurb = await page.evaluate(() => document.querySelector('.gt-mission-slab-blurb')?.textContent);
  await page.screenshot({ path: `${out}/phone-job-start.jpg`, type: 'jpeg', quality: 75 });
  await page.waitForTimeout(4500);
  r.line = await vis('.gt-mission-line');
  r.lineBox = await page.evaluate(() => { const e = document.querySelector('.gt-mission-line'); const b = e?.getBoundingClientRect(); return b ? { top: Math.round(b.top), bottom: Math.round(b.bottom) } : null; });
  r.radarBox = await page.evaluate(() => { const e = document.querySelector('.gt-radar'); const b = e?.getBoundingClientRect(); return b ? { top: Math.round(b.top), bottom: Math.round(b.bottom) } : null; });
  r.paintDuringJob = await vis('#mayhem-fire');
  await page.screenshot({ path: `${out}/phone-objective.jpg`, type: 'jpeg', quality: 75 });
} catch (e) { r.failure = String(e?.message ?? e).slice(0, 200); }
r.errs = errs; console.log('RESULT', JSON.stringify(r)); await b.close();
