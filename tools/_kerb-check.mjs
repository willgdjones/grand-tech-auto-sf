// gtasf-b4wtu: focused kerb-car theft check with no scripted walking. Load at Union Square, find the nearest kerb-parked car,
// WALK to it with the keyboard (client collision, so the server accepts the moves; QA nudged foot.x/z), press E,
// then poll up to 6 s. Records: KERB_CAR_TAKE frames sent (0x28), CORRECTION (0x89) / VEHICLE_STATE (0xa1) frames received,
// the client's toasts, and the final mode. Pair with the worker log ('kerb take refused <reason>', f7866728).
//   GTASF_QA_URL=http://localhost:5374 node tools/_kerb-check.mjs
import { chromium } from '@playwright/test';
const BASE = (process.env.GTASF_QA_URL ?? 'http://localhost:5374').replace(/\/$/, '');
const AT = process.env.KERB_AT ?? '37.789100,-122.409600,90';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  window.__kerb = { sent: 0, corrections: 0, vstate: 0, toasts: [] };
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, 1) : null; if (b && b[0] === 0x28) window.__kerb.sent++; } catch {}
    return send.call(this, d);
  };
  addEventListener('DOMContentLoaded', () => new MutationObserver(() => { for (const el of document.querySelectorAll('.gt-toast, .gt-notice, [class*="notify"], [role="status"]')) { const t = el.textContent?.trim(); if (t && /car|vehicle|Getting/i.test(t) && !window.__kerb.toasts.includes(t)) window.__kerb.toasts.push(t.slice(0, 80)); } })
    .observe(document.documentElement, { subtree: true, childList: true, characterData: true }));
});
const page = await ctx.newPage(); page.setDefaultTimeout(60000);
page.on('websocket', ws => ws.on('framereceived', f => { if (typeof f.payload === 'string') return; const op = f.payload[0];
  if (op === 0x89 || op === 0xa1) page.evaluate(op => { if (op === 0x89) window.__kerb.corrections++; else window.__kerb.vstate++; }, op).catch(() => {}); }));
const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)));
async function boot(at) {
  await page.goto(`${BASE}/?at=${at}&bot=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90000 });
  for (let i = 0; i < 15; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(250); }
  try { const d = page.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 800 })) { await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill('kerb'); await d.getByRole('button', { name: 'Save startup' }).click(); } } catch {}
}
const nearestKerb = () => page.evaluate(() => { const w = window.__gtasf.world, f = w.foot;
  return [...w.kerbCarBodies()].map(k => ({ x: k.x, z: k.z, yaw: k.yaw, d: Math.hypot(k.x - f.x, k.z - f.z) })).sort((a, b) => a.d - b.d)[0] ?? null; });
async function waitKerb(maxM) { for (let i = 0; i < 60; i++) { const k = await nearestKerb(); if (k && k.d <= maxM) return k; await page.waitForTimeout(1000); } return null; }
try {
  await boot(AT);
  const k = await waitKerb(40);
  if (!k) throw new Error('no kerb car within 40 m after 60 s');
  // Walk to it for real (keyboard + client collision, so the server accepts every MOVE): aim the chase camera so
  // W heads at the car, short bursts, re-aim, until within ~2.2 m.
  let k2 = k;
  for (let i = 0; i < 60 && k2 && k2.d > 2.2; i++) {
    await page.evaluate(({ x, z }) => { const w = window.__gtasf.world, f = w.foot; w.camera.setOrbit(Math.atan2(x - f.x, z - f.z) + Math.PI, -0.2); }, k2);
    await page.keyboard.down('KeyW'); await page.waitForTimeout(Math.min(400, 120 + k2.d * 60)); await page.keyboard.up('KeyW');
    await page.waitForTimeout(150);
    k2 = await nearestKerb();
  }
  const foot = await page.evaluate(() => ({ ...window.__gtasf.world.foot }));
  console.log(`[kerb] walked: foot (${foot.x.toFixed(1)},${foot.z.toFixed(1)}), nearest kerb ${k2 ? k2.d.toFixed(1) + ' m' : 'none'}; corrections so far ${await page.evaluate(() => window.__kerb.corrections)}`);
  if (!k2 || k2.d > 3) throw new Error('could not walk within 3 m of a kerb car');
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => ({ ...window.__kerb }));
  await page.keyboard.press('KeyE');
  let mode = 'on-foot', ms = 0;
  for (; ms < 6000; ms += 200) { await page.waitForTimeout(200); mode = await page.evaluate(() => window.__gtasf.world.mode); if (mode === 'driver') break; }
  const after = await page.evaluate(() => ({ ...window.__kerb }));
  console.log(`[kerb] E → mode ${mode} after ${ms} ms; KERB_CAR_TAKE sent ${after.sent - before.sent}; corrections ${after.corrections - before.corrections} (since boot ${after.corrections}); VEHICLE_STATE ${after.vstate - before.vstate}; toasts ${JSON.stringify(after.toasts)}`);
  console.log(`RESULT: ${mode === 'driver' ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 4))}`);
} catch (e) { console.log(`ABORTED: ${String(e.message).split('\n')[0]}`); }
await browser.close();
