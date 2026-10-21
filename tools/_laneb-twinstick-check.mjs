// gtasf-7fwek: does the phone twin-stick render and aim? A touch-enabled phone context (isMobile + hasTouch, so
// `(pointer: coarse)` matches) on a combat-on stack: accept the 18+ gate, equip a pistol, screenshot the FIRE stick,
// then drag it with real CDP touch events and check the camera yaw turned and the label followed the thumb.
//   GTASF_URL=http://localhost:5319 tools/heavy.sh node tools/_laneb-twinstick-check.mjs
// Stack flags should match prod's aim set (COMBAT_FLAGS="combat weapons weaponPoses shootingFeel") or there is no aim camera.
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 240_000).unref();
const base = process.env.GTASF_URL ?? 'http://localhost:5319';
const out = resolve(process.env.OUT ?? 'docs/sf-data/combat/twinstick');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/?at=37.79560,-122.39370,270&preset=low&bot=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready, null, { timeout: 180_000 });
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  await page.waitForTimeout(600);
  if (await page.locator('.gt-age-gate').isVisible().catch(() => false)) { await page.locator('.gt-age-gate-enter').click(); await page.waitForTimeout(800); }
  await page.evaluate(() => { const c = window.__gtasfCombat; c?.giveWeapon?.('pistol'); c?.selectWeapon?.('pistol'); });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const b = document.querySelector('.gt-combat-fire-btn'), r = b?.getBoundingClientRect();
    return { coarse: matchMedia('(pointer: coarse)').matches, present: !!b, hidden: b?.hidden ?? null, stick: b?.classList.contains('gt-combat-fire-stick') ?? false,
      box: r ? { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width } : null, yaw: window.__gtasf?.world?.camera?.yaw ?? null };
  });
  console.log('stick', JSON.stringify(info));
  await page.screenshot({ path: resolve(out, 'phone-stick.jpg'), quality: 80 });
  if (!info.box || info.hidden) { console.log('RESULT FAIL stick not visible'); process.exitCode = 1; }
  else {
    const cdp = await context.newCDPSession(page), { x, y } = info.box, point = (px, py) => [{ x: px, y: py, id: 1, radiusX: 8, radiusY: 8, force: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(x, y) });
    for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(x - i * 4, y) }); await page.waitForTimeout(30); }
    const mid = await page.evaluate(() => ({ yaw: window.__gtasf?.world?.camera?.yaw ?? null, label: document.querySelector('.gt-combat-fire-label')?.style.transform ?? '', aiming: document.body.classList.contains('gt-aiming'), raceOpacity: (e => e ? getComputedStyle(e).opacity : null)(document.querySelector('.gt-race-host')) }));
    await page.screenshot({ path: resolve(out, 'phone-stick-drag.jpg'), quality: 80 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => document.querySelector('.gt-combat-fire-label')?.style.transform ?? '');
    const turned = info.yaw !== null && mid.yaw !== null && Math.abs(mid.yaw - info.yaw) > 0.02;
    console.log(`drag: yaw ${info.yaw} -> ${mid.yaw}; label mid '${mid.label}' after '${after}'; aiming ${mid.aiming}, race button opacity ${mid.raceOpacity}`);
    console.log(`RESULT ${turned && mid.label.includes('translate') && !after ? 'PASS stick renders, aims and recentres' : 'FAIL'}`);
  }
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser.close(); console.log(`page errors ${errors.length} ${JSON.stringify(errors.slice(0, 3))}`); }
