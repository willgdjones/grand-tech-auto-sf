/** Run only through tools/heavy.sh. Real game, one browser/page at a time; no fixed steps. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { loadavg, platform, release } from 'node:os';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
import { startLocalPool } from './local-pool/pool.mjs';
import { startCrowdBots } from './perf/crowd-bots.mjs';

const out = resolve(process.env.GTASF_PHONE_OUT ?? `docs/perf/phone-d6-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const app = resolve(process.env.GTASF_PHONE_APP ?? `artifacts/phone-d6/${basename(out)}/app`);
const suppliedUrl = process.env.GTASF_TEST_URL;
const spawns = [['ferry', null], ['mission', '37.7599,-122.4148'], ['soma', '37.7785,-122.4010'], ['unionsquare', '37.7880,-122.4075'], ['chinatown', '37.79035,-122.40558'], ['castro', '37.76082,-122.435015'], ['dolores', '37.7598,-122.4264'], ['alamo', '37.77625,-122.4325'], ['harvey', '37.76258,-122.43500'], ['lafayette', '37.79154,-122.42739'], ['castrotheatre', '37.76202,-122.43510'], ['wharf', '37.80849,-122.41570'], ['ghirardelli', '37.80620,-122.42300'], ['pagoda', '37.78506,-122.42973'], ['turntable', '37.80672,-122.42070'], ['haightsign', '37.76999,-122.44648'], ['sutro', '37.75440,-122.44770'], ['coit', '37.80130,-122.40790'], ['citylights', '37.79783,-122.40628'], ['transamerica', '37.79440,-122.40230'], ['goldengate', '37.81405,-122.47990'], ['pier39', '37.80810,-122.41006'], ['vcoffice', '37.779361,-122.392552'],
  // gtasf-tdbw: the dense residential tour districts (Victorian rowhouses + LiDAR roofs) to profile phone fps.
  ['haight', '37.7701,-122.4469'], ['castro', '37.7609,-122.4350'], ['marina', '37.8008,-122.4360'],
  // gtasf-hale: Haight again, but sampled continuously across the post-READY street-prop mount so the mount
  // hitch lands IN the window (the plain `haight` samples at READY+2 s, long before props mount — the gate blind
  // spot). Reports the full-window max frame (the hitch) and a props-present steady window.
  ['haight-props', '37.7701,-122.4469'], ['ferry-props', null], ['soma-props', '37.7785,-122.4010']];
const requestedScenarios = [...new Set((process.env.GTASF_PHONE_SCENARIOS ?? 'ferry,mission').split(','))];
if (!requestedScenarios.length || requestedScenarios.some(name => !spawns.some(([known]) => known === name)))
  throw new Error(`GTASF_PHONE_SCENARIOS must select from: ${spawns.map(([known]) => known).join(', ')}`);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
function thermal() {
  if (platform() !== 'darwin') return null;
  try { return execFileSync('pmset', ['-g', 'therm'], { encoding: 'utf8', timeout: 5000 }).trim(); }
  catch { return null; }
}
async function bounded(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms); })]); }
  finally { clearTimeout(timer); }
}
const report = {
  startedAt: new Date().toISOString(), commit: git('rev-parse', 'HEAD'), dirty: git('status', '--short'),
  host: { platform: platform(), release: release(), loadavg: loadavg() },
  requestedScenarios, partial: requestedScenarios.length !== spawns.length,
  config: { viewport: { width: 1080, height: 2400 }, deviceScaleFactor: 2.75, cpuThrottle: 4,
    preset: 'low', localDist: process.env.GTASF_PHONE_LOCAL_DIST ?? null, introOptional: process.env.GTASF_PHONE_INTRO_OPTIONAL === '1', readyTimeoutMs: 180000, warmupMs: Number(process.env.GTASF_PHONE_WARMUP_MS ?? 45000), sampleCount: 120, capture: false,
    // gtasf-s387g: the AGENTS.md phone gate (founder 2026-10-13: desktop-first; the 60 fps / 25 ms gate is retired) with a
    // 45 s real warmup so street props have mounted. Override for an A/B against the old bar.
    meanFpsMin: Number(process.env.GTASF_PHONE_MIN_FPS ?? 30), p95MsMax: Number(process.env.GTASF_PHONE_MAX_P95 ?? 50) },
  harnessSha256: createHash('sha256').update(await readFile('tools/phone-perf.mjs')).digest('hex'),
  scenarios: [], passed: false,
};
await mkdir(out, { recursive: true });
const save = () => writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
let server, pool, browser, crowd;
try {
  let base = suppliedUrl;
  if (!base) {
    // GTASF_PHONE_FORCE_FLAGS=a,b builds with those shared/flags.ts flags forced true (NOT a flags.ts flip),
    // so a perf run can measure a flag-off feature (e.g. fogBank) under load.
    // GTASF_PHONE_UNFORCE_FLAGS=a,b forces those false instead (flag-off baselines of dev-on flags).
    const forceFlags = process.env.GTASF_PHONE_FORCE_FLAGS ? process.env.GTASF_PHONE_FORCE_FLAGS.split(',') : [];
    const unforceFlags = process.env.GTASF_PHONE_UNFORCE_FLAGS ? process.env.GTASF_PHONE_UNFORCE_FLAGS.split(',') : [];
    if (!process.env.GTASF_PHONE_APP) await build({ root: resolve('web'), configFile: resolve('web/vite.config.ts'),
      logLevel: 'warn', plugins: forceFlags.length || unforceFlags.length ? [{ name: 'force-flags', enforce: 'pre', transform(code, id) { if (id !== resolve('shared/flags.ts')) return; let out = code;
        for (const [list, value] of [[forceFlags, 'true'], [unforceFlags, 'false']]) for (const f of list) out = out.replace(new RegExp(`\\b${f}:\\s*(?:true|false)\\b`), `${f}: ${value}`); return out; } }] : [],
      build: { outDir: app, emptyOutDir: true, reportCompressedSize: false } });
    pool = await startLocalPool();
    // Optional launch-day crowd (GTASF_PHONE_BOTS=N real protocol clients around the Ferry plaza). Recorded in
    // report.crowd; the ordinary gate is the no-crowd run. Requires the local pool (not GTASF_TEST_URL).
    const botCount = Number(process.env.GTASF_PHONE_BOTS ?? 0);
    if (botCount > 0) { crowd = await startCrowdBots(pool, Math.min(60, botCount)); report.crowd = { requested: botCount, connected: crowd.connected, errors: crowd.errors.slice(0, 5) }; }
    server = await preview({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), build: { outDir: app },
      preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: pool.url.origin, ws: true } } } });
    base = server.resolvedUrls.local[0];
  }
  report.app = suppliedUrl ?? app;
  if (!suppliedUrl) {
    // Identify the actual frozen bundle even when GTASF_PHONE_APP reuses a previous checkout.
    const paths = ['index.html', ...(await readdir(`${app}/assets`)).filter(f => f.endsWith('.js')).map(f => `assets/${f}`)];
    report.bundleSha256 = Object.fromEntries(await Promise.all(paths.map(async file => [file,
      createHash('sha256').update(await readFile(`${app}/${file}`)).digest('hex')])));
  }
  // This describes the runner checkout; an explicitly reused bundle may contain earlier flags.
  report.flagsSource = await readFile('shared/flags.ts', 'utf8');
  // macOS headless-shell can select SwiftShader. Always headless (never pop windows on the founder's screen); Metal ANGLE + ignore-gpu-blocklist keep the real GPU; always record GPU.
  browser = await chromium.launch({ headless: true,
    args: [...(platform() === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : []),
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  report.browser = browser.version();
  for (const [name, at] of spawns.filter(([name]) => requestedScenarios.includes(name))) {
    const scenario = { name, startedAt: new Date().toISOString(), errors: [], httpErrors: [], friendsRequests: [], passed: false };
    report.scenarios.push(scenario);
    // GTASF_PHONE_DESKTOP=1 (lane D): a desktop context (1440x900 @2, no touch) so HD-only paths (props/materials) can be checked
    // with this harness's props-present warmup; never a perf gate (the validity check still expects the phone viewport).
    const desktop = process.env.GTASF_PHONE_DESKTOP === '1';
    const context = await browser.newContext(desktop ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, hasTouch: true } : { viewport: report.config.viewport,
      deviceScaleFactor: report.config.deviceScaleFactor, isMobile: true, hasTouch: true });
    // GTASF_PHONE_LOCAL_DIST=<built web dir> (with GTASF_TEST_URL): serve the page + assets from a local build while
    // /api and /map stay on GTASF_TEST_URL, so flag subsets can be measured without publishing a preview.
    if (process.env.GTASF_PHONE_LOCAL_DIST && suppliedUrl) {
      const { extname } = await import('node:path');
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
      await context.route(u => u.origin === new URL(suppliedUrl).origin && !u.pathname.startsWith('/api') && !u.pathname.startsWith('/map'), async route => {
        const p = new URL(route.request().url()).pathname, f = join(process.env.GTASF_PHONE_LOCAL_DIST, p === '/' ? 'index.html' : p);
        try { await route.fulfill({ body: await readFile(f), contentType: types[extname(f)] ?? 'application/octet-stream' }); } catch { await route.continue(); }
      });
    }
    // GTASF_PHONE_PASSROUTE=1 (lane D/E harness control): the SAME route predicate as LOCAL_DIST but every request is simply
    // continued, so a prod leg pays the interception round trip without serving anything locally.
    if (process.env.GTASF_PHONE_PASSROUTE === '1' && suppliedUrl && !process.env.GTASF_PHONE_LOCAL_DIST)
      await context.route(u => u.origin === new URL(suppliedUrl).origin && !u.pathname.startsWith('/api') && !u.pathname.startsWith('/map'), route => route.continue());
    // GTASF_PHONE_OUTFIT=n pins the saved player outfit (gtasf.outfit), so body/wardrobe A/Bs don't depend on the random default.
    // GTASF_PHONE_CARCLOSE: record every long task (>50 ms) from page start, to attribute carNearDetail load stalls.
    // GTASF_PHONE_READYTRACE=1 (lane D): also stamp READY, and report long tasks in READY..READY+6 s (first-seconds hitch check).
    if (process.env.GTASF_PHONE_READYTRACE === '1') await context.addInitScript(() => { const t = setInterval(() => { if (window.__gtasf?.ready) { window.__gtasfReadyAt = performance.now(); clearInterval(t); } }, 20); });
    if (process.env.GTASF_PHONE_CARCLOSE === '1' || process.env.GTASF_PHONE_READYTRACE === '1') await context.addInitScript(() => { window.__gtasfLongTasks = [];
      try { new PerformanceObserver(list => { for (const e of list.getEntries()) window.__gtasfLongTasks.push({ start: e.startTime, duration: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch {} });
    if (process.env.GTASF_PHONE_OUTFIT) await context.addInitScript(v => { try { localStorage.setItem('gtasf.outfit', v); } catch {} }, process.env.GTASF_PHONE_OUTFIT);
    const page = await context.newPage(); page.setDefaultTimeout(90_000);
    page.on('console', m => { if (m.type() === 'error') scenario.errors.push(m.text()); });
    page.on('pageerror', e => scenario.errors.push(e.message));
    page.on('request', r => { const path = new URL(r.url()).pathname;
      if (path.startsWith('/api/friends/')) scenario.friendsRequests.push(path); });
    page.on('response', r => { if (r.status() >= 400) scenario.httpErrors.push({ url: r.url(), status: r.status() }); });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: report.config.cpuThrottle });
    try {
      scenario.thermalBefore = thermal();
      const url = new URL(base); url.searchParams.set('preset', process.env.GTASF_PHONE_PRESET ?? 'low'); // GTASF_PHONE_PRESET=hd: HD material paths (not a perf gate)
      if (at) url.searchParams.set('at', at);
      // GTASF_PHONE_EXTRAQ=k=v&k2=v2: extra query params (e.g. fog=0.6 to force the fog bank active under load).
      if (process.env.GTASF_PHONE_EXTRAQ) for (const kv of process.env.GTASF_PHONE_EXTRAQ.split('&')) { const i = kv.indexOf('='); if (i > 0) url.searchParams.set(kv.slice(0, i), kv.slice(i + 1)); }
      scenario.url = url.href;
      const navigationAt = Date.now();
      await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      // Cold initialization is separate from wall-frame performance. Keep its duration visible;
      // do not weaken or filter any frame after the scene is ready.
      await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.ready === 'true',
        null, { timeout: report.config.readyTimeoutMs });
      await page.locator('#loading').waitFor({ state: 'hidden' });
      scenario.readyMs = Date.now() - navigationAt;
      scenario.readyWithin90Seconds = scenario.readyMs <= 90_000;
      // Exercise normal visible dismissal controls, never overwrite profile or game state.
      scenario.setup = [];
      const intro = page.locator('.gt-sa-intro');
      // A fresh context must show the intro when the compiled client includes onboarding.
      // Replay is only observed as the feature signal; never click it to mask first-visit bugs.
      // GTASF_PHONE_INTRO_OPTIONAL=1 (recorded in report.config): measure frames even when the fresh-profile intro
      // is not visible at READY (before/after flag comparisons); the default keeps the first-visit assertion.
      // With the paint intro (playfulMayhem), onboarding/flow.ts deliberately replaces the slides with a 'Paint the
      // Ferry Building' mission step, so a fresh profile shows either the slides or that mission banner.
      const paintIntro = page.locator('.gt-sa-mission__title', { hasText: /paint/i });
      if (!report.config.introOptional && await page.getByRole('button', { name: 'Replay tutorial', exact: true, includeHidden: true }).count()) {
        await intro.or(paintIntro).first().waitFor({ state: 'visible' });
        if (await paintIntro.isVisible()) scenario.setup.push('Fresh profile showed the paint-intro mission (slides replaced by design)');
        scenario.setup.push('Fresh profile displayed intro without Replay');
      }
      if (await intro.count() && await intro.isVisible()) {
        await intro.getByRole('button', { name: 'Skip', exact: true }).tap();
        await intro.waitFor({ state: 'hidden' });
        scenario.setup.push('Tapped intro Skip');
      }
      const identity = page.getByRole('dialog', { name: 'Create your founder', exact: true });
      if (await identity.count() && await identity.isVisible()) {
        await identity.getByRole('button', { name: 'Looks good', exact: true }).tap();
        await identity.waitFor({ state: 'hidden' });
        scenario.setup.push('Accepted the generated founder through Looks good');
      }
      for (const label of ['Skip intro', 'Skip tutorial', 'Close ×', "Let's go"]) {
        const button = page.getByRole('button', { name: label, exact: true });
        if (await button.count() === 1 && await button.isVisible()) {
          await button.tap(); scenario.setup.push(`Tapped ${label}`);
        }
      }
      const openDialogs = await page.locator('dialog[open]').count();
      if (openDialogs) throw new Error(`${openDialogs} modal dialog(s) obscure gameplay; complete onboarding before measuring`);
      await intro.waitFor({ state: 'hidden' });
      if (name.endsWith('-props')) {
        // gtasf-hale: sample continuously from ~READY through the post-READY street-prop mount. `propsDrawn` turns
        // true the frame the street-prop root is both visible AND populated (stats.visible>0) — i.e. the first real
        // draw. The plain `haight` scenario samples at READY+2 s, ~27 s BEFORE props mount, so it never sees the
        // mount cost (the gate blind spot). The mount window is ~4 s of heavy frames — CPU/JS scene-graph matrix +
        // geometry build and instance-buffer uploads, NOT shader compilation (profiled) — so the full-window max
        // frame captures that hitch; a separate steady window (well after the first draw) reports props-present fps.
        if (process.env.GTASF_PHONE_PROFILE === '1') { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
        scenario.measurement = await bounded(page.evaluate(async ({ hardCapMs, tailFrames }) => {
          const start = performance.now();
          const world = window.__gtasf.world;
          const gameFrameBefore = window.__gtasf.frame;
          const samples = [];
          let last, raf, timedOut = false, propsDrawnIndex = -1;
          const propsDrawn = () => {
            const probe = owner => owner && owner.root && owner.root.visible && (owner.stats?.visible ?? 0) > 0;
            return probe(world.streetProps) || probe(world.parodyBillboards);
          };
          await new Promise(resolve => {
            const deadline = setTimeout(() => { timedOut = true; cancelAnimationFrame(raf); resolve(); }, hardCapMs);
            function frame() {
              const now = performance.now();
              if (last !== undefined && now > last) samples.push(now - last);
              last = now;
              if (propsDrawnIndex < 0 && propsDrawn()) propsDrawnIndex = samples.length;
              const done = propsDrawnIndex >= 0 && samples.length - propsDrawnIndex >= tailFrames;
              if (!done && samples.length < 5000) raf = requestAnimationFrame(frame);
              else { clearTimeout(deadline); resolve(); }
            }
            raf = requestAnimationFrame(frame);
          });
          const canvas = document.querySelector('#world');
          const gl = canvas.getContext('webgl2');
          const ext = gl?.getExtension('WEBGL_debug_renderer_info');
          return { samples, timedOut, elapsedMs: performance.now() - start, warmupMs: 0, gameFrameBefore,
            gameFrameAfter: window.__gtasf.frame, capture: window.__gtasf.capture,
            harnessErrors: [...window.__gtasf.errors], viewport: { width: innerWidth, height: innerHeight },
            dpr: devicePixelRatio, visibility: document.visibilityState, canvas: { width: canvas.width, height: canvas.height },
            gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
            shadow: canvas.dataset.renderShadows ?? null, post: canvas.dataset.renderPost ?? null,
            foot: { ...world.foot }, mode: world.mode, connected: canvas.dataset.connected,
            map: { ...world.map?.stats }, dialogs: document.querySelectorAll('dialog[open]').length,
            intro: Boolean(document.querySelector('.gt-sa-intro')),
            propsDrawnIndex, streetPropsVisible: world.streetProps?.stats?.visible ?? null };
        }, { hardCapMs: 55_000, tailFrames: 180 }), 75_000, `${name} props-present sampling`);
        if (process.env.GTASF_PHONE_PROFILE === '1') {
          const { profile } = await cdp.send('Profiler.stop');
          await writeFile(`${out}/${name}.cpuprofile`, JSON.stringify(profile));
          await cdp.send('Profiler.disable');
        }
        const m = scenario.measurement;
        const statsOf = arr => { const s = [...arr].sort((a, b) => a - b), mean = arr.reduce((t, n) => t + n, 0) / arr.length;
          return { count: s.length, meanMs: mean, meanFps: 1000 / mean, p95Ms: s[Math.ceil(s.length * .95) - 1], maxMs: s.at(-1) }; };
        // Full window: maxMs is the first-draw hitch (the headline number). Steady: frames well after props first drew.
        scenario.stats = statsOf(m.samples);
        const steadyFrom = m.propsDrawnIndex >= 0 ? Math.min(m.propsDrawnIndex + 30, m.samples.length) : Math.max(0, m.samples.length - 120);
        scenario.steadyStats = m.samples.length - steadyFrom >= 30 ? statsOf(m.samples.slice(steadyFrom)) : null;
        scenario.propsDrawnAtFrame = m.propsDrawnIndex;
        scenario.valid = !m.capture && !m.timedOut && m.samples.length >= 60 && m.samples.every(n => Number.isFinite(n) && n > 0)
          && m.gameFrameAfter - m.gameFrameBefore >= m.samples.length && m.visibility === 'visible'
          && m.viewport.width === 1080 && m.viewport.height === 2400 && m.dpr === 2.75 && !m.dialogs && !m.intro && m.propsDrawnIndex >= 0;
        // Pass judged on the STEADY (props-present) window, not the one-off first-draw compile frame.
        scenario.passed = scenario.valid && !!scenario.steadyStats && scenario.steadyStats.meanFps >= report.config.meanFpsMin && scenario.steadyStats.p95Ms <= report.config.p95MsMax
          && !scenario.errors.length && !m.harnessErrors.length && !scenario.httpErrors.length;
        await page.screenshot({ path: `${out}/${name}.png` });
      } else {
      // GTASF_PHONE_DRIVE=1 (lane D): board the nearest car (E, use an AT beside a parked car, e.g. the run-over spawn) and keep
      // driving through warmup + sampling: throttle held, a steer pulse every 3 s, reverse when stuck. scenario.drive records it.
      let driving = false;
      if (process.env.GTASF_PHONE_DRIVE === '1') {
        const st = () => page.evaluate(() => { const w = window.__gtasf.world; return { mode: w.mode, speed: Math.abs(w.driving?.speed ?? 0) }; });
        // Up to ~30 s: at a job / time-trial start (the Ferry plaza) E answers "Still loading the city" until the deferred runners mount.
        for (let i = 0; i < 25 && (await st()).mode !== 'driver'; i++) { await page.keyboard.press('KeyE'); await page.waitForTimeout(1200); }
        scenario.drive = { boarded: (await st()).mode === 'driver', speeds: [] };
        // GTASF_PHONE_POSELOG=1 (gtasf-8mjjf bob check): every frame while driving, the car's visual height, pitch and speed.
        if (scenario.drive.boarded && process.env.GTASF_PHONE_POSELOG === '1') await page.evaluate(() => { const log = window.__gtasfPoseLog = [];
          const tick = () => { const d = window.__gtasf?.world?.driving; if (d) log.push([+performance.now().toFixed(1), +d.x.toFixed(2), +d.z.toFixed(2), +(d.visualY ?? d.y).toFixed(3), +d.pitch.toFixed(4), +Math.abs(d.speed).toFixed(2)]);
            if (log.length < 20000) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
        if (scenario.drive.boarded) { driving = true; await page.keyboard.down('KeyW');
          // Pure pursuit along the road graph (gtasf-xgnai: random steer pulses stalled against geometry within seconds): every
          // 150 ms snap a point LOOK m ahead of the car to the nearest road and steer toward it; reverse out when stuck.
          // GTASF_PHONE_DRIVE_FLIP=1 swaps A/D if the steering sense is inverted.
          const flip = process.env.GTASF_PHONE_DRIVE_FLIP === '1';
          void (async () => { let held = null, stuck = 0, k = 0;
            while (driving) { await page.waitForTimeout(150).catch(() => {}); if (!driving) break;
              const now = await page.evaluate(() => { const w = window.__gtasf.world, d = w.driving; if (!d) return null;
                const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw), look = 10 + Math.min(20, Math.abs(d.speed));
                const r = w.map.nearestRoad(d.x + fx * look, d.z + fz * look, 40); if (!r) return { speed: Math.abs(d.speed), cross: 0 };
                const rx = r.x - d.x, rz = r.z - d.z, len = Math.hypot(rx, rz) || 1;
                return { speed: Math.abs(d.speed), cross: (fx * rz - fz * rx) / len, dot: (fx * rx + fz * rz) / len }; }).catch(() => null);
              if (!now) break;
              if (++k % 7 === 0) scenario.drive.speeds.push(+now.speed.toFixed(1)); // ~1 s
              stuck = now.speed < 1.5 ? stuck + 1 : 0;
              if (stuck >= 8) { if (held) { await page.keyboard.up(held); held = null; } await page.keyboard.up('KeyW'); await page.keyboard.down('KeyS');
                await page.waitForTimeout(1200); await page.keyboard.up('KeyS'); await page.keyboard.down('KeyW'); stuck = 0; scenario.drive.reversals = (scenario.drive.reversals ?? 0) + 1; continue; }
              const want = Math.abs(now.cross) < .08 ? null : (now.cross < 0) !== flip ? 'KeyA' : 'KeyD';
              if (want !== held) { if (held) await page.keyboard.up(held); if (want) await page.keyboard.down(want); held = want; }
            }
            if (held) await page.keyboard.up(held).catch(() => {}); })(); }
      }
      if (process.env.GTASF_PHONE_POSELOG === '1') scenario.poseLogLater = true;
      // gtasf-ts6py: GTASF_PHONE_PROFILE=1 also CPU-profiles the plain sampling window (warmup included) and stamps
      // every frame > 200 ms (hitches[].at = performance.now at its end) so a hitch can be found in the profile.
      if (process.env.GTASF_PHONE_PROFILE === '1') { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
      scenario.measurement = await bounded(page.evaluate(async ({ warmupMs, sampleCount }) => {
        const start = performance.now();
        const gameFrameBefore = window.__gtasf.frame;
        const samples = [], hitches = [];
        let last, raf, timedOut = false;
        // performance.now at callback entry records wall time, including scheduling and slow frames.
        // Neither endpoint of a retained interval may precede the real warmup deadline.
        await new Promise(resolve => {
          const deadline = setTimeout(() => { timedOut = true; cancelAnimationFrame(raf); resolve(); }, 120_000 + warmupMs);
          function frame() {
            const now = performance.now();
            if (last !== undefined && last >= start + warmupMs) { samples.push(now - last); if (now - last > 200) hitches.push({ at: now, ms: now - last }); }
            last = now;
            if (samples.length < sampleCount) raf = requestAnimationFrame(frame);
            else { clearTimeout(deadline); resolve(); }
          }
          raf = requestAnimationFrame(frame);
        });
        const world = window.__gtasf.world, canvas = document.querySelector('#world');
        const gl = canvas.getContext('webgl2');
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        return { samples, hitches, timedOut, elapsedMs: performance.now() - start, warmupMs, gameFrameBefore,
          gameFrameAfter: window.__gtasf.frame, capture: window.__gtasf.capture,
          harnessErrors: [...window.__gtasf.errors], viewport: { width: innerWidth, height: innerHeight },
          dpr: devicePixelRatio, visibility: document.visibilityState, canvas: { width: canvas.width, height: canvas.height },
          gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
          shadow: canvas.dataset.renderShadows ?? null, post: canvas.dataset.renderPost ?? null,
          foot: { ...world.foot }, mode: world.mode, connected: canvas.dataset.connected,
          map: { ...world.map?.stats }, dialogs: document.querySelectorAll('dialog[open]').length,
          intro: Boolean(document.querySelector('.gt-sa-intro')) };
      }, report.config), 150_000 + report.config.warmupMs, `${name} wall-frame sampling`);
      if (process.env.GTASF_PHONE_PROFILE === '1') {
        const { profile } = await cdp.send('Profiler.stop');
        await writeFile(`${out}/${name}.cpuprofile`, JSON.stringify(profile));
        await cdp.send('Profiler.disable');
      }
      if (scenario.poseLogLater) { scenario.poseLog = await page.evaluate(() => window.__gtasfPoseLog ?? []).catch(() => []); delete scenario.poseLogLater; }
      if (driving) { driving = false; await page.keyboard.up('KeyW').catch(() => {}); scenario.drive.modeAfter = await page.evaluate(() => window.__gtasf.world.mode).catch(() => null);
        // Moving share: of the ~1 s speed log, the seconds that covered the sampling window (the last ~sampleCount/30 s).
        const tail = scenario.drive.speeds.slice(-Math.max(3, Math.ceil(report.config.sampleCount / 30))); scenario.drive.samplingSpeeds = tail;
        scenario.drive.movingShare = +(tail.filter(v => v > 3).length / Math.max(1, tail.length)).toFixed(2); }
      const m = scenario.measurement, sorted = [...m.samples].sort((a, b) => a - b);
      const meanMs = m.samples.reduce((sum, n) => sum + n, 0) / m.samples.length;
      scenario.stats = { count: sorted.length, meanMs, meanFps: 1000 / meanMs,
        p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], maxMs: sorted.at(-1) };
      scenario.valid = !m.capture && !m.timedOut && m.samples.length >= 60 && m.samples.every(n => Number.isFinite(n) && n > 0)
        && m.gameFrameAfter - m.gameFrameBefore >= m.samples.length && m.visibility === 'visible'
        && m.viewport.width === 1080 && m.viewport.height === 2400 && m.dpr === 2.75 && !m.dialogs && !m.intro;
      scenario.passed = scenario.valid && scenario.stats.meanFps >= report.config.meanFpsMin && scenario.stats.p95Ms <= report.config.p95MsMax
        && !scenario.errors.length && !m.harnessErrors.length && !scenario.httpErrors.length;
      await page.screenshot({ path: `${out}/${name}.png` });
      // GTASF_PHONE_HABITS=1 (pedIdleVariety evidence): frame each rigged walker (1-3) side-on from 3 m, a little above, for
      // ~1.5 s each (habits: 1 texting walk, 2 phone call, 3 look around on phone Low).
      if (process.env.GTASF_PHONE_HABITS === '1') for (const n of [1, 2, 3]) {
        const found = await page.evaluate(n => { const root = window.__gtasf?.world?.streetWalkers?.root; if (!root) return false; let scene = root; while (scene.parent) scene = scene.parent;
          let target; root.traverse(o => { if (o.name === `Street walker ${n}` && o.visible) target = o; }); if (!target) return false;
          scene.onBeforeRender = (_r, _s, cam) => { const p = target.getWorldPosition(target.position.clone()), yaw = target.rotation.y + 1.2;
            cam.position.set(p.x + Math.sin(yaw) * 3, p.y + 2.1, p.z + Math.cos(yaw) * 3); cam.lookAt(p.x, p.y + 1.1, p.z); cam.updateMatrixWorld(); };
          return true; }, n);
        if (!found) { (scenario.habits ??= []).push({ n, found: false }); continue; }
        for (const k of [0, 1]) { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}-habit-${n}-${k}.png` }); }
        (scenario.habits ??= []).push({ n, found: true });
        await page.evaluate(() => { let s = window.__gtasf.world.streetWalkers.root; while (s.parent) s = s.parent; s.onBeforeRender = () => {}; });
      }
      // GTASF_PHONE_CLOSEUP=1 (lane D, face-quality evidence): after the timing window, re-aim the render camera 2.2 m in front
      // of a street walker's face via scene.onBeforeRender (runs after the game loop poses the camera, before the frustum is
      // built), screenshot, then remove the hook. One shot of the nearest rigged walker (lowNearPeople: walkers 1-3) and one
      // of the nearest other (VAT on Low). Never part of the timing samples.
      if (process.env.GTASF_PHONE_CLOSEUP === '1') for (const kind of ['rigged', 'other']) {
        const picked = await page.evaluate(kind => {
          const world = window.__gtasf?.world, root = world?.streetWalkers?.root; if (!root) return null;
          let scene = root; while (scene.parent) scene = scene.parent;
          const foot = world.foot, list = [];
          root.traverse(o => { const m = /^Street walker (\d+)$/.exec(o.name ?? ''); if (!m || !o.visible) return;
            const rigged = Number(m[1]) <= 3; if ((kind === 'rigged') !== rigged) return;
            const p = o.getWorldPosition(o.position.clone()); list.push({ o, d: Math.hypot(p.x - foot.x, p.z - foot.z) }); });
          list.sort((a, b) => a.d - b.d); const target = list[0]?.o; if (!target) return null;
          scene.onBeforeRender = (_r, _s, cam) => {
            const p = target.getWorldPosition(target.position.clone()), yaw = target.rotation.y;
            cam.position.set(p.x + Math.sin(yaw) * 2.2, p.y + 1.6, p.z + Math.cos(yaw) * 2.2);
            cam.lookAt(p.x, p.y + 1.5, p.z); cam.updateMatrixWorld();
          };
          return { name: target.name, distance: +list[0].d.toFixed(1), candidates: list.length };
        }, kind).catch(error => ({ error: String(error) }));
        if (!picked?.name) { (scenario.closeups ??= []).push({ kind, ...picked }); continue; }
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${out}/${name}-close-${kind}.png` });
        // GTASF_PHONE_SKINCHECK=1 (meshyHeadMaps shards): world-space posed bounds of every SkinnedMesh at this exact frame; list any
        // over 3 m with its distance to the camera, parent chain and the walker's current clip.
        if (process.env.GTASF_PHONE_SKINCHECK === '1') (scenario.skincheck ??= []).push({ kind, bad: await page.evaluate(() => {
          const w = window.__gtasf.world, cam = w.camera.camera, roots = new Set(); for (const o of [cam, w.streetWalkers?.root]) { let t = o; while (t?.parent) t = t.parent; if (t) roots.add(t); }
          const cp = cam.getWorldPosition(cam.position.clone()), bad = [];
          for (const r of roots) r.traverse(o => { if (!o.isSkinnedMesh || !o.visible) return; o.computeBoundingBox(); const b = o.boundingBox.clone().applyMatrix4(o.matrixWorld), size = b.getSize(cp.clone());
            const chain = []; let owner = null; for (let q = o.parent; q; q = q.parent) { if (chain.length < 6) chain.push(q.name || q.type); if (!owner && /Street walker|on-foot-avatar|Crowd/.test(q.name ?? '')) owner = q.name; }
            bad.push({ mesh: o.name, verts: o.geometry.attributes.position.count, size: size.toArray().map(n => +n.toFixed(2)), camDist: +b.distanceToPoint(cp).toFixed(2), owner, big: Math.max(size.x, size.y, size.z) > 3 }); });
          // Nearest meshes to the lens (a head inside the near plane renders as giant shards) plus anything oversized.
          return bad.sort((x, y) => x.camDist - y.camDist).filter((x, i) => i < 3 || x.big).slice(0, 8); }) });
        // ...then re-shoot with every head-mapped head primitive (Mesh_0_1 in a person) hidden, to see whether the shards go too.
        if (process.env.GTASF_PHONE_SKINCHECK === '1') {
          const hide = on => page.evaluate(on => { const w = window.__gtasf.world; let r = w.streetWalkers?.root ?? w.camera.camera; while (r.parent) r = r.parent;
            r.traverse(o => { if (o.isSkinnedMesh && o.name === 'Mesh_0_1') o.visible = !on; }); }, on);
          await hide(true); await page.waitForTimeout(200); await page.screenshot({ path: `${out}/${name}-close-${kind}-noheads.png` }); await hide(false);
        }
        // The walker may have turned (idle/avoid): a second shot from the opposite side guarantees one face-on frame.
        await page.evaluate(() => { let sc = window.__gtasf?.world?.streetWalkers?.root; while (sc?.parent) sc = sc.parent; const hook = sc?.onBeforeRender;
          if (hook) sc.onBeforeRender = (r, s2, cam) => { hook(r, s2, cam); const t = cam.position.clone(); const look = new cam.position.constructor(); cam.getWorldDirection(look); const focus = t.clone().addScaledVector(look, 2.2); cam.position.set(2 * focus.x - t.x, t.y, 2 * focus.z - t.z); cam.lookAt(focus.x, focus.y, focus.z); cam.updateMatrixWorld(); }; });
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${out}/${name}-close-${kind}-opposite.png` });
        // GTASF_PHONE_DEATH=1: waste that walker (testingHarness wasteNearest) and shoot its fall from the side.
        // GTASF_PHONE_DEATH_KIND=vat wastes the framed VAT walker instead (the plank fallback: everyone but the rigged 3 on Low).
        if (process.env.GTASF_PHONE_DEATH === '1' && kind === (process.env.GTASF_PHONE_DEATH_KIND === 'vat' ? 'other' : 'rigged')) {
          const wasted = await page.evaluate(kind => {
            const world = window.__gtasf.world, root = world.streetWalkers.root; let scene = root; while (scene.parent) scene = scene.parent;
            const want = kind === 'rigged' ? /^Street walker [123]$/ : /^Street walker (?:[4-9]|\d\d+)$/;
            let found, best = Infinity; const f = world.foot;
            root.traverse(o => { if (want.test(o.name ?? '') && o.visible) { const q = o.getWorldPosition(o.position.clone()), d = Math.hypot(q.x - f.x, q.z - f.z); if (d < best) { best = d; found = o; } } });
            const p = found.getWorldPosition(found.position.clone()), yaw = found.rotation.y;
            const ok = world.streetWalkers.wasteNearest(p.x, p.z);
            scene.onBeforeRender = (_r, _s, cam) => { // side-on, a little above: both fall directions stay in frame
              cam.position.set(p.x + Math.cos(yaw) * 4.2, p.y + 1.7, p.z - Math.sin(yaw) * 4.2); cam.lookAt(p.x, p.y + .4, p.z); cam.updateMatrixWorld(); };
            return ok;
          }, kind);
          // Full-size screenshots stall the game clock for a second or two, so 'end' is not the end of the fall: add a late frame.
          for (const [ms, tag] of [[600, 'mid'], [2900, 'end'], [5000, 'late']]) { await page.waitForTimeout(ms); await page.screenshot({ path: `${out}/${name}-death-${tag}.png` }); }
          (scenario.closeups ??= []).push({ kind: 'death', wasted });
        }
        await page.evaluate(() => { let s = window.__gtasf?.world?.streetWalkers?.root; while (s?.parent) s = s.parent; if (s) s.onBeforeRender = () => {}; });
        (scenario.closeups ??= []).push({ kind, ...picked });
      }
      if (process.env.GTASF_PHONE_READYTRACE === '1') scenario.readyTrace = await page.evaluate(() => { const r = window.__gtasfReadyAt ?? 0;
        const w = (window.__gtasfLongTasks ?? []).filter(t => t.start >= r && t.start < r + 6000);
        return { readyAt: Math.round(r), count: w.length, sumMs: Math.round(w.reduce((a, t) => a + t.duration, 0)), maxMs: Math.round(Math.max(0, ...w.map(t => t.duration))), tasks: w.map(t => [Math.round(t.start - r), Math.round(t.duration)]) }; });
      // GTASF_PHONE_TREECAM=1 (foliageCanopyHide, critic R1): pin the camera INSIDE the canopy of the street tree nearest the player
      // (on the trunk axis at 70 % of the card height, looking at the player), then 8 m out (the tree must still render).
      if (process.env.GTASF_PHONE_TREECAM === '1') {
        const tree = await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot; let scene = w.camera.camera; for (const c of w.fleet?.cars?.values?.() ?? []) { scene = c.model.root; break; } while (scene.parent) scene = scene.parent;
          const roots = new Set([scene]); for (const o of [w.camera.camera, w.streetWalkers?.root]) { let t = o; while (t?.parent) t = t.parent; if (t) roots.add(t); }
          const M = new (w.camera.camera.matrixWorld.constructor)(); let best = null;
          for (const r of roots) r.traverse(o => { if (!o.isInstancedMesh || !/^SF (palm|plane|cypress|tree|.*canopy)/i.test(o.name) && !/^SF .* instances$/.test(o.name)) return;
            if (!o.material?.userData?.gtasfFoliageCanopyHide && !o.material?.userData?.gtasfFoliageCameraFade && !/palm|plane|cypress/.test(o.name)) return;
            o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox;
            for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, M); M.premultiply(o.matrixWorld); const e = M.elements, s = Math.hypot(e[0], e[1], e[2]), d = Math.hypot(e[12] - f.x, e[14] - f.z);
              if (!best || d < best.d) best = { d, x: e[12], y: e[13], z: e[14], top: bb.max.y * s, name: o.name, mat: o.material?.type, ud: Object.keys(o.material?.userData ?? {}), key: o.material?.customProgramCacheKey?.()?.slice(-60), bbMin: bb.min.toArray().map(n => +n.toFixed(2)), bbMax: bb.max.toArray().map(n => +n.toFixed(2)), scale: +s.toFixed(2), visible: o.visible, layers: o.layers.mask }; } });
          if (!best) return null; window.__treeCam = best; return { ...best, d: +best.d.toFixed(1), top: +best.top.toFixed(1), x: undefined, y: undefined, z: undefined }; });
        scenario.treeCam = tree;
        scenario.treeDebug = await page.evaluate(() => window.__gtasfTrees ? { ...window.__gtasfTrees } : null);
        scenario.treeMarks = await page.evaluate(() => performance.getEntriesByType('mark').filter(m => m.name.startsWith('gtasf:treeMesh')).map(m => `${m.name}@${Math.round(m.startTime)}`));
        scenario.treeMeshes = await page.evaluate(() => { const w = window.__gtasf.world, roots = new Set(); for (const o of [w.camera.camera, w.streetWalkers?.root, [...(w.fleet?.cars?.values?.() ?? [])][0]?.model.root]) { let t = o; while (t?.parent) t = t.parent; if (t) roots.add(t); }
          const out = []; for (const r of roots) r.traverse(o => { if (/^SF (palm|plane|cypress) instances$/.test(o.name)) { let vis = true; for (let q = o; q; q = q.parent) if (!q.visible) vis = false;
            out.push({ name: o.name, uuid: o.material.uuid.slice(0, 8), ud: Object.keys(o.material.userData), obc: o.material.onBeforeCompile.toString().replace(/\s+/g, ' ').slice(0, 160), mapSrc: (o.material.map?.image?.src ?? o.material.map?.name ?? '').slice(-40), id: o.id, key: o.material.customProgramCacheKey().slice(-70), count: o.count, vis, layers: o.layers.mask, root: r.type + ':' + (r.name || '') }); } });
          return out; });
        if (tree) for (const [tag, out8] of [['inside', 0], ['outside', 8]]) {
          await page.evaluate(out8 => { const w = window.__gtasf.world, t = window.__treeCam, f = w.foot; let scene = w.camera.camera; for (const c of w.fleet?.cars?.values?.() ?? []) { scene = c.model.root; break; } while (scene.parent) scene = scene.parent;
            const dx = f.x - t.x, dz = f.z - t.z, len = Math.hypot(dx, dz) || 1;
            scene.onBeforeRender = (_r, _s, cam) => { cam.position.set(t.x - dx / len * out8 + .3, t.y + t.top * .7, t.z - dz / len * out8); cam.lookAt(f.x, f.y + 1.2, f.z); cam.updateMatrixWorld(); }; }, out8);
          await page.waitForTimeout(800); await page.screenshot({ path: `${out}/${name}-treecam-${tag}.png` });
        }
      }
      // GTASF_PHONE_TREECAM=wall (treeFacadeAlign): frame the nearest facade-aligned street tree (instance with unequal x/z
      // scale; its local z is the away-from-wall normal) from 9 m out on the open side, eye height; GTASF_PHONE_TREEAT=x,z,nx,nz
      // frames that same spot in another build. Records scenario.wallTree.
      if (process.env.GTASF_PHONE_TREECAM === 'wall') {
        scenario.wallTree = await page.evaluate(forced => { const w = window.__gtasf.world, f = w.foot; let scene = w.camera.camera; for (const c of w.fleet?.cars?.values?.() ?? []) { scene = c.model.root; break; } while (scene.parent) scene = scene.parent;
          const roots = new Set([scene]); for (const o of [w.camera.camera, w.streetWalkers?.root]) { let t = o; while (t?.parent) t = t.parent; if (t) roots.add(t); }
          let best = null;
          if (forced) { const [x, z, nx, nz] = forced.split(',').map(Number); best = { x, z, nx, nz, y: w.map.heightAt?.(x, z) ?? f.y }; }
          else { const M = new (w.camera.camera.matrixWorld.constructor)();
            for (const r of roots) r.traverse(o => { if (!o.isInstancedMesh || !/^SF .* instances$/.test(o.name)) return;
              for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, M); M.premultiply(o.matrixWorld); const e = M.elements, sx = Math.hypot(e[0], e[1], e[2]), sz = Math.hypot(e[8], e[9], e[10]);
                if (sz > sx * .8) continue; const d = Math.hypot(e[12] - f.x, e[14] - f.z);
                if (!best || d < best.d) best = { d, x: e[12], y: e[13], z: e[14], nx: e[8] / sz, nz: e[10] / sz, name: o.name }; } }); }
          if (!best) return null;
          scene.onBeforeRender = (_r, _s, cam) => { cam.position.set(best.x + best.nx * 9, best.y + 1.7, best.z + best.nz * 9); cam.lookAt(best.x, best.y + 4, best.z); cam.updateMatrixWorld(); };
          return { ...best, x: +best.x.toFixed(1), z: +best.z.toFixed(1), nx: +best.nx.toFixed(3), nz: +best.nz.toFixed(3) }; }, process.env.GTASF_PHONE_TREEAT ?? null);
        if (scenario.wallTree) { await page.waitForTimeout(800); await page.screenshot({ path: `${out}/${name}-walltree.png` });
          // Oblique: 4 m out from the wall and 8 m along it (where a card slicing into the facade shows).
          await page.evaluate(() => { const w = window.__gtasf.world; let scene = w.camera.camera; for (const c of w.fleet?.cars?.values?.() ?? []) { scene = c.model.root; break; } while (scene.parent) scene = scene.parent;
            const t = scene.onBeforeRender; void t; });
          await page.evaluate(b => { const w = window.__gtasf.world; let scene = w.camera.camera; for (const c of w.fleet?.cars?.values?.() ?? []) { scene = c.model.root; break; } while (scene.parent) scene = scene.parent;
            const ax = -b.nz, az = b.nx; scene.onBeforeRender = (_r, _s, cam) => { cam.position.set(b.x + b.nx * 4 + ax * 8, b.y + 1.7, b.z + b.nz * 4 + az * 8); cam.lookAt(b.x, b.y + 4, b.z); cam.updateMatrixWorld(); }; }, scenario.wallTree);
          await page.waitForTimeout(800); await page.screenshot({ path: `${out}/${name}-walltree-oblique.png` }); }
      }
      // GTASF_PHONE_PROPCOUNT=1: instance counts per instanced-mesh name (total, and within 150 m of the player) into
      // scenario.propCount, to check a prop flag actually places anything (e.g. lowStreetFurniture on/off).
      if (process.env.GTASF_PHONE_PROPCOUNT === '1') {
        scenario.propCount = await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot, out = {};
          let scene = w.streetWalkers?.root ?? w.camera.camera; while (scene.parent) scene = scene.parent;
          const M = new (w.camera.camera.matrixWorld.constructor)();
          scene.traverse(o => { if (!o.isInstancedMesh) return; const k = o.name || '(unnamed)', e = out[k] ??= [0, 0];
            for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, M); M.premultiply(o.matrixWorld); e[0]++; if (Math.hypot(M.elements[12] - f.x, M.elements[14] - f.z) < 150) e[1]++; } });
          out.shopGlows = [w.streetProps?.stats?.shopGlows ?? null, 0]; return out; });
      }
      // GTASF_PHONE_PROPCAM=<instanced-mesh name> | x,y,z: aim a pinned camera at the nearest instance of that prop
      // (or a given point) from 8 m across the sidewalk, 1.7 m up; save ${name}-propcam.png and the pose in scenario.propCam
      // (pass the coordinates to the flag-off build so both frames share one pose).
      if (process.env.GTASF_PHONE_PROPCAM) {
        scenario.propCam = await page.evaluate(spec => { const w = window.__gtasf.world, f = w.foot;
          let scene = w.streetWalkers?.root ?? w.camera.camera; while (scene.parent) scene = scene.parent;
          let t = null; const nums = spec.split(',').map(Number);
          if (nums.length === 3 && nums.every(Number.isFinite)) t = { x: nums[0], y: nums[1], z: nums[2] };
          else { const M = new (w.camera.camera.matrixWorld.constructor)();
            scene.traverse(o => { if (!o.isInstancedMesh || o.name !== spec) return;
              for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, M); M.premultiply(o.matrixWorld); const e = M.elements, d = Math.hypot(e[12] - f.x, e[14] - f.z);
                if (!t || d < t.d) t = { d, x: e[12], y: e[13], z: e[14] }; } }); }
          if (!t) return null;
          const dx = f.x - t.x, dz = f.z - t.z, l = Math.hypot(dx, dz) || 1, cx = t.x + dx / l * 8, cz = t.z + dz / l * 8;
          scene.onBeforeRender = (_r, _s, cam) => { cam.position.set(cx, t.y + 1.7, cz); cam.lookAt(t.x, t.y + 0.6, t.z); cam.updateMatrixWorld(); };
          return { x: +t.x.toFixed(2), y: +t.y.toFixed(2), z: +t.z.toFixed(2) }; }, process.env.GTASF_PHONE_PROPCAM);
        if (scenario.propCam) { await page.waitForTimeout(1200); await page.screenshot({ path: `${out}/${name}-propcam.png` }); }
      }
      // GTASF_PHONE_PINCAM=x,z,lookX,lookZ[,height] (world metres): pin the camera above the ground at (x,z) looking at (lookX,lookZ)
      // and save ${name}-pincam.png (e.g. along a boulevard median for a tree-filter before/after).
      if (process.env.GTASF_PHONE_PINCAM) {
        await page.evaluate(spec => { const [x, z, lx, lz, h = 7] = spec.split(',').map(Number), w = window.__gtasf.world;
          let scene = w.streetWalkers?.root ?? w.camera.camera; while (scene.parent) scene = scene.parent;
          const gy = w.map.heightAt?.(x, z) ?? w.foot.y, ly = w.map.heightAt?.(lx, lz) ?? gy;
          scene.onBeforeRender = (_r, _s, cam) => { cam.position.set(x, gy + h, z); cam.lookAt(lx, ly + 2, lz); cam.updateMatrixWorld(); }; }, process.env.GTASF_PHONE_PINCAM);
        await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/${name}-pincam.png` });
      }
      // GTASF_PHONE_KERB=1 (carNearDetail kerb props, critic N5): the kerb car pulled out of the Low instancing (nearest within
      // 12 m of the player) - report it, then pin the camera 2.6 m from it and record which LOD level it draws.
      if (process.env.GTASF_PHONE_KERB === '1') {
        const probe = () => page.evaluate(() => { const w = window.__gtasf.world, f = w.foot; let scene = w.camera.camera; for (const c of w.fleet?.cars?.values?.() ?? []) { scene = c.model.root; break; } while (scene.parent) scene = scene.parent;
          const roots = new Set([scene]); for (const o of [w.camera.camera, w.streetWalkers?.root]) { let t = o; while (t?.parent) t = t.parent; if (t) roots.add(t); }
          let group; const names = new Set(); for (const r of roots) r.traverse(o => { if (o.name === 'Kerbside parked cars') group = o; if (/kerb/i.test(o.name)) names.add(o.name.slice(0, 30)); });
          if (!group) return { group: false, roots: roots.size, names: [...names].slice(0, 8), props: !!w.streetProps, propStats: w.streetProps?.stats ?? null };
          const pulled = group.children.filter(c => !c.isInstancedMesh), lods = []; for (const r of pulled) r.traverse(o => { if (o.isLOD) lods.push(o.levels.map(l => ({ d: l.distance, vis: l.object.visible }))); });
          const M = new (w.camera.camera.matrixWorld.constructor)(), inst = []; for (const m of group.children) if (m.isInstancedMesh) for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, M); const e = M.elements; if (e[0] || e[2]) inst.push({ x: +e[12].toFixed(1), z: +e[14].toFixed(1), d: +Math.hypot(e[12] - f.x, e[14] - f.z).toFixed(1) }); }
          inst.sort((a, b) => a.d - b.d);
          const p = pulled[0]?.position; return { group: true, foot: { x: +f.x.toFixed(1), z: +f.z.toFixed(1) }, nearestInstanced: inst.slice(0, 2), pulled: pulled.length, d: p ? +Math.hypot(p.x - f.x, p.z - f.z).toFixed(1) : null, lods }; });
        scenario.kerb = { before: await probe() };
        if (scenario.kerb.before.pulled) {
          await page.evaluate(() => { const w = window.__gtasf.world; let scene = w.camera.camera; for (const c of w.fleet?.cars?.values?.() ?? []) { scene = c.model.root; break; } while (scene.parent) scene = scene.parent;
            let car; scene.traverse(o => { if (o.name === 'Kerbside parked cars') car = o.children.find(c => !c.isInstancedMesh); });
            scene.onBeforeRender = (_r, _s, cam) => { const p = car.position, yaw = car.rotation.y; cam.position.set(p.x + Math.sin(yaw + .9) * 2.6, p.y + 1.5, p.z + Math.cos(yaw + .9) * 2.6); cam.lookAt(p.x, p.y + .6, p.z); cam.updateMatrixWorld(); }; });
          await page.waitForTimeout(4000);
          scenario.kerb.close = await probe();
          await page.screenshot({ path: `${out}/${name}-kerb-close.png` });
        }
      }
      // GTASF_PHONE_CARCLOSE=1 (carNearDetail evidence): frame the fleet car nearest the player from ~2.5 m, twice (the near
      // HD level loads lazily once the car is within 14 m of the camera, so the second frame shows it if it arrived).
      if (process.env.GTASF_PHONE_CARCLOSE === '1') {
        const car = await page.evaluate(() => {
          const w = window.__gtasf.world, f = w.foot; let best, bd = Infinity;
          for (const c of w.fleet.cars.values()) { const p = c.model.root.position, d = Math.hypot(p.x - f.x, p.z - f.z); if (d < bd) { bd = d; best = c; } }
          if (!best) return null; let scene = best.model.root; while (scene.parent) scene = scene.parent;
          scene.onBeforeRender = (_r, _s, cam) => { const p = best.model.root.position, yaw = best.model.root.rotation.y;
            cam.position.set(p.x + Math.sin(yaw + .9) * 2.6, p.y + 1.5, p.z + Math.cos(yaw + .9) * 2.6); cam.lookAt(p.x, p.y + .6, p.z); cam.updateMatrixWorld(); };
          return { kind: best.data.kind, distance: +bd.toFixed(1) };
        });
        // First-approach stall: the longest frame in the 3 s after the camera moves in (lazy HD load + first draw).
        const approach = await page.evaluate(() => new Promise(resolve => { let last = performance.now(), max = 0, n = 0; const end = last + 3000;
          const f = t => { max = Math.max(max, t - last); last = t; n++; if (t < end) requestAnimationFrame(f); else resolve({ maxFrameMs: +max.toFixed(1), frames: n }); }; requestAnimationFrame(f); }));
        if (car) Object.assign(car, approach);
        // carNearDetail load marks + the longest long task within [mark - 200 ms, mark + 1.5 s] (load/decode/warm/first draw).
        scenario.carNearMarks = await page.evaluate(() => performance.getEntriesByType('mark').filter(m => m.name.startsWith('carNearDetail:')).map(m => {
          const near = (window.__gtasfLongTasks ?? []).filter(t => t.start >= m.startTime - 200 && t.start <= m.startTime + 1500);
          return { name: m.name, at: Math.round(m.startTime), worstTaskMs: Math.round(Math.max(0, ...near.map(t => t.duration))), tasks: near.length };
        }));
        for (const tag of ['first', 'settled']) { await page.waitForTimeout(tag === 'first' ? 300 : 2500); await page.screenshot({ path: `${out}/${name}-car-${tag}.png` }); }
        await page.evaluate(() => { const w = window.__gtasf.world; for (const c of w.fleet.cars.values()) { let s = c.model.root; while (s.parent) s = s.parent; s.onBeforeRender = () => {}; break; } });
        scenario.carClose = car;
      }
      // Profile AFTER the retained timing window, so profiling overhead cannot affect its budget.
      if (process.env.GTASF_PHONE_PROFILE === '1') {
        scenario.sceneProfile = await bounded(page.evaluate(async () => {
          const world = window.__gtasf.world;
          let scene = world.fleet.cars.values().next().value?.model.root;
          while (scene?.parent) scene = scene.parent;
          if (!scene?.isScene) throw new Error('Cannot locate mounted game scene for profiling');
          function inventory(root) {
            const materials = new Set();
            let objects = 0, meshes = 0, triangles = 0, autoMatrices = 0, visibleMeshes = 0;
            root.traverse(object => {
              objects++; if (object.matrixAutoUpdate) autoMatrices++;
              if (!object.isMesh) return;
              meshes++;
              let visible = true;
              for (let p = object; p; p = p.parent) visible &&= p.visible;
              if (visible) visibleMeshes++;
              for (const material of [object.material].flat()) materials.add(material.uuid);
              triangles += (object.geometry.index?.count ?? object.geometry.attributes.position?.count ?? 0) / 3
                * (object.isInstancedMesh ? object.count : 1);
            });
            return { name: root.name, type: root.type, position: root.position.toArray(), objects, meshes, visibleMeshes,
              triangles, autoMatrices, materials: materials.size };
          }
          const structure = { total: inventory(scene), children: scene.children.map(inventory)
            .sort((a, b) => b.objects - a.objects) };
          const gl = document.querySelector('#world').getContext('webgl2');
          const methods = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'];
          const originals = Object.fromEntries(methods.map(key => [key, gl[key]]));
          const draws = Object.fromEntries(methods.map(key => [key, 0]));
          const originalMatrix = scene.updateMatrixWorld;
          const costs = {}, restoreUpdates = [];
          const renderedRoots = scene.children.map(root => ({ name: root.name, position: root.position.toArray(), calls: 0 }));
          const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2'), gpuQueries = [];
          const beforeScene = scene.onBeforeRender, afterScene = scene.onAfterRender;
          let activeQuery = null;
          const measuredUpdates = [['fleet', world.fleet], ['camera', world.camera], ['map', world.map],
            ['radar', world.radar], ['streetProps', world.streetProps], ['parodyBillboards', world.parodyBillboards],
            ['roadDetails', world.roadDetails], ['pedestrians', world.ferryPedestrians], ['coffeeQueue', world.coffeeQueue],
            ['doloresWeekend', world.doloresWeekend], ['angels', world.angels], ['funding', world.funding]];
          let matrixMs = 0, matrixCalls = 0;
          const frameBefore = window.__gtasf.frame, start = performance.now();
          try {
            scene.updateMatrixWorld = function (...args) {
              const before = performance.now();
              try { return originalMatrix.apply(this, args); }
              finally { matrixMs += performance.now() - before; matrixCalls++; }
            };
            if (timer) {
              scene.onBeforeRender = function (...args) {
                const result = beforeScene.apply(this, args);
                activeQuery = gl.createQuery(); gpuQueries.push(activeQuery);
                gl.beginQuery(timer.TIME_ELAPSED_EXT, activeQuery);
                return result;
              };
              scene.onAfterRender = function (...args) {
                if (activeQuery) { gl.endQuery(timer.TIME_ELAPSED_EXT); activeQuery = null; }
                return afterScene.apply(this, args);
              };
            }
            for (const key of methods) gl[key] = function (...args) { draws[key]++; return originals[key].apply(this, args); };
            scene.children.forEach((root, index) => root.traverse(object => {
              if (!object.isMesh && !object.isSprite && !object.isLine) return;
              const original = object.onBeforeRender;
              object.onBeforeRender = function (...args) { renderedRoots[index].calls++; return original.apply(this, args); };
              restoreUpdates.push(() => { object.onBeforeRender = original; });
            }));
            for (const [name, owner] of measuredUpdates) {
              if (typeof owner?.update !== 'function') continue;
              const original = owner.update, cost = costs[name] = { calls: 0, ms: 0, maxMs: 0 };
              owner.update = function (...args) {
                const before = performance.now();
                try { return original.apply(this, args); }
                finally { const ms = performance.now() - before; cost.ms += ms; cost.calls++; cost.maxMs = Math.max(cost.maxMs, ms); }
              };
              restoreUpdates.push(() => { owner.update = original; });
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
          } finally {
            scene.updateMatrixWorld = originalMatrix;
            if (activeQuery) gl.endQuery(timer.TIME_ELAPSED_EXT);
            scene.onBeforeRender = beforeScene; scene.onAfterRender = afterScene;
            for (const key of methods) gl[key] = originals[key];
            for (const restore of restoreUpdates) restore();
          }
          const gpu = { supported: Boolean(timer), scope: 'scene pass only; excludes post',
            disjoint: timer ? gl.getParameter(timer.GPU_DISJOINT_EXT) : null, pending: 0, samplesMs: [] };
          for (const query of gpuQueries) {
            if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
              if (!gpu.disjoint) gpu.samplesMs.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
            } else gpu.pending++;
            gl.deleteQuery(query);
          }
          return { diagnosticOnly: true, elapsedMs: performance.now() - start,
            frames: window.__gtasf.frame - frameBefore, matrixMs, matrixCalls, draws, costs, gpu, structure,
            renderedRoots: renderedRoots.sort((a, b) => b.calls - a.calls) };
        }), 30_000, `${name} diagnostic scene profiling`);
        await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
        await page.waitForTimeout(1500);
        const { profile } = await cdp.send('Profiler.stop');
        await writeFile(`${out}/${name}.cpuprofile`, JSON.stringify(profile));
        await cdp.send('Profiler.disable');
      }
      }
      console.log(`PHONE_PERF:${name} ${JSON.stringify(scenario.stats)}${scenario.steadyStats ? ` steady=${JSON.stringify(scenario.steadyStats)}` : ''} passed=${scenario.passed}`);
    } catch (error) {
      scenario.passed = false;
      scenario.failure = error.stack ?? String(error);
      await page.screenshot({ path: `${out}/${name}-failed.png`, timeout: 10_000 }).catch(() => {});
      console.error(`PHONE_PERF:${name} ${scenario.failure}`);
    } finally {
      scenario.thermalAfter = thermal(); scenario.finishedAt = new Date().toISOString(); await context.close();
      // Screenshot/profile failures and errors after timing must never leave a stale passing result.
      scenario.passed = scenario.passed && !scenario.failure && !scenario.errors.length && !scenario.httpErrors.length;
      await save();
    }
  }
  report.passed = !crowd && report.scenarios.length === 2 && report.scenarios.every(s => s.passed);
} catch (error) { report.failure = error.stack ?? String(error); console.error(report.failure); }
finally {
  await crowd?.stop();
  await browser?.close();
  if (server) { server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done)); }
  await pool?.close();
  report.finishedAt = new Date().toISOString(); report.host.loadavgAfter = loadavg(); await save();
  console.log(`PHONE_PERF_REPORT:${out}/report.json`);
  if (!report.passed) process.exitCode = 1;
}
