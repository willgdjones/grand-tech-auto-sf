// Lane B (critic N13j residual): what does seating a new traffic driver cost on a phone? Loads the default Ferry arrival on
// the phone profile with a 4x CPU throttle, records every frame for SECONDS after READY with the driver-slot count, and
// prints each slot's split (window.__gtasfDriverBake: instance+settle ms, bake ms, cache misses) plus the long frames
// (> 50 ms) and whether a new slot landed in them.
//   GTASF_COMBAT_URL=http://localhost:5393 node tools/_laneb-driver-bake.mjs
import { chromium } from '@playwright/test';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5393';
const SECONDS = Number(process.env.SECONDS ?? 20), THROTTLE = Number(process.env.THROTTLE ?? 4);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1080, height: 2400 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
const page = await ctx.newPage(); page.setDefaultTimeout(120_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
const cdp = await ctx.newCDPSession(page);
await page.goto(`${base}/?preset=low&bot=1`);
await page.waitForFunction(() => window.__gtasf?.ready, null, { timeout: 180_000 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
const r = await page.evaluate(seconds => new Promise(resolve => {
  const frames = [], start = performance.now(); let last = start;
  const tick = () => { const now = performance.now(); frames.push([+(now - start).toFixed(0), +(now - last).toFixed(1), window.__gtasfDriverBake?.slots ?? -1]); last = now;
    if (now - start < seconds * 1000) requestAnimationFrame(tick); else resolve({ frames, stats: window.__gtasfDriverBake ?? null }); };
  requestAnimationFrame(tick);
}), SECONDS);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
const s = r.stats;
console.log(`slots ${s?.slots}; per slot: create(ms) ${JSON.stringify(s?.createMs)} bake(ms) ${JSON.stringify(s?.bakeMs)} misses ${JSON.stringify(s?.bakeMisses)} rebake(ms) ${JSON.stringify(s?.rebakeMs)}`);
const long = r.frames.map((f, i) => ({ t: f[0], ms: f[1], newSlot: i > 0 && f[2] > r.frames[i - 1][2] ? f[2] - r.frames[i - 1][2] : 0 })).filter(f => f.ms > 50);
const sorted = r.frames.map(f => f[1]).sort((a, b) => a - b);
console.log(`frames ${r.frames.length}, median ${sorted[sorted.length >> 1]} ms; long (>50 ms): ${long.length}, with a new slot: ${long.filter(f => f.newSlot).length}`);
console.log(`worst: ${JSON.stringify(long.sort((a, b) => b.ms - a.ms).slice(0, 10))}`);
console.log(`errors=${JSON.stringify(errors)}`);
await browser.close();
