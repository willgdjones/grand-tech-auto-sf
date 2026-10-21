// Acqui-hire ("Buy My Company", flag acquihireQuest) escrow smoke on a LOCAL stack (combat-stack with missions +
// economyV3). Seeds a $50k credit for the fresh device in the LOCAL D1 (never prod), then through the real UI + server:
//   A) buy (price debited) → Abandon on the phone → price refunded;
//   B) buy again → walk the laptop to the hacker house (server-accepted steps) → paid 1.5× the price.
// Balances are read from the local D1 at each step.   SNAP=/tmp/gtasf-lanec-verify node tools/acquihire-verify.mjs
// PROD mode (post-enable smoke; GTASF_VERIFY_URL=https://gtasf.pages.dev): no D1 access — a throwaway is_bot device is
// funded the real way (found → Pre-seed pitch), reloaded next to the burnt-out founder, then buys and ABANDONS (A only):
// the price is debited and refunded, read from /api/funding/profile currentCents. Nothing else is written.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5319';
const out = process.env.OUT ?? 'docs/sf-data/missions/acquihire';
const SNAP = process.env.SNAP ?? '/tmp/gtasf-lanec-verify'; mkdirSync(out, { recursive: true });
// shared/founder/missions.ts 'acquihire' (road-snapped)
const START = { lat: 37.776464, lon: -122.424129 };
const HOUSE = { lat: 37.785418, lon: -122.397022 };
const d1 = sql => JSON.parse(execFileSync('node', [`${process.cwd()}/node_modules/wrangler/bin/wrangler.js`, 'd1', 'execute', 'gtasf-local', '--local', '--json', '--command', sql], { cwd: `${SNAP}/worker`, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0].results;
const PROD = process.env.PROD === '1' || !/localhost|127\.0\.0\.1/.test(base);
const balance = async id => PROD ? Number((await page.evaluate(async () => (await (await fetch('/api/funding/profile', { credentials: 'same-origin' })).json()).currentCents)) ?? NaN)
  : d1(`SELECT economy_v3_current_cents c FROM funding_profiles WHERE device_id='${id}'`)[0]?.c ?? null;
const result = { base, at: new Date().toISOString(), legs: [] };
const project = (lat, lon) => { const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f);
  const ecef = (la, lo) => { const phi = la * rad, lam = lo * rad, n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2); return [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - e2) * Math.sin(phi)]; };
  const o = { lat: 37.7842, lon: -122.4078 }, a = ecef(o.lat, o.lon), b = ecef(lat, lon), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const phi = o.lat * rad, lam = o.lon * rad;
  return { x: -Math.sin(lam) * d[0] + Math.cos(lam) * d[1], z: -(-Math.sin(phi) * Math.cos(lam) * d[0] - Math.sin(phi) * Math.sin(lam) * d[1] + Math.cos(phi) * d[2]) }; };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
// Prod mode founds + pitches for real, so it must NOT pre-seed a founded/Pre-seed-closed ladder state.
if (!PROD) await ctx.addInitScript(() => { try {
  localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Acquirer', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' }));
  localStorage.setItem('gtasf.founder.bucket.v2', 'ladder'); } catch {} });
const page = await ctx.newPage(); page.setDefaultTimeout(90000);
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push(m.text().slice(0, 160)); });
const api = []; page.on('response', r => { const p = new URL(r.url()).pathname; if (p.startsWith('/api/funding/mission-')) r.json().then(b => api.push({ p, http: r.status(), ...b })).catch(() => {}); });
const toasts = []; await page.exposeFunction('__toast', t => toasts.push(t));
async function clearOnboarding(p) {
  for (let i = 0; i < 20; i++) { const b = await p.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); }; return { intro: v('.gt-sa-intro') || v('.gt-sa-intro__skip'), id: v('.gt-identity-go'), fund: !!document.querySelector('.gt-funding-onboarding[open]') }; });
    if (!b.intro && !b.id && !b.fund) break;
    if (b.fund) { try { const d = p.locator('.gt-funding-onboarding[open]'); await d.getByLabel('Startup name', { exact: true }).fill('QA Acquirer'); await d.getByLabel('Your nickname', { exact: true }).fill('q'); await d.getByRole('button', { name: 'Save startup' }).click({ timeout: 3000 }); } catch {} await p.waitForTimeout(600); continue; }
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
const tapE = async () => { await page.keyboard.down('KeyE'); await page.waitForTimeout(90); await page.keyboard.up('KeyE'); await page.waitForTimeout(2000); };
/** PROD funding: found the startup and take the Pre-seed pitch from the quest card (a judged cheque ≥ $1k in v3). */
async function fundByPitch() {
  await page.goto(`${base}/?bot=1&preset=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready, { timeout: 120000 });
  for (let step = 0; step < 25; step++) {
    await page.waitForTimeout(2500);
    const s = await page.evaluate(() => { const vis = e => !!e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      const d = [...document.querySelectorAll('dialog[open]')].filter(vis)[0], q = document.querySelector('.gt-founder-quest');
      return { dialog: d ? String(d.className) : null, buttons: d ? [...d.querySelectorAll('button')].filter(vis).map(b => b.innerText.trim()) : [], quest: vis(q) ? q.innerText.replace(/\s+/g, ' ') : '' }; });
    if (/SEED ROUND|HAIL A ROBOTAXI/i.test(s.quest) && !s.dialog) return true; // Pre-seed closed → funded
    try {
      if (s.dialog && /gt-founder-pitch/.test(s.dialog)) {
        if (s.buttons.some(b => /continue/i.test(b))) await page.locator('dialog[open] .gt-founder-pitch-done:not(.gt-founder-pitch-skip)').click();
        else await page.locator('dialog[open] .gt-founder-pitch-line').first().click();
      } else if (s.dialog) {
        const pick = s.buttons.find(b => /^.?\s*(done|continue|found it)/i.test(b)) ?? s.buttons[0];
        await page.locator('dialog[open] button:visible').filter({ hasText: pick }).first().click();
      } else if (/found it|pitch now/i.test(s.quest)) await page.locator('.gt-founder-quest-cta').click();
    } catch { /* next step */ }
  }
  return false;
}
try {
  if (PROD) result.fundedByPitch = await fundByPitch();
  await page.goto(`${base}/?at=${(START.lat + 0.0005).toFixed(6)},${START.lon.toFixed(6)},180&bot=1&preset=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120000 });
  await clearOnboarding(page);
  await page.waitForSelector('.gt-mission-phone', { state: 'attached', timeout: 180000 }).catch(() => {});
  await clearOnboarding(page);
  const device = (await page.evaluate(async () => (await (await fetch('/api/funding/profile', { credentials: 'same-origin' })).json()).deviceId));
  if (!PROD) d1(`INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents,meta_json) VALUES ('seed-${Date.now()}','${device}','sf-tech-week-2026','celebrity','qa-seed','QA seed','2026-10-14',${Date.now()},5000000,NULL)`);
  // Local: the stored snapshot only folds the seed in on the next refresh (the buy does it), so the baseline is the seed.
  // Prod: the profile's read-time currentCents is already exact.
  result.seeded = PROD ? await balance(device) : 5_000_000;
  result.legs.push({ to: 'founder', dist: await walkTo(START, 4) });
  // A) buy → abandon → refund
  await tapE();
  result.startA = api.find(a => a.p === '/api/funding/mission-start') ?? null;
  result.afterBuyA = await balance(device);
  await page.keyboard.press('KeyN'); await page.waitForTimeout(1200);
  await page.locator('.gt-mission-phone').screenshot({ path: `${out}/phone-live-abandon.png` });
  await page.locator('.gt-mission-phone-abandon').click(); await page.waitForTimeout(2500);
  result.abandon = api.find(a => a.p === '/api/funding/mission-abandon') ?? null;
  result.afterAbandon = await balance(device);
  if (await page.evaluate(() => !document.querySelector('.gt-mission-phone')?.hidden)) await page.keyboard.press('KeyN');
  // B) buy → deliver → paid (local only: prod mode stops after the refund check, writing nothing more)
  if (PROD) throw 'prod-done';
  api.length = 0;
  await tapE();
  result.startB = api.find(a => a.p === '/api/funding/mission-start') ?? null;
  result.afterBuyB = await balance(device);
  await page.screenshot({ path: `${out}/bought-desktop.jpg`, type: 'jpeg', quality: 80 });
  result.legs.push({ to: 'house', dist: await walkTo(HOUSE, 6, 8000) });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/flipped-desktop.jpg`, type: 'jpeg', quality: 80 });
  result.complete = api.filter(a => a.p === '/api/funding/mission-complete' && a.status === 'completed').at(-1) ?? null;
  result.afterDeliver = await balance(device);
  result.escrow = d1(`SELECT status, cost_cents FROM acquisitions WHERE device_id='${device}' ORDER BY started_at`);
} catch (e) { if (e !== 'prod-done') result.failure = String(e?.message ?? e).slice(0, 300); }
result.toasts = toasts.filter(Boolean).slice(-8); result.errs = errs; result.api = api.map(a => `${a.p} ${a.http} ${a.status ?? a.error ?? ''}`);
const cost = Number(result.startA?.costCents ?? 0);
result.checks = PROD ? {
  funded: result.fundedByPitch === true && result.seeded >= 100_000,
  startedWithPrice: result.startA?.status === 'started' && cost >= 100_000,
  debitedOnBuy: result.afterBuyA === result.seeded - cost,
  refundedOnAbandon: result.abandon?.refunded === true && result.afterAbandon === result.seeded,
  noConsoleErrors: !errs.length,
} : {
  startedWithPrice: result.startA?.status === 'started' && cost === 500000,
  debitedOnBuy: result.afterBuyA === result.seeded - cost,
  refundedOnAbandon: result.abandon?.refunded === true && result.afterAbandon === result.seeded,
  debitedAgain: result.afterBuyB === result.seeded - cost,
  paidOnDelivery: result.complete?.outcome?.payoutCents === String(cost * 1.5) && result.afterDeliver === result.seeded - cost + cost * 1.5,
  escrowSettled: JSON.stringify((result.escrow ?? []).map(r => r.status)) === '["refunded","delivered"]',
  noConsoleErrors: !errs.length,
};
result.passed = Object.values(result.checks).every(Boolean);
console.log(JSON.stringify(result, null, 2));
console.log(`\nRESULT: ${result.passed ? 'ACQUIHIRE PASS ✅' : 'CHECK FAILED ❌'} ${JSON.stringify(result.checks)}`);
await browser.close();
