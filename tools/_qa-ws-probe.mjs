// LANE E scratch probe: does a deep-linked load reach READY + connected, and what do the world sockets do?
//   AT=lat,lon,heading [WANTED=1] node tools/_qa-ws-probe.mjs
import { chromium } from '@playwright/test';
const AT = process.env.AT ?? '37.795300,-122.401500,270';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { const W = window.WebSocket; window.WebSocket = class extends W { constructor(...a) { super(...a);
  const c0 = this.close.bind(this); this.close = (code, reason) => { console.warn(`[probe] client close ${code} ${reason}`); return c0(code, reason); };
  this.addEventListener('close', e => console.warn(`[probe] ws closed code=${e.code} reason=${e.reason} clean=${e.wasClean}`)); } }; });
const page = await ctx.newPage();
const t0 = Date.now(); const ev = []; const log = s => { const l = `${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`; ev.push(l); console.log(l); };
page.on('websocket', ws => { log(`ws open ${new URL(ws.url()).pathname}`); let n = 0;
  ws.on('framereceived', f => { if (n++ < 3) log(`ws rx ${typeof f.payload === 'string' ? f.payload.slice(0, 100) : `[bin ${f.payload.length}]`}`); });
  ws.on('socketerror', e => log(`ws error ${e}`)); ws.on('close', () => log(`ws close after ${n} frames`)); });
page.on('response', r => { if (r.status() >= 400) log(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
page.on('console', m => { if (/error|warn/.test(m.type()) && !/emissiveMap/.test(m.text())) log(`console.${m.type()} ${m.text().slice(0, 160)}`); });
async function load(label) {
  log(`--- load ${label}`);
  await page.goto(`https://gtasf.com/?at=${AT}&bot=1`, { waitUntil: 'domcontentloaded' });
  const ok = await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 90000 }).then(() => true).catch(() => false);
  log(`${label}: READY+connected=${ok}`);
  return ok;
}
const first = await load('fresh');
if (first && process.env.WANTED === '1') {
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  await page.locator('.gt-age-gate-enter').click({ timeout: 8000 }).catch(() => log('no age gate'));
  await page.waitForTimeout(800);
  for (let i = 0; i < 4; i++) { await page.evaluate(() => { window.__gtasfCombat.selectWeapon('pistol'); window.__gtasfCombat.fire(); }); await page.waitForTimeout(250); await page.evaluate(() => window.__gtasfCombat.fireStop()); }
  await page.waitForTimeout(3000);
  log(`stars ${await page.evaluate(() => document.querySelectorAll('.gt-combat-wanted-star.lit').length)}`);
  await load('reload-while-wanted');
}
await browser.close();
