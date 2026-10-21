// Time-trial smoke (live feature, flag timeTrials): the Telegraph Hill Climb foot route. Walk (server-accepted steps)
// to its 'T', E starts the run (server tt-start), run the checkpoint to Coit Tower, and the server accepts the time
// (tt-submit) onto the daily board. Local stack or prod (is_bot device).
//
//   GTASF_VERIFY_URL=http://localhost:5319 node tools/timetrial-verify.mjs      (OUT=dir for screenshots)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5319';
const out = process.env.OUT ?? 'docs/sf-data/time-trials/telegraph'; mkdirSync(out, { recursive: true });
// shared/founder/timeTrials.ts 'telegraph-hill-climb' (road-snapped)
const START = { lat: 37.800367, lon: -122.409934 };
const STOPS = [{ id: 'cp1', lat: 37.801719, lon: -122.406763 }, { id: 'finish', lat: 37.802488, lon: -122.405617 }];
const result = { base, at: new Date().toISOString(), legs: [] };
const project = (lat, lon) => { const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f);
  const ecef = (la, lo) => { const phi = la * rad, lam = lo * rad, n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2); return [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - e2) * Math.sin(phi)]; };
  const o = { lat: 37.7842, lon: -122.4078 }, a = ecef(o.lat, o.lon), b = ecef(lat, lon), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const phi = o.lat * rad, lam = o.lon * rad;
  return { x: -Math.sin(lam) * d[0] + Math.cos(lam) * d[1], z: -(-Math.sin(phi) * Math.cos(lam) * d[0] - Math.sin(phi) * Math.sin(lam) * d[1] + Math.cos(phi) * d[2]) }; };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => { try {
  localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Trials', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' }));
  localStorage.setItem('gtasf.founder.bucket.v2', 'ladder'); } catch {} });
const page = await ctx.newPage(); page.setDefaultTimeout(90000);
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push(m.text().slice(0, 160)); });
const api = []; page.on('response', r => { const p = new URL(r.url()).pathname; if (p.startsWith('/api/funding/tt-') || p.startsWith('/api/time-trials')) r.json().then(b => api.push({ p, http: r.status(), ...b })).catch(() => {}); });
const toasts = []; await page.exposeFunction('__toast', t => toasts.push(t));
async function clearOnboarding(p) {
  for (let i = 0; i < 20; i++) { const b = await p.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); }; return { intro: v('.gt-sa-intro') || v('.gt-sa-intro__skip'), id: v('.gt-identity-go'), fund: !!document.querySelector('.gt-funding-onboarding[open]') }; });
    if (!b.intro && !b.id && !b.fund) break;
    if (b.fund) { try { const d = p.locator('.gt-funding-onboarding[open]'); await d.getByLabel('Startup name', { exact: true }).fill('QA Trials'); await d.getByLabel('Your nickname', { exact: true }).fill('q'); await d.getByRole('button', { name: 'Save startup' }).click({ timeout: 3000 }); } catch {} await p.waitForTimeout(600); continue; }
    if (b.id) { try { await p.locator('.gt-identity-go').click({ timeout: 3000 }); } catch {} await p.waitForTimeout(500); continue; }
    if (b.intro) { await p.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click()); await p.waitForTimeout(500); continue; } }
  await p.waitForTimeout(800);
}
// Walk the server pose: 0.7 m nudges ~every 110 ms (under the 8 m/s on-foot cap); stops within `stop` m.
async function walkTo(t, stop, maxSteps = 4000) {
  const target = project(t.lat, t.lon); let last = Infinity, stuck = 0, d = Infinity;
  for (let i = 0; i < maxSteps; i++) {
    d = await page.evaluate(({ tx, tz, stop }) => { const f = window.__gtasf.world.foot; const dx = tx - f.x, dz = tz - f.z, d = Math.hypot(dx, dz);
      if (d > stop) { const k = Math.min(0.7, d - stop + 0.1) / d; f.x += dx * k; f.z += dz * k; } return d; }, { tx: target.x, tz: target.z, stop });
    if (d <= stop + 0.2) break;
    if (i % 150 === 0) await page.keyboard.press('ShiftLeft'); // real input, or the 5-min idle kick ends the session
    if (last - d < 0.05) { if (++stuck > 40) break; } else stuck = 0;
    last = d; await page.waitForTimeout(110);
  }
  await page.waitForTimeout(900);
  return Math.round(d);
}
try {
  await page.goto(`${base}/?at=${(START.lat - 0.0005).toFixed(6)},${START.lon.toFixed(6)},0&bot=1&preset=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120000 });
  await clearOnboarding(page);
  await page.waitForSelector('.gt-mission-phone, .gt-tt-hud', { state: 'attached', timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(4000); await clearOnboarding(page);
  result.legs.push({ to: 'start', dist: await walkTo(START, 3) });
  await page.keyboard.down('KeyE'); await page.waitForTimeout(90); await page.keyboard.up('KeyE');
  await page.waitForTimeout(1500);
  result.started = api.find(a => a.p === '/api/funding/tt-start') ?? null;
  result.hudStart = await page.evaluate(() => document.querySelector('.gt-tt-hud')?.textContent?.slice(0, 120) ?? null);
  for (const stop of STOPS) {
    result.legs.push({ to: stop.id, dist: await walkTo(stop, 6) });
    if (stop.id === 'cp1') await page.screenshot({ path: `${out}/run-desktop.jpg`, type: 'jpeg', quality: 80 });
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/finish-desktop.jpg`, type: 'jpeg', quality: 80 });
  result.submit = api.find(a => a.p === '/api/funding/tt-submit') ?? null;
} catch (e) { result.failure = String(e?.message ?? e).slice(0, 300); }
result.errs = errs; result.api = api.map(a => `${a.p} ${a.http} ${a.status ?? a.error ?? ''}`);
result.checks = {
  // tt-start is fire-and-forget (its response is not always captured); a 'recorded' submit proves it, since the server
  // only accepts a submit against its own recorded start.
  started: result.started?.status === 'started' || result.submit?.status === 'recorded',
  hudShows: /TELEGRAPH/i.test(result.hudStart ?? ''),
  walked: result.legs.every(l => l.dist <= 7),
  submitted: result.submit?.status === 'recorded',
  noConsoleErrors: !errs.length,
};
result.passed = Object.values(result.checks).every(Boolean);
console.log(JSON.stringify(result, null, 2));
console.log(`\nRESULT: ${result.passed ? 'TIME TRIAL PASS ✅' : 'CHECK FAILED ❌'} ${JSON.stringify(result.checks)}`);
await browser.close();
