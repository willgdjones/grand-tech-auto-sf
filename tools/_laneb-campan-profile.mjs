// gtasf-kd2rv: does a moving camera alone cost phone Low ~2x p95? Phone Low (1080x2400 DPR 2.75, 4x CPU throttle) at the
// Ferry spawn, 45 s warmup, then 10 s static / 10 s pitch wiggle (camera.look ±1.5 px alternating each frame: the camera
// moves every frame but the view stays put, like recoil) /
// 10 s static. Per phase: rAF frame-time mean + p95 and a CPU profile's top self-time functions.
//   GTASF_URL=http://localhost:5319 tools/heavy.sh node tools/_laneb-campan-profile.mjs
import { chromium } from '@playwright/test';

setTimeout(() => { console.log("RESULT watchdog"); process.exit(2); }, 480_000).unref();
const base = process.env.GTASF_URL ?? 'http://localhost:5319';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
  const page = await context.newPage(), cdp = await context.newCDPSession(page);
  await page.goto(`${base}/?preset=low&bot=1&time=noon`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready, null, { timeout: 180_000 });
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.waitForTimeout(Number(process.env.WARMUP_MS ?? 45_000));
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  const phase = async (name, pan) => {
    await page.evaluate(pan => {
      window.__frames = []; let last = performance.now(); window.__stop = false;
      const step = now => { window.__frames.push(now - last); last = now; if (pan) { window.__wig = -(window.__wig || 1.5); window.__gtasf.world.camera.look?.(0, window.__wig); } if (!window.__stop) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }, pan);
    await cdp.send('Profiler.start');
    await page.waitForTimeout(10_000);
    const { profile } = await cdp.send('Profiler.stop');
    const frames = await page.evaluate(() => { window.__stop = true; return window.__frames.slice(2); });
    frames.sort((a, b) => a - b);
    const mean = frames.reduce((a, b) => a + b, 0) / frames.length, p95 = frames[Math.floor(frames.length * 0.95)];
    // self time per function (sampled)
    const self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n]));
    const dt = profile.timeDeltas; let total = 0;
    profile.samples.forEach((id, i) => { const n = byId.get(id), f = n.callFrame; const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}:${f.columnNumber}`; const t = dt[i] ?? 0; total += t; self.set(key, (self.get(key) ?? 0) + t); });
    const top = [...self].filter(([k]) => !/^\(idle\)|^\(program\)|^\(garbage/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${(100 * v / total).toFixed(1)}% ${k}`);
    const busy = [...self].filter(([k]) => !/^\(idle\)/.test(k)).reduce((a, [, v]) => a + v, 0);
    console.log(`== ${name}: frames ${frames.length} mean ${mean.toFixed(1)} ms (${(1000 / mean).toFixed(1)} fps) p95 ${p95.toFixed(1)} ms; main-thread busy ${(100 * busy / total).toFixed(0)}%`);
    for (const line of top) console.log(`   ${line}`);
  };
  await phase('static', false);
  await phase('static-control', false); // time-drift control
  await phase('wiggle', true);
  await phase('static-again', false);
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser.close(); }
