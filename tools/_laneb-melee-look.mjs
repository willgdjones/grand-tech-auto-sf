// meleeSwing look check: equip the bat, then fists; attack (F) and screenshot mid-swing from the chase camera, plus the
// local avatar's right-wrist offset when the scene is reachable from the test hook (it currently is not: prints null).
//   OUT=docs/sf-data/combat/melee-swing GTASF_URL=http://localhost:5319 tools/heavy.sh node tools/_laneb-melee-look.mjs
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 240_000).unref();
const base = process.env.GTASF_URL ?? 'http://localhost:5319';
const out = resolve(process.env.OUT ?? 'docs/sf-data/combat/melee-swing');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/?at=37.79560,-122.39370,270&preset=hd&bot=1&time=noon`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready, null, { timeout: 180_000 });
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.()); await page.waitForTimeout(600);
  if (await page.locator('.gt-age-gate').isVisible().catch(() => false)) { await page.locator('.gt-age-gate-enter').click(); await page.waitForTimeout(800); }
  // Right wrist offset from the avatar root, in metres (the avatar that carries the held-weapon probe).
  const wrist = () => page.evaluate(() => {
    let avatar = null; window.__gtasf?.world?.scene?.traverse?.(o => { if (o.userData?.heldWeapon) avatar = o; });
    const w = avatar?.getObjectByName('Wrist.R') ?? avatar?.getObjectByName('WristR'); if (!w) return null;
    const p = w.getWorldPosition(new w.position.constructor()), r = avatar.getWorldPosition(new w.position.constructor());
    return [+(p.x - r.x).toFixed(2), +(p.y - r.y).toFixed(2), +(p.z - r.z).toFixed(2)];
  });
  for (const weapon of ['bat', 'fists']) {
    await page.evaluate(w => { const c = window.__gtasfCombat; c?.giveWeapon?.(w); c?.selectWeapon?.(w); }, weapon);
    await page.waitForTimeout(1200);
    const rest = await wrist();
    // Screenshots take ~100+ ms headless, so the short fists jab is captured straight after the key press.
    await page.keyboard.down('KeyF'); await page.keyboard.up('KeyF');
    if (weapon === 'bat') await page.waitForTimeout(90);
    const a = await wrist(); await page.screenshot({ path: resolve(out, `${weapon}-early.jpg`), quality: 82 });
    if (weapon === 'bat') await page.waitForTimeout(110);
    const b = await wrist(); await page.screenshot({ path: resolve(out, `${weapon}-mid.jpg`), quality: 82 });
    await page.waitForTimeout(700); const end = await wrist();
    console.log(`${weapon}: wrist rest ${JSON.stringify(rest)} early ${JSON.stringify(a)} mid ${JSON.stringify(b)} after ${JSON.stringify(end)}`);
  }
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser.close(); console.log(`page errors ${errors.length} ${JSON.stringify(errors.slice(0, 3))}`); }
