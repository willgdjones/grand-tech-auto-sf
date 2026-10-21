/**
 * Founder-ladder look evidence (gtasf-founder-ladder-p1-ilnl). Screenshots the REAL founder-ladder DOM
 * overlays (found-your-startup card, the one quest card, the valuation pill) at desktop + phone sizes,
 * via a short-lived vite dev preview of web/founder-preview.html — no production build and no worker,
 * since these are pure DOM overlays. Fails on any console/page error.
 *
 * Phone frame follows the repo convention (tools/phone-perf.mjs): 1080x2400 viewport at DPR 2.75. A
 * narrow 393x852 frame is also captured so the real-phone layout (the @media max-width rules) is proven.
 *
 * Run: node tools/founder-ladder-capture.mjs   (outputs to docs/sf-data/founder-ladder/)
 */
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const outDir = resolve('docs/sf-data/founder-ladder');
await mkdir(outDir, { recursive: true });

const server = await createServer({
  configFile: resolve('web/vite.config.ts'), root: resolve('web'),
  server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
});
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');

const devices = [
  { id: 'desktop', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  { id: 'phone', viewport: { width: 1080, height: 2400 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true },
  { id: 'phone-narrow', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
];
// state -> the selector that proves it mounted.
const states = [
  { state: 'found', selector: '.gt-founder-found[open]' },
  { state: 'quest', selector: '.gt-founder-quest' },
  { state: 'billboard', selector: '.gt-founder-quest-cta' },
  { state: 'valuation', selector: '.gt-founder-valuation:not([hidden])' },
  { state: 'share', selector: '.gt-founder-share[open]' },
];

const browser = await chromium.launch({ headless: true });
const results = [];
const errors = [];
try {
  for (const device of devices) {
    for (const { state, selector } of states) {
      const context = await browser.newContext({
        viewport: device.viewport, deviceScaleFactor: device.deviceScaleFactor,
        isMobile: device.isMobile ?? false, hasTouch: device.hasTouch ?? false,
      });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(`${device.id}/${state}: ${String(e.message).slice(0, 160)}`));
      page.on('console', m => { if (m.type() === 'error') errors.push(`${device.id}/${state}: ${m.text().slice(0, 160)}`); });
      await page.goto(`${base}/founder-preview.html?state=${state}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector(selector, { state: 'visible', timeout: 10_000 });
      await page.waitForTimeout(150); // let fonts/layout settle
      const file = resolve(outDir, `${state}-${device.id}.png`);
      await page.screenshot({ path: file, animations: 'disabled' });
      results.push(`${state}-${device.id}.png`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

const ok = errors.length === 0;
console.log((ok ? 'FOUNDER_LADDER_CAPTURE_PASS ' : 'FOUNDER_LADDER_CAPTURE_FAIL ') +
  JSON.stringify({ frames: results.length, files: results, errors: errors.slice(0, 8) }));
process.exitCode = ok ? 0 : 1;
