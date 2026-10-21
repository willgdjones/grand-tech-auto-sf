import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.GTASF_DEV_URL ?? 'http://127.0.0.1:5173';
const out = 'artifacts/loading-art'; await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [], evidence = [];
try {
  for (const [path, name] of [['/', 'ferry-title'], ['/go/lombard', 'lombard-title']]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    // Hold the real map response to inspect the real visible loading state, without changing app state.
    await page.route('**/map/lombard/manifest.json', async route => { await held; if (!page.isClosed()) await route.continue(); });
    await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('gt-loading-art-ready'), undefined, { timeout: 30000 });
    assert.equal(await page.locator('#loading').getAttribute('data-art'), name);
    const image = await page.locator('.gt-loading-image').evaluate(el => ({ src: el.getAttribute('src'), width: el.naturalWidth, height: el.naturalHeight }));
    assert.equal(image.width, 1024); assert.equal(image.height, 576);
    await page.screenshot({ path: `${out}/${name}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const card = await page.locator('.loading-card').boundingBox();
    assert(card && card.x >= 0 && card.y >= 0 && card.x + card.width <= 390 && card.y + card.height <= 844);
    await page.screenshot({ path: `${out}/${name}-phone.png` });
    evidence.push({ path, name, image, phoneCard: card });
    // DOM-only scope: do not start world rendering while the deploy owner uses the GPU slot.
    await page.close(); release();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${out}/evidence.json`, JSON.stringify({ scope: 'real loading DOM and images; map request held, no game rendering', evidence, errors }, null, 2));
  console.log(JSON.stringify({ evidence, errors }, null, 2));
} finally { await browser.close(); }
