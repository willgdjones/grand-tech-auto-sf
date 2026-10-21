// "Find Your Co-founders" (mission cofounder-hunt, flag cofounderHunt) end-to-end smoke on a local stack with
// missions on. Start at the hacker-house giver (E) → an instant return claim is refused (server checkpoints) →
// walk the 3 pickups (server-accepted steps) → back at the house the runner's mission-complete is paid.
//
//   GTASF_VERIFY_URL=http://localhost:5319 node tools/cofounder-verify.mjs      (OUT=dir for screenshots)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5319';
const out = process.env.OUT ?? 'docs/sf-data/missions/cofounder'; mkdirSync(out, { recursive: true });
// shared/founder/missions.ts 'cofounder-hunt' (road-snapped)
const START = { lat: 37.785418, lon: -122.397022 };
const STOPS = [{ id: 'rust', lat: 37.781691, lon: -122.394117 }, { id: 'designer', lat: 37.776493, lon: -122.394309 }, { id: 'staff-eng', lat: 37.782761, lon: -122.401856 }, { id: 'return', ...START }];
const result = { base, at: new Date().toISOString(), legs: [] };
const project = (lat, lon) => { const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f);
  const ecef = (la, lo) => { const phi = la * rad, lam = lo * rad, n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2); return [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - e2) * Math.sin(phi)]; };
  const o = { lat: 37.7842, lon: -122.4078 }, a = ecef(o.lat, o.lon), b = ecef(lat, lon), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const phi = o.lat * rad, lam = o.lon * rad;
  return { x: -Math.sin(lam) * d[0] + Math.cos(lam) * d[1], z: -(-Math.sin(phi) * Math.cos(lam) * d[0] - Math.sin(phi) * Math.sin(lam) * d[1] + Math.cos(phi) * d[2]) }; };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => { try {
  localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Cofounders', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' }));
  localStorage.setItem('gtasf.founder.bucket.v2', 'ladder'); } catch {} });
const page = await ctx.newPage(); page.setDefaultTimeout(90000);
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push(m.text().slice(0, 160)); });
const api = []; page.on('response', r => { const p = new URL(r.url()).pathname; if (p.startsWith('/api/funding/mission-')) r.json().then(b => api.push({ p, http: r.status(), ...b })).catch(() => {}); });
const toasts = []; await page.exposeFunction('__toast', t => toasts.push(t));
async function clearOnboarding(p) {
  for (let i = 0; i < 20; i++) { const b = await p.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); }; return { intro: v('.gt-sa-intro') || v('.gt-sa-intro__skip'), id: v('.gt-identity-go'), fund: !!document.querySelector('.gt-funding-onboarding[open]') }; });
    if (!b.intro && !b.id && !b.fund) break;
    if (b.fund) { try { const d = p.locator('.gt-funding-onboarding[open]'); await d.getByLabel('Startup name', { exact: true }).fill('QA Cofounders'); await d.getByLabel('Your nickname', { exact: true }).fill('q'); await d.getByRole('button', { name: 'Save startup' }).click({ timeout: 3000 }); } catch {} await p.waitForTimeout(600); continue; }
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
  // Watch toasts (the runner's pickup cues) via the DOM.
  await page.addInitScript(() => { addEventListener('DOMContentLoaded', () => new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && /toast/i.test(String(n.className ?? ''))) window.__toast?.(n.textContent?.trim().slice(0, 140)); }).observe(document.body, { childList: true, subtree: true })); });
  await page.goto(`${base}/?at=${(START.lat + 0.0005).toFixed(6)},${START.lon.toFixed(6)},180&bot=1&preset=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120000 });
  await clearOnboarding(page);
  await page.waitForSelector('.gt-mission-phone', { state: 'attached', timeout: 180000 }).catch(() => {});
  await clearOnboarding(page);
  await page.keyboard.press('KeyN'); await page.waitForTimeout(800);
  result.phoneJobs = await page.evaluate(() => [...document.querySelectorAll('.gt-mission-phone-item-title')].map(e => e.textContent));
  await page.locator('.gt-mission-phone').screenshot({ path: `${out}/phone-jobs.png` });
  await page.keyboard.press('KeyN');
  result.legs.push({ to: 'giver', dist: await walkTo(START, 4) });
  await page.screenshot({ path: `${out}/giver-desktop.jpg`, type: 'jpeg', quality: 80 });
  await page.keyboard.down('KeyE'); await page.waitForTimeout(90); await page.keyboard.up('KeyE');
  await page.waitForTimeout(2000);
  result.started = api.find(a => a.p === '/api/funding/mission-start') ?? null;
  // Anti-cheat: claim the return delivery right away (standing at the house = the delivery point).
  result.instantClaim = await page.evaluate(async () => { const r = await fetch('/api/funding/mission-complete', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' }); return { http: r.status, body: await r.json().catch(() => null) }; });
  // Live-job banner with the Abandon button (not clicked).
  await page.keyboard.press('KeyN'); await page.waitForTimeout(800);
  result.abandonButton = await page.evaluate(() => { const b = document.querySelector('.gt-mission-phone-abandon'); return !!b && !b.hidden && !!b.closest('.gt-mission-phone-live:not([hidden])'); });
  await page.locator('.gt-mission-phone').screenshot({ path: `${out}/phone-live-abandon.png` });
  await page.keyboard.press('KeyN');
  for (const stop of STOPS) {
    result.legs.push({ to: stop.id, dist: await walkTo(stop, stop.id === 'return' ? 5 : 8) });
    if (stop.id === 'rust') await page.screenshot({ path: `${out}/pickup-desktop.jpg`, type: 'jpeg', quality: 80 });
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/complete-desktop.jpg`, type: 'jpeg', quality: 80 });
  result.complete = api.filter(a => a.p === '/api/funding/mission-complete' && a.http === 200).at(-1) ?? null;
  // Cooldown at start: the job is now done for today — a repeat start is refused up front, and the phone says so.
  result.repeatStart = await page.evaluate(async () => { const r = await fetch('/api/funding/mission-start', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ missionId: 'cofounder-hunt' }) }); return { http: r.status, body: await r.json().catch(() => null) }; });
  // Now funded: the once-a-day quest-giver call rings within ~15 s (it was deferred while the job ran).
  result.call = await page.waitForSelector('.gt-phone-call:not([hidden])', { timeout: 40000 }).then(() => page.evaluate(() => document.querySelector('.gt-phone-call')?.textContent?.slice(0, 200))).catch(() => null);
  if (result.call) {
    await page.screenshot({ path: `${out}/phone-call-desktop.jpg`, type: 'jpeg', quality: 80 });
    await page.locator('.gt-phone-call-answer').click();
    await page.waitForTimeout(1500);
    result.callAnswered = await page.evaluate(() => /Routing to/.test(document.body.innerText));
  }
  await page.keyboard.press('KeyN'); await page.waitForTimeout(1500);
  result.phoneDone = await page.evaluate(() => [...document.querySelectorAll('.gt-mission-phone-start')].map(b => `${b.textContent}${b.disabled ? ' (disabled)' : ''}`));
  await page.locator('.gt-mission-phone').screenshot({ path: `${out}/phone-done-today.png` });
} catch (e) { result.failure = String(e?.message ?? e).slice(0, 300); }
result.toasts = toasts; result.errs = errs; result.api = api.map(a => `${a.p} ${a.http} ${a.status ?? a.error}`);
result.checks = {
  phoneListsJob: (result.phoneJobs ?? []).includes('Find Your Co-founders'),
  started: result.started?.status === 'started',
  instantClaimRefused: result.instantClaim?.body?.status === 'incomplete',
  walkedAllStops: result.legs.length === 5 && result.legs.every(l => l.dist <= 9),
  paid: result.complete?.status === 'completed' && result.complete?.outcome?.credited === true,
  abandonButton: result.abandonButton === true,
  repeatStartBlocked: result.repeatStart?.body?.status === 'blocked',
  phoneShowsDoneToday: (result.phoneDone ?? []).some(t => /Done today/.test(t) && /disabled/.test(t)),
  questGiverCall: !!result.call && result.callAnswered === true,
  noConsoleErrors: !errs.length,
};
result.passed = Object.values(result.checks).every(Boolean);
console.log(JSON.stringify(result, null, 2));
console.log(`\nRESULT: ${result.passed ? 'COFOUNDER HUNT PASS ✅' : 'CHECK FAILED ❌'} ${JSON.stringify(result.checks)}`);
await browser.close();
