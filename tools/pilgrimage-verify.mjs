// SF PILGRIMAGE smoke (LANE C task 6, flag pilgrimage). Local by default (a combat-stack with missions on); after the
// orchestrator enables `pilgrimage` it doubles as the post-enable prod smoke on throwaway is_bot devices (bot=1).
//
//   GTASF_VERIFY_URL=http://localhost:5319 node tools/pilgrimage-verify.mjs      (OUT=dir for screenshots)
//
// 1. Phone (desktop, N): the SF PILGRIMAGE section lists all 12 landmarks with Route buttons.
// 2. Anti-teleport: a fresh device deep-linked ONTO Dolores Park → claim returns 409 no-travel (nothing paid).
// 3. Real travel: a fresh device deep-linked ~220 m north of Dolores Park walks in (small server-accepted steps) →
//    the tracker auto-claims → 'completed', valuation credited, the phone shows ✓ Dolores Park.
// 4. Phone (touch viewport): ☰ → Game options → "Phone: jobs & SF pilgrimage" opens the phone.
// Writes only to its own is_bot devices. Bails (no write) if pilgrimage is off at the target.
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5319';
const out = process.env.OUT ?? 'docs/sf-data/pilgrimage'; mkdirSync(out, { recursive: true });
const SITE = { id: 'dolores-park', lat: 37.759654, lon: -122.426013 }; // shared/founder/pilgrimage.ts (road-snapped)
const NORTH = '37.76180,-122.42620,180'; // Dolores St, ~240 m north of the site
const note = s => console.log(s);
const result = { base, at: new Date().toISOString() };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

const seed = () => { try {
  localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Pilgrim', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' }));
  localStorage.setItem('gtasf.founder.bucket.v2', 'ladder');
} catch {} };
async function open(at, ctxOpts = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }) {
  const ctx = await browser.newContext(ctxOpts); await ctx.addInitScript(seed);
  const page = await ctx.newPage(); page.setDefaultTimeout(90000);
  const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push(m.text().slice(0, 160)); });
  const claims = []; page.on('response', r => { if (new URL(r.url()).pathname === '/api/funding/pilgrimage-claim') r.json().then(b => claims.push({ http: r.status(), ...b })).catch(() => {}); });
  await page.goto(`${base}/?${at ? `at=${at}&` : ''}bot=1&preset=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120000 });
  await clearOnboarding(page);
  // The phone + pilgrimage tracker mount with the deferred scenery (seconds after READY); wait for them.
  await page.waitForSelector('.gt-mission-phone', { state: 'attached', timeout: 180000 }).catch(() => {});
  await clearOnboarding(page); // the SA intro can (re)appear while the scenery loads, notably on touch
  return { ctx, page, errs, claims };
}
// SA intro + identity + funding onboarding (names the startup server-side so credits can pay).
async function clearOnboarding(p) {
  for (let i = 0; i < 20; i++) { const b = await p.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); }; return { intro: v('.gt-sa-intro') || v('.gt-sa-intro__skip'), id: v('.gt-identity-go'), fund: !!document.querySelector('.gt-funding-onboarding[open]') }; });
    if (!b.intro && !b.id && !b.fund) break;
    if (b.fund) { try { const d = p.locator('.gt-funding-onboarding[open]'); await d.getByLabel('Startup name', { exact: true }).fill('QA Pilgrim'); await d.getByLabel('Your nickname', { exact: true }).fill('q'); await d.getByRole('button', { name: 'Save startup' }).click({ timeout: 3000 }); } catch {} await p.waitForTimeout(600); continue; }
    if (b.id) { try { await p.locator('.gt-identity-go').click({ timeout: 3000 }); } catch {} await p.waitForTimeout(500); continue; }
    if (b.intro) { await p.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click()); await p.waitForTimeout(500); continue; } }
  await p.waitForTimeout(800);
}
const api = (page, path, init) => page.evaluate(async ([path, init]) => { const r = await fetch(path, { credentials: 'same-origin', ...init }); return { http: r.status, body: await r.json().catch(() => null) }; }, [path, init]);
// The global SF frame placePoint uses (tools/map SF_FRAME) — ENU around 37.7842,-122.4078, z = -north.
const project = (lat, lon) => { const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f);
  const ecef = (la, lo) => { const phi = la * rad, lam = lo * rad, n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2); return [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - e2) * Math.sin(phi)]; };
  const o = { lat: 37.7842, lon: -122.4078 }, a = ecef(o.lat, o.lon), b = ecef(lat, lon), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const phi = o.lat * rad, lam = o.lon * rad;
  return { x: -Math.sin(lam) * d[0] + Math.cos(lam) * d[1], z: -(-Math.sin(phi) * Math.cos(lam) * d[0] - Math.sin(phi) * Math.sin(lam) * d[1] + Math.cos(phi) * d[2]) }; };

try {
  // 1+3: walk-in claim (fresh device), with the phone shots before/after.
  const walker = await open(NORTH);
  const list = await api(walker.page, '/api/funding/pilgrimage');
  if (list.http === 404) { result.enabled = false; note('pilgrimage OFF at target — nothing written.'); throw 'off'; }
  result.enabled = true; result.listBefore = list.body;
  await walker.page.keyboard.press('KeyN'); await walker.page.waitForTimeout(800);
  result.phoneRows = await walker.page.evaluate(() => ({ rows: document.querySelectorAll('.gt-mission-phone-pilgrim').length, route: document.querySelectorAll('.gt-mission-phone-pilgrim-route').length, header: [...document.querySelectorAll('.gt-mission-phone-header')].map(e => e.textContent) }));
  await walker.page.locator('.gt-mission-phone').screenshot({ path: `${out}/phone-desktop-before.png` });
  await walker.page.keyboard.press('KeyN');
  const target = project(SITE.lat, SITE.lon), trace = [];
  for (let i = 0; i < 700; i++) {
    const s = await walker.page.evaluate(({ tx, tz }) => { const f = window.__gtasf.world.foot; const dx = tx - f.x, dz = tz - f.z, d = Math.hypot(dx, dz);
      if (d > 15) { const k = Math.min(0.5, d) / d; f.x += dx * k; f.z += dz * k; } return Math.round(d); }, { tx: target.x, tz: target.z });
    if (i % 100 === 0) trace.push(s);
    if (walker.claims.some(c => c.status === 'completed') || (s <= 15 && i % 20 === 0 && walker.claims.length > 3)) break;
    await walker.page.waitForTimeout(110);
  }
  await walker.page.waitForTimeout(2500);
  result.walk = { trace, claims: walker.claims };
  result.listAfter = (await api(walker.page, '/api/funding/pilgrimage')).body;
  await walker.page.screenshot({ path: `${out}/claim-desktop.jpg`, type: 'jpeg', quality: 80 });
  await walker.page.keyboard.press('KeyN'); await walker.page.waitForTimeout(1200);
  result.phoneDone = await walker.page.evaluate(() => [...document.querySelectorAll('.gt-mission-phone-pilgrim-done')].map(e => e.textContent));
  await walker.page.locator('.gt-mission-phone').screenshot({ path: `${out}/phone-desktop-after.png` });
  result.walkerErrors = walker.errs; await walker.ctx.close();

  // 2: deep link straight onto the site → no-travel.
  const jumper = await open(`${SITE.lat},${SITE.lon},0`);
  await jumper.page.waitForTimeout(1500);
  result.teleportClaim = await api(jumper.page, '/api/funding/pilgrimage-claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteId: SITE.id }) });
  result.jumperErrors = jumper.errs; await jumper.ctx.close();

  // 4: touch viewport — Game options entry opens the phone.
  const phone = await open('', { ...devices['Pixel 7'] });
  // Phones (minimal HUD): ☰ pause menu → City actions → Game options → the phone entry.
  result.touchBlocker = await phone.page.evaluate(() => { const b = document.querySelector('.gt-pause-launch'); const r = b?.getBoundingClientRect(); const t = r && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { rect: r && [r.x, r.y, r.width, r.height], top: t ? `${t.tagName}.${t.className}` : null }; });
  await phone.page.locator('.gt-pause-launch').click({ timeout: 15000 }); await phone.page.waitForTimeout(500);
  await phone.page.locator('#movement-mode').click(); await phone.page.waitForTimeout(600);
  await phone.page.getByRole('button', { name: 'Phone: jobs & SF pilgrimage' }).click(); await phone.page.waitForTimeout(1200);
  result.touchPhoneOpen = await phone.page.evaluate(() => { const e = document.querySelector('.gt-mission-phone'); return !!e && !e.hidden; });
  await phone.page.screenshot({ path: `${out}/phone-touch.jpg`, type: 'jpeg', quality: 80 });
  result.phoneErrors = phone.errs; await phone.ctx.close();
} catch (e) { if (e !== 'off') { result.failure = String(e?.message ?? e).slice(0, 300); note(`FAILURE: ${result.failure}`); } }
const completed = result.walk?.claims?.find(c => c.status === 'completed');
result.checks = {
  phoneLists12: result.phoneRows?.rows === 12 && result.phoneRows?.route === 12,
  walkInPaid: !!completed && completed.outcome?.credited === true && result.listAfter?.collected?.includes(SITE.id),
  phoneShowsCollected: (result.phoneDone ?? []).some(t => /Dolores Park/.test(t)),
  teleportRejected: result.teleportClaim?.http === 409 && result.teleportClaim?.body?.status === 'no-travel',
  touchPhoneOpens: result.touchPhoneOpen === true,
  noConsoleErrors: ![...(result.walkerErrors ?? []), ...(result.jumperErrors ?? []), ...(result.phoneErrors ?? [])].length,
};
result.passed = result.enabled === true && Object.values(result.checks).every(Boolean);
console.log(JSON.stringify(result, null, 2));
note(`\nRESULT: ${result.passed ? 'PILGRIMAGE PASS ✅' : 'CHECK FAILED ❌'} ${JSON.stringify(result.checks)}`);
await browser.close();
