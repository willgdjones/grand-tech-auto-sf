// Draw calls per frame: what a police chase adds (lane B perf). Phone Low on a local combat stack; counts every WebGL
// draw (drawElements/drawArrays + instanced variants) per rAF frame, averaged over 90 frames: before combat, then at 3
// stars with cruisers + officers close (confessed crimes). Prints per-phase mean draws + instanced share.
//   GTASF_URL=http://localhost:5319 tools/heavy.sh node tools/_laneb-drawcalls.mjs
import { chromium } from '@playwright/test';

setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 300_000).unref();
const base = process.env.GTASF_URL ?? 'http://localhost:5319';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
  await context.addInitScript(() => {
    const W = window.WebSocket; window.WebSocket = class extends W { constructor(...a) { super(...a); if (/\/api\/world/.test(String(a[0]))) window.__worldSocket = this; } };
    window.__draws = { plain: 0, instanced: 0 };
    for (const proto of [WebGL2RenderingContext.prototype]) {
      for (const name of ['drawElements', 'drawArrays']) { const f = proto[name]; proto[name] = function (...a) { window.__draws.plain++; return f.apply(this, a); }; }
      for (const name of ['drawElementsInstanced', 'drawArraysInstanced']) { const f = proto[name]; proto[name] = function (...a) { window.__draws.instanced++; return f.apply(this, a); }; }
    }
  });
  const page = await context.newPage();
  await page.goto(`${base}/?at=37.78790,-122.40750,90&preset=low&bot=1&time=noon`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 180_000 });
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
  await page.waitForTimeout(30_000);
  const measure = () => page.evaluate(() => new Promise(resolve => {
    const rows = []; let n = 0;
    const frame = () => { const d = window.__draws; rows.push({ plain: d.plain, instanced: d.instanced }); d.plain = 0; d.instanced = 0; if (++n < 91) requestAnimationFrame(frame); else resolve(rows.slice(1)); };
    window.__draws.plain = 0; window.__draws.instanced = 0; requestAnimationFrame(frame);
  }));
  const summary = rows => { const p = rows.reduce((a, r) => a + r.plain, 0) / rows.length, i = rows.reduce((a, r) => a + r.instanced, 0) / rows.length; return `draws/frame ${(p + i).toFixed(0)} (plain ${p.toFixed(0)}, instanced ${i.toFixed(0)})`; };
  const idle = await measure();
  console.log(`idle (no combat): ${summary(idle)}`);
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.()); await page.waitForTimeout(600);
  if (await page.locator('.gt-age-gate').isVisible().catch(() => false)) { await page.locator('.gt-age-gate-enter').click(); await page.waitForTimeout(1500); }
  for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__worldSocket?.send(Uint8Array.of(0x25, 0))); await page.waitForTimeout(1200); }
  await page.waitForTimeout(15_000);
  const near = await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot; let n = 0; for (const c of w.fleet?.cars?.values?.() ?? []) if (c.data.flags & 0x40 && Math.hypot(c.model.root.position.x - f.x, c.model.root.position.z - f.z) < 40) n++; return { police: n, officers: w.policeOfficers?.root?.children?.length ?? null }; });
  const chase = await measure();
  console.log(`3-star chase (${JSON.stringify(near)}): ${summary(chase)}`);
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser.close(); }
