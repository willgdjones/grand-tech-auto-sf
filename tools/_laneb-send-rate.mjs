// Lane B (gtasf-giklk): how many world-socket messages does the client send per second while driving into walls? The
// server closes a socket at > 30 msg/s sustained (burst 60, WorldDO webSocketMessage, 4004 'message budget exceeded').
// Boards the parked car at the usual kerb, drives steering hard into the buildings for DRIVE_S, and reports the busiest
// 1 s window overall and per opcode (0x12 VEHICLE_MOVE, 0x26 VEHICLE_CRASH, 0x25 COMBAT_CRIME, ...).
//   GTASF_COMBAT_URL=http://localhost:5393 node tools/_laneb-send-rate.mjs
import { chromium } from '@playwright/test';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5393';
const SPAWN = process.env.GTASF_SEAT_AT ?? '37.80199520213967,-122.41963019831591,87.8';
const DRIVE_S = Number(process.env.DRIVE_S ?? 8);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  window.__sends = [];
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, 1) : null;
      if (b && String(this.url).includes('/api/world')) window.__sends.push([performance.now(), b[0]]); } catch {}
    return send.call(this, d);
  };
});
const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
await page.goto(`${base}/?at=${SPAWN}&preset=low&bot=1`);
await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 120_000 });
for (let i = 0; i < 12; i++) { const on = await page.evaluate(() => { const b = document.querySelector('.gt-sa-intro__skip') ?? document.querySelector('.gt-identity-go'); if (b && b.checkVisibility()) { b.click(); return true; } return false; }); if (!on) break; await page.waitForTimeout(500); }
await page.waitForTimeout(3000);
for (let i = 0; i < 6 && (await page.evaluate(() => window.__gtasf.world.mode)) === 'on-foot'; i++) { await page.keyboard.press('KeyE'); await page.waitForTimeout(1300); }
const mode = await page.evaluate(() => window.__gtasf.world.mode);
await page.waitForTimeout(1500);
const t0 = await page.evaluate(() => performance.now());
await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD');
await page.waitForTimeout(DRIVE_S * 1000);
await page.keyboard.up('KeyD'); await page.keyboard.up('KeyW');
const r = await page.evaluate(t0 => {
  const s = window.__sends.filter(([t]) => t >= t0), names = { 0x12: 'VEHICLE_MOVE', 0x26: 'VEHICLE_CRASH', 0x25: 'COMBAT_CRIME', 0x02: 'MOVE' };
  const peak = list => { let best = 0; for (let i = 0, j = 0; i < list.length; i++) { while (list[i] - list[j] > 1000) j++; best = Math.max(best, i - j + 1); } return best; };
  const byOp = {}; for (const [t, op] of s) (byOp[op] ??= []).push(t);
  return { total: s.length, peakPerSec: peak(s.map(([t]) => t)), perOp: Object.fromEntries(Object.entries(byOp).map(([op, ts]) => [names[op] ?? `0x${(+op).toString(16)}`, { n: ts.length, peakPerSec: peak(ts) }])) };
}, t0);
console.log(`mode ${mode}; ${DRIVE_S} s driving into walls: ${JSON.stringify(r)}`);
console.log(`server budget: 30/s sustained, burst 60 -> ${r.peakPerSec > 30 ? 'OVER (would be kicked if sustained)' : 'within'}; errors=${JSON.stringify(errors)}`);
await browser.close();
