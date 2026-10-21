// gtasf-facade-exposed-clearance-l6sy visual gate: A/B the old single-point wall-exposure probe vs the new
// geometric ~6 m clearance test (flag exposedByClearance) at Mission / Valencia / Haight / Castro on the dense
// 3DEP map, HD + phone. Reuses look-capture-facades-ab.mjs's proven approach (real GPU via --use-angle=metal,
// fresh page per shot, the real readiness signal, modal dismissal, a <20 KB blank guard). Points at the LOCAL
// dev server; the wrapper (run-exposed-ab.sh) flips the flag in shared/flags.ts between the two runs:
//   EXPOSED_VARIANT=before node tools/look-capture-exposed-ab.mjs   # exposedByClearance OFF (old 0.8 m probe)
//   EXPOSED_VARIANT=after  node tools/look-capture-exposed-ab.mjs   # exposedByClearance ON  (6 m clearance)
// Output: docs/sf-data/exposed-clearance/<spot>-<device>-<variant>.jpg
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';

const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const variant = process.env.EXPOSED_VARIANT ?? 'after'; // before | after
const out = 'docs/sf-data/exposed-clearance';
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
const blanks = [];

// Plaza / open-lot streets where the blank-slab bug showed (task: Mission 37.7599,-122.4190), plus a Valencia
// corridor and the Haight / Castro residential districts. heading aims the camera at the facades in question.
const SPOTS = [
  ['mission', 'at=37.7599,-122.4190,110', 6000],
  ['valencia', 'at=37.7585,-122.4216,20', 6000],
  ['haight', 'at=37.7701,-122.4469,80', 6000],
  ['castro', 'at=37.7609,-122.4350,20', 6000],
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
