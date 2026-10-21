// Phone 3-star message layout probe (critic N2 follow-up): every ~1 s for 20 s after taking 3 stars, record the visible
// boxes of the SFPD bark, the DISPATCH line and the centre toast ('Lose the cops'), and flag any pair that overlaps.
//   GTASF_URL=http://localhost:5319 tools/heavy.sh node tools/_laneb-phone-msgs.mjs
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 300_000).unref();
const base = process.env.GTASF_URL ?? 'http://localhost:5319';
const out = resolve(process.env.OUT ?? 'docs/sf-data/combat/phone-msgs');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
let overlaps = 0;
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
  await context.addInitScript(() => { const W = window.WebSocket; window.WebSocket = class extends W { constructor(...a) { super(...a); if (/\/api\/world/.test(String(a[0]))) window.__worldSocket = this; } }; });
  const page = await context.newPage();
  await page.goto(`${base}/?at=37.78790,-122.40750,90&preset=low&bot=1&time=noon`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 180_000 });
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.()); await page.waitForTimeout(600);
  if (await page.locator('.gt-age-gate').isVisible().catch(() => false)) { await page.locator('.gt-age-gate-enter').click(); await page.waitForTimeout(1200); }
  for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__worldSocket?.send(Uint8Array.of(0x25, 0))); await page.waitForTimeout(1200); }
  for (let t = 0; t < 20; t++) {
    const boxes = await page.evaluate(() => {
      const pick = sel => [...document.querySelectorAll(sel)].filter(e => e.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) && e.getBoundingClientRect().height > 0)
        .map(e => { const r = e.getBoundingClientRect(); return { sel, text: e.textContent.trim().slice(0, 40), top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; });
      return [...pick('.gt-police-bark'), ...pick('.gt-dispatch'), ...pick('.gt-toast-notice, .gt-toast, .toast')];
    });
    const hits = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) hits.push(`${a.sel}×${b.sel}`);
    }
    if (hits.length) { overlaps++; if (overlaps <= 2) await page.screenshot({ path: resolve(out, `overlap-${overlaps}.jpg`), quality: 80 }); }
    console.log(`t${t} ${JSON.stringify(boxes.map(b => `${b.sel}@${b.top}-${b.bottom}`))} ${hits.join(' ')}`);
    await page.waitForTimeout(1000);
  }
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); }
finally { await browser.close(); console.log(`RESULT ${overlaps ? `FAIL ${overlaps} sample(s) with overlapping messages` : 'PASS no overlaps'}`); }
