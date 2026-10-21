// Capture the EXPANDED SA pause-map (M) on the LIVE build to verify decision 7/8 (36-district
// de-overlap + venue layout) on the real citywide roadgraph, not fixtures. SA-map lane (gtasf-v2-sa-map-ah1l).
// Run from repo root with GPU: node tools/sa-expanded-map-capture.mjs   (GTASF_SMOKE_URL overrides prod)
import { chromium } from '@playwright/test';
import { readFile, mkdir, stat } from 'node:fs/promises';

const base = process.env.GTASF_SMOKE_URL ?? 'https://gtasf.com';
const code = (await readFile('worker/.wrangler/production/invite-code.txt', 'utf8')).trim();
const out = process.env.OUT ?? 'artifacts/look';
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });

async function dismissOnboarding(page) {
  // Same 3 overlays as tools/look-capture.mjs (gtasf-9xxk): intro Skip, Founder-ID "Looks good", recovery Close.
  try { const s = page.locator('.gt-sa-intro__skip'); if (await s.isVisible({ timeout: 1000 })) { await s.click(); await page.locator('.gt-sa-intro').waitFor({ state: 'hidden', timeout: 3000 }); } } catch {}
  try { const g = page.locator('.gt-identity-go'); await g.waitFor({ state: 'visible', timeout: 1500 }); await g.click({ timeout: 8000 }); await page.locator('dialog.gt-identity').waitFor({ state: 'hidden', timeout: 4000 }); } catch {}
  try { const c = page.locator('.gt-recovery-close'); if (await c.isVisible({ timeout: 800 })) { await c.click(); await page.locator('dialog.gt-recovery').waitFor({ state: 'hidden', timeout: 3000 }); } } catch {}
}

const page = await ctx.newPage();
page.setDefaultTimeout(40_000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message).replaceAll(code, '[INVITE]')));
await page.goto(`${base}/?invite=${code}&at=37.7955,-122.3937,270`);
await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true');
await dismissOnboarding(page);
await page.waitForTimeout(5000);
await dismissOnboarding(page);

// Open the expanded map with M and let it draw the whole-city fit.
await page.keyboard.press('KeyM');
await page.waitForTimeout(2500);
const path = `${out}/latest-expanded-map.png`;
await page.screenshot({ path });
const bytes = (await stat(path)).size;
console.log(`expanded-map: ${bytes}B  errors=${JSON.stringify(errors.slice(0, 4))}`);
await browser.close();
process.exitCode = bytes < 50_000 ? 1 : 0;
