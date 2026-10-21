// Lane B: in-game evidence for the founder's 2026-10-14 playtest notes, on a stack with the LIVE prod combat flags
// (seed prod collision with tools/_seed-prod-collision.mjs). One fresh player per item:
//   shoot    — at Union Square, F opens the 18+ gate, the one-time hint shows, then F fires the starter pistol
//              (a C2S COMBAT_FIRE is sent and the magazine drops).
//   distance — 2★ on foot by the Corner Market: the nearest cruiser keeps >= ~8 m for 25 s (it used to park at 4 m).
//   escape   — 2★, spotted, then run from the nearest unit: the radar search circle shows while out of sight and the
//              stars drop (QA: 2★ for 240 s+ before).
//   cop-car  — 2★, walk up to the parked cruiser and press E: you drive it and the stars go up.
//   GTASF_COMBAT_URL=http://localhost:5374 [PHONE=1] [ONLY=shoot,distance,escape,cop-car] node tools/_founder-feedback-check.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5374';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat/founder-feedback';
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
const ONLY = (process.env.ONLY ?? 'shoot,distance,escape,cop-car').split(',');
const UNION_SQUARE = '37.7891,-122.4096,0', MARKET = '37.796823,-122.398323,270';
const log = []; const note = s => { log.push(s); console.log(s); };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
const view = PHONE ? { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 };

async function open(at, label) {
  const ctx = await browser.newContext(view);
  await ctx.addInitScript(() => {
    window.__fires = 0; window.__sight = [];
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (d) {
      try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, 1) : null;
        if (b && b[0] === 2) window.__worldSocket = this; if (b && b[0] === 0x23) window.__fires++; } catch {}
      return send.call(this, d);
    };
  });
  const p = await ctx.newPage(); p.setDefaultTimeout(60_000);
  p.on('pageerror', e => errors.push(`${label}: ${String(e.message).slice(0, 120)}`));
  p.on('websocket', ws => ws.on('framereceived', f => { if (typeof f.payload !== 'string' && f.payload[0] === 0xb3) p.evaluate(s => window.__sight.push(s), f.payload[1] === 1).catch(() => {}); }));
  await p.goto(`${base}/?at=${at}&preset=low&bot=1`);
  await p.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90_000 });
  for (let i = 0; i < 20; i++) {
    const b = await p.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); };
      return { intro: v('.gt-sa-intro') || v('.gt-sa-intro__skip'), id: v('.gt-identity-go'), fund: !!document.querySelector('.gt-funding-onboarding[open]') }; });
    if (!b.intro && !b.id && !b.fund) break;
    if (b.fund) { try { const d = p.locator('.gt-funding-onboarding[open]'); await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill(label); await d.getByRole('button', { name: 'Save startup' }).click({ timeout: 3000 }); } catch {} }
    else if (b.id) { try { await p.locator('.gt-identity-go').click({ timeout: 3000 }); } catch {} }
    else await p.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click());
    await p.waitForTimeout(500);
  }
  await p.waitForTimeout(1500);
  return { p, ctx };
}
// The SA intro slideshow can come back over the game: skip it before any evidence frame.
const clearIntro = async p => { for (let i = 0; i < 6; i++) { const on = await p.evaluate(() => { const b = document.querySelector('.gt-sa-intro__skip'); if (b && b.checkVisibility()) { b.click(); return true; } return false; }); if (!on) break; await p.waitForTimeout(300); } };
const pageText = p => p.evaluate(() => document.body.textContent ?? '');
const acceptGate = async p => { try { const b = p.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); return true; } catch { return false; } };
const startCombat = async p => { await p.evaluate(() => window.__gtasfCombat?.requestCombat?.()); await acceptGate(p); await p.waitForTimeout(800); };
const stars = p => p.evaluate(() => document.querySelectorAll('.gt-combat-wanted-star.lit').length);
const confess = async (p, n) => { for (let i = 0; i < n; i++) { await p.evaluate(() => window.__worldSocket.send(Uint8Array.of(0x25, 0))); await p.waitForTimeout(1100); } };
const nearestCop = p => p.evaluate(() => { const w = window.__gtasf.world, f = w.foot; let best = null;
  for (const c of w.fleet.cars.values()) { if (!(c.data.flags & 0x40) || c.data.kind !== 'subaru') continue; const q = c.model.root.position, d = Math.hypot(q.x - f.x, q.z - f.z); if (!best || d < best.d) best = { d, x: q.x, z: q.z, id: c.data.id, speed: c.data.speedCmps }; }
  return best; });
const face = (p, t, away = false, bias = 0) => p.evaluate(async ({ t, away, bias }) => {
  const w = window.__gtasf.world, f = w.foot, cam = w.camera; let dx = t.x - f.x, dz = t.z - f.z; if (away) { dx = -dx; dz = -dz; }
  const a = Math.atan2(dx, dz) + bias, ux = Math.sin(a), uz = Math.cos(a); let top = { s: -2, y: 0 };
  for (const y of [a, a + Math.PI, -a, Math.PI - a]) { cam.setOrbit(y, cam.pitch); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const v = cam.camera.getWorldDirection(new cam.camera.position.constructor()); const s = v.x * ux + v.z * uz; if (s > top.s) top = { s, y }; }
  cam.setOrbit(top.y, cam.pitch); }, { t, away, bias });
const results = {};

async function shoot() {
  const { p, ctx } = await open(UNION_SQUARE, 'S');
  const hintBefore = await p.evaluate(() => document.querySelector('[data-status="prompt"], .gt-status')?.textContent ?? '');
  await p.keyboard.press('KeyF'); // before 18+: F is a combat intent → the gate
  const gate = await acceptGate(p);
  await p.waitForTimeout(600);
  const hint = await p.evaluate(() => [...document.querySelectorAll('body *')].map(e => e.childElementCount === 0 ? e.textContent : '').find(t => t && t.includes('to shoot')) ?? null);
  await clearIntro(p);
  await p.screenshot({ path: `${out}/shoot-hint-${tag}.jpg`, type: 'jpeg', quality: 85 });
  const before = await p.evaluate(() => ({ fires: window.__fires, ammo: window.__gtasfCombat.state().ammo.pistol }));
  if (PHONE) { const b = p.locator('.gt-fire-button, button:has-text("FIRE")').first(); try { const box = await b.boundingBox(); if (box) await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); } catch {} }
  else { await clearIntro(p); await p.keyboard.down('KeyF'); await p.waitForTimeout(80); await p.keyboard.up('KeyF'); }
  await p.waitForTimeout(250);
  await p.screenshot({ path: `${out}/shoot-fired-${tag}.jpg`, type: 'jpeg', quality: 85 });
  const after = await p.evaluate(() => ({ fires: window.__fires, ammo: window.__gtasfCombat.state().ammo.pistol }));
  note(`[shoot] gate via F: ${gate}; hint: ${JSON.stringify(hint)}; fired ${after.fires - before.fires}, pistol ${before.ammo}→${after.ammo}; controls bar has 'F shoot': ${/F shoot/.test(await pageText(p))}`);
  results.shoot = gate && after.fires > before.fires && after.ammo < before.ammo && !!hint;
  void hintBefore; await ctx.close();
}

async function distance() {
  const { p, ctx } = await open(MARKET, 'D');
  await startCombat(p); await confess(p, 2);
  let min = Infinity, samples = 0;
  for (let i = 0; i < 70; i++) { const c = await nearestCop(p); if (c) { if (c.d < 60) { samples++; min = Math.min(min, c.d); } if (i > 0 && c.d < 14 && samples === 1) { await face(p, c); await clearIntro(p); await p.screenshot({ path: `${out}/distance-${tag}.jpg`, type: 'jpeg', quality: 85 }); } } await p.waitForTimeout(500); }
  if (samples > 1) { const c = await nearestCop(p); if (c) { await face(p, c); await clearIntro(p); await p.screenshot({ path: `${out}/distance-${tag}.jpg`, type: 'jpeg', quality: 85 }); } }
  note(`[distance] ${await stars(p)}★; nearest cruiser over ${samples} samples within 60 m: min ${min.toFixed(1)} m`);
  results.distance = samples > 4 && min >= 8;
  await ctx.close();
}

async function escape() {
  const { p, ctx } = await open(MARKET, 'E');
  await startCombat(p); await confess(p, 2);
  const start = await stars(p);
  const wantedHint = /Lose the cops/.test(await pageText(p));
  await clearIntro(p); await p.screenshot({ path: `${out}/escape-hint-${tag}.jpg`, type: 'jpeg', quality: 85 });
  for (let i = 0; i < 60 && !(await p.evaluate(() => window.__sight.includes(true))); i++) await p.waitForTimeout(1000);
  note(`[escape] ${start}★, 'Lose the cops' hint: ${wantedHint}, spotted: ${await p.evaluate(() => window.__sight.includes(true))}`);
  let circleShot = false, dropped = false;
  for (let t = 0; t < 180 && !dropped; t++) {
    // Play it like a player: run while they can see you, then stay hidden once you've broken line of sight.
    if (await p.evaluate(() => window.__sight.at(-1) !== false)) {
      const c = await nearestCop(p);
      if (c) await face(p, c, true, Math.floor(t / 6) % 2 ? 0.9 : -0.9);
      await p.keyboard.down('ShiftLeft'); await p.keyboard.down('KeyW'); await p.waitForTimeout(900); await p.keyboard.up('KeyW'); await p.keyboard.up('ShiftLeft');
    } else await p.waitForTimeout(900);
    const sight = await p.evaluate(() => window.__sight.at(-1));
    if (sight === false && !circleShot) { circleShot = true; note(`  out of sight at ~${t}s`); await clearIntro(p); await p.waitForTimeout(300); await p.screenshot({ path: `${out}/escape-search-circle-${tag}.jpg`, type: 'jpeg', quality: 85 }); }
    if ((await stars(p)) < start) { dropped = true; note(`  stars dropped to ${await stars(p)} at ~${t}s`); await p.screenshot({ path: `${out}/escape-dropped-${tag}.jpg`, type: 'jpeg', quality: 85 }); }
  }
  results.escape = circleShot && dropped;
  await ctx.close();
}

async function copCar() {
  const { p, ctx } = await open(MARKET, 'C');
  await startCombat(p); await confess(p, 2);
  const start = await stars(p);
  let c = null;
  for (let i = 0; i < 60; i++) { c = await nearestCop(p); if (c && c.d < 15 && Math.abs(c.speed) < 30) break; await p.waitForTimeout(1000); }
  if (!c) throw new Error('no cruiser arrived');
  for (let i = 0; i < 30 && c && c.d > 3; i++) { await face(p, c); await p.keyboard.down('KeyW'); await p.waitForTimeout(Math.min(700, c.d * 150)); await p.keyboard.up('KeyW'); c = await nearestCop(p); }
  const prompt = await p.evaluate(() => /Take over and drive|Get in and drive/.test(document.body.innerText));
  await clearIntro(p); await p.screenshot({ path: `${out}/cop-car-before-${tag}.jpg`, type: 'jpeg', quality: 85 });
  if (PHONE) { const b = p.locator('button[data-action="enter-exit"]').first(); try { const box = await b.boundingBox(); if (box) await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); } catch {} }
  else await p.keyboard.press('KeyE');
  await p.waitForTimeout(2000);
  const mode = await p.evaluate(() => window.__gtasf.world.mode);
  await clearIntro(p); await p.screenshot({ path: `${out}/cop-car-driving-${tag}.jpg`, type: 'jpeg', quality: 85 });
  const now = await stars(p);
  note(`[cop-car] cruiser ${c?.d.toFixed(1)} m, prompt: ${prompt}; after E mode=${mode}, stars ${start}→${now}`);
  results['cop-car'] = mode === 'driver' && now > start;
  await ctx.close();
}

try {
  if (ONLY.includes('shoot')) await shoot().catch(e => note(`[shoot] ABORTED ${String(e.message).split('\n')[0]}`));
  if (ONLY.includes('distance')) await distance().catch(e => note(`[distance] ABORTED ${String(e.message).split('\n')[0]}`));
  if (ONLY.includes('escape')) await escape().catch(e => note(`[escape] ABORTED ${String(e.message).split('\n')[0]}`));
  if (ONLY.includes('cop-car')) await copCar().catch(e => note(`[cop-car] ABORTED ${String(e.message).split('\n')[0]}`));
} finally {
  note(`RESULT ${JSON.stringify(results)}  errors=${JSON.stringify(errors.slice(0, 6))}`);
  await writeFile(`${out}/log-${tag}.txt`, log.join('\n') + '\n');
  await browser.close();
}
