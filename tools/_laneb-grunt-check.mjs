// hurtGrunts check (client wiring). Local stacks hold police fire (no building collision loaded → the server fails
// closed), so this feeds the client two server-format COMBAT_HIT frames through its own world socket: one on us, one on a
// player beside us. Every started audio buffer's duration is recorded; the hurt grunts are the only 0.18-0.36 s samples.
//   COMBAT_FLAGS="combat weapons serverHits shootingFeel sampledAudio" GTASF_URL=http://localhost:5319 \
//     tools/heavy.sh node tools/_laneb-grunt-check.mjs
import { chromium } from '@playwright/test';

setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 240_000).unref();
const base = process.env.GTASF_URL ?? 'http://localhost:5319';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    const W = window.WebSocket;
    window.WebSocket = class extends W {
      constructor(...a) {
        super(...a);
        if (!/\/api\/world/.test(String(a[0]))) return;
        window.__worldSocket = this;
        this.addEventListener('message', e => { const b = new Uint8Array(e.data instanceof ArrayBuffer ? e.data : []); if (b[0] === 0x81) window.__selfId = new DataView(b.buffer).getUint32(1, true); });
      }
    };
    window.__starts = []; const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) { window.__starts.push(Math.round((this.buffer?.duration ?? -1) * 1000)); return start.apply(this, a); };
    // A COMBAT_HIT (0xa8) frame exactly as shared/protocol/s2c.ts encodes it (little-endian).
    window.__injectHit = (targetId, damage) => {
      const f = window.__gtasf.world.foot, buf = new ArrayBuffer(1 + 4 + 1 + 48 + 4 + 2 + 1), v = new DataView(buf);
      let o = 0; v.setUint8(o, 0xa8); o += 1; v.setUint32(o, 7777, true); o += 4; v.setUint8(o, 2); o += 1;
      for (const n of [f.x + 6, f.y + 1.3, f.z, f.x, f.y + 1.3, f.z]) { v.setFloat64(o, n, true); o += 8; }
      v.setUint32(o, targetId, true); o += 4; v.setUint16(o, damage, true); o += 2; v.setUint8(o, 0);
      window.__worldSocket.dispatchEvent(new MessageEvent('message', { data: buf }));
    };
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/?at=37.78790,-122.40750,90&preset=low&bot=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true' && window.__selfId, null, { timeout: 180_000 });
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.()); await page.waitForTimeout(600);
  if (await page.locator('.gt-age-gate').isVisible().catch(() => false)) { await page.locator('.gt-age-gate-enter').click(); }
  await page.waitForTimeout(4000); // combat samples preload
  const before = await page.evaluate(() => window.__starts.length);
  await page.evaluate(() => window.__injectHit(window.__selfId, 9)); await page.waitForTimeout(700);
  const self = await page.evaluate(n => ({ starts: window.__starts.slice(n), hp: window.__gtasfCombat?.state?.()?.health }), before);
  await page.evaluate(() => window.__injectHit(4242, 9)); await page.waitForTimeout(700);
  const other = await page.evaluate(n => window.__starts.slice(n), before + self.starts.length);
  const grunt = list => list.filter(ms => ms >= 180 && ms <= 360).length;
  console.log(`self hit: starts ${JSON.stringify(self.starts)} hp ${self.hp}; other hit: starts ${JSON.stringify(other)}; page errors ${errors.length}`);
  console.log(`RESULT ${grunt(self.starts) === 1 && grunt(other) === 1 ? 'PASS a grunt on the hit on us and on the nearby player' : 'FAIL'}`);
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser.close(); }
