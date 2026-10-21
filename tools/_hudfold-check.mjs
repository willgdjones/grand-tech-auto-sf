// One-off: hudMenuFold on the local stack — the ticker lives in the pause menu, the Privacy launch is off the HUD.
import { chromium } from '@playwright/test';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { localStorage.setItem('gtasf.founder.bucket.v1', 'ladder'); localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'Fold Labs', foundedAt: Date.now(), billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: 1 })); });
const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/api/analytics/config', r => r.fulfill({ contentType: 'application/json', body: '{"posthog":true,"xPixelId":null,"consentRequired":false}' }));
await page.goto('http://localhost:5319/?bot=1');
await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120000 });
await page.waitForTimeout(4000);
const r = await page.evaluate(() => ({
  tickerInMenu: !!document.querySelector('.gt-pause-menu .gt-radar-ticker'),
  privacyLaunch: !!document.querySelector('.gt-privacy-launch'),
  privacyVisibleOnHud: (() => { const p = document.querySelector('.gt-privacy-launch'); return !!p && p.getClientRects().length > 0; })(),
}));
await page.screenshot({ path: 'docs/sf-data/hud-fold/hud-desktop.jpg', type: 'jpeg', quality: 72 });
await page.locator('.gt-pause-launch').click(); await page.waitForTimeout(800);
r.menuPrivacyShown = await page.evaluate(() => [...document.querySelectorAll('.gt-pause-menu button')].some(b => /Privacy settings/.test(b.textContent) && !b.hidden));
await page.screenshot({ path: 'docs/sf-data/hud-fold/menu-desktop.jpg', type: 'jpeg', quality: 72 });
console.log('PRE', JSON.stringify(r));
if (r.menuPrivacyShown) { await page.getByRole('button', { name: 'Privacy settings' }).click(); await page.waitForTimeout(600); }
r.consentPanelOpens = await page.evaluate(() => { const p = document.querySelector('#analytics-consent'); return !!p && !p.hidden; });
await page.keyboard.press('Escape'); await page.waitForTimeout(500);
await page.keyboard.press('KeyN'); await page.waitForTimeout(1200);
r.phoneFramed = await page.evaluate(() => { const p = document.querySelector('.gt-mission-phone'); return !!p && !p.hidden && p.classList.contains('gt-mission-phone--framed') && /\d:\d\d/.test(p.querySelector('.gt-mission-phone-clock')?.textContent ?? ''); });
await page.screenshot({ path: 'docs/sf-data/hud-fold/phone-frame-desktop.jpg', type: 'jpeg', quality: 72 });
r.errs = errs; console.log('RESULT', JSON.stringify(r)); await b.close();
