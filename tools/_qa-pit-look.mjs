// LANE E (gtasf-659xq): look at the Powell/Hallidie spot on prod, desktop + phone (Low, touch), four camera yaws each,
// and log the player's height (the pit put the spawn at y ~8.3 m against an ~11.5 m street; lift3 measured 10.95 m).
//   OUT=docs/qa/<day>/pit-look [AT=37.7846,-122.4079] node tools/_qa-pit-look.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const OUT = process.env.OUT ?? 'docs/qa/pit-look'; mkdirSync(OUT, { recursive: true });
const AT = process.env.AT ?? '37.7846,-122.4079';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const profiles = {
  desktop: { opts: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }, q: '' },
  phone: { opts: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true }, q: '&preset=low' },
};
for (const [name, p] of Object.entries(profiles)) {
  const ctx = await browser.newContext(p.opts);
  await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Founder', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' })); } catch {} });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 120)));
  await page.goto(`https://gtasf.com/?at=${AT}&bot=1${p.q}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const ok = await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 150000 }).then(() => true).catch(() => false);
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
  await page.waitForTimeout(12000);
  const st = await page.evaluate(() => { const w = window.__gtasf?.world, f = w?.foot; return f ? { x: +f.x.toFixed(1), y: +f.y.toFixed(2), z: +f.z.toFixed(1),
    ground: w.heightAt?.(f.x, f.z) ?? null, ring: [[-8, 0], [8, 0], [0, -8], [0, 8], [-16, 0], [16, 0], [0, -16], [0, 16]].map(([dx, dz]) => +(w.heightAt?.(f.x + dx, f.z + dz) ?? NaN).toFixed(2)) } : null; }).catch(() => null);
  console.log(`[${name}] ready=${ok} ${JSON.stringify(st)} errs=${errs.length}`);
  for (const [i, yaw] of [0, Math.PI / 2, Math.PI, -Math.PI / 2].entries()) {
    await page.evaluate(y => window.__gtasf?.world?.camera?.setOrbit?.(y, -0.25), yaw).catch(() => {}); await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${name}-${i}.jpg`, type: 'jpeg', quality: 72 });
  }
  await ctx.close();
}
setTimeout(() => process.exit(0), 8000).unref(); await browser.close();
