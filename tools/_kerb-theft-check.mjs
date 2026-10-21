// gtasf-0lnjq: in-game check that a kerb-parked car can be stolen (flag kerbCarTheft) on a stack with the live combat
// flags + kerbCarTheft. At Union Square/Powell (the founder's spot): walk up to the nearest kerb-parked car, expect the
// 'Steal this car' prompt, press E (phone: the Enter/exit button) and end up DRIVING a real fleet car at that spot,
// with car-theft wanted (combat on). Screenshots before/after.
//   GTASF_COMBAT_URL=http://localhost:5374 [PHONE=1] node tools/_kerb-theft-check.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5374';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat/founder-feedback';
const SPAWN = process.env.GTASF_KERB_AT ?? '37.7891,-122.4096,0';
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
const log = []; const note = s => { log.push(s); console.log(s); };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext(PHONE ? { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
const clearIntro = async () => { for (let i = 0; i < 6; i++) { const on = await page.evaluate(() => { const b = document.querySelector('.gt-sa-intro__skip'); if (b && b.checkVisibility()) { b.click(); return true; } return false; }); if (!on) break; await page.waitForTimeout(300); } };
async function clearOnboarding() {
  for (let i = 0; i < 20; i++) {
    const b = await page.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); };
      return { intro: v('.gt-sa-intro') || v('.gt-sa-intro__skip'), id: v('.gt-identity-go'), fund: !!document.querySelector('.gt-funding-onboarding[open]') }; });
    if (!b.intro && !b.id && !b.fund) break;
    if (b.fund) { try { const d = page.locator('.gt-funding-onboarding[open]'); await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill('k'); await d.getByRole('button', { name: 'Save startup' }).click({ timeout: 3000 }); } catch {} }
    else if (b.id) { try { await page.locator('.gt-identity-go').click({ timeout: 3000 }); } catch {} }
    else await page.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click());
    await page.waitForTimeout(500);
  }
}
const nearestKerb = () => page.evaluate(() => { const w = window.__gtasf.world, f = w.foot;
  return [...w.kerbCarBodies()].map(k => ({ x: k.x, z: k.z, yaw: k.yaw, d: Math.hypot(k.x - f.x, k.z - f.z) })).sort((a, b) => a.d - b.d)[0] ?? null; });
const face = t => page.evaluate(async t => { const w = window.__gtasf.world, f = w.foot, cam = w.camera, dx = t.x - f.x, dz = t.z - f.z, a = Math.atan2(dx, dz);
  let top = { s: -2, y: 0 }; for (const y of [a, a + Math.PI, -a, Math.PI - a]) { cam.setOrbit(y, cam.pitch); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const v = cam.camera.getWorldDirection(new cam.camera.position.constructor()); const s = (v.x * dx + v.z * dz) / (Math.hypot(v.x, v.z) * Math.hypot(dx, dz) || 1); if (s > top.s) top = { s, y }; }
  cam.setOrbit(top.y, cam.pitch); }, t);
let pass = false;
try {
  await page.goto(`${base}/?at=${SPAWN}&preset=low&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90_000 });
  await clearOnboarding();
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await page.waitForTimeout(2500);
  let k = await nearestKerb();
  for (let i = 0; i < 60 && !k; i++) { await page.waitForTimeout(1000); k = await nearestKerb(); } // street props mount well after READY
  if (!k) throw new Error('no kerb-parked car shown near the spawn');
  note(`[kerb-theft] nearest kerb car ${k.d.toFixed(1)} m`);
  // Walk up beside it (its collision stops us ~1 m off the body).
  for (let i = 0; i < 40 && k && k.d > 2.6; i++) { await face(k); await page.keyboard.down('KeyW'); await page.waitForTimeout(Math.min(500, k.d * 90)); await page.keyboard.up('KeyW'); k = await nearestKerb(); }
  await clearIntro();
  const prompt = await page.evaluate(() => /Steal this car/.test(document.body.textContent ?? ''));
  const fleetBefore = await page.evaluate(() => window.__gtasf.world.fleet.cars.size);
  note(`  beside it at ${k?.d.toFixed(1)} m; prompt 'Steal this car': ${prompt}`);
  await page.screenshot({ path: `${out}/kerb-theft-before-${tag}.jpg`, type: 'jpeg', quality: 85 });
  if (PHONE) { const b = page.locator('button[data-action="enter-exit"]').first(); try { const box = await b.boundingBox(); if (box) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); } catch {} }
  else await page.keyboard.press('KeyE');
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => { const w = window.__gtasf.world, car = w.vehicleId ? w.fleet.cars.get(w.vehicleId) : null; const f = w.foot;
    return { mode: w.mode, kind: car?.data.kind ?? null, stars: document.querySelectorAll('.gt-combat-wanted-star.lit').length, kerbLeftAtSpot: [...w.kerbCarBodies()].some(b => Math.hypot(b.x - f.x, b.z - f.z) < 1.5) }; });
  // Drive off a little so the frame shows the stolen car moving away from the kerb.
  if (after.mode === 'driver' && !PHONE) { await page.keyboard.down('KeyW'); await page.waitForTimeout(1200); await page.keyboard.up('KeyW'); }
  await clearIntro();
  await page.screenshot({ path: `${out}/kerb-theft-driving-${tag}.jpg`, type: 'jpeg', quality: 85 });
  note(`  after E: ${JSON.stringify(after)} (fleet cars before ${fleetBefore})`);
  pass = prompt && after.mode === 'driver' && !!after.kind && after.stars > 0 && errors.length === 0;
} catch (e) { note(`ABORTED: ${String(e.message).split('\n')[0]}`); }
finally {
  note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 6))}`);
  await writeFile(`${out}/kerb-theft-log-${tag}.txt`, log.join('\n') + '\n');
  await browser.close();
}
