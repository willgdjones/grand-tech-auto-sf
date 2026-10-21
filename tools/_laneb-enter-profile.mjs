// Lane B (gtasf-9jl2j follow-up): what stalls the FIRST car entry for ~1.1-1.5 s? CPU-profiles the 3 s around the first
// E press (CDP Profiler) plus long tasks, then resolves the hottest self-time locations through the build's sourcemaps
// (build the stack with `vite build --sourcemap`). Prints the long tasks and the top self-time source locations.
//   GTASF_COMBAT_URL=http://localhost:5393 DIST=/tmp/<snap>/web/dist node tools/_laneb-enter-profile.mjs
import { chromium } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { SourceMapConsumer } from 'source-map-js';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5393';
const dist = process.env.DIST ?? '/tmp/gtasf-laneb-seat/web/dist';
const SPAWN = process.env.GTASF_SEAT_AT ?? '37.80199520213967,-122.41963019831591,87.8';
const TOP = Number(process.env.TOP ?? 25);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
async function clearOnboarding() {
  for (let i = 0; i < 20; i++) {
    const b = await page.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); };
      return { intro: v('.gt-sa-intro') || v('.gt-sa-intro__skip'), id: v('.gt-identity-go'), fund: !!document.querySelector('.gt-funding-onboarding[open]') }; });
    if (!b.intro && !b.id && !b.fund) break;
    if (b.id) { try { await page.locator('.gt-identity-go').click({ timeout: 3000 }); } catch {} }
    else await page.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click());
    await page.waitForTimeout(500);
  }
}
await page.goto(`${base}/?at=${SPAWN}&preset=low&bot=1`);
await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 120_000 });
await clearOnboarding(); await page.waitForTimeout(8000); await clearOnboarding(); // let boot-time one-offs settle
const cdp = await ctx.newCDPSession(page);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await page.evaluate(() => { window.__long = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: false }); window.__t0 = performance.now(); });
let entered = false;
await cdp.send('Profiler.start');
for (let i = 0; i < 5 && !entered; i++) {
  await page.keyboard.press('KeyE'); await page.waitForTimeout(1200);
  entered = await page.evaluate(() => window.__gtasf.world.mode !== 'on-foot');
}
await page.waitForTimeout(2000);
const { profile } = await cdp.send('Profiler.stop');
const longs = await page.evaluate(() => window.__long.map(([s, d]) => [s - Math.round(window.__t0), d]));
console.log(`entered: ${entered}; long tasks (ms after start, duration): ${JSON.stringify(longs)}`);
// Self time per node -> (url, line, col, name).
const byId = new Map(profile.nodes.map(n => [n.id, n]));
const self = new Map(); const dt = profile.timeDeltas; let total = 0;
for (let i = 0; i < profile.samples.length; i++) { const id = profile.samples[i], d = (dt[i + 1] ?? 0) / 1000; total += d; self.set(id, (self.get(id) ?? 0) + d); }
const maps = new Map();
const resolve = (url, line, col) => {
  const file = url.split('/').pop()?.split('?')[0]; if (!file || !file.endsWith('.js')) return null;
  if (!maps.has(file)) { const p = `${dist}/assets/${file}.map`; maps.set(file, existsSync(p) ? new SourceMapConsumer(JSON.parse(readFileSync(p, 'utf8'))) : null); }
  const m = maps.get(file); if (!m) return null;
  const o = m.originalPositionFor({ line: line + 1, column: col }); return o.source ? `${o.source.replace(/^.*?(web\/src|shared|node_modules)\//, '$1/')}:${o.line}${o.name ? ` ${o.name}` : ''}` : null;
};
const agg = new Map();
for (const [id, ms] of self) {
  const n = byId.get(id), f = n.callFrame;
  const key = f.url ? (resolve(f.url, f.lineNumber, f.columnNumber) ?? `${f.url.split('/').pop()}:${f.lineNumber} ${f.functionName}`) : `(${f.functionName || 'native'})`;
  agg.set(key, (agg.get(key) ?? 0) + ms);
}
console.log(`profile ${Math.round(total)} ms; top self time:`);
for (const [k, ms] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`${ms.toFixed(0).padStart(6)} ms  ${k}`);
await browser.close();
