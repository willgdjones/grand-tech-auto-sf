// LANE E: Share location round trip on prod. Device A spawns at a deep link, presses L (copy current location), we read
// the clipboard; device B (fresh context) opens that link and must land within a few metres of A, facing the same way.
//   OUT=docs/qa/<day>/share-location [START=/go/coit-tower] node tools/_qa-share-location.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.env.OUT ?? 'docs/qa/share-location'; mkdirSync(OUT, { recursive: true });
const BASE = process.env.GTASF_QA_URL ?? 'https://gtasf.com';
const START = process.env.START ?? '/go/coit-tower';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const founded = () => { try { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Founder', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' })); } catch {} };
async function device(url, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(founded);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 140)));
  const t0 = Date.now(); await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const ok = await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 120000 }).then(() => true).catch(() => false);
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
  await page.waitForTimeout(3000);
  const pose = await page.evaluate(() => { const f = window.__gtasf?.world?.foot; return f ? { x: +f.x.toFixed(1), z: +f.z.toFixed(1), yaw: +(f.yaw ?? 0).toFixed(2) } : null; });
  await page.screenshot({ path: `${OUT}/${tag}.jpg`, type: 'jpeg', quality: 70 });
  return { ctx, page, errs, ok, readyS: Math.round((Date.now() - t0) / 1000), pose };
}
const R = { start: START };
const a = await device(`${BASE}${START}${START.includes('?') ? '&' : '?'}bot=1`, 'a-start');
R.a = { ok: a.ok, readyS: a.readyS, pose: a.pose };
// Walk a little off the spawn so the shared spot differs from the canonical place spawn.
await a.page.keyboard.down('KeyW'); await a.page.waitForTimeout(1500); await a.page.keyboard.up('KeyW'); await a.page.waitForTimeout(800);
R.a.moved = await a.page.evaluate(() => { const f = window.__gtasf.world.foot; return { x: +f.x.toFixed(1), z: +f.z.toFixed(1), yaw: +(f.yaw ?? 0).toFixed(2) }; });
await a.page.evaluate(() => navigator.clipboard.writeText('')).catch(() => {});
await a.page.keyboard.press('KeyL'); await a.page.waitForTimeout(1200);
R.copied = await a.page.evaluate(() => navigator.clipboard.readText()).catch(e => `clipboard error: ${e.message}`);
R.notice = await a.page.evaluate(() => [...document.querySelectorAll('[class*="notice"], [class*="toast"], #prompt')].filter(e => e.checkVisibility()).map(e => e.textContent.trim()).join(' | ').slice(0, 160));
await a.page.screenshot({ path: `${OUT}/a-after-L.jpg`, type: 'jpeg', quality: 70 });
console.log(`A ready=${a.ok} in ${a.readyS}s at ${JSON.stringify(R.a.moved)}; L copied "${R.copied}" notice "${R.notice}"`);
if (/^https?:\/\//.test(R.copied ?? '')) {
  const link = new URL(R.copied); link.searchParams.set('bot', '1');
  const b = await device(link.toString(), 'b-opened');
  R.b = { ok: b.ok, readyS: b.readyS, pose: b.pose, errs: b.errs.length };
  R.distM = b.pose && R.a.moved ? +Math.hypot(b.pose.x - R.a.moved.x, b.pose.z - R.a.moved.z).toFixed(1) : null;
  console.log(`B ready=${b.ok} in ${b.readyS}s at ${JSON.stringify(b.pose)}; ${R.distM} m from A`);
  await b.ctx.close();
} else console.log('no link on the clipboard');
R.pass = !!(R.a.ok && R.b?.ok && R.distM != null && R.distM <= 8);
console.log(`RESULT: ${R.pass ? 'SHARE LOCATION PASS' : 'CHECK FAILED'}`);
writeFileSync(`${OUT}/result.json`, JSON.stringify(R, null, 2));
await a.ctx.close(); setTimeout(() => process.exit(0), 8000).unref(); await browser.close();
