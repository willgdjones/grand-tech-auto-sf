// Combat pre-enable gates. Runs against a COMBAT-ON stack (GTASF_GATES_URL) — stand one up with
//   tools/combat-stack.sh up   then:  GATES=1,2,3 GTASF_GATES_URL=http://localhost:5374 node tools/_combat-gates.mjs
//   gate 3: 18+ age gate + gore toggle shots; confirm DECLINING removes the gate and leaves the game
//           fully playable with combat hidden (combat.started === false, no combat HUD).
//   gate 2: combat HUD + controls look (phone 1080x2400 DPR2.75 + desktop); no overlap with existing HUD.
//   gate 1: ferry phone-Low perf under combat load (two clients: A measured @4x CPU throttle while A shoots
//           B → real wanted → SFPD spawn; firing held through 45s warmup + 120 samples). Gate >=30fps / p95<=50ms.
// Run subsets with GATES=3,2,1 (default all).
import { chromium } from '@playwright/test';
import { mkdir, writeFile, stat } from 'node:fs/promises';

const base = process.env.GTASF_GATES_URL ?? 'http://localhost:5374';
const perfOut = process.env.GTASF_PERF_OUT ?? `docs/perf/combat-enable-${new Date().toISOString().replace(/[:.]/g,'-')}`;
const lookOut = 'docs/sf-data/combat';
const FERRY = process.env.GTASF_GATES_AT ?? '37.7955,-122.3937';
// GTASF_GATES_TIME=noon|night|<hour>: pin the game clock (the default follows the real clock, so a night run renders the
// heavier night scene — runs at different hours weren't comparable, 2026-10-18).
const GATES_TIME = process.env.GTASF_GATES_TIME ? `&time=${encodeURIComponent(process.env.GTASF_GATES_TIME)}` : '';
const GATES = (process.env.GATES ?? '3,2,1').split(',').map(s => s.trim());
const PHONE = { viewport: { width: 1080, height: 2400 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }; // perf config (conservative, matches the phone-perf gate)
const PHONE_LOOK = { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }; // TRUE 1080x2400 physical: CSS width <701 so mobile touch controls + fire button render
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 };
const BUILD_NOTE = process.env.GTASF_GATES_NOTE ?? 'PROD build (vite build of a combat-on snapshot) served via vite preview; /api → combat-on worker. Gate: mean>=30fps / p95<=50ms.';
await mkdir(perfOut, { recursive: true }); await mkdir(lookOut, { recursive: true });
const log = []; const note = s => { log.push(s); console.log(s); };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding'] });
const shot = async (page, dir, name) => { const p = `${dir}/${name}.png`; await page.screenshot({ path: p }); note(`  shot ${name}: ${(await stat(p)).size}B`); return p; };

async function waitReady(page) {
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90000 });
}

// What modal/overlay is currently blocking play? (checkVisibility — the fixed/opacity-animated overlays
// report offsetParent === null even while on screen, so offsetParent can't be used.)
const blockingState = page => page.evaluate(() => {
  const vis = sel => { const e = document.querySelector(sel); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); };
  // The SA intro fades in at opacity 0; detect it by its always-opaque SKIP button too.
  return { ageGate: vis('.gt-age-gate-enter'), intro: vis('.gt-sa-intro') || vis('.gt-sa-intro__skip'),
    identity: vis('.gt-identity-go'), funding: !!document.querySelector('.gt-funding-onboarding[open]') };
});

// Click through whatever onboarding modal is up, in any order, until the view is clear. Clears the age gate
// too (accept) when askAgeGate is 'enter'. Returns once nothing is blocking (or the deadline passes).
async function clearModals(page, { ageGate = 'enter', timeoutMs = 35000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let clearStreak = 0; // onboarding modals mount ~1-2s AFTER accept, so require a SUSTAINED clear state.
  while (Date.now() < deadline) {
    const b = await blockingState(page);
    const blocked = (b.ageGate && ageGate === 'enter') || b.funding || b.identity || b.intro;
    if (!blocked) { if (++clearStreak >= 3) return true; await page.waitForTimeout(700); continue; }
    clearStreak = 0;
    if (b.ageGate && ageGate === 'enter') { try { await page.locator('.gt-age-gate-enter').click({ timeout: 2500 }); } catch {} await page.waitForTimeout(400); continue; }
    if (b.funding) {
      try { const d = page.locator('.gt-funding-onboarding[open]');
        await d.getByLabel('Startup name', { exact: true }).fill('Cop');
        await d.getByLabel('Your nickname', { exact: true }).fill('c');
        await d.getByRole('button', { name: 'Save startup' }).click({ timeout: 3000 });
      } catch {} await page.waitForTimeout(600); continue;
    }
    if (b.identity) { try { await page.locator('.gt-identity-go').click({ timeout: 3000 }); } catch {} await page.waitForTimeout(500); continue; }
    if (b.intro) {
      // Synthetic DOM click dismisses the carousel reliably (a real pointer force-click gets intercepted
      // by the intro scrim); fall back to Enter to advance a slide if the skip button isn't there yet.
      const clicked = await page.evaluate(() => { const s = document.querySelector('.gt-sa-intro__skip'); if (s) { s.click(); return true; } return false; });
      if (!clicked) { try { await page.keyboard.press('Enter'); } catch {} }
      await page.waitForTimeout(500); continue;
    }
  }
  return false;
}

// Full entry for a COMBAT client: accept the 18+ gate, wait ready, clear onboarding so aim/fire work.
async function enterCombat(page) {
  // The 18+ gate is deferred to the first combat action (funnel fix): get the world up, clear onboarding, then ask
  // for combat and accept. A legacy build that still pops the gate on load is accepted the same way.
  await waitReady(page);
  await clearModals(page);
  if (!(await page.evaluate(() => window.__gtasfCombat?.state?.().started === true))) {
    await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
    try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 15000 }); await b.click(); } catch {}
  }
  await clearModals(page);
  // Combat HUD mounts on accept; wait for it so look/overlap shots aren't taken mid-onboarding.
  try { await page.locator('.gt-combat-hud').waitFor({ state: 'visible', timeout: 8000 }); } catch {}
  await page.waitForTimeout(600);
}

// ---------- GATE 3: 18+ gate + gore toggle + DECLINE leaves the game playable (combat hidden) ----------
async function gate3() {
  note('[gate 3] 18+ click-through + gore toggle + decline-leaves-game-playable');
  const ctx = await browser.newContext(PHONE); const page = await ctx.newPage(); page.setDefaultTimeout(90000);
  const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0,160)));
  await page.goto(`${base}/?at=${FERRY}&preset=low&bot=1${GATES_TIME}`, { waitUntil: 'domcontentloaded' });
  // The 18+ gate is deferred (epic .1): it opens on the first combat attempt, not at boot. Ask for combat once READY.
  await page.waitForFunction(() => window.__gtasf?.ready, null, { timeout: 180000 });
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  await page.locator('.gt-age-gate').waitFor({ state: 'visible', timeout: 90000 });
  await page.waitForTimeout(500); await shot(page, lookOut, 'enable-18gate');
  const hasGoreToggle = await page.locator('.gt-age-gate-gore').count() > 0;
  note(`  gore toggle present on gate: ${hasGoreToggle}`);
  // DECLINE: click Leave. With the fix, the gate removes itself and combat never starts.
  await page.locator('.gt-age-gate-leave').click();
  await page.waitForTimeout(1200);
  const afterDecline = await page.evaluate(() => {
    const vis = sel => { const e = document.querySelector(sel); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); };
    return { gateStillUp: vis('.gt-age-gate'),
      combatStarted: window.__gtasfCombat?.state?.().started ?? null,
      combatHudVisible: vis('.gt-combat-hud'),
      ready: window.__gtasf?.ready, connected: document.querySelector('#world')?.dataset.connected };
  });
  note(`  after DECLINE: ${JSON.stringify(afterDecline)}`);
  // Prove the base game is now fully reachable: clear the normal onboarding (no age gate in the way) and
  // confirm the regular HUD comes up with combat still hidden.
  const cleared = await clearModals(page, { ageGate: 'enter', timeoutMs: 25000 });
  await page.waitForTimeout(800);
  const playable = await page.evaluate(() => {
    const vis = sel => { const e = document.querySelector(sel); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); };
    return { cleared: true,
      ready: window.__gtasf?.ready, connected: document.querySelector('#world')?.dataset.connected,
      radarVisible: vis('.gt-radar'),
      anyModalOpen: [...document.querySelectorAll('dialog[open]')].some(d => d.checkVisibility()),
      ageGatePresent: vis('.gt-age-gate'),
      combatStarted: window.__gtasfCombat?.state?.().started ?? null,
      combatHudVisible: vis('.gt-combat-hud') };
  });
  note(`  playable after decline (modalsCleared=${cleared}): ${JSON.stringify(playable)}`);
  await shot(page, lookOut, 'enable-18decline');
  // Re-enable path: Game Options → Mature content → "Enable mature content (18+)" brings the gate back.
  let reEnable = null;
  try {
    // Phones fold Game options into the ☰ pause menu: ☰ .gt-pause-launch → #movement-mode (City actions) → options.
    if (await page.locator('.gt-pause-launch').isVisible().catch(() => false)) { await page.locator('.gt-pause-launch').click(); await page.waitForTimeout(500); }
    const launcher = page.locator('#movement-mode, button:has-text("Game options")').first();
    if (await launcher.isVisible({ timeout: 2000 })) {
      await launcher.click(); await page.waitForTimeout(500);
      const btn = page.getByRole('button', { name: /Enable mature content/i });
      const present = await btn.count() > 0;
      if (present) { await btn.click(); await page.waitForTimeout(800); }
      reEnable = { optionPresent: present, gateReopened: await page.evaluate(() => !!document.querySelector('.gt-age-gate')) };
    } else reEnable = { launcherFound: false };
  } catch (e) { reEnable = { error: String(e).slice(0,120) }; }
  note(`  re-enable via Game Options: ${JSON.stringify(reEnable)}`);
  note(`RESULT ${!afterDecline.gateStillUp && afterDecline.combatStarted === false && playable.radarVisible && !playable.anyModalOpen && reEnable?.gateReopened ? 'PASS' : 'FAIL'} gate 3: decline leaves the game playable, re-enable reopens the gate`);
  await ctx.close();
  return { hasGoreToggle, afterDecline, playable, reEnable, errs };
}

// ---------- GATE 2: HUD + controls look + overlap ----------
async function gate2(device, label) {
  note(`[gate 2] combat HUD + controls look — ${label}`);
  const ctx = await browser.newContext(device); const page = await ctx.newPage(); page.setDefaultTimeout(90000);
  const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0,160)));
  await page.goto(`${base}/?at=${FERRY}&preset=low&bot=1${GATES_TIME}`, { waitUntil: 'domcontentloaded' });
  await enterCombat(page);
  await page.evaluate(() => { window.__gtasfCombat.giveWeapon('smg'); window.__gtasfCombat.selectWeapon('smg'); window.__gtasfCombat.addArmour(60); window.__gtasfCombat.setWanted(3); });
  await page.waitForTimeout(1500); await shot(page, lookOut, `enable-hud-${label}`);
  // Overlap measure on the STEADY HUD (before opening the wheel — the wheel is a centre-screen transient, and
  // Escape would open the pause menu, so never toggle it here). Visibility via checkVisibility (offsetParent is
  // null for the fixed-position HUD, so it can't be used). Existing-HUD selectors from toastLayout.ts.
  const overlaps = await page.evaluate(() => {
    const vis = el => el && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const box = sel => { for (const s of sel.split(',')) { const el = document.querySelector(s.trim()); if (vis(el)) { const r = el.getBoundingClientRect(); if (r.width > 1 && r.height > 1) return { left:+r.left.toFixed(0), top:+r.top.toFixed(0), right:+r.right.toFixed(0), bottom:+r.bottom.toFixed(0) }; } } return null; };
    const hit = (a,b) => a && b && !(a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom);
    const combat = { hud: box('.gt-combat-hud'), fire: box('.gt-combat-fire-btn') };
    const existing = { founderHud: box('.gt-hud'), minimap: box('.gt-radar'), quest: box('.gt-street-hud, .gt-sa-mission'),
      station: box('.gt-hud-radio'), stick: box('.gtasf-touch.on .stick'), buttons: box('.gtasf-touch.on .buttons'), chat: box('.gt-chat-launch') };
    const report = {};
    for (const [cn, cb] of Object.entries(combat)) for (const [en, eb] of Object.entries(existing)) if (hit(cb, eb)) report[`${cn}x${en}`] = { combat: cb, existing: eb };
    return { combatBoxes: combat, existingBoxes: existing, overlaps: report, vw: innerWidth, vh: innerHeight };
  });
  note(`  ${label} overlap: ${JSON.stringify(overlaps.overlaps)} | combat=${JSON.stringify(Object.fromEntries(Object.entries(overlaps.combatBoxes).map(([k,v])=>[k,!!v])))} existing=${JSON.stringify(Object.fromEntries(Object.entries(overlaps.existingBoxes).map(([k,v])=>[k,!!v])))}`);
  // Now open the weapon wheel just for the look shot (center-screen transient; not part of the overlap measure).
  await page.evaluate(() => window.__gtasfCombat.openWheel());
  await page.waitForTimeout(600); await shot(page, lookOut, `enable-wheel-${label}`);
  await ctx.close();
  return { overlaps, errs };
}

// Aim A's camera at B (both at the same ?at=, point-blank) + fire bursts until wanted rises → SFPD spawn on A.
async function pvpRaiseWanted(A, B) {
  const fa = await A.page.evaluate(() => { const f = window.__gtasf.world.foot; return { x: f.x, z: f.z }; });
  const fb = await B.page.evaluate(() => { const f = window.__gtasf.world.foot; return { x: f.x, z: f.z }; });
  const yaw = Math.atan2(fb.x - fa.x, fb.z - fa.z);
  await A.page.evaluate(y => { const c = window.__gtasf?.world?.camera; if (c && 'yaw' in c) try { c.yaw = y; } catch {} }, yaw);
  for (let i = 0; i < 8; i++) { await A.page.evaluate(() => window.__gtasfCombat.fire()); await A.page.waitForTimeout(250); await A.page.evaluate(() => window.__gtasfCombat.fireStop()); }
  await A.page.waitForTimeout(1500);
}

// ---------- GATE 1: ferry phone-Low perf under combat load (two clients) ----------
// mode 'firefight' (gate): A shoots B → wanted → SFPD + continuous VFX. mode 'idle': combat stack mounted but
// no firefight (no 2nd client, no wanted/police, no firing) — isolates the standing combat overhead.
async function gate1(mode = 'firefight') {
  const idle = mode === 'idle';
  // mode 'stars' (gtasf-0qct5): a FIXED escalation, so runs compare — no 2nd client; the measured player confesses
  // GTASF_GATE1_STARS worth of crimes (18 heat each, raw COMBAT_CRIME) and then fires skyward every 500 ms (resisting:
  // no bust; gunfire heat is capped below 3★, so the level holds). End stars + whether the player died are logged.
  const starsMode = mode === 'stars', wantStars = Number(process.env.GTASF_GATE1_STARS ?? 3);
  note(`[gate 1:${mode}] ferry phone-Low perf under combat, 45s warmup, 120 samples`);
  let B;
  if (!idle && !starsMode) {
    const bctx = await browser.newContext(PHONE); const bpage = await bctx.newPage(); bpage.setDefaultTimeout(120000);
    await bpage.goto(`${base}/?at=${FERRY}&preset=low&bot=1${GATES_TIME}`, { waitUntil: 'domcontentloaded' });
    await enterCombat(bpage);
    B = { ctx: bctx, page: bpage };
  }
  const ctx = await browser.newContext(PHONE); const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const errs = [], httpErrs = []; page.on('pageerror', e => errs.push(e.message.slice(0,160)));
  page.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,160)); });
  page.on('response', r => { if (r.status() >= 400) httpErrs.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(`${base}/?at=${FERRY}&preset=low&bot=1${GATES_TIME}`, { waitUntil: 'domcontentloaded' });
  await enterCombat(page);
  await page.evaluate(() => { window.__gtasfCombat.giveWeapon('smg'); window.__gtasfCombat.selectWeapon('smg'); });
  if (starsMode) {
    await page.evaluate(() => { const s = WebSocket.prototype.send; WebSocket.prototype.send = function (d) { try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, 1) : null; if (b && b[0] === 2) window.__ws = this; } catch {} return s.call(this, d); }; });
    await page.waitForTimeout(1500); // a MOVE goes out → the world socket is captured
    const heatFor = [0, 1, 22, 42, 65, 90][Math.max(1, Math.min(5, wantStars))];
    for (let i = 0; i < Math.ceil(heatFor / 18); i++) { await page.evaluate(() => window.__ws?.send(Uint8Array.of(0x25, 0))); await page.waitForTimeout(1100); }
    await page.evaluate(() => { const c = window.__gtasf.world.camera; c.setOrbit(c.yaw ?? 0, 10); }); // max pitch: aim at the sky
    await page.evaluate(() => { window.__combatFire = setInterval(() => { try { const c = window.__gtasf.world.camera; c.setOrbit(c.yaw ?? 0, 10); window.__gtasfCombat.fire(); setTimeout(() => window.__gtasfCombat.fireStop(), 120); } catch {} }, 500); });
  } else if (!idle) {
    await pvpRaiseWanted({ page }, B);
    await page.evaluate(() => { window.__combatFire = setInterval(() => { try { window.__gtasfCombat.fire(); setTimeout(() => window.__gtasfCombat.fireStop(), 120); } catch {} }, 500); });
    // GTASF_GATE1_AIMSWEEP=1: aim while firing, like a thumb on the twin-stick — sweep yaw ~20°/s, reversing every 1.5 s
    // (so the view stays in one sector), which moves the aim past the 1° cast-reuse key between shots.
    if (process.env.GTASF_GATE1_AIMSWEEP === '1') await page.evaluate(() => { const t0 = performance.now(); const step = now => { try { window.__gtasf.world.camera.look?.(Math.sin((now - t0) / 1500 * Math.PI) >= 0 ? 3 : -3, 0); } catch {} if (!window.__stopSweep) requestAnimationFrame(step); }; requestAnimationFrame(step); });
  }
  const police = () => page.evaluate(() => { const cars = window.__gtasf.world.fleet?.cars; let n=0; if (cars) for (const c of cars.values()) if (c.data.flags & 0x40) n++; return n; });
  const policeAtStart = await police();
  // GTASF_GATE1_TOGGLE=heliBeam|heli (lane B attribution): after warmup, flip that scene part's visibility every 2 s and
  // bucket frame times by state in the same session (load drift hits both). Needs more samples: GTASF_GATE1_SAMPLES.
  const toggle = process.env.GTASF_GATE1_TOGGLE ?? '', sampleCount = Number(process.env.GTASF_GATE1_SAMPLES ?? (toggle ? 720 : 120));
  // GTASF_GATE1_PROFILE=1: a sampled CPU profile over the measurement window (after warmup); prints the top self-time
  // functions (minified name + bundle:line:col — map them back with the built bundle).
  const profiling = process.env.GTASF_GATE1_PROFILE === '1' ? (async () => { await new Promise(r => setTimeout(r, 45000)); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); })() : null;
  const measurement = await page.evaluate(async ({ warmupMs, sampleCount, toggle }) => {
    const start = performance.now(); const gfb = window.__gtasf.frame; const samples = []; let last, raf, timedOut = false;
    const byState = { on: [], off: [] }; let hidden = false, flippedAt = 0, targets = 0;
    const scene = (() => { let o = window.__gtasf.world.landmarks; while (o?.parent) o = o.parent; return o; })();
    const setHidden = h => { targets = 0; scene?.traverse(o => { if (o.name !== 'GTASF SFPD helicopter') return;
      if (toggle === 'heli') { o.visible = !h; targets++; } else o.traverse(m => { if (m.material?.blending === 2) { m.visible = !h; targets++; } }); }); };
    await new Promise(resolve => { const dl = setTimeout(() => { timedOut = true; cancelAnimationFrame(raf); resolve(); }, 300000 + warmupMs);
      function frame() { const now = performance.now();
        if (last !== undefined && last >= start + warmupMs) { samples.push(now - last); if (toggle && targets) byState[hidden ? 'off' : 'on'].push(now - last); }
        if (toggle && now >= start + warmupMs && now - flippedAt >= 2000) { hidden = !hidden; setHidden(hidden); flippedAt = now; last = undefined; } // skip the flip frame
        else last = now;
        if (samples.length < sampleCount) raf = requestAnimationFrame(frame); else { if (toggle) setHidden(false); clearTimeout(dl); resolve(); } } raf = requestAnimationFrame(frame); });
    const stat = a => { const s = [...a].sort((x, y) => x - y), m = s.reduce((t, n) => t + n, 0) / Math.max(1, s.length); return { n: s.length, meanMs: +m.toFixed(2), p95Ms: s.length ? +s[Math.ceil(s.length * .95) - 1].toFixed(2) : null }; };
    return { samples, timedOut, gfb, gfa: window.__gtasf.frame, vis: document.visibilityState, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, dialogs: document.querySelectorAll('dialog[open]').length,
      ...(toggle ? { toggle: { what: toggle, targets, on: stat(byState.on), off: stat(byState.off) } } : {}) };
  }, { warmupMs: 45000, sampleCount, toggle });
  if (profiling) {
    await profiling; const { profile } = await cdp.send('Profiler.stop');
    const byId = new Map(profile.nodes.map(n => [n.id, n])), self = new Map(); let total = 0;
    profile.samples.forEach((id, i) => { const f = byId.get(id).callFrame, k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}:${f.columnNumber}`, t = profile.timeDeltas[i] ?? 0; total += t; self.set(k, (self.get(k) ?? 0) + t); });
    const idle = [...self].filter(([k]) => /^\(idle\)/.test(k)).reduce((a, [, v]) => a + v, 0);
    note(`  profile: busy ${(100 * (total - idle) / total).toFixed(0)}%; top self: ${[...self].filter(([k]) => !/^\((idle|program|garbage collector)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${(100 * v / total).toFixed(1)}% ${k}`).join(' | ')}`);
    const gc = self.get('(garbage collector) :-1:-1') ?? 0, program = self.get('(program) :-1:-1') ?? 0;
    note(`  profile: gc ${(100 * gc / total).toFixed(1)}%, program ${(100 * program / total).toFixed(1)}%`);
  }
  await page.evaluate(() => { clearInterval(window.__combatFire); window.__stopSweep = true; try { window.__gtasfCombat.fireStop(); } catch {} });
  if (process.env.GTASF_GATE1_CASTSTATS === '1') note(`  cast stats: ${JSON.stringify(await page.evaluate(() => window.__cast ?? null))}`); // needs an instrumented fire.ts
  note(`  ray grids: ${JSON.stringify(await page.evaluate(() => window.__gtasfRayGrid ?? null))}`); // aimRayGrid memory
  if (process.env.GTASF_GATE1_CASTSTATS === '1') note(`  per-object: ${JSON.stringify(await page.evaluate(() => [...(window.__perObj ?? new Map())].sort((a, b) => b[1].ms - a[1].ms).slice(0, 14).map(([k, v]) => `${k} ${v.ms.toFixed(0)}ms/${v.n}`)))}`);
  const policeOnScreen = await police();
  // Escalation at the end of the run: wanted stars + helicopter ('supercar') / SWAT ('bus') police units (policeAir).
  const escalation = await page.evaluate(() => { const cars = window.__gtasf.world.fleet?.cars; let heli = 0, swat = 0;
    if (cars) for (const c of cars.values()) if (c.data.flags & 0x40) { if (c.data.kind === 'supercar') heli++; else if (c.data.kind === 'bus') swat++; }
    return { stars: document.querySelectorAll('.gt-combat-wanted-star.lit').length, heli, swat, dead: window.__gtasfCombat?.state?.().dead ?? null, health: window.__gtasfCombat?.state?.().health ?? null }; });
  await shot(page, perfOut, `ferry-combat${idle ? '-idle' : ''}`);
  const s = [...measurement.samples].sort((a,b)=>a-b); const mean = measurement.samples.reduce((t,n)=>t+n,0)/Math.max(1,measurement.samples.length);
  const stats = { count: s.length, meanMs: +mean.toFixed(2), meanFps: +(1000/mean).toFixed(1), p95Ms: s.length ? +s[Math.ceil(s.length*0.95)-1].toFixed(2) : null, maxMs: s.length ? +s.at(-1).toFixed(2) : null };
  const valid = !measurement.timedOut && stats.count >= 60 && measurement.gfa - measurement.gfb >= stats.count && measurement.vis === 'visible' && measurement.vw === 1080 && measurement.vh === 2400 && measurement.dpr === 2.75 && !measurement.dialogs;
  const passed = valid && stats.meanFps >= 30 && stats.p95Ms <= 50 && !errs.length && !httpErrs.length;
  note(`  perf[${mode}]: ${JSON.stringify(stats)} police(start=${policeAtStart},end=${policeOnScreen}) escalation=${JSON.stringify(escalation)} valid=${valid} passed=${passed} errs=${errs.length} http=${httpErrs.length}`);
  if (measurement.toggle) note(`  toggle[${measurement.toggle.what}] targets=${measurement.toggle.targets} on=${JSON.stringify(measurement.toggle.on)} off=${JSON.stringify(measurement.toggle.off)}`);
  if (errs.length) note(`  errs: ${errs.slice(0,4).join(' | ')}`);
  await ctx.close(); if (B) await B.ctx.close();
  return { mode, stats, ...(measurement.toggle ? { toggle: measurement.toggle } : {}), policeOnScreen, policeAtStart, escalation, valid, passed, errs: errs.slice(0,8), httpErrs: httpErrs.slice(0,8), measurement: { timedOut: measurement.timedOut, vw: measurement.vw, vh: measurement.vh, dpr: measurement.dpr, dialogs: measurement.dialogs } };
}

const result = { startedAt: new Date().toISOString(), base, gate: 'combat-enable', note: BUILD_NOTE, gatesRun: GATES };
try {
  if (GATES.includes('3')) result.gate3 = await gate3();
  if (GATES.includes('2')) result.gate2 = { phone: await gate2(PHONE_LOOK, 'phone'), desktop: await gate2(DESKTOP, 'desktop') };
  if (GATES.includes('1')) result.gate1 = await gate1(process.env.GTASF_GATE1_MODE ?? 'firefight');
} catch (e) { result.failure = String(e.stack ?? e); note(`FAILURE: ${result.failure.split('\n')[0]}`); }
finally {
  await writeFile(`${perfOut}/report.json`, JSON.stringify(result, null, 2) + '\n');
  await writeFile(`${perfOut}/log.txt`, log.join('\n') + '\n');
  note(`REPORT: ${perfOut}/report.json`);
  await browser.close();
}
