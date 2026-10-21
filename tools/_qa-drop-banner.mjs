// LANE E (gtasf-lskkn): on a phone, the live fund-drop banner must not cover the combat health/armour bars. Run while a drop
// is live (/api/drops/state active non-empty); measures .gt-drop-banner vs .gt-combat-hud and screenshots. Fresh is_bot device.
//   OUT=docs/qa/<day>/drop-banner node tools/_qa-drop-banner.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.env.OUT ?? 'docs/qa/drop-banner'; mkdirSync(OUT, { recursive: true });
const BASE = process.env.GTASF_QA_URL ?? 'https://gtasf.com';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36' });
await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Founder', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' })); } catch {} });
const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 140)));
await page.goto(`${BASE}/?at=37.795570,-122.393900,270&bot=1&preset=low`, { waitUntil: 'domcontentloaded', timeout: 60000 });
const R = { ready: await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 150000 }).then(() => true).catch(() => false) };
for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
// The vitals (.gt-combat-hud) only show once combat has started (18+ accepted); on touch the playtest's gunshop step does this.
await page.evaluate(() => window.__gtasfCombat?.requestCombat?.()); await page.waitForTimeout(900);
if (await page.locator('.gt-age-gate-enter').isVisible().catch(() => false)) { await page.locator('.gt-age-gate-enter').tap(); await page.waitForTimeout(900); }
R.combatStarted = await page.evaluate(() => !!window.__gtasfCombat?.state?.()?.started);
R.bannerSeen = await page.waitForFunction(() => { const b = document.querySelector('.gt-drop-banner'); return !!b && b.checkVisibility?.() && b.getBoundingClientRect().height > 0; }, null, { timeout: Number(process.env.WAIT ?? 60000) }).then(() => true).catch(() => false);
await page.waitForTimeout(1500);
const rect = sel => page.evaluate(s => { const e = document.querySelector(s); if (!e || !e.checkVisibility?.()) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; }, sel);
R.banner = await rect('.gt-drop-banner'); R.vitals = await rect('.gt-combat-hud');
R.bannerText = await page.evaluate(() => document.querySelector('.gt-drop-banner')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 90));
const b = R.banner, v = R.vitals;
R.overlap = !!(b && v && b.top < v.bottom && v.top < b.bottom && b.left < v.right && v.left < b.right);
await page.screenshot({ path: `${OUT}/phone-drop-banner.jpg`, type: 'jpeg', quality: 75 });
R.errs = errs;
R.pass = !!(R.ready && R.bannerSeen && b && v && !R.overlap);
console.log(JSON.stringify(R)); console.log(`RESULT: ${R.pass ? 'DROP BANNER CLEAR OF VITALS' : R.bannerSeen ? 'CHECK FAILED' : 'NO LIVE BANNER (inconclusive)'}`);
writeFileSync(`${OUT}/result.json`, JSON.stringify(R, null, 2));
setTimeout(() => process.exit(0), 8000).unref(); await browser.close();
