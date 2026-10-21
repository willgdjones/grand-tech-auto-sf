// #6 rollback render-defect check (orchestrator-sanctioned headed real-GPU check of my own feature).
// Captures Ferry/Mission (overexposure) + FiDi/Lombard (boot hang) at HD golden realistic, waiting for
// the loading card to actually HIDE (the scene, not the poster), and prints the ?debug=render overlay.
import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';

const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
let code = '';
try { code = (await readFile('worker/.wrangler/production/invite-code.txt', 'utf8')).trim(); } catch {}
const out = 'artifacts/look/rr-check';
await mkdir(out, { recursive: true });
const ALL = { ferry: '37.7955,-122.3937,270', mission: '37.7599,-122.4148,0',
  fidi: '37.7929,-122.4027,0', lombard: '37.8021,-122.4187,200' };
const spots = (process.env.RR_SPOTS ?? 'ferry,mission,fidi,lombard').split(',').map(s => s.trim()).filter(Boolean).map(n => [n, ALL[n]]);

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
for (const [name, at] of spots) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
  const url = `${base}/?at=${at}&gfx=hd&time=golden&debug=render${code ? `&invite=${code}` : ''}`;
  try {
    await page.goto(url);
    try { const g = page.locator('.gt-identity-go'); await g.waitFor({ state: 'visible', timeout: 3000 }); await g.click({ timeout: 8000 }); } catch {}
    // SA intro carousel ("PRESS ANY KEY TO CONTINUE" + a SKIP button): click SKIP, else press a key to
    // advance/dismiss. Loop until .gt-sa-intro is gone so the GAME is captured, not the intro poster.
    for (let i = 0; i < 8; i++) {
      const introUp = await page.evaluate(() => { const e = document.querySelector('.gt-sa-intro'); return !!e && e.offsetParent !== null; });
      if (!introUp) break;
      try { const s = page.locator('.gt-sa-intro__skip'); if (await s.isVisible({ timeout: 300 })) { await s.click(); await page.waitForTimeout(300); continue; } } catch {}
      await page.keyboard.press('Enter'); await page.waitForTimeout(350);
    }
    try { const go = page.getByRole('button', { name: /let'?s go/i }); if (await go.isVisible({ timeout: 800 })) await go.click(); } catch {}
    let booted = false;
    try { await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, { timeout: 50_000 }); booted = true; } catch {}
    await page.waitForTimeout(4000);
    const overlay = await page.evaluate(() => document.getElementById('gt-render-debug')?.textContent ?? 'NO OVERLAY');
    // Screenshot the <canvas> directly: it's the WebGL scene itself, so DOM overlays (onboarding
    // intro/identity) don't occlude it. This shows the realisticRender output regardless of modals.
    try { await page.locator('canvas').first().screenshot({ path: `${out}/${name}.png` }); }
    catch { await page.screenshot({ path: `${out}/${name}.png` }); }
    console.log(`\n=== ${name}: booted(loading hidden)=${booted}  errs=${errs.length ? JSON.stringify(errs.slice(0, 2)) : '0'} ===`);
    console.log(overlay);
  } catch (e) { console.log(`${name} FAIL: ${String(e.message).split('\n')[0]}`); }
  finally { await page.close(); }
}
await browser.close();
