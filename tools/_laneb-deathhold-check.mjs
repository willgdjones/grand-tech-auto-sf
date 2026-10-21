// deathCamHold check: replay the server's arrest sequence through the client's own world socket — BUSTED (0xaa), then
// 300 ms later a CORRECTION (0x89) 400 m east, as WorldDO.settleBust does — and screenshot while the card is up (+1.2 s)
// and after it lifts (+3.6 s). With the hold, the card plays over the arrest spot; without it, over the new spot.
//   OUT=... GTASF_URL=http://localhost:5319 tools/heavy.sh node tools/_laneb-deathhold-check.mjs
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 240_000).unref();
const base = process.env.GTASF_URL ?? 'http://localhost:5319';
const out = resolve(process.env.OUT ?? 'docs/sf-data/combat/death-hold');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    const W = window.WebSocket;
    window.WebSocket = class extends W {
      constructor(...a) { super(...a); if (/\/api\/world/.test(String(a[0]))) window.__worldSocket = this; }
      // The local server never made this respawn, so it would pull the client back on its next move; mute sends meanwhile.
      send(data) { if (this === window.__worldSocket && window.__muteSend) return; return super.send(data); }
    };
    window.__inject = bytes => window.__worldSocket.dispatchEvent(new MessageEvent('message', { data: bytes.buffer }));
    window.__correctionEast = metres => {
      const f = window.__gtasf.world.foot, b = new Uint8Array(15), v = new DataView(b.buffer);
      v.setUint8(0, 0x89); v.setInt32(1, Math.round((f.x + metres) * 100), true); v.setInt32(5, Math.round(f.y * 100), true); v.setInt32(9, Math.round(f.z * 100), true);
      v.setUint8(13, 0); v.setUint8(14, 0); return b;
    };
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/?at=37.79560,-122.39370,270&preset=low&bot=1&time=noon`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 180_000 });
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: resolve(out, 'before.jpg'), quality: 80 });
  const start = await page.evaluate(() => ({ ...window.__gtasf.world.foot }));
  const cam = () => page.evaluate(() => { const p = window.__gtasf.world.camera.camera.position; return [p.x, p.y, p.z]; });
  const camBefore = await cam();
  await page.evaluate(() => { window.__muteSend = true; window.__inject(Uint8Array.of(0xaa)); setTimeout(() => window.__inject(window.__correctionEast(400)), 300); });
  await page.waitForTimeout(1200); const camCard = await cam(); await page.screenshot({ path: resolve(out, 'card.jpg'), quality: 80 });
  await page.waitForTimeout(2400); await page.screenshot({ path: resolve(out, 'after.jpg'), quality: 80 });
  const end = await page.evaluate(() => { window.__muteSend = false; return { ...window.__gtasf.world.foot }; });
  const camAfter = await cam(), dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const moved = end.x - start.x, held = dist(camCard, camBefore), released = dist(camAfter, camBefore);
  console.log(`foot moved ${Math.round(moved)} m east (server-authoritative pose followed the correction); camera during card ${held.toFixed(1)} m from before, after ${released.toFixed(0)} m`);
  // With deathCamHold the card plays where the arrest happened (camera ~still) and the new spot shows after it lifts.
  console.log(`RESULT ${moved > 300 && held < 5 && released > 300 ? 'PASS card at the arrest spot, new spot after' : moved > 300 && held > 300 ? 'FAIL card over the new spot (no hold)' : 'INCONCLUSIVE'}`);
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser.close(); console.log(`page errors ${errors.length} ${JSON.stringify(errors.slice(0, 3))}`); }
