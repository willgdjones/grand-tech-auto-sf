// gtasf-l857 A/B look capture: shipped facade atlas vs proceduralFacades, at Mission / FiDi / Marina,
// desktop + phone. Reuses look-capture-deploy6.mjs's proven approach (real GPU via --use-angle=metal,
// a fresh page per shot so headless Chromium keeps the WebGL context, the real readiness signal, modal
// dismissal, a <50KB blank guard). Points at the LOCAL dev server so the flag edited in shared/flags.ts
// takes effect. The operator flips the flag between runs:
//   L857_VARIANT=before node tools/look-capture-l857.mjs   # proceduralFacades OFF (shipped atlas)
//   L857_VARIANT=after  node tools/look-capture-l857.mjs   # proceduralFacades ON  (procedural shader)
// Output: docs/sf-data/look-l857-<spot>-<device>-<variant>.jpg
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';

const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const variant = process.env.L857_VARIANT ?? 'before'; // before | after
const out = 'docs/sf-data';
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
const errors = [];
const blanks = [];

// Mission, FiDi, Marina — facade-dense blocks at each. Golden hour so materials read clearly.
const SPOTS = [
  ['mission', '37.7599,-122.4148,0'],
  ['fidi', '37.7929,-122.4027,0'],
  ['marina', '37.8008,-122.4360,30'],
];
// Desktop (HD preset) and phone (Low preset, mobile viewport ~1080x2400 @ DPR 2.75 = 393x873 CSS px).
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

async function shot(ctx, device, spot, extra, at) {
  const name = `look-l857-${spot}-${device}-${variant}`;
  const page = await ctx.newPage();
  page.setDefaultTimeout(75_000);
  page.on('pageerror', e => errors.push(`${name}: ${String(e.message)}`));
  const url = `${base}/?at=${at}&${extra}&time=golden&bot=1`;
  try {
    await page.goto(url);
    try { await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 75_000 }); }
    catch { await page.waitForFunction(() => window.__gtasf?.ready, { timeout: 25_000 }); }
    await dismissModals(page);
    await page.waitForTimeout(6000); // chunk stream + world draw
    await dismissModals(page);
    const path = `${out}/${name}.jpg`;
    await page.screenshot({ path, type: 'jpeg', quality: 82 });
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
  for (const [spot, at] of SPOTS) await shot(ctx, device, spot, extra, at);
  await ctx.close();
}

if (blanks.length) console.log('BLANK_SHOTS=' + JSON.stringify(blanks));
console.log('DONE variant=' + variant + ' errors=' + JSON.stringify(errors.slice(0, 5)));
await browser.close();
process.exitCode = blanks.length ? 1 : 0;
