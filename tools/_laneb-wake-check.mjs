// gtasf-ceent (critic N20): after a BUSTED/WASTED respawn at a non-SF-General hospital, the player is told where they
// woke ("Released outside / Discharged from Saint Francis Memorial") once the card lifts, and the minimap shows the
// hospital cross. Injects BUSTED (0xaa) then a CORRECTION to the road by Saint Francis on a local combat stack (a real
// server bust can't happen locally: police hold fire without building collision). Headless; self-judging RESULT line.
//   GTASF_URL=http://localhost:5391 tools/heavy.sh node tools/_laneb-wake-check.mjs
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 240_000).unref();
const base = process.env.GTASF_URL ?? 'http://localhost:5391';
const out = resolve(process.env.OUT ?? 'docs/sf-data/respawn-n20');
await mkdir(out, { recursive: true });
const SAINT_FRANCIS_ROAD = { x: -817.64, y: 64.33, z: -592.68 }; // the road-snapped point by the hospital (probe 10-17)
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
  await context.addInitScript(() => {
    const W = window.WebSocket;
    window.WebSocket = class extends W {
      constructor(...a) { super(...a); if (/\/api\/world/.test(String(a[0]))) window.__worldSocket = this; }
      send(data) { if (this === window.__worldSocket && window.__muteSend) return; return super.send(data); }
    };
    window.__inject = bytes => window.__worldSocket.dispatchEvent(new MessageEvent('message', { data: bytes.buffer }));
    window.__correctionTo = (x, y, z) => {
      const b = new Uint8Array(15), v = new DataView(b.buffer);
      v.setUint8(0, 0x89); v.setInt32(1, Math.round(x * 100), true); v.setInt32(5, Math.round(y * 100), true); v.setInt32(9, Math.round(z * 100), true);
      return b;
    };
    window.__toasts = [];
    addEventListener('DOMContentLoaded', () => new MutationObserver(() => {
      for (const t of document.querySelectorAll('.gt-toast')) if (!window.__toasts.includes(t.textContent)) window.__toasts.push(t.textContent);
    }).observe(document.body, { childList: true, subtree: true, characterData: true }));
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/?at=37.79560,-122.39370,270&preset=low&bot=1&time=noon`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 180_000 });
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
  await page.waitForTimeout(2000);
  await page.evaluate(({ x, y, z }) => { window.__muteSend = true; window.__inject(Uint8Array.of(0xaa)); setTimeout(() => window.__inject(window.__correctionTo(x, y, z)), 300); }, SAINT_FRANCIS_ROAD);
  await page.waitForFunction(() => window.__toasts.some(t => /Saint Francis/.test(t)), null, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(out, 'wake-toast-phone.jpg'), quality: 85 });
  const toasts = await page.evaluate(() => window.__toasts);
  const foot = await page.evaluate(() => ({ ...window.__gtasf.world.foot }));
  const moved = Math.hypot(foot.x - SAINT_FRANCIS_ROAD.x, foot.z - SAINT_FRANCIS_ROAD.z);
  const named = toasts.find(t => /Saint Francis Memorial/.test(t));
  // Wake view (critic 5e4e2200): face Saint Francis's monument — heading 30 → yaw π − 30° (spawn/locations.ts headingToYaw).
  const wantYaw = Math.PI - 30 * Math.PI / 180, yawOff = Math.abs(Math.atan2(Math.sin(foot.yaw - wantYaw), Math.cos(foot.yaw - wantYaw)));
  await page.waitForTimeout(2500); await page.screenshot({ path: resolve(out, 'wake-heading-phone.jpg'), quality: 85 });
  console.log(`toasts ${JSON.stringify(toasts)}; foot ${moved.toFixed(1)} m from the Saint Francis road point; yaw ${(yawOff * 180 / Math.PI).toFixed(1)}° off heading 30`);
  console.log(`RESULT ${named && moved < 5 && yawOff < .05 ? `PASS "${named}", facing heading 30` : named && moved < 5 ? 'FAIL toast ok but not facing heading 30' : 'FAIL no wake toast naming Saint Francis'}`);
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser.close(); console.log(`page errors ${errors.length} ${JSON.stringify(errors.slice(0, 3))}`); }
