// LANE E: inject a CSS file into prod on a phone at AT and print the rects of SELECTORS (overlap check) + a shot.
//   CSS=path AT=lat,lon,h SEL='.a,.b' OUT=file.jpg node tools/_qa-css-verify.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' })); } catch {} });
const page = await ctx.newPage();
await page.goto(`https://gtasf.com/?at=${process.env.AT}&bot=1&preset=low`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 150000 });
if (process.env.CSS) await page.addStyleTag({ content: readFileSync(process.env.CSS, 'utf8') });
for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
await page.waitForSelector('.gt-mission-phone', { state: 'attached', timeout: 120000 }).catch(() => {});
await page.waitForTimeout(5000);
const rects = await page.evaluate(sel => sel.split(',').map(s => { const e = document.querySelector(s.trim()); if (!e || !e.checkVisibility()) return [s, null]; const r = e.getBoundingClientRect(); return [s, [r.left, r.top, r.right, r.bottom].map(Math.round)]; }), process.env.SEL);
console.log(JSON.stringify(rects));
await page.screenshot({ path: process.env.OUT, type: 'jpeg', quality: 70 });
await browser.close();
