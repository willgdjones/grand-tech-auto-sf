// gtasf-ieoj: in-GAME look check for traffic drivers behind translucent car glass (the showroom passed before, but the
// driver read as invisible in-game). Point at a stack with trafficDrivers on (tools/combat-stack.sh with
// COMBAT_FLAGS="trafficDrivers"), stand on the Embarcadero by the Ferry Building and take a few frames as traffic
// passes. Headless only.   GTASF_URL=http://localhost:5319 tools/heavy.sh node tools/_laneb-drivers-ingame.mjs
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 420_000).unref();
const base = process.env.GTASF_URL ?? 'http://localhost:5319';
const at = process.env.AT ?? '37.79560,-122.39430,0';
const out = resolve(process.env.OUT ?? 'docs/sf-data/traffic-drivers/ingame');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
try {
  for (const [device, viewport, dsf, preset] of [['desktop', { width: 1600, height: 900 }, 1.5, 'hd'], ['phone', { width: 412, height: 915 }, 2.625, 'low']]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: dsf, isMobile: device === 'phone', hasTouch: device === 'phone' });
    page.on('pageerror', e => errors.push(`${device}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${device}: ${m.text()}`); });
    await page.goto(`${base}/?at=${at}&preset=${preset}&bot=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__gtasf?.ready, null, { timeout: 180_000 });
    for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
    await page.waitForTimeout(20_000); // traffic fills in around the player
    for (let shot = 1; shot <= Number(process.env.SHOTS ?? 4); shot++) {
      await page.screenshot({ path: resolve(out, `${device}-${shot}.jpg`), quality: 80 });
      await page.waitForTimeout(2500);
    }
    console.log(`OK ${device}`);
    await page.close();
  }
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser.close(); console.log(`DONE errors=${errors.length} ${JSON.stringify(errors.slice(0, 4))}`); }
