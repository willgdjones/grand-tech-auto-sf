// Live street race (flag streetRaces) two-client smoke on a LOCAL stack (combat-stack with missions on; timeTrials +
// streetRaces are dev-on). Host A (desktop) and rival B (Pixel 7) at the Telegraph Hill Climb 'T': A hosts, B gets the
// invite and joins, 30 s lobby → countdown → GO, both run the gates on foot (server-accepted steps; A faster), both get
// the results. Screenshots desktop + phone.      GTASF_VERIFY_URL=http://localhost:5319 node tools/race-verify.mjs
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5319';
const out = process.env.OUT ?? 'docs/sf-data/street-races'; mkdirSync(out, { recursive: true });
// shared/founder/timeTrials.ts 'telegraph-hill-climb' (road-snapped)
const START = { lat: 37.800367, lon: -122.409934 }, CP1 = { lat: 37.801719, lon: -122.406763 }, FIN = { lat: 37.802488, lon: -122.405617 };
const project = (lat, lon) => { const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f);
  const ecef = (la, lo) => { const phi = la * rad, lam = lo * rad, n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2); return [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - e2) * Math.sin(phi)]; };
  const o = { lat: 37.7842, lon: -122.4078 }, a = ecef(o.lat, o.lon), b = ecef(lat, lon), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], phi = o.lat * rad, lam = o.lon * rad;
  return { x: -Math.sin(lam) * d[0] + Math.cos(lam) * d[1], z: -(-Math.sin(phi) * Math.cos(lam) * d[0] - Math.sin(phi) * Math.sin(lam) * d[1] + Math.cos(phi) * d[2]) }; };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const result = { base, at: new Date().toISOString() };
async function player(tag, opts, at) {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Racer', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' })); localStorage.setItem('gtasf.founder.bucket.v2', 'ladder'); } catch {} });
  const page = await ctx.newPage(); page.setDefaultTimeout(60000);
  const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push(m.text().slice(0, 160)); });
  await page.goto(`${base}/?at=${at}&bot=1&preset=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120000 });
  await page.waitForSelector('.gt-mission-phone', { state: 'attached', timeout: 180000 }).catch(() => {});
  for (let i = 0; i < 4; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(600); }
  return { tag, page, errs };
}
async function walkTo(p, t, stop, step) {
  const target = project(t.lat, t.lon);
  for (let i = 0; i < 3000; i++) {
    const d = await p.page.evaluate(({ tx, tz, stop, step }) => { const f = window.__gtasf.world.foot; const dx = tx - f.x, dz = tz - f.z, d = Math.hypot(dx, dz);
      if (d > stop) { const k = Math.min(step, d - stop + 0.1) / d; f.x += dx * k; f.z += dz * k; } return d; }, { tx: target.x, tz: target.z, stop, step });
    if (d <= stop + 0.2) return Math.round(d);
    if (i % 150 === 0) await p.page.keyboard.press('ShiftLeft');
    await p.page.waitForTimeout(110);
  }
  return -1;
}
const text = (p, sel) => p.page.evaluate(s => { const e = document.querySelector(s); return e && !e.hidden ? e.textContent.replace(/\s+/g, ' ').slice(0, 200) : null; }, sel);
try {
  const A = await player('desktop', { viewport: { width: 1280, height: 800 } }, `${START.lat.toFixed(6)},${START.lon.toFixed(6)},90`);
  const B = await player('phone', { ...devices['Pixel 7'] }, `${(START.lat - 0.00015).toFixed(6)},${START.lon.toFixed(6)},90`);
  result.A = A; result.B = B;
  await walkTo(A, START, 3, 0.5); await walkTo(B, START, 12, 0.5);
  await A.page.waitForSelector('.gt-race-host:not([hidden])', { timeout: 15000 });
  await A.page.screenshot({ path: `${out}/host-button-desktop.jpg`, type: 'jpeg', quality: 75 });
  await A.page.locator('.gt-race-host').click();
  await B.page.waitForSelector('.gt-race-card:not([hidden])', { timeout: 15000 });
  result.invite = await text(B, '.gt-race-card');
  await B.page.screenshot({ path: `${out}/invite-phone.jpg`, type: 'jpeg', quality: 75 });
  await B.page.locator('.gt-race-card-btn', { hasText: 'Join' }).click();
  await A.page.waitForTimeout(1500);
  result.lobby = await text(A, '.gt-race-card');
  await A.page.screenshot({ path: `${out}/lobby-desktop.jpg`, type: 'jpeg', quality: 75 });
  await A.page.waitForSelector('.gt-race-count:not([hidden])', { timeout: 45000 });
  await B.page.screenshot({ path: `${out}/countdown-phone.jpg`, type: 'jpeg', quality: 75 });
  await A.page.waitForSelector('.gt-race-hud:not([hidden])', { timeout: 20000 });
  const run = async (p, step) => { await walkTo(p, CP1, 6, step); await walkTo(p, FIN, 5, step); };
  await Promise.all([run(A, 0.7), (async () => { await walkTo(B, CP1, 6, 0.5); await B.page.screenshot({ path: `${out}/race-hud-phone.jpg`, type: 'jpeg', quality: 75 }); await walkTo(B, FIN, 5, 0.5); })()]);
  await A.page.waitForTimeout(3000);
  result.resultsA = await A.page.waitForSelector('.gt-race-card:not([hidden])', { timeout: 30000 }).then(() => text(A, '.gt-race-card')).catch(() => null);
  result.resultsB = await text(B, '.gt-race-card');
  await A.page.screenshot({ path: `${out}/results-desktop.jpg`, type: 'jpeg', quality: 75 });
  await B.page.screenshot({ path: `${out}/results-phone.jpg`, type: 'jpeg', quality: 75 });
} catch (e) { result.failure = String(e?.message ?? e).slice(0, 300); }
const errs = [...(result.A?.errs ?? []), ...(result.B?.errs ?? [])];
result.checks = {
  inviteReceived: /is racing Telegraph Hill Climb/.test(result.invite ?? ''),
  lobbyHasBoth: /Racers: .+, .+/.test(result.lobby ?? ''),
  hostWins: /You finished #1/.test(result.resultsA ?? ''),
  rivalPlaced: /You finished #2/.test(result.resultsB ?? ''),
  noConsoleErrors: !errs.length,
};
result.passed = Object.values(result.checks).every(Boolean);
delete result.A; delete result.B; result.errs = errs;
console.log(JSON.stringify(result, null, 2));
console.log(`\nRESULT: ${result.passed ? 'STREET RACE PASS ✅' : 'CHECK FAILED ❌'} ${JSON.stringify(result.checks)}`);
await browser.close();
