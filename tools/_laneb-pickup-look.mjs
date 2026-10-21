// Critic R4 look check (flag pickupModels): the Ferry plaza health pickup + bat pickup, desktop + phone, after the
// 18+ gate (pickups render for combat players). Run once per flag state into different OUT folders.
//   OUT=docs/sf-data/combat/pickups/on GTASF_URL=http://localhost:5319 tools/heavy.sh node tools/_laneb-pickup-look.mjs
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 240_000).unref();
const base = process.env.GTASF_URL ?? 'http://localhost:5319';
const at = process.env.AT ?? '37.795830,-122.394700,270'; // ~7 m east of the Ferry plaza health pickup, facing it
// The portrait phone view is narrow: it stands ~8 m south of the pickup and faces straight at it.
const phoneAt = process.env.PHONE_AT ?? '37.795760,-122.394740,336';
const out = resolve(process.env.OUT ?? 'docs/sf-data/combat/pickups');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  for (const [device, opts, preset] of [['desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, 'hd'], ['phone', { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true }, 'low']]) {
    const context = await browser.newContext(opts), page = await context.newPage();
    await page.goto(`${base}/?at=${device === 'phone' ? phoneAt : at}&preset=${preset}&bot=1&time=noon`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__gtasf?.ready, null, { timeout: 180_000 });
    for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
    await page.evaluate(() => window.__gtasfCombat?.requestCombat?.()); await page.waitForTimeout(600);
    if (await page.locator('.gt-age-gate').isVisible().catch(() => false)) { await page.locator('.gt-age-gate-enter').click(); await page.waitForTimeout(800); }
    await page.waitForTimeout(4000); // pickup meshes + spin
    // The model spins (~5.6 s a turn): a burst of four frames so at least one shows a face, not an edge.
    for (let i = 0; i < 4; i++) { await page.screenshot({ path: resolve(out, i ? `${device}-${i}.jpg` : `${device}.jpg`), quality: 82 }); await page.waitForTimeout(700); }
    console.log(`OK ${device}`);
    await context.close();
  }
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser.close(); console.log('DONE'); }
