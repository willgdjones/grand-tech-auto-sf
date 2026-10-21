// Lane B: in-game check for melee takedowns + peds that fight back (flag pedMelee) on a flags-ON stack
// (COMBAT_FLAGS="... streetCrimeWanted vitalsPickups pedMelee"). The player walks (W) up to the nearest pedestrian and
// punches it: the ped must be knocked down and confessed as COMBAT_CRIME kind 3 (an assault, not a kill). Knockouts
// repeat until a bystander fights back: its landed swing must send C2S PED_PUNCH and the server must take health.
//   GTASF_COMBAT_URL=http://localhost:5374 [PHONE=1] node tools/_ped-melee-check.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5374';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat';
const SPAWN = process.env.GTASF_PED_AT ?? '37.795799,-122.394805,0';
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
const log = []; const note = s => { log.push(s); console.log(s); };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext(PHONE ? { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  window.__knockouts = 0; window.__punches = 0;
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : null;
      if (b && b[0] === 0x25 && b[1] === 3) window.__knockouts++; if (b && b[0] === 0x27) window.__punches++; if (b && b[0] === 2) window.__worldSocket = this; } catch {}
    return send.call(this, d);
  };
});
const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
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
// Turn the camera (and so the walk direction + swing) toward the nearest standing walker; returns its distance.
const faceNearest = () => page.evaluate(async () => {
  const w = window.__gtasf.world, f = w.foot, cam = w.camera;
  const peds = w.streetWalkers?.positions?.() ?? [];
  let best; for (const p of peds) { const d = Math.hypot(p.x - f.x, p.z - f.z); if (d < 40 && (!best || d < best.d)) best = { ...p, d }; }
  if (!best) return null;
  const dx = best.x - f.x, dz = best.z - f.z, want = Math.atan2(dx, dz);
  let top = { score: -2, yaw: want };
  for (const yaw of [want, want + Math.PI, -want, Math.PI - want]) {
    cam.setOrbit(yaw, cam.pitch);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const v = cam.camera.getWorldDirection(new cam.camera.position.constructor());
    const score = (v.x * dx + v.z * dz) / (Math.hypot(v.x, v.z) * best.d || 1);
    if (score > top.score) top = { score, yaw };
  }
  cam.setOrbit(top.yaw, cam.pitch);
  return best.d;
});
const hp = () => page.evaluate(() => window.__gtasfCombat.state().health);
let pass = false;
try {
  await page.goto(`${base}/?at=${SPAWN}&preset=low&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90_000 });
  await clearOnboarding();
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await page.waitForTimeout(800);
  await clearOnboarding();
  await page.evaluate(() => window.__gtasfCombat.selectWeapon('fists'));
  await page.waitForTimeout(4000); // walkers populate
  let koShot = false, fightShot = false;
  const start = Date.now();
  while (Date.now() - start < 150_000 && !(fightShot && (await page.evaluate(() => window.__punches)) > 0 && (await hp()) < 100)) {
    const d = await faceNearest();
    if (d === null) { await page.waitForTimeout(500); continue; }
    if (d > 1.9) { await page.keyboard.down('KeyW'); await page.waitForTimeout(Math.min(600, d * 120)); await page.keyboard.up('KeyW'); continue; }
    const before = await page.evaluate(() => window.__knockouts);
    await page.evaluate(() => { window.__gtasfCombat.fire(); window.__gtasfCombat.fireStop(); });
    await page.waitForTimeout(500);
    const ko = (await page.evaluate(() => window.__knockouts)) > before;
    if (ko) note(`  KO #${await page.evaluate(() => window.__knockouts)}: walkers ${JSON.stringify(await page.evaluate(() => { const s = window.__gtasf.world.streetWalkers?.stats; return s && { fighters: s.fighters, swings: s.swings, visible: s.visible }; }))}`);
    if (ko && !koShot) { koShot = true; note(`  knockout #1 at ${d.toFixed(1)} m (COMBAT_CRIME kind 3 sent)`); await page.screenshot({ path: `${out}/ped-melee-knockout-${tag}.jpg`, type: 'jpeg', quality: 85 }); }
    // A fighter is on the way: stand and take it (it comes to us), then screenshot the swing.
    for (let i = 0; i < 16 && ko; i++) {
      await page.waitForTimeout(500);
      if (i === 6) note(`    +3s: ${JSON.stringify(await page.evaluate(() => { const s = window.__gtasf.world.streetWalkers?.stats; return s && { fighters: s.fighters, swings: s.swings }; }))}`);
      if ((await page.evaluate(() => window.__punches)) > 0) {
        await faceNearest();
        if (!fightShot) { fightShot = true; await page.waitForTimeout(200); await page.screenshot({ path: `${out}/ped-melee-fightback-${tag}.jpg`, type: 'jpeg', quality: 85 }); }
        await page.waitForTimeout(1500);
        break;
      }
    }
  }
  const state = await page.evaluate(() => ({ knockouts: window.__knockouts, punches: window.__punches, health: window.__gtasfCombat.state().health, stars: document.querySelectorAll('.gt-combat-wanted-star.lit').length }));
  note(`  ${JSON.stringify(state)}`);
  pass = state.knockouts > 0 && state.punches > 0 && state.health < 100 && errors.length === 0;
} catch (e) { note(`ABORTED: ${String(e.message).split('\n')[0]}`); }
finally {
  note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 6))}`);
  await writeFile(`${out}/ped-melee-log-${tag}.txt`, log.join('\n') + '\n');
  await browser.close();
}
