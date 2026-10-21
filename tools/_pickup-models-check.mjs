// critic R4 (flag pickupModels): in-game look at the 3D pickup models. Spawn a few metres south of the Ferry plaza health
// pickup (beside the bat pickup) and of the Embarcadero Corner Market armour pickup, facing each pickup; opt into combat (weapon
// pickups mount with combat); screenshot desktop + phone.
//   GTASF_COMBAT_URL=http://localhost:5374 [PHONE=1] node tools/_pickup-models-check.mjs
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5374';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat';
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
// [name, pickup lat, lon]: spawn ~7 m south of it, then aim the chase camera at the pickup's projected position.
const SPOTS = [['ferry-health-bat', 37.795830, -122.394780], ['market-armour', 37.796850, -122.398300]];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
for (const [name, lat, lon] of SPOTS) {
  const at = `${(lat - 7 / 111320).toFixed(6)},${lon.toFixed(6)},0`;
  const ctx = await browser.newContext(PHONE ? { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage(); page.setDefaultTimeout(60000); page.on('pageerror', e => errors.push(e.message.slice(0, 120)));
  try {
    await page.goto(`${base}/?at=${at}&preset=low&bot=1`);
    await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90000 });
    for (let i = 0; i < 15; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(250); }
    try { const d = page.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 800 })) { await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill('pick'); await d.getByRole('button', { name: 'Save startup' }).click(); } } catch {}
    await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
    try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click({ force: true }); } catch {}
    // Forward of web/src/hud/feedback.ts unprojectLocation: lat/lon → world x/z, then look from behind the player at it.
    await page.evaluate(({ lat, lon }) => { const w = window.__gtasf.world, fr = w.map.manifest.frame, rad = Math.PI / 180, th = fr.gridRotationDeg * rad;
      const east = (lon - fr.origin.lon) * 111320 * Math.cos(fr.origin.lat * rad), north = (lat - fr.origin.lat) * 111320;
      const x = east * Math.cos(th) - north * Math.sin(th), z = -east * Math.sin(th) - north * Math.cos(th);
      const heading = Math.atan2(x - w.foot.x, z - w.foot.z); w.foot.yaw = heading; // the chase cam re-follows the player's facing
      w.camera.setOrbit(heading + Math.PI, -0.15); }, { lat, lon });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${out}/pickup-models-${name}-${tag}.jpg`, type: 'jpeg', quality: 85 });
    console.log(`[pickups] ${name}: captured`);
  } catch (e) { console.log(`[pickups] ${name}: ABORTED ${String(e.message).split('\n')[0]}`); }
  await ctx.close();
}
console.log(`RESULT: ${errors.length === 0 ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 4))}`);
await browser.close();
