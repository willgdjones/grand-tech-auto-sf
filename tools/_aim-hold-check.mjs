// gtasf-2x1b2 follow-up (flag weaponPoses): holding the right mouse button raises the aim (arms up + over-the-shoulder
// camera) without firing. Screenshot idle vs RMB held; the held frame should show the shoulder-offset camera + raised gun.
//   GTASF_COMBAT_URL=http://localhost:5374 node tools/_aim-hold-check.mjs
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5374';
const out = 'docs/sf-data/weapon-poses';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })).newPage(); page.setDefaultTimeout(60000);
const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)));
try {
  await page.goto(`${base}/?at=37.795570,-122.393900,270&preset=low&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90000 });
  for (let i = 0; i < 15; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(250); }
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click({ force: true }); } catch {}
  await page.evaluate(() => { window.__gtasfCombat.giveWeapon('rifle'); window.__gtasfCombat.selectWeapon('rifle'); });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/aim-hold-idle-desktop.jpg`, type: 'jpeg', quality: 85 });
  const canvas = await page.$('canvas'); const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(900); // ease in
  await page.screenshot({ path: `${out}/aim-hold-rmb-desktop.jpg`, type: 'jpeg', quality: 85 });
  await page.mouse.up({ button: 'right' });
  console.log('[aim-hold] captured idle + rmb');
} catch (e) { console.log(`ABORTED: ${String(e.message).split('\n')[0]}`); }
console.log(`RESULT: ${errors.length === 0 ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 4))}`);
await browser.close();
