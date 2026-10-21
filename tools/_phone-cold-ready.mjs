// gtasf-ep30n: how long does a cold phone visit take to reach READY on prod, and where does the time go?
// Phone context (393x873 @2.75, touch), 4x CPU, CDP network throttle, empty cache. Read-only (?bot=1 keeps the funnel clean).
//   MBPS=9 RTT=60 tools/heavy.sh node tools/_phone-cold-ready.mjs     (BASE=https://gtasf.pages.dev default)
import { chromium } from '@playwright/test';
setTimeout(() => { console.log('watchdog 360 s'); process.exit(2); }, 360_000).unref();
const base = process.env.BASE ?? 'https://gtasf.pages.dev', mbps = Number(process.env.MBPS ?? 9), rtt = Number(process.env.RTT ?? 60);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await ctx.addInitScript(() => { window.__lt = []; try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch {} });
await ctx.addInitScript(() => { const watch = () => { const el = document.querySelector('#loading'); if (!el) return requestAnimationFrame(watch);
  new MutationObserver(() => { if (el.hidden && !window.__hiddenAt) window.__hiddenAt = performance.now(); }).observe(el, { attributes: true, attributeFilter: ['hidden'] }); };
  document.addEventListener('DOMContentLoaded', watch); });
await ctx.addInitScript(() => { const t = setInterval(() => { if (window.__gtasf?.ready) { window.__readyAt = performance.now(); clearInterval(t); } }, 16); });
await ctx.addInitScript(() => { window.__fetchLog = []; const f = window.fetch; window.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (url.includes('/api/')) window.__fetchLog.push([Math.round(performance.now()), url.replace(location.origin, '').split('?')[0]]);
  return f.call(this, input, init); }; });
const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page);
const consoleNotes = []; page.on('console', m => { const t = m.text(); if (/routing|worker/i.test(t) && m.type() !== 'debug') consoleNotes.push(`${m.type()}: ${t.slice(0, 140)}`); }); /* __consoleRouting */
await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: rtt, downloadThroughput: mbps * 125_000, uploadThroughput: 1.5 * 125_000 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const reqs = new Map(); let bytes = 0; const t0 = Date.now(), timeline = [];
const ws = [];
cdp.on('Network.webSocketCreated', e => ws.push(`created@${Date.now() - t0} ${e.url.replace(/^wss?:\/\/[^/]+/, '').slice(0, 40)}`));
cdp.on('Network.webSocketHandshakeResponseReceived', () => ws.push(`open@${Date.now() - t0}`));
let frames = 0; cdp.on('Network.webSocketFrameReceived', () => { if (frames++ < 3) ws.push(`rx${frames}@${Date.now() - t0}`); });
cdp.on('Network.webSocketFrameSent', () => { if (!ws.some(w => w.startsWith('tx'))) ws.push(`tx1@${Date.now() - t0}`); });
const apis = []; cdp.on('Network.requestWillBeSent', e => { if (/\/api\//.test(e.request.url)) apis.push([e.requestId, e.request.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0], Date.now() - t0]); });
const apiDone = new Map(); cdp.on('Network.loadingFinished', e => apiDone.set(e.requestId, Date.now() - t0));
cdp.on('Network.responseReceived', e => reqs.set(e.requestId, e.response.url));
cdp.on('Network.loadingFinished', e => { bytes += e.encodedDataLength; const url = reqs.get(e.requestId) ?? ''; if (e.encodedDataLength > 250_000) timeline.push([Date.now() - t0, Math.round(e.encodedDataLength / 1e3), url.replace(/^https?:\/\/[^/]+/, '').slice(0, 70)]); });
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
const PROFILE = { from: Number(process.env.FROM ?? 1800), to: Number(process.env.TO ?? 5000) };
await page.goto(`${base}/?bot=1${process.env.QUERY ?? ''}`, { waitUntil: 'commit' }); // QUERY e.g. '&time=noon'
const hiddenWait = page.waitForFunction(() => window.__hiddenAt, null, { timeout: 230_000, polling: 50 }).then(async () => {
  await page.waitForTimeout(300); if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, type: 'jpeg', quality: 70 }); });
await page.waitForFunction(() => window.__gtasf?.ready, null, { timeout: 230_000, polling: 100 });
const readyMs = Date.now() - t0, bytesAtReady = bytes;
if (process.env.WAIT_ROUTING) { // how long after READY until routes (event picks, GPS) work
  for (let i = 0; i < 4 && process.env.ROUTING_SHOT; i++) { await page.getByText('SKIP', { exact: true }).click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(800); } // dev builds show the intro comic
  const at = await page.waitForFunction(() => performance.getEntriesByName('gtasf:routing-ready')[0]?.startTime, null, { timeout: 120_000, polling: 250 }).then(h => h.jsonValue()).catch(() => null);
  console.log(`routing-ready at ${at === null ? 'not within 120 s' : Math.round(at) + ' ms'} (READY observed at ${readyMs} ms wall)`);
  console.log('marks after READY:', (await page.evaluate(() => performance.getEntriesByType('mark').filter(m => m.startTime > (window.__readyAt ?? 0) - 50).map(m => `${m.name.replace('gtasf:', '')}@${Math.round(m.startTime)}`))).join('  '));
  if (process.env.ROUTING_SHOT && at !== null) {
    for (let i = 0; i < 6 && await page.getByText(/tap to continue|press any key/i).first().isVisible().catch(() => false); i++) {
      await page.getByRole('button', { name: /skip/i }).first().tap({ timeout: 1500 }).catch(() => page.getByText('SKIP', { exact: true }).first().click({ timeout: 1500 }).catch(() => {}));
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(400); await page.screenshot({ path: process.env.ROUTING_SHOT, type: 'jpeg', quality: 70 });
  }
  console.log('routing/worker console:', consoleNotes.length ? consoleNotes.join(' | ') : '(none)');
  console.log('rIC available:', await page.evaluate(() => typeof requestIdleCallback)); }
await hiddenWait.catch(() => {});
const gap = await page.evaluate(() => ({ hiddenAt: Math.round(window.__hiddenAt ?? -1), readyAt: Math.round(window.__readyAt ?? -1) }));
console.log(`loading card hidden at ${gap.hiddenAt} ms; animation loop start (harness READY) at ${gap.readyAt} ms (page time) -> frozen ${gap.readyAt - gap.hiddenAt} ms`);
const { profile } = await cdp.send('Profiler.stop');
{ // self time per function for samples whose page time (performance.now) falls in [FROM, TO]
  const navAt = await page.evaluate(() => performance.timeOrigin), byId = new Map(profile.nodes.map(n => [n.id, n])), agg = new Map();
  let t = profile.startTime / 1000;
  if (process.env.WINDOW_MARKS) { // profile the window between two page marks of THIS run (e.g. world-ready,loop-start)
    const [a, b] = process.env.WINDOW_MARKS.split(','), at = await page.evaluate(n => n.map(m => performance.getEntriesByName('gtasf:' + m)[0]?.startTime ?? null), [a, b]);
    if (at[0] !== null && at[1] !== null) { PROFILE.from = at[0]; PROFILE.to = at[1]; console.log(`window ${a}@${Math.round(at[0])} .. ${b}@${Math.round(at[1])}`); } }
  // profile timestamps are monotonic (us); align by the first sample after the first boot mark is not possible, so use relative-to-profile-start
  for (let i = 0; i < profile.samples.length; i++) { t += profile.timeDeltas[i] / 1000; const rel = t - profile.startTime / 1000;
    if (rel < PROFILE.from || rel > PROFILE.to) continue; const f = byId.get(profile.samples[i]).callFrame;
    const key = `${f.functionName || '(anon)'} @ ${(f.url || '').split('/').pop() || '(native)'}:${f.lineNumber + 1}`; agg.set(key, (agg.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000); }
  console.log(`CPU self time, ${PROFILE.from}..${PROFILE.to} ms after profiler start (~navigation):`);
  if (process.env.CALLERS_OF) { // whose calls make a hot function hot: group its in-window self time by the nearest different caller
    const parent = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const want = process.env.CALLERS_OF, by = new Map(); let tt = profile.startTime / 1000;
    for (let i = 0; i < profile.samples.length; i++) { tt += profile.timeDeltas[i] / 1000; const rel = tt - profile.startTime / 1000;
      if (rel < PROFILE.from || rel > PROFILE.to) continue; const node = byId.get(profile.samples[i]); if (node.callFrame.functionName !== want) continue;
      const chain = []; for (let p = parent.get(node.id); p !== undefined && chain.length < 3; p = parent.get(p)) { const f = byId.get(p).callFrame; if (f.functionName !== want) chain.push(`${f.functionName || '(anon)'}:${f.lineNumber + 1}`); }
      const k = chain.join(' <- '); by.set(k, (by.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000); }
    console.log(`callers of ${want}:`); for (const [k, ms] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${ms.toFixed(0).padStart(5)} ms  ${k}`); }
  for (const [k, ms] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.TOPN ?? 18))) console.log(`  ${ms.toFixed(0).padStart(5)} ms  ${k}`);
  if (process.env.LT_TOP) { // per long task >= LT_TOP ms in the window: its top self-time functions + the hottest one's callers
    const parent = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const frame = id => { const f = byId.get(id).callFrame; return `${f.functionName || '(anon)'}@${(f.url || '').split('/').pop() || '(native)'}:${f.lineNumber + 1}`; };
    const tasks = (await page.evaluate(() => window.__lt)).filter(([s, d]) => d >= Number(process.env.LT_TOP ?? 200) && s + d > PROFILE.from && s < PROFILE.to);
    console.log(`long tasks >= ${process.env.LT_TOP} ms, attributed:`);
    for (const [s0, d] of tasks) { const self = new Map(), via = new Map(); let tt = profile.startTime / 1000;
      for (let i = 0; i < profile.samples.length; i++) { tt += profile.timeDeltas[i] / 1000; const rel = tt - profile.startTime / 1000;
        if (rel < s0 || rel > s0 + d) continue; const id = profile.samples[i], ms = (profile.timeDeltas[i] ?? 0) / 1000;
        self.set(frame(id), (self.get(frame(id)) ?? 0) + ms);
        // the innermost game-code frame (nearest the leaf): the subsystem code that called into three/native for this sample
        let top = null; for (let p = id; p !== undefined && !top; p = parent.get(p)) { const u = byId.get(p).callFrame.url || ''; if (/game-|landmarks-|main/.test(u)) top = frame(p); }
        if (top) via.set(top, (via.get(top) ?? 0) + ms); }
      const fmt = m => [...m].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' | ');
      console.log(`  ${s0}+${d}: self ${fmt(self)} || game ${fmt(via)}`); } }
}
console.log('long tasks (start ms, duration):', (await page.evaluate(() => window.__lt)).filter(([s, d]) => s + d > PROFILE.from && s < PROFILE.to).map(([s, d]) => `${s}+${d}`).join('  '));
const hiddenAt = await page.evaluate(() => document.querySelector('#loading')?.hidden);
const marks = await page.evaluate(() => performance.getEntriesByType('mark').filter(m => m.name.startsWith('gtasf:')).map(m => [m.name.replace('gtasf:', ''), Math.round(m.startTime)]));
console.log(`network ${mbps} Mbps / ${rtt} ms RTT, 4x CPU, cold cache`);
console.log(`READY ${(readyMs / 1000).toFixed(1)} s, ${(bytesAtReady / 1e6).toFixed(1)} MB transferred before READY`);
console.log('marks (ms since navigation):', marks.map(([n, t]) => `${n}@${t}`).join('  '));
console.log('files > 250 kB (finished at ms, kB, path):'); for (const r of timeline.sort((a, b) => a[0] - b[0])) console.log('  ', r.join('  '));
console.log('fetch() called (ms since navigation):', (await page.evaluate(() => window.__fetchLog)).slice(0, 12).map(([t, u]) => `${u}@${t}`).join('  '));
console.log('websocket:', ws.join('  '), '| loading hidden at READY:', hiddenAt);
console.log('api (start..end ms):'); for (const [id, path, t] of apis) console.log('  ', path, `${t}..${apiDone.get(id) ?? '?'}`);
await b.close();
