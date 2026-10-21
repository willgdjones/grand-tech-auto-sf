// LANE E (scratch): do kerb-parked cars stream in after a same-page reload? founder-repro's crash check re-boots and
// then never sees a kerb car within 45 s. Counts world.kerbCarBodies() near the player for 60 s after each READY.
//   OUT=docs/qa/<day>/kerb-reload [AT=lat,lon,h] node tools/_qa-kerb-reload.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.env.OUT ?? 'docs/qa/kerb-reload'; mkdirSync(OUT, { recursive: true });
const AT = process.env.AT ?? '37.789100,-122.409600,90';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Founder', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' })); } catch {} });
const page = await ctx.newPage(); page.setDefaultTimeout(30000);
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
const R = { at: AT, rounds: [] };
async function round(label, nav) {
  const t0 = Date.now(); await nav();
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 150000 });
  const ready = Date.now() - t0; const samples = [];
  for (let s = 0; s <= 60; s += 5) {
    const k = await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot; const all = [...(w.kerbCarBodies?.() ?? [])];
      return { n: all.length, near: all.filter(k => Math.hypot(k.x - f.x, k.z - f.z) < 120).length, phone: !!document.querySelector('.gt-mission-phone') }; });
    samples.push({ s, ...k }); if (k.near) break; await page.waitForTimeout(5000);
  }
  await page.screenshot({ path: `${OUT}/${label}.jpg`, type: 'jpeg', quality: 70 });
  const r = { label, readyMs: ready, firstKerbS: samples.find(x => x.near)?.s ?? null, samples }; R.rounds.push(r); console.log(JSON.stringify(r));
}
await round('first-load', () => page.goto(`https://gtasf.com/?at=${AT}&bot=1`, { waitUntil: 'domcontentloaded', timeout: 60000 }));
await round('goto-again', () => page.goto(`https://gtasf.com/?at=${AT}&bot=1`, { waitUntil: 'domcontentloaded', timeout: 60000 }));
await round('reload', () => page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }));
R.errs = errs; writeFileSync(`${OUT}/result.json`, JSON.stringify(R, null, 2)); console.log('errs', JSON.stringify(errs));
setTimeout(() => process.exit(0), 8000).unref(); await browser.close();
