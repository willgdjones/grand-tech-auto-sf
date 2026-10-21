// Load-robust in-session A/B (lane D): one phone-Low page (4x CPU throttle, ferry, 45 s warmup) with FORCE_FLAGS built in,
// then alternate a scene toggle every SWITCH_MS and bucket rAF frame times by state. Machine-load drift hits both states
// equally, so the delta is the toggled feature's cost even when absolute fps is load-depressed.
// Default toggle: hide/show every mesh named 'Crowd VAT *' (the crowdVat draw cost). Env: FORCE_FLAGS, TOGGLE (name prefix),
// ROUNDS (default 10), SWITCH_MS (default 5000), WARMUP_MS (default 45000), AT, APP_DIR, OUT (json path).
import { build, preview } from 'vite';
import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { startLocalPool } from './local-pool/pool.mjs';

const forceFlags = (process.env.FORCE_FLAGS ?? 'cc0People,crowdVat').split(',');
const unforceFlags = (process.env.UNFORCE_FLAGS ?? '').split(',').filter(Boolean); // built false (flag-off attribution)
const prefix = process.env.TOGGLE ?? 'Crowd VAT ', rounds = Number(process.env.ROUNDS ?? 10), switchMs = Number(process.env.SWITCH_MS ?? 5000);
const warmupMs = Number(process.env.WARMUP_MS ?? 45000), at = process.env.AT ?? '37.7955,-122.3937';
const app = resolve(process.env.APP_DIR ?? '/tmp/crowd-ab-app'), out = process.env.OUT ? resolve(process.env.OUT) : '';
let server, browser, pool;
try {
  if (!process.env.SKIP_BUILD) await build({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), logLevel: 'warn',
    plugins: [{ name: 'force-flags', enforce: 'pre', transform(code, id) { if (id !== resolve('shared/flags.ts')) return; let s = code;
      for (const f of forceFlags) s = s.replace(new RegExp(`\\b${f}:\\s*(?:true|false)\\b`), `${f}: true`);
      for (const f of unforceFlags) s = s.replace(new RegExp(`\\b${f}:\\s*(?:true|false)\\b`), `${f}: false`); return s; } }, ...(process.env.TRANSFORM ? [{ name: 'capture-transform', enforce: 'pre', transform(code, id) {
      // TRANSFORM='[{"file":"web/src/...","from":"exact","to":"replacement"}]': capture-only source edits (as _buildcap), e.g. force a tier.
      let out = code, hit = false;
      for (const e of JSON.parse(process.env.TRANSFORM)) if (id === resolve(e.file)) { if (!out.includes(e.from)) throw new Error(`TRANSFORM: '${e.from}' not in ${e.file}`); out = out.split(e.from).join(e.to); hit = true; }
      return hit ? out : undefined; } }] : [])],
    build: { outDir: app, emptyOutDir: true, reportCompressedSize: false } });
  pool = await startLocalPool();
  server = await preview({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), build: { outDir: app },
    preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: pool.url.origin, ws: true } } } });
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const context = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
  await context.addInitScript(v => { try { localStorage.setItem('gtasf.founder.v1', v); } catch {} }, JSON.stringify({ founded: true, startupName: 'Perf', foundedAt: Date.now(), billboardSeen: true }));
  // OUTFIT=n pins the saved outfit (4-7 = Meshy wardrobe bodies), e.g. so a Meshy-only feature (meshyTierDress) is present.
  if (process.env.OUTFIT) await context.addInitScript(v => { try { localStorage.setItem('gtasf.outfit', v); } catch {} }, process.env.OUTFIT);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/?at=${at}&preset=low&touch=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', undefined, { timeout: 180000 });
  for (let i = 0; i < 10; i++) { if (!(await page.locator('.gt-sa-intro').count())) break; await page.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click()); await page.waitForTimeout(400); }
  const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.waitForTimeout(warmupMs);
  const result = await page.evaluate(async ({ prefix, rounds, switchMs }) => {
    const scene = (() => { let s; for (const k of ['streetWalkers', 'ferryPedestrians']) { let o = window.__gtasf?.world?.[k]?.root; while (o?.parent) o = o.parent; if (o) s = o; } return s; })();
    // Toggle the matched meshes' PARENT groups: populations re-set per-mesh visibility every frame (empty-body culling).
    const matched = []; scene?.traverse(o => { if (o.name?.startsWith(prefix)) matched.push(o); });
    const targets = [...new Set(matched.map(o => o.parent ?? o))];
    const samples = { on: [], off: [] };
    for (let r = 0; r < rounds * 2; r++) {
      const state = r % 2 ? 'off' : 'on'; targets.forEach(o => { o.visible = state === 'on'; });
      await new Promise(res => setTimeout(res, 300)); // let the switch settle
      await new Promise(res => { let last = performance.now(); const end = last + switchMs; const f = t => { samples[state].push(t - last); last = t; if (t < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    }
    targets.forEach(o => { o.visible = true; });
    const stat = list => { const s = [...list].sort((a, b) => a - b), mean = s.reduce((a, b) => a + b, 0) / s.length; return { n: s.length, meanFps: +(1000 / mean).toFixed(1), p95Ms: +s[Math.floor(s.length * .95)].toFixed(1) }; };
    return { toggled: targets.length, meshes: matched.length, names: [...new Set(matched.map(o => o.name))].slice(0, 10), on: stat(samples.on), off: stat(samples.off) };
  }, { prefix, rounds, switchMs });
  result.errors = errors.slice(0, 5); result.forceFlags = forceFlags; result.unforceFlags = unforceFlags; result.prefix = prefix; result.at = at; result.when = new Date().toISOString();
  console.log('CROWD_AB ' + JSON.stringify(result));
  if (out) { await mkdir(dirname(out), { recursive: true }); await writeFile(out, JSON.stringify(result, null, 2) + '\n'); }
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser?.close(); try { await server?.httpServer?.close(); } catch {} try { await pool?.close(); } catch {} process.exit(); }
