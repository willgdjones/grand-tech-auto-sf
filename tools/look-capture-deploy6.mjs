// Deploy #6 before/after look preview. Reuses look-capture.mjs's proven approach: Playwright +
// --use-angle=metal --enable-gpu (real GPU, so the realisticRender PBR path actually renders where
// software-GL headless blanks), a FRESH PAGE per shot (headless Chromium drops the WebGL context on
// page reuse — gtasf-9xxk), the real readiness signal (window.__gtasf.ready + #world connected), full
// modal dismissal, and a <50KB blank guard. Points at LOCAL dev at HEAD so the realisticRender flags
// (edited in shared/flags.ts) take effect; prod doesn't have them.
//
//   V6_VARIANT=before node tools/look-capture-deploy6.mjs   # flags off (current production look)
//   V6_VARIANT=after  node tools/look-capture-deploy6.mjs   # flags on  (realisticRender etc.)
import { chromium } from '@playwright/test';
import { readFile, mkdir, stat } from 'node:fs/promises';

const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const variant = process.env.V6_VARIANT ?? 'before'; // before | after
let code = '';
try { code = (await readFile('worker/.wrangler/production/invite-code.txt', 'utf8')).trim(); } catch {}
const out = 'artifacts/look/deploy6-preview';
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const errors = [];
const blanks = [];

async function dismissModals(page) {
  try { const s = page.locator('.gt-sa-intro__skip'); if (await s.isVisible({ timeout: 1000 })) { await s.click(); await page.locator('.gt-sa-intro').waitFor({ state: 'hidden', timeout: 3000 }); } } catch {}
  try { const g = page.locator('.gt-identity-go'); await g.waitFor({ state: 'visible', timeout: 1500 }); await g.click({ timeout: 8000 }); if (await g.isVisible({ timeout: 500 }).catch(() => false)) await g.click({ timeout: 8000 }).catch(() => {}); await page.locator('dialog.gt-identity').waitFor({ state: 'hidden', timeout: 15000 }); } catch {}
  try { const d = page.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 800 })) { await d.getByLabel('Startup name', { exact: true }).fill('Look Check'); await d.getByLabel('Your nickname', { exact: true }).fill('Founder'); await d.getByRole('button', { name: 'Save startup' }).click(); await d.waitFor({ state: 'hidden' }); } } catch {}
  try { const g = page.getByRole('button', { name: /LET'S GO/i }); if (await g.isVisible({ timeout: 800 })) { await g.click(); await page.waitForTimeout(400); } } catch {}
}

async function shot(spot, time, at) {
  const name = `${spot}-${variant}-${time}`;
  const page = await ctx.newPage();
  page.setDefaultTimeout(75_000);
  page.on('pageerror', e => errors.push(String(e.message).replaceAll(code || '\0', '[INVITE]')));
  const url = `${base}/?at=${at}&gfx=hd&time=${time}${code ? `&invite=${code}` : ''}`;
  try {
    // ?bot=1: automated visit, excluded from analytics and player counts (web/src/analytics/bot.ts).
    await page.goto(`${url}${String(url).includes('?') ? '&' : '?'}bot=1`);
    try {
      await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 75_000 });
    } catch {
      // Fallback: geometry/render ready even if the multiplayer WS is still reconnecting. A look
      // preview only needs the scene drawn, so don't let a slow WS connect abort the shot.
      await page.waitForFunction(() => window.__gtasf?.ready, { timeout: 25_000 });
    }
    await dismissModals(page);
    await page.waitForTimeout(6000); // chunk stream + world draw (the grey-void fix)
    await dismissModals(page);
    const path = `${out}/${name}.png`;
    await page.screenshot({ path });
    const bytes = (await stat(path)).size;
    if (bytes < 50_000) blanks.push(`${name} (${bytes}B)`);
    console.log(`OK ${name}: ${bytes}B`);
  } catch (e) {
    console.log(`SKIP ${name}: ${String(e.message).split('\n')[0]}`);
  } finally {
    await page.close();
  }
}

// Ferry Building default spawn, Mission, Lombard switchbacks, a FiDi street. Golden for all + one dusk.
// SPOTS env (comma-separated "<spot>-<time>") re-runs only those shots; default runs all.
const SPOTS = (process.env.V6_SPOTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const ALL = [
  ['ferry', 'golden', '37.7955,-122.3937,270'],
  ['mission', 'golden', '37.7599,-122.4148,0'],
  ['lombard', 'golden', '37.8021,-122.4187,200'],
  ['fidi', 'golden', '37.7929,-122.4027,0'],
  ['ferry', 'dusk', '37.7955,-122.3937,270'],
];
for (const [spot, time, at] of ALL) {
  if (SPOTS.length && !SPOTS.includes(`${spot}-${time}`)) continue;
  await shot(spot, time, at);
}

if (blanks.length) console.log('BLANK_SHOTS=' + JSON.stringify(blanks));
console.log('DONE variant=' + variant + ' errors=' + JSON.stringify(errors.slice(0, 5)));
await browser.close();
process.exitCode = blanks.length ? 1 : 0;
