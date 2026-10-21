// Lane B: headless e2e for SFPD return fire (flag policeFire; run with policeBust OFF) on a flags-ON stack. A fresh is_bot player robs a store
// (+$750, instant 2 stars), then stands still. The SFPD close in; once a ground unit stays within 7 m for 2.5 s the
// SERVER busts them: the BUSTED screen plays, wanted drops to 0, valuation falls ~5% (server-applied), and the
// player is moved to SF General (CORRECTION). If the cruisers park out of reach, the player walks to the nearest.
//   GTASF_COMBAT_URL=http://localhost:5374 [PHONE=1] node tools/_bust-check.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5374';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat';
const STORE = process.env.GTASF_FIRE_AT ?? '37.796823,-122.398323'; // embarcadero-market (robbery store)
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
const log = []; const note = s => { log.push(s); console.log(s); };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext(PHONE ? { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
const fundingLog = []; let bustedAt = 0;
if (process.env.DEBUG_FUNDING) page.on('response', r => { const u = new URL(r.url()); if (!u.pathname.startsWith('/api/funding/')) return;
  r.json().then(b => { const t = b?.totalCents ?? b?.profile?.totalCents ?? b?.you?.totalCents; fundingLog.push(`${bustedAt ? '+' + (Date.now() - bustedAt) : 'pre'}ms ${u.pathname} total=${t}`); }).catch(() => {}); });
page.on('websocket', ws => ws.on('framereceived', f => { if (typeof f.payload !== 'string' && f.payload[0] === 0xaa && !bustedAt) bustedAt = Date.now(); }));
const deaths = []; page.on('request', r => { if (new URL(r.url()).pathname === '/api/combat/death') deaths.push(r.url()); });
const stars = () => page.evaluate(() => document.querySelectorAll('.gt-combat-wanted-star.lit').length);
const dollars = () => page.evaluate(() => { const t = document.querySelector('.gt-hud-money, .gt-hud-money-value')?.textContent ?? ''; const n = t.replace(/[^0-9]/g, ''); return n ? Number(n) : null; });
const foot = () => page.evaluate(() => { const f = window.__gtasf?.world?.foot; return f ? { x: f.x, z: f.z } : null; });
const nearestCop = () => page.evaluate(() => {
  const w = window.__gtasf.world, f = w.foot; let best = null;
  for (const c of w.fleet?.cars?.values?.() ?? []) if ((c.data.flags & 0x40) && c.data.kind !== 'supercar') {
    const p = c.model.root.position, d = Math.hypot(p.x - f.x, p.z - f.z); if (!best || d < best.d) best = { d, x: p.x, z: p.z };
  }
  return best;
});
async function clearOnboarding() {
  for (let i = 0; i < 20; i++) {
    const b = await page.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); };
      return { intro: v('.gt-sa-intro') || v('.gt-sa-intro__skip'), id: v('.gt-identity-go'), fund: !!document.querySelector('.gt-funding-onboarding[open]') }; });
    if (!b.intro && !b.id && !b.fund) break;
    if (b.fund) { try { const d = page.locator('.gt-funding-onboarding[open]'); await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill('q'); await d.getByRole('button', { name: 'Save startup' }).click({ timeout: 3000 }); } catch {} }
    else if (b.id) { try { await page.locator('.gt-identity-go').click({ timeout: 3000 }); } catch {} }
    else await page.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click());
    await page.waitForTimeout(500);
  }
}
// Walk toward a point by aiming the camera at it and holding W (desktop) for a short step.
async function stepToward(target) {
  await page.evaluate(async t => {
    const w = window.__gtasf.world, f = w.foot, cam = w.camera, dx = t.x - f.x, dz = t.z - f.z, want = Math.atan2(dx, dz);
    let top = { s: -2, yaw: want };
    for (const yaw of [want, want + Math.PI, -want, Math.PI - want]) {
      cam.setOrbit(yaw, cam.pitch); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const v = cam.camera.getWorldDirection(new cam.camera.position.constructor());
      const s = (v.x * dx + v.z * dz) / (Math.hypot(v.x, v.z) * Math.hypot(dx, dz) || 1); if (s > top.s) top = { s, yaw };
    }
    cam.setOrbit(top.yaw, cam.pitch);
  }, target);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(600); await page.keyboard.up('KeyW');
}
let pass = false;
let policeShots = 0, policeHits = 0;
page.on('websocket', ws => ws.on('framereceived', f => {
  if (typeof f.payload === 'string' || f.payload[0] !== 0xa8) return; // COMBAT_HIT
  const v = new DataView(f.payload.buffer, f.payload.byteOffset, f.payload.byteLength);
  const shooter = v.getUint32(1, true), target = v.getUint32(2 + 4 + 48, true);
  if (shooter >= 1_500_000) { policeShots++; if (target !== 0) policeHits++; }
}));
try {
  await page.goto(`${base}/?at=${STORE}&preset=low&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90_000 });
  await clearOnboarding();
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await page.waitForTimeout(800); await clearOnboarding();
  if (!(await page.evaluate(() => window.__gtasfCombat?.state?.().started))) throw new Error('combat not started (stack not flag-on?)');
  for (let i = 0; i < 20 && (await stars()) < 2; i++) await page.waitForTimeout(1000);
  note(`[police-fire] after robbery: ${await stars()} star(s), health ${await page.evaluate(() => window.__gtasfCombat.state().health)}`);
  let shot = false, minHealth = 100;
  for (let i = 0; i < 80; i++) {
    const h = await page.evaluate(() => window.__gtasfCombat.state().health); minHealth = Math.min(minHealth, h);
    if (i % 8 === 0) { const c = await nearestCop(); note(`  t=${i / 2}s cruiser ${c ? c.d.toFixed(1) + ' m' : 'none'}, shots ${policeShots} (hits ${policeHits}), health ${h}`); }
    if (!shot && policeShots > 0) { await page.waitForTimeout(120); await page.screenshot({ path: `${out}/police-fire-${tag}.jpg`, type: 'jpeg', quality: 85 }); shot = true; }
    if (policeHits >= 3 || await page.evaluate(() => window.__gtasfCombat.state().dead)) break;
    await page.waitForTimeout(500);
  }
  note(`[police-fire] police shots received: ${policeShots}, hits on me: ${policeHits}, lowest health: ${minHealth}`);
  pass = policeShots > 0 && policeHits > 0 && minHealth < 100;
} catch (e) { note(`ABORTED: ${String(e.message).split('\n')[0]}`); }
finally {
  note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 6))}`);
  await writeFile(`${out}/police-fire-log-${tag}.txt`, log.join('\n') + '\n');
  await browser.close();
}
