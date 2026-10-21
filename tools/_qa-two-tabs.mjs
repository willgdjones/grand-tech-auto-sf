// LANE E: "two browser tabs see each other" on prod. Two fresh is_bot devices spawn a few metres apart at the same
// deep link; each must receive a PLAYER_JOIN (0x83) for the other and snapshots (0x82) that grow past the 15-byte
// single-player size, and each camera is turned toward the other for a screenshot.
//   OUT=docs/qa/<day>/two-tabs [AT=37.795570,-122.393900] node tools/_qa-two-tabs.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.env.OUT ?? 'docs/qa/two-tabs'; mkdirSync(OUT, { recursive: true });
const BASE = process.env.GTASF_QA_URL ?? 'https://gtasf.com';
const AT = process.env.AT ?? '37.795570,-122.393900';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
async function device(tag, at) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Founder', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' })); } catch {} });
  const page = await ctx.newPage(); const s = { tag, joins: 0, maxSnap: 0, errs: [] };
  page.on('pageerror', e => s.errs.push(e.message.slice(0, 120)));
  page.on('websocket', ws => { if (!/\/api\/world/.test(ws.url())) return;
    ws.on('framereceived', f => { if (typeof f.payload === 'string') return; const op = f.payload[0];
      if (op === 0x83) s.joins++; if (op === 0x82) s.maxSnap = Math.max(s.maxSnap, f.payload.length); }); });
  await page.goto(`${BASE}/?at=${at}&bot=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  s.ready = await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 120000 }).then(() => true).catch(() => false);
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
  return { ctx, page, s };
}
const [lat, lon] = AT.split(',').map(Number);
const a = await device('A', `${lat},${lon},90`);
const b = await device('B', `${(lat + 0.00004).toFixed(6)},${lon},270`); // ~4.5 m north
await a.page.waitForTimeout(6000);
const foot = p => p.evaluate(() => { const f = window.__gtasf.world.foot; return { x: f.x, z: f.z }; });
const fa = await foot(a.page), fb = await foot(b.page);
const R = { distM: +Math.hypot(fa.x - fb.x, fa.z - fb.z).toFixed(1) };
for (const [d, me, other] of [[a, fa, fb], [b, fb, fa]]) {
  await d.page.evaluate(({ me, other }) => window.__gtasf.world.camera.setOrbit(Math.atan2(-(other.x - me.x), -(other.z - me.z)), -0.15), { me, other });
  await d.page.waitForTimeout(1500); await d.page.screenshot({ path: `${OUT}/${d.s.tag}-sees-other.jpg`, type: 'jpeg', quality: 72 });
  R[d.s.tag] = { ready: d.s.ready, playerJoins: d.s.joins, maxSnapshotBytes: d.s.maxSnap, pageErrors: d.s.errs.length };
}
R.pass = ['A', 'B'].every(t => R[t].ready && R[t].playerJoins >= 1 && R[t].maxSnapshotBytes > 15);
console.log(JSON.stringify(R)); console.log(`RESULT: ${R.pass ? 'TWO TABS PASS' : 'CHECK FAILED'}`);
writeFileSync(`${OUT}/result.json`, JSON.stringify(R, null, 2));
await a.ctx.close(); await b.ctx.close(); setTimeout(() => process.exit(0), 8000).unref(); await browser.close();
