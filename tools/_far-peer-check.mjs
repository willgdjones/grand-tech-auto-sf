// Lane D: far remote player on phone Low renders as a VAT body (peerImpostors + crowdVat). Builds the current tree (dev
// flags), starts a local pool + preview, opens observer A (phone Low, ferry plaza facing east) and remote B ~25 m east,
// waits, screenshots A and probes A's 'Low far-player silhouettes' root for live VAT instances. Env: OUT, APP_DIR, SKIP_BUILD.
import { build, preview } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startLocalPool } from './local-pool/pool.mjs';

const out = resolve(process.env.OUT ?? 'docs/sf-data/character-bakeoff'), app = resolve(process.env.APP_DIR ?? '/tmp/far-peer-app');
const A = '37.79558,-122.39480,90', B = '37.79558,-122.39452,270';
let server, browser, pool;
try {
  if (!process.env.SKIP_BUILD) await build({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), logLevel: 'warn', build: { outDir: app, emptyOutDir: true, reportCompressedSize: false } });
  pool = await startLocalPool();
  server = await preview({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), build: { outDir: app }, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: pool.url.origin, ws: true } } } });
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const founded = JSON.stringify({ founded: true, startupName: 'Peer', foundedAt: Date.now(), billboardSeen: true });
  async function open(label, at, phone) {
    const ctx = await browser.newContext(phone ? { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(v => { try { localStorage.setItem('gtasf.founder.v1', v); } catch {} }, founded);
    const page = await ctx.newPage();
    await page.goto(`${base}/?at=${at}&${phone ? 'preset=low&touch=1' : 'gfx=low'}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', undefined, { timeout: 180000 });
    for (let i = 0; i < 10; i++) { if (!(await page.locator('.gt-sa-intro').count())) break; await page.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click()); await page.waitForTimeout(400); }
    try { const g = page.locator('.gt-identity-go'); if (await g.isVisible({ timeout: 1500 })) await g.click({ timeout: 6000 }); } catch {}
    console.log(`READY ${label}`); return page;
  }
  const a = await open('A', A, true), b = await open('B', B, false);
  await a.waitForTimeout(12000);
  const probe = await a.evaluate(() => {
    let scene; const w = window.__gtasf?.world; for (const k of ['ferryPedestrians', 'streetWalkers']) { let o = w?.[k]?.root; while (o?.parent) o = o.parent; if (o) scene = o; }
    const root = scene?.getObjectByName('Low far-player silhouettes'); if (!root) return { root: false };
    const meshes = []; root.traverse(o => { if (o.isInstancedMesh) { let live = 0; const m = o.instanceMatrix.array; for (let i = 0; i < o.count; i++) if (Math.abs(m[i * 16]) + Math.abs(m[i * 16 + 5]) > .01) live++; meshes.push({ name: o.name, visible: o.visible, live }); } });
    return { root: true, meshes: meshes.filter(m => m.live || m.name.startsWith('Crowd VAT')).map(m => `${m.name}:${m.live}${m.visible ? '' : '(hidden)'}`) };
  });
  console.log('PROBE ' + JSON.stringify(probe));
  await mkdir(out, { recursive: true });
  await a.screenshot({ path: resolve(out, 'far-peer-vat-phone.png') });
  console.log('OK far-peer');
  void b;
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser?.close(); try { await server?.httpServer?.close(); } catch {} try { await pool?.close(); } catch {} process.exit(); }
