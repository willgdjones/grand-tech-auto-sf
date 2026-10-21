// Critic N2 (fire-moment message contention) look check: get 2 stars fast on a combat stack (streetCrimeWanted on) by
// confessing two crimes on the world socket after the 18+ gate (lane E's recipe), then screenshot desktop + phone just
// after WANTED (DISPATCH up) and 6 s later (the 'Lose the cops' hint), to see what draws where.
//   GTASF_URL=http://localhost:5319 tools/heavy.sh node tools/_laneb-wanted-look.mjs
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 300_000).unref();
const base = process.env.GTASF_URL ?? 'http://localhost:5319';
const out = resolve(process.env.OUT ?? 'docs/sf-data/combat/wanted-look');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  for (const [device, opts] of [['desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }], ['phone', { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true }]]) {
    const context = await browser.newContext(opts);
    await context.addInitScript(() => { const W = window.WebSocket; window.WebSocket = class extends W { constructor(...a) { super(...a); if (/\/api\/world/.test(String(a[0]))) window.__worldSocket = this; } }; });
    const page = await context.newPage();
    await page.goto(`${base}/?at=37.78790,-122.40750,90&preset=low&bot=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 180_000 });
    for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
    await page.evaluate(() => window.__gtasfCombat?.requestCombat?.()); await page.waitForTimeout(600);
    if (await page.locator('.gt-age-gate').isVisible().catch(() => false)) { await page.locator('.gt-age-gate-enter').click(); await page.waitForTimeout(1200); }
    for (let i = 0; i < 2; i++) { await page.evaluate(() => window.__worldSocket?.send(Uint8Array.of(0x25, 0))); await page.waitForTimeout(1200); }
    await page.waitForTimeout(800);
    const state = await page.evaluate(() => ({ dispatch: !document.querySelector('.gt-dispatch')?.hidden, rect: document.querySelector('.gt-dispatch')?.getBoundingClientRect()?.toJSON() }));
    console.log(device, 'dispatch', JSON.stringify(state));
    await page.screenshot({ path: resolve(out, `${device}-dispatch.jpg`), quality: 80 });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: resolve(out, `${device}-hint.jpg`), quality: 80 });
    await context.close();
  }
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser.close(); console.log('DONE'); }
