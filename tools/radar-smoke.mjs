import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Reuse the shared npm run dev process. No competing watcher or fake event fixture.
const base = process.env.GTASF_DEV_URL ?? 'http://127.0.0.1:5173';
const out = fileURLToPath(new URL('../artifacts/radar/', import.meta.url));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${base}/src/radar/check.html`);
  await page.waitForFunction(() => window.radarSmoke?.radar.eventCount > 100, undefined, { timeout: 20000 });
  const count = await page.evaluate(() => window.radarSmoke.radar.eventCount);
  await page.screenshot({ path: `${out}radar.png` });
  await page.getByRole('button', { name: 'Open event map', exact: true }).click();
  await page.locator('.gt-radar-list button').first().click();
  await page.getByText('approximate location', { exact: false }).waitFor();
  const title = await page.locator('.gt-radar-card h3').innerText();
  const link = await page.getByRole('link', { name: 'Event page ↗' }).getAttribute('href');
  assert(link.startsWith('https://www.tech-week.com/'));
  await page.screenshot({ path: `${out}event-map.png` });
  await page.getByRole('button', { name: 'Set destination', exact: true }).click();
  const destination = await page.evaluate(() => window.radarSmoke.selected[0]);
  assert.equal(destination.title, title); assert(Number.isFinite(destination.x) && Number.isFinite(destination.z));
  await page.getByRole('button', { name: 'Open event map', exact: true }).click();
  await page.getByRole('button', { name: 'Hail robotaxi', exact: true }).click();
  assert.equal(await page.evaluate(() => window.radarSmoke.selected.length), 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open event map', exact: true }).click();
  await page.screenshot({ path: `${out}phone-event-map.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false); assert.deepEqual(errors, []);
  const evidence = { realLocatedEvents: count, title, link, destination: { x: destination.x, z: destination.z }, errors };
  await writeFile(`${out}evidence.json`, JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2));
} finally { await browser.close(); }
