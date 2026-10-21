// SFPD livery check (flag sfpdLook): take 3 stars (confessed crimes on the world socket), let cruisers arrive, then for
// every police car count its 'body' meshes (one per LOD level; phone Low adds the HD level lazily when a car comes close)
// and how many are painted black. PASS when every body of every cruiser is black, desktop HD and phone Low.
//   GTASF_URL=http://localhost:5319 tools/heavy.sh node tools/_laneb-livery-check.mjs   (or https://gtasf.com)
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 560_000).unref();
const base = process.env.GTASF_URL ?? 'http://localhost:5319';
const out = resolve(process.env.OUT ?? 'docs/sf-data/combat/sfpd-livery');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
let ok = true;
try {
  for (const [device, opts, preset] of [['desktop', { viewport: { width: 1280, height: 800 } }, 'hd'], ['phone', { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true }, 'low']]) {
    const context = await browser.newContext(opts);
    await context.addInitScript(() => { const W = window.WebSocket; window.WebSocket = class extends W {
      constructor(...a) { super(...a); if (/\/api\/world/.test(String(a[0]))) window.__worldSocket = this; }
      send(data) { if (this === window.__worldSocket && window.__muteSend) return; return super.send(data); } }; });
    const page = await context.newPage();
    await page.goto(`${base}/?at=37.78790,-122.40750,90&preset=${preset}&bot=1&time=noon`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 180_000 });
    for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
    await page.evaluate(() => window.__gtasfCombat?.requestCombat?.()); await page.waitForTimeout(600);
    if (await page.locator('.gt-age-gate').isVisible().catch(() => false)) { await page.locator('.gt-age-gate-enter').click(); await page.waitForTimeout(1200); }
    for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__worldSocket?.send(Uint8Array.of(0x25, 0))); await page.waitForTimeout(1200); }
    let last = null;
    for (let t = 0; t < 24; t++) {
      await page.waitForTimeout(2500);
      last = await page.evaluate(() => {
        const w = window.__gtasf.world, f = w.foot, rows = [];
        for (const c of w.fleet?.cars?.values?.() ?? []) if (c.data.flags & 0x40) {
          const p = c.model.root.position; let bodies = 0, black = 0;
          c.model.root.traverse(o => { if (o.isMesh && o.name === 'body') { bodies++; const m = Array.isArray(o.material) ? o.material[0] : o.material; if (m?.color && m.color.r < 0.12 && m.color.g < 0.12 && !m.map) black++; } });
          rows.push({ d: Math.round(Math.hypot(p.x - f.x, p.z - f.z)), kind: c.data.kind, bodies, black });
        }
        return rows.sort((a, b) => a.d - b.d);
      });
      // Phone Low only gets a second (HD) body once the nearest car's HD glb has loaded: wait for that case.
      if (last.length && last[0].d < 12 && (device === 'desktop' || last.some(r => r.bodies > 1))) break;
      // carNearDetail gives the one HD swap to a car within ~6 m of the player (visibleLod.ts); cruisers often hold 9-10 m
      // off, so after 25 s step the LOCAL player 3 m from the nearest one (sends muted so the server can't pull us back).
      if (device === 'phone' && t >= 10 && last.length && !last.some(r => r.bodies > 1)) await page.evaluate(() => {
        const w = window.__gtasf.world, f = w.foot; let best = null, bd = Infinity;
        for (const c of w.fleet?.cars?.values?.() ?? []) if (c.data.flags & 0x40) { const p = c.model.root.position, d = Math.hypot(p.x - f.x, p.z - f.z); if (d < bd) { bd = d; best = p; } }
        if (best && bd > 4) { window.__muteSend = true; const k = 3 / bd; f.x = best.x + (f.x - best.x) * k; f.z = best.z + (f.z - best.z) * k; }
      });
    }
    await page.screenshot({ path: resolve(out, `${device}.jpg`), quality: 80 });
    const pass = last.length > 0 && last.every(r => r.black === r.bodies) && (device === 'desktop' || last.some(r => r.bodies > 1));
    if (!pass) ok = false;
    console.log(`${device}: cruisers ${JSON.stringify(last.slice(0, 4))} -> ${pass ? 'all bodies black' : 'UNPAINTED level (or phone HD level never added)'}`);
    await context.close();
  }
} catch (e) { ok = false; console.log('FATAL ' + (e?.stack ?? e)); }
finally { await browser.close(); console.log(`RESULT ${ok ? 'PASS' : 'FAIL'}`); }
