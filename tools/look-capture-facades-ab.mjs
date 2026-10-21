// gtasf-l857 visual gate: A/B shipped facade atlas vs proceduralFacades at Haight / Mission / SoMa /
// FiDi (street) + a Nob Hill -> FiDi aerial, HD + phone. Reuses look-capture-l857.mjs's proven approach
// (real GPU via --use-angle=metal, fresh page per shot, the real readiness signal, modal dismissal,
// a <20KB blank guard). Points at the LOCAL dev server; the operator flips proceduralFacades in
// shared/flags.ts between runs:
//   L857_VARIANT=before node tools/look-capture-facades-ab.mjs   # proceduralFacades OFF (shipped atlas)
//   L857_VARIANT=after  node tools/look-capture-facades-ab.mjs   # proceduralFacades ON  (procedural shader)
// Output: docs/sf-data/procedural-facades/<spot>-<device>-<variant>.jpg
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';

const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const variant = process.env.L857_VARIANT ?? 'before'; // before | after
const out = 'docs/sf-data/procedural-facades';
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
const blanks = [];

// Facade-dense streets covering the shader's material range: Victorian rowhouses, mixed Mission,
// SoMa brick/industrial + towers, FiDi glass/stone. Plus one aerial (Nob Hill camera toward FiDi).
// query is the full URL query after `?`; settleMs lets a far aerial stream more chunks.
const SPOTS = [
  ['haight', 'at=37.7701,-122.4469,80', 6000],
  ['mission', 'at=37.7599,-122.4148,0', 6000],
  ['soma', 'at=37.7785,-122.4010,0', 6000],
  ['fidi', 'at=37.7929,-122.4027,0', 6000],
  ['aerial-nobhill', 'at=37.7925,-122.4150&aerial=37.7925,-122.4150,160,37.7946,-122.4005', 11000],
];
const DEVICES = [
  ['desktop', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }, 'gfx=hd'],
  ['phone', { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }, 'preset=low&touch=1'],
];

async function dismissModals(page) {
  try { const s = page.locator('.gt-sa-intro__skip'); if (await s.isVisible({ timeout: 1000 })) { await s.click(); await page.locator('.gt-sa-intro').waitFor({ state: 'hidden', timeout: 3000 }); } } catch {}
  try { const g = page.locator('.gt-identity-go'); await g.waitFor({ state: 'visible', timeout: 1500 }); await g.click({ timeout: 8000 }); if (await g.isVisible({ timeout: 500 }).catch(() => false)) await g.click({ timeout: 8000 }).catch(() => {}); await page.locator('dialog.gt-identity').waitFor({ state: 'hidden', timeout: 15000 }); } catch {}
  try { const d = page.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 800 })) { await d.getByLabel('Startup name', { exact: true }).fill('Look Check'); await d.getByLabel('Your nickname', { exact: true }).fill('Founder'); await d.getByRole('button', { name: 'Save startup' }).click(); await d.waitFor({ state: 'hidden' }); } } catch {}
  try { const g = page.getByRole('button', { name: /LET'S GO/i }); if (await g.isVisible({ timeout: 800 })) { await g.click(); await page.waitForTimeout(400); } } catch {}
}

async function shot(ctx, device, spot, extra, query, settleMs) {
  const name = `${spot}-${device}-${variant}`;
  const page = await ctx.newPage();
  page.setDefaultTimeout(90_000);
  page.on('pageerror', e => errors.push(`${name}: ${String(e.message)}`));
  const url = `${base}/?${query}&${extra}&time=golden&bot=1`;
  try {
    await page.goto(url);
    try { await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 75_000 }); }
    catch { await page.waitForFunction(() => window.__gtasf?.ready, { timeout: 25_000 }); }
    await dismissModals(page);
    await page.waitForTimeout(settleMs); // chunk stream + world draw
    await dismissModals(page);
    const path = `${out}/${name}.jpg`;
    await page.screenshot({ path, type: 'jpeg', quality: 86 });
    const bytes = (await stat(path)).size;
    if (bytes < 20_000) blanks.push(`${name} (${bytes}B)`);
    console.log(`OK ${name}: ${bytes}B`);
  } catch (e) {
    console.log(`SKIP ${name}: ${String(e.message).split('\n')[0]}`);
  } finally {
    await page.close();
  }
}

for (const [device, ctxOpts, extra] of DEVICES) {
  const ctx = await browser.newContext(ctxOpts);
  for (const [spot, query, settleMs] of SPOTS) await shot(ctx, device, spot, extra, query, settleMs);
  await ctx.close();
}

if (blanks.length) console.log('BLANK_SHOTS=' + JSON.stringify(blanks));
console.log('DONE variant=' + variant + ' errors=' + JSON.stringify(errors.slice(0, 5)));
await browser.close();
process.exitCode = blanks.length ? 1 : 0;
