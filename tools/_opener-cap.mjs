// guidedOpener evidence capture (gtasf-dzrrn): serves a prebuilt flags-on app (APP_DIR, from
// `PROD_FLAGS=1 FORCE_FLAGS=guidedOpener APP_DIR=… node tools/_buildcap.mjs`) against the local pool, opens it as a NEW
// device on the plain URL and walks the opener: call+move → highlighted car → in the car (drive GPS) → walk to the
// relocated Pear VC partner → the walk-up pitch. One screenshot per beat, then a reload to smoke "shows once".
// Env: APP_DIR (required), DEVICE=phone, OUTDIR (default docs/sf-data/guided-opener).
import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startLocalPool } from './local-pool/pool.mjs';
const app = resolve(process.env.APP_DIR), phone = process.env.DEVICE === 'phone', out = process.env.OUTDIR ?? 'docs/sf-data/guided-opener';
const tag = phone ? 'phone' : 'desktop', errors = [], log = (...a) => console.log(...a);
let pool, server, b;
try {
  pool = await startLocalPool();
  server = await preview({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), build: { outDir: app }, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: pool.url.origin, ws: true } } } });
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const c = await b.newContext(phone ? { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true } : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
  const p = await c.newPage();
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await mkdir(out, { recursive: true });
  const shot = async name => { const path = `${out}/${name}-${tag}.png`; await p.screenshot({ path, animations: 'disabled', timeout: 45_000 }); log(`SHOT ${path}`); };
  const state = () => p.evaluate(() => { const w = window.__gtasf?.world; const f = w?.foot; const banner = document.querySelector('.gt-opener-banner');
    return { x: f?.x, z: f?.z, mode: w?.mode, banner: banner && !banner.hidden ? banner.textContent : null, call: !document.querySelector('.gt-opener-call')?.hidden,
      quest: document.querySelector('.gt-founder-quest:not([hidden])')?.textContent ?? null, opener: localStorage.getItem('gtasf.opener.v1'),
      panel: Boolean(document.querySelector('.gt-controls-panel')) }; });
  const clearIntro = async () => { for (let i = 0; i < 10; i++) { const n = await p.evaluate(() => { const s = document.querySelector('.gt-sa-intro__skip'); s?.click(); const g = document.querySelector('.gt-identity-go'); if (g && g.checkVisibility()) g.click(); return Boolean(s); }); if (!n) break; await p.waitForTimeout(400); } };
  async function boot() {
    await p.goto(`${base}/?time=golden&${phone ? 'preset=low&touch=1' : 'gfx=hd'}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await clearIntro();
    await p.waitForFunction(() => { const w = window.__gtasf; if (!w?.ready) return false; if (document.querySelector('#world')?.dataset.connected !== 'true') return false;
      const l = document.querySelector('#loading'); return (!l || l.hidden || getComputedStyle(l).display === 'none') && /arial/i.test(getComputedStyle(document.body).fontFamily); }, undefined, { timeout: 120_000 });
    await clearIntro();
  }
  // Walk the server pose in small accepted steps (like qa-prod-playtest walkTo).
  async function walkTo(t, stop, maxMs = 120_000) {
    const t0 = Date.now(); let d = Infinity;
    while (Date.now() - t0 < maxMs) {
      d = await p.evaluate(({ t, stop }) => { const f = window.__gtasf.world.foot; const dx = t.x - f.x, dz = t.z - f.z, d = Math.hypot(dx, dz);
        if (d > stop) { const k = Math.min(0.7, d - stop + 0.1) / d; f.x += dx * k; f.z += dz * k; f.yaw = Math.atan2(dx, dz); } return d; }, { t, stop });
      if (d <= stop + 0.2) break; await p.waitForTimeout(110);
    }
    return Math.round(d);
  }
  await boot();
  await p.waitForFunction(() => { const b = document.querySelector('.gt-opener-banner'); return b && !b.hidden; }, undefined, { timeout: 45_000 });
  await p.waitForTimeout(1800);
  log('CALL', JSON.stringify(await state())); await shot('01-call-move');
  // Move: a few metres forward completes step 1.
  const f0 = await state(); await walkTo({ x: f0.x + 5, z: f0.z + 5 }, 0.5, 8000); await p.waitForTimeout(1500);
  log('CAR', JSON.stringify(await state())); await shot('02-highlighted-car');
  // Walk to the nearest drivable car (the one the opener highlights) and get in.
  const car = await p.evaluate(() => { const w = window.__gtasf.world, f = w.foot; let best = null, bd = Infinity;
    for (const c of w.fleet.cars.values()) { if (c.data.driverId || c.data.kind === 'robotaxi' || c.data.kind === 'bus' || c.data.kind === 'cable-car' || c.data.flags & 0x20) continue;
      const q = c.model.root.position, d = Math.hypot(q.x - f.x, q.z - f.z); if (d < bd) { bd = d; best = { x: q.x, z: q.z, d, kind: c.data.kind }; } } return best; });
  log('NEAREST CAR', JSON.stringify(car));
  if (car) { await walkTo(car, 2.6, 30_000); await p.waitForTimeout(600); await p.keyboard.press('KeyE');
    await p.waitForFunction(() => window.__gtasf.world.mode === 'driver', undefined, { timeout: 10_000 }).catch(() => log('did not enter car')); }
  await p.waitForTimeout(2500);
  log('DRIVE', JSON.stringify(await state())); await shot('03-drive-gps');
  // Out of the car and on to the partner (the opener's arrival fires on foot too).
  if ((await state()).mode !== 'on-foot') { await p.keyboard.press('KeyE'); await p.waitForFunction(() => window.__gtasf.world.mode === 'on-foot', undefined, { timeout: 10_000 }).catch(() => log('did not exit')); await p.waitForTimeout(1200); }
  const vc = await p.evaluate(() => window.__gtasf.world.founderPlazaInvestor?.position ?? null);
  log('PARTNER', JSON.stringify(vc));
  if (vc) { log('walked, left', await walkTo(vc, 16, 150_000), 'm'); await p.waitForTimeout(1200); }
  log('ARRIVED', JSON.stringify(await state())); await shot('04-arrived-partner');
  if (vc) { await walkTo(vc, 4, 10_000); await p.waitForTimeout(800); await p.keyboard.press('KeyE'); await p.waitForTimeout(2500); }
  log('PITCH', JSON.stringify({ ...(await state()), convo: await p.evaluate(() => Boolean(document.querySelector('.gt-convo:not([hidden])'))) })); await shot('05-pitch');
  // Smoke: the opener shows once — reload, it must not run again.
  await boot(); await p.waitForTimeout(12_000);
  const again = await state();
  log(`SMOKE once: opener key=${again.opener} banner-after-reload=${again.banner ? 'SHOWN (FAIL)' : 'none (PASS)'} panel=${again.panel}`);
  log(`ERRORS ${errors.length} ${JSON.stringify(errors.slice(0, 4))}`);
  await b.close(); await server.httpServer.close(); await pool.close(); process.exit(0);
} catch (e) { console.log(`FATAL ${e?.message ?? e}`); console.log(`ERRORS ${JSON.stringify(errors.slice(0, 4))}`); try { await b?.close(); } catch {} try { server?.httpServer?.close(); } catch {} try { await pool?.close(); } catch {} process.exit(5); }
