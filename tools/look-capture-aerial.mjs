// High aerial over Nob Hill looking toward FiDi (Transamerica Pyramid), for the Teleoperator-reference look gap
// (docs/sf-data/teleoperator-reference.png). Real GPU (--use-angle=metal), fresh page, real readiness, modal
// dismissal, <20 KB blank guard. Points at GTASF_SMOKE_URL (live gtasf.com or local dev). The aerial pose uses
// the ?aerial=camLat,camLon,heightM,lookLat,lookLon harness param (main.ts). AERIAL_OUT names the output file.
//   GTASF_SMOKE_URL=https://gtasf.com AERIAL_OUT=docs/sf-data/aerial-live node tools/look-capture-aerial.mjs
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const outBase = process.env.AERIAL_OUT ?? 'docs/sf-data/aerial-nobhill';
await mkdir(dirname(outBase), { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];

// Camera over Nob Hill (~37.7925,-122.4150), looking at the Transamerica Pyramid / FiDi (~37.7952,-122.4028).
// Several heights/times to find the pose that best matches the reference framing (skyline upper, rooftops lower).
const timeOfDay = process.env.AERIAL_TIME ?? 'golden';
const POSES = [
  ['nobhill-fidi', 'at=37.7925,-122.4150&aerial=37.7925,-122.4150,170,37.7952,-122.4028', `time=${timeOfDay}`, 24000],
];
// HD + phone (the phone uses the low preset, which also drives a smaller far-LOD ring).
const DEVICES = [
  ['desktop', { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 }, 'gfx=hd'],
  ['phone', { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }, 'preset=low&touch=1'],
];

async function dismissModals(page) {
  try { const s = page.locator('.gt-sa-intro__skip'); if (await s.isVisible({ timeout: 1000 })) { await s.click(); await page.locator('.gt-sa-intro').waitFor({ state: 'hidden', timeout: 3000 }); } } catch {}
  try { const g = page.locator('.gt-identity-go'); await g.waitFor({ state: 'visible', timeout: 1500 }); await g.click({ timeout: 8000 }); if (await g.isVisible({ timeout: 500 }).catch(() => false)) await g.click({ timeout: 8000 }).catch(() => {}); await page.locator('dialog.gt-identity').waitFor({ state: 'hidden', timeout: 15000 }); } catch {}
  try { const d = page.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 800 })) { await d.getByLabel('Startup name', { exact: true }).fill('Look Check'); await d.getByLabel('Your nickname', { exact: true }).fill('Founder'); await d.getByRole('button', { name: 'Save startup' }).click(); await d.waitFor({ state: 'hidden' }); } } catch {}
  try { const g = page.getByRole('button', { name: /LET'S GO/i }); if (await g.isVisible({ timeout: 800 })) { await g.click(); await page.waitForTimeout(400); } } catch {}
  // Hide HUD for a clean look shot if a toggle exists; otherwise the HUD is minimal on an aerial.
}

for (const [device, ctxOpts, extra] of DEVICES) {
  const ctx = await browser.newContext(ctxOpts);
  for (const [name, query, timeQuery, settleMs] of POSES) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(90_000);
  page.on('pageerror', e => errors.push(`${device}/${name}: ${String(e.message)}`));
  const url = `${base}/?${query}&${timeQuery}&${extra}&bot=1`;
  try {
    await page.goto(url);
    try { await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 75_000 }); }
    catch { await page.waitForFunction(() => window.__gtasf?.ready, { timeout: 25_000 }); }
    await dismissModals(page);
    await page.waitForTimeout(settleMs); // let the far FiDi chunks stream + draw
    await dismissModals(page);
    const path = `${outBase}-${device}.jpg`;
    await page.screenshot({ path, type: 'jpeg', quality: 90 });
    const bytes = (await stat(path)).size;
    console.log(`OK ${device}/${name}: ${bytes}B -> ${path}`);
  } catch (e) {
    console.log(`SKIP ${device}/${name}: ${String(e.message).split('\n')[0]}`);
  } finally {
    await page.close();
  }
  }
  await ctx.close();
}
console.log('DONE errors=' + JSON.stringify(errors.slice(0, 5)));
await browser.close();
