// Onboarding fresh-profile smoke: with flags.onboarding ON, a brand-new profile should see the SA intro
// slides (.gt-sa-intro, "You're a founder in San Francisco.") on boot. Previews a built app (prod-like)
// against the local worker in a FRESH context (no cookie → fresh device → freshOnboarding).
// Prereq: build web with onboarding on into GTASF_FOUNDER_APP, local worker on :8787 healthy (WELCOME).
// Run: node tools/onboarding-smoke.mjs
import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const outDir = resolve(process.env.GTASF_FOUNDER_APP ?? '/tmp/claude-501/onboarding-app');
const server = await preview({
  configFile: resolve('web/vite.config.ts'), root: resolve('web'), build: { outDir },
  preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
});
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
let ok = false, detail = {};
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); // fresh context = fresh profile
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  // Boot: world connects (WELCOME). Then the fresh-profile onboarding intro slides should mount.
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', undefined, { timeout: 75_000 }); // local preview boot is slow (~45s); options is the 3rd arg (arg is 2nd) or it defaults to 30s
  await page.waitForSelector('.gt-sa-intro', { state: 'visible', timeout: 15_000 });
  const title = (await page.locator('.gt-sa-intro__title').first().innerText().catch(() => '')).trim();
  detail = { connected: true, introVisible: true, title, errors: errs.slice(0, 5) };
  assert.ok(title.length > 0, 'intro slide has a title');
  assert.deepEqual(errs, [], 'no console/page errors during onboarding boot');
  ok = true;
} catch (e) {
  detail.failure = String(e.message).split('\n')[0];
}
console.log((ok ? 'ONBOARDING_SMOKE_PASS ' : 'ONBOARDING_SMOKE_FAIL ') + JSON.stringify(detail));
await browser.close();
await new Promise(r => server.httpServer.close(r));
process.exitCode = ok ? 0 : 1;
