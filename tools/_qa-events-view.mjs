// LANE E: Tech Week events on prod: the radar carries event pins, the events view (J / the HUD button) lists them, and
// choosing one sets a destination (route + notice). Desktop, fresh is_bot device at the Ferry.
//   OUT=docs/qa/<day>/events-view node tools/_qa-events-view.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.env.OUT ?? 'docs/qa/events-view'; mkdirSync(OUT, { recursive: true });
const BASE = process.env.GTASF_QA_URL ?? 'https://gtasf.com';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Founder', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' })); } catch {} });
const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 140)));
const bad = []; page.on('response', r => { if (r.status() >= 400) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });
await page.goto(`${BASE}/?at=37.795570,-122.393900,270&bot=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
const ready = await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 120000 }).then(() => true).catch(() => false);
for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
await page.waitForTimeout(Number(process.env.WAIT ?? 30000)); // the full road graph streams after READY; choosing earlier says "Road directions are loading"
const R = { ready };
R.radarEvents = await page.evaluate(() => Number(document.querySelector('canvas')?.dataset.events ?? NaN));
await page.evaluate(() => document.querySelector('.gt-upcoming-open')?.click()); await page.waitForTimeout(1500);
R.panelOpen = await page.evaluate(() => { const r = document.querySelector('.gt-upcoming'); return !!r && !r.hidden; });
R.tabs = await page.evaluate(() => [...document.querySelectorAll('.gt-upcoming-tabs [role="tab"], .gt-upcoming-tabs button')].map(b => b.textContent.trim()).slice(0, 8));
R.rows = await page.evaluate(() => document.querySelectorAll('.gt-upcoming-choose').length);
R.enabledRows = await page.evaluate(() => document.querySelectorAll('.gt-upcoming-choose:not(:disabled)').length);
R.firstTitles = await page.evaluate(() => [...document.querySelectorAll('.gt-upcoming-choose')].slice(0, 3).map(b => b.textContent.trim().replace(/\s+/g, ' ').slice(0, 80)));
await page.screenshot({ path: `${OUT}/01-events-view.jpg`, type: 'jpeg', quality: 72 });
const choose = page.locator('.gt-upcoming-choose:not(:disabled)').first();
if (await choose.count()) {
  R.chosen = (await choose.textContent())?.trim().replace(/\s+/g, ' ').slice(0, 80);
  await choose.click(); await page.waitForTimeout(2500);
  R.after = await page.evaluate(() => ({ panelOpen: !document.querySelector('.gt-upcoming')?.hidden,
    notices: [...document.querySelectorAll('[class*="notice"], [class*="toast"], #prompt, .gt-gps-status')].filter(e => e.checkVisibility()).map(e => e.textContent.trim()).filter(Boolean).join(' | ').slice(0, 200) }));
  await page.screenshot({ path: `${OUT}/02-event-chosen.jpg`, type: 'jpeg', quality: 72 });
  // LATE_MS (deferredEventPick, lane D): wait for the road graph and check the remembered pick was applied.
  if (process.env.LATE_MS) { const notes = []; const t0 = Date.now();
    page.on('console', () => {}); await page.exposeFunction('__lateNote', n => notes.push(n)).catch(() => {});
    while (Date.now() - t0 < Number(process.env.LATE_MS)) { await page.waitForTimeout(1000);
      const n = await page.evaluate(() => [...document.querySelectorAll('[class*="notice"], [class*="toast"], #prompt, .gt-gps-status')].filter(e => e.checkVisibility()).map(e => e.textContent.trim()).filter(Boolean).join(' | '));
      if (n && notes.at(-1)?.text !== n) notes.push({ s: Math.round((Date.now() - t0) / 1000), text: n.slice(0, 160) }); }
    R.late = notes; await page.screenshot({ path: `${OUT}/03-late.jpg`, type: 'jpeg', quality: 72 }); }
}
R.errs = errs; R.http = bad;
R.pass = !!(ready && R.radarEvents > 0 && R.panelOpen && R.enabledRows > 0 && R.chosen && !errs.length);
console.log(JSON.stringify(R)); console.log(`RESULT: ${R.pass ? 'EVENTS VIEW PASS' : 'CHECK FAILED'}`);
writeFileSync(`${OUT}/result.json`, JSON.stringify(R, null, 2));
setTimeout(() => process.exit(0), 8000).unref(); await browser.close();
