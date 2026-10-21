// Street-race NPC rivals (flag raceRivals) on a LOCAL stack (stack OUTSIDE heavy.sh; only this capture inside):
//   SNAP=/tmp/gtasf-lanec-verify WEB_PORT=5319 WORKER_PORT=8988 COMBAT_FLAGS="founderLadder pitching economyV3 missions" tools/combat-stack.sh up
//   tools/heavy.sh node tools/race-rivals-verify.mjs
// Fresh device per profile at the Embarcadero sprint 'T': Host → nobody joins → the lobby says rivals will race →
// countdown + 'Racing 3 rivals' → running HUD shows POS n/4 and three rival pins → run the gates (server-accepted
// nudges, ~6.5 m/s) → results card with four placings and the player's place.
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5319';
const out = process.env.OUT ?? 'docs/sf-data/race-rivals'; mkdirSync(out, { recursive: true });
const START = { lat: 37.795347, lon: -122.393962 }, GATES = [{ lat: 37.797878, lon: -122.395200 }, { lat: 37.799500, lon: -122.397500 }];
const project = (lat, lon) => { const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f);
  const ecef = (la, lo) => { const phi = la * rad, lam = lo * rad, n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2); return [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - e2) * Math.sin(phi)]; };
  const o = { lat: 37.7842, lon: -122.4078 }, a = ecef(o.lat, o.lon), b = ecef(lat, lon), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], phi = o.lat * rad, lam = o.lon * rad;
  return { x: -Math.sin(lam) * d[0] + Math.cos(lam) * d[1], z: -(-Math.sin(phi) * Math.cos(lam) * d[0] - Math.sin(phi) * Math.sin(lam) * d[1] + Math.cos(phi) * d[2]) }; };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const results = {};
for (const [tag, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', { ...devices['Pixel 7'] }]].filter(([t]) => !process.env.ONLY || process.env.ONLY === t)) {
  const r = results[tag] = { notes: [] };
  const context = await browser.newContext(opts); const page = await context.newPage(); page.setDefaultTimeout(60000);
  const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push(m.text().slice(0, 160)); });
  const touch = tag === 'phone';
  const text = sel => page.evaluate(sel => { const e = [...document.querySelectorAll(sel)].find(e => !e.hidden && e.getClientRects().length); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
  const walkTo = async (t, stop, step = 0.72) => { const p = project(t.lat, t.lon); for (let i = 0; i < 4000; i++) {
    const d = await page.evaluate(({ x, z, stop, step }) => { const f = window.__gtasf.world.foot, dx = x - f.x, dz = z - f.z, d = Math.hypot(dx, dz); if (d > stop) { const k = Math.min(step, d - stop) / d; f.x += dx * k; f.z += dz * k; } return d; }, { x: p.x, z: p.z, stop, step });
    if (d <= stop + 0.2) return Math.round(d); if (i % 150 === 0) await page.keyboard.press('ShiftLeft'); await page.waitForTimeout(110); } return -1; };
  try {
    await page.goto(`${base}/?bot=1&at=${START.lat},${START.lon}${touch ? '&preset=low' : ''}`);
    await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120000 });
    await page.waitForTimeout(3000);
    await walkTo(START, 3); await page.waitForTimeout(1500);
    const hostBtn = page.locator('.gt-race-host');
    await hostBtn.waitFor({ state: 'visible', timeout: 20000 });
    await hostBtn[touch ? 'tap' : 'click']();
    await page.waitForTimeout(2000);
    r.lobby = await text('.gt-race-card');
    await page.screenshot({ path: `${out}/lobby-${tag}.jpg`, type: 'jpeg', quality: 72 });
    r.notices = [];
    for (let i = 0; i < 400 && !(await page.evaluate(() => document.querySelector('.gt-race-hud') && !document.querySelector('.gt-race-hud').hidden)); i++) {
      const seen = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && /Racing 3 rivals/.test(e.textContent ?? '')).map(e => e.textContent));
      if (seen.length && !r.notices.length) { r.notices = seen; await page.screenshot({ path: `${out}/countdown-${tag}.jpg`, type: 'jpeg', quality: 72 }); }
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(4000);
    r.hudEarly = await text('.gt-race-hud');
    r.questHiddenWhileRacing = await page.evaluate(() => { const q = document.querySelector('.gt-founder-quest'); return !q || q.getClientRects().length === 0; });
    await page.screenshot({ path: `${out}/running-${tag}.jpg`, type: 'jpeg', quality: 72 });
    for (const g of GATES) { await walkTo(g, 4); await page.waitForTimeout(300); }
    r.hudLate = await text('.gt-race-hud');
    await page.waitForFunction(() => /finished #|Race over/.test(document.querySelector('.gt-race-card')?.textContent ?? ''), null, { timeout: 120000 }).catch(() => {});
    r.results = await text('.gt-race-card');
    await page.screenshot({ path: `${out}/results-${tag}.jpg`, type: 'jpeg', quality: 72 });
  } catch (e) { r.failure = e.message.slice(0, 200); }
  r.errors = errs.slice(0, 5);
  r.checks = {
    lobbyMentionsRivals: /three rivals/.test(r.lobby ?? ''),
    racingRivalsNotice: (r.notices ?? []).length > 0,
    posInHud: /POS \d\/4/.test(r.hudEarly ?? ''),
    questCardSteppedAside: !!r.questHiddenWhileRacing,
    results4: /You finished #[1-4]/.test(r.results ?? '') && ((r.results ?? '').match(/#\d/g) ?? []).length >= 5,
    noConsoleErrors: errs.length === 0,
  };
  await context.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
const ok = Object.values(results).every(r => Object.values(r.checks).every(Boolean));
console.log(`RESULT: RACE RIVALS ${ok ? 'PASS ✅' : 'CHECK FAILED ❌'} ${JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.checks])))}`);
