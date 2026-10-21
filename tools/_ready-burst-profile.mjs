// gtasf-qvajw: what burns the CPU in READY..READY+6 s on phone Low (4x CPU throttle, like the phone-perf gate)?
// CDP CPU profile over that window, aggregated by function+file self time (bottom-up). Read-only against BASE.
//   tools/heavy.sh node tools/_ready-burst-profile.mjs        (BASE=https://gtasf.pages.dev default)
import { chromium } from '@playwright/test';
setTimeout(() => { console.log('watchdog'); process.exit(2); }, 240_000).unref();
const base = process.env.BASE ?? 'https://gtasf.pages.dev';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { window.__lt = []; try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch {} });
const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await page.goto(`${base}/?bot=1&preset=low`);
await page.waitForFunction(() => window.__gtasf?.ready, null, { timeout: 180000, polling: 25 });
const readyAt = await page.evaluate(() => performance.now());
await cdp.send('Profiler.start'); await page.waitForTimeout(6000);
const { profile } = await cdp.send('Profiler.stop');
const lt = await page.evaluate(r => window.__lt.filter(([s]) => s >= r && s < r + 6000), readyAt);
console.log(`long tasks READY..+6s: ${lt.length}, total ${Math.round(lt.reduce((a, [, d]) => a + d, 0))} ms, max ${Math.round(Math.max(0, ...lt.map(([, d]) => d)))} ms`);
// self time per node from samples
const byId = new Map(profile.nodes.map(n => [n.id, n])), self = new Map();
const dt = profile.timeDeltas; for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + (dt[i] ?? 0) / 1000);
const agg = new Map();
for (const [id, ms] of self) { const f = byId.get(id).callFrame; const file = (f.url || '').split('/').pop() || '(native)'; const key = `${f.functionName || '(anon)'} @ ${file}:${f.lineNumber + 1}`; agg.set(key, (agg.get(key) ?? 0) + ms); }
const total = [...agg.values()].reduce((a, b) => a + b, 0);
console.log(`sampled ${Math.round(total)} ms`);
for (const [k, ms] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`${ms.toFixed(0).padStart(6)} ms  ${k}`);
// inclusive: top-level scripts by summing descendants is costly; also report by file
const byFile = new Map(); for (const [id, ms] of self) { const f = byId.get(id).callFrame; const file = (f.url || '').split('/').pop() || '(native)'; byFile.set(file, (byFile.get(file) ?? 0) + ms); }
// gtasf-qvajw: who calls the road-graph edge materialisation? Walk each sample up to the first frame outside the pack line.
const parent = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const callers = new Map(), PACK_LINE = Number(process.env.PACK_LINE ?? 6480);
for (const [id, ms] of self) { const f = byId.get(id).callFrame; if (f.lineNumber + 1 !== PACK_LINE) continue;
  let p = parent.get(id), chain = [];
  while (p !== undefined) { const pf = byId.get(p).callFrame; if (pf.lineNumber + 1 !== PACK_LINE && pf.url) { chain.push(`${pf.functionName || '(anon)'}:${pf.lineNumber + 1}`); if (chain.length >= 3) break; } p = parent.get(p); }
  const key = chain.join(' <- ') || '(top)'; callers.set(key, (callers.get(key) ?? 0) + ms); }
console.log('-- callers of the road-pack line --'); for (const [k, ms] of [...callers].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`${ms.toFixed(0).padStart(6)} ms  ${k}`);
console.log('-- by file --'); for (const [k, ms] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`${ms.toFixed(0).padStart(6)} ms  ${k}`);
await b.close();
