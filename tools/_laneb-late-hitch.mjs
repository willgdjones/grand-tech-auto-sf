// Lane B (N13j follow-up): what are the 400-900 ms frames 6-14 s after READY on a 4x phone (default Ferry arrival)?
// gtasf-qvajw attributed READY..+6 s; this takes the later window. CDP CPU profile from READY+FROM to READY+TO; for every
// long task over MIN_MS it buckets the samples inside it by call stack (outermost named frames, file:line:col), so each
// big hitch gets named. Look a frame up in the built chunk (web/dist/assets/<file>) at that line:col.
//   GTASF_COMBAT_URL=http://localhost:5393 node tools/_laneb-late-hitch.mjs     (FROM=6 TO=14 MIN_MS=250 THROTTLE=4)
import { chromium } from '@playwright/test';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5393';
const FROM = Number(process.env.FROM ?? 6) * 1000, TO = Number(process.env.TO ?? 14) * 1000;
const MIN_MS = Number(process.env.MIN_MS ?? 250), THROTTLE = Number(process.env.THROTTLE ?? 4);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1080, height: 2400 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { window.__lt = []; try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch {} });
const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page); page.setDefaultTimeout(180_000);
await page.goto(`${base}/?preset=low&bot=1`);
await page.waitForFunction(() => window.__gtasf?.ready, null, { timeout: 180_000, polling: 25 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start'); await page.waitForTimeout(TO);
const { profile } = await cdp.send('Profiler.stop');
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
// Long tasks straight from the profile: an unbroken run of non-idle samples. (Page-clock alignment fails at 4x: every
// page.evaluate waits behind the very tasks we want, so its timestamps drift by seconds.)
const byId = new Map(profile.nodes.map(n => [n.id, n])), parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const frameKey = f => `${f.functionName || '(anon)'}@${(f.url || '').split('/').pop() || 'native'}:${f.lineNumber + 1}:${f.columnNumber + 1}`;
const stackOf = id => { const out = []; for (let p = id; p !== undefined; p = parent.get(p)) { const f = byId.get(p).callFrame; if (f.url) out.push(frameKey(f)); } return out.reverse(); };
let t = 0; const samples = profile.samples.map((id, i) => { t += (profile.timeDeltas[i] ?? 0) / 1000; return [t, id]; });
const runs = []; let run = null;
for (const [at, id] of samples) {
  const idle = byId.get(id).callFrame.functionName === '(idle)';
  if (!idle) { if (!run) run = { start: at, end: at, ids: [] }; run.end = at; run.ids.push(id); }
  else if (run) { runs.push(run); run = null; }
}
if (run) runs.push(run);
const long = runs.filter(r => r.end - r.start >= MIN_MS && r.start >= FROM);
console.log(`profile ${(t / 1000).toFixed(1)} s from READY, ${samples.length} samples; busy runs >= ${MIN_MS} ms after +${FROM / 1000} s: ${long.length} [${long.map(r => `+${(r.start / 1000).toFixed(1)}s ${Math.round(r.end - r.start)}ms`).join(', ')}]`);
for (const r of long.sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 4)) {
  const buckets = new Map(), leaf = new Map();
  for (const id of r.ids) { const key = stackOf(id).slice(0, 8).join(' > ') || `(${byId.get(id).callFrame.functionName || 'native'})`; buckets.set(key, (buckets.get(key) ?? 0) + 1);
    const k = frameKey(byId.get(id).callFrame); leaf.set(k, (leaf.get(k) ?? 0) + 1); }
  console.log(`\n== run +${(r.start / 1000).toFixed(1)} s, ${Math.round(r.end - r.start)} ms, ${r.ids.length} samples`);
  for (const [k, n] of [...buckets].sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`  ${(100 * n / r.ids.length).toFixed(0).padStart(3)}%  ${k}`);
  console.log(`  leaves: ${[...leaf].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${(100 * n / r.ids.length).toFixed(0)}% ${k}`).join(' | ')}`);
}
await browser.close();
