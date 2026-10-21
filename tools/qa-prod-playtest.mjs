// LANE E — live-site playtester. Plays prod (or any GTASF_QA_URL) headlessly like a player on a FRESH is_bot device
// (?bot=1 → excluded from boards/funnels), desktop and phone, and records everything a player would trip over:
// console errors, 4xx/5xx, stuck modals, overlapping HUD, dead buttons, wrong text and frame hitches.
//
//   node tools/qa-prod-playtest.mjs                       # both profiles against https://gtasf.com
//   PROFILES=phone STEPS=load,found,pitch node tools/qa-prod-playtest.mjs
//   GTASF_QA_URL=http://localhost:5319 node tools/qa-prod-playtest.mjs
//
// Session 1 (fresh device, default Ferry spawn): READY → found a startup → share card → Pear VC pitch → Seed robotaxi
// + First Round pitch → jobs phone (start + abandon a job).
// Session 2 (same device reloaded at the Ferry plaza = returning player): weapon pickup + 18+ gate → Embarcadero
// Sprint time trial → fire + store robbery → wanted stars → escape → gun shop (weapon wheel) → pilgrimage landmark.
// Never clicks "Share on X", never pays real money; every write lands on its own throwaway is_bot device.
// Writes docs/qa/<date>/run-<hhmm>/<profile>/{*.jpg,result.json}. Exit 1 when any step failed.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = (process.env.GTASF_QA_URL ?? 'https://gtasf.com').replace(/\/$/, '');
const PROFILES = (process.env.PROFILES ?? 'desktop,phone').split(',');
const STEPS = process.env.STEPS ? new Set(process.env.STEPS.split(',')) : null;
const want = s => !STEPS || STEPS.has(s);
const now = new Date();
// Folders follow the SF day (the game's day), not UTC.
const pt = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  .formatToParts(now).map(p => [p.type, p.value]));
const day = process.env.QA_DAY ?? `${pt.year}-${pt.month}-${pt.day}`;
const runDir = process.env.OUT ?? `docs/qa/${day}/run-${pt.hour}${pt.minute}`;

const FERRY = '37.795570,-122.393900,270';
const BAT = { lat: 37.795799, lon: -122.394805 };
const SPRINT = { start: { lat: 37.795347, lon: -122.393962 }, stops: [{ lat: 37.797878, lon: -122.395200, r: 10 }, { lat: 37.799500, lon: -122.397500, r: 12 }] };
const MARKET = { lat: 37.796823, lon: -122.398323 };
const PEAR = { lat: 37.795570, lon: -122.393771 }; // FOUNDER_PLAZA_ANGEL (shared/founder/pitch.ts)
const PILGRIM = { id: 'transamerica', lat: 37.795152, lon: -122.403196 };

const PROFILE_OPTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, query: '' },
  // 1080x2400 physical at DPR 2.75 = a 393x873 CSS phone (what the layout really gets on a Pixel-class phone).
  phone: { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true, query: '&preset=low',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36' },
};

// The global SF frame (tools/map SF_FRAME): ENU around 37.7842,-122.4078, z = -north.
const project = (lat, lon) => { const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f);
  const ecef = (la, lo) => { const phi = la * rad, lam = lo * rad, n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2); return [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - e2) * Math.sin(phi)]; };
  const o = { lat: 37.7842, lon: -122.4078 }, a = ecef(o.lat, o.lon), b = ecef(lat, lon), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const phi = o.lat * rad, lam = o.lon * rad;
  return { x: -Math.sin(lam) * d[0] + Math.cos(lam) * d[1], z: -(-Math.sin(phi) * Math.cos(lam) * d[0] - Math.sin(phi) * Math.sin(lam) * d[1] + Math.cos(phi) * d[2]) }; };

// Frame-hitch sampler + toast capture, installed before any game script.
function initProbe() {
  const w = window; w.__qa = { hitches: [], frames: 0, worst: 0, toasts: [], tag: 'boot' };
  let last = 0;
  const tick = t => { if (last && w.__gtasf?.ready) { const dt = t - last; w.__qa.frames++; if (dt > w.__qa.worst) w.__qa.worst = dt;
      if (dt > 150 && document.visibilityState === 'visible') w.__qa.hitches.push({ ms: Math.round(dt), tag: w.__qa.tag }); }
    last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  // World-socket closes (code + reason) — intermittent mid-session drops showed up on #6.17.
  const WS = window.WebSocket; window.WebSocket = class extends WS { constructor(...a) { super(...a);
    if (/\/api\/world/.test(String(a[0]))) this.addEventListener('close', e => console.warn(`[qa] world ws closed code=${e.code} reason=${e.reason}`)); } };
  // Every notice/toast/hint the player sees, including text swapped into a reused element.
  const seen = new Set();
  new MutationObserver(ms => { for (const m of ms) {
    const el = (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest?.('[class*="toast"],[class*="notice"],[class*="notify"],[class*="hint"]');
    const t = el?.textContent?.trim(); if (!t || seen.has(t)) continue; seen.add(t); w.__qa.toasts.push({ t: t.slice(0, 160), tag: w.__qa.tag }); } })
    .observe(document, { childList: true, subtree: true, characterData: true });
}

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const summary = { base: BASE, startedAt: now.toISOString(), runDir, profiles: {} };

for (const profile of PROFILES) {
  const P = PROFILE_OPTS[profile]; const touch = !!P.hasTouch;
  const out = `${runDir}/${profile}`; mkdirSync(out, { recursive: true });
  const R = { profile, steps: {}, consoleErrors: [], http: [], failedRequests: [], hitches: [], overlaps: [], covered: [], toasts: [] };
  summary.profiles[profile] = R;
  const ctx = await browser.newContext({ viewport: P.viewport, deviceScaleFactor: P.deviceScaleFactor, isMobile: P.isMobile, hasTouch: P.hasTouch, userAgent: P.userAgent });
  await ctx.addInitScript(initProbe);
  const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  let stepTag = 'boot';
  page.on('pageerror', e => R.consoleErrors.push({ step: stepTag, kind: 'pageerror', text: String(e.message).slice(0, 240) }));
  page.on('console', m => { if (m.type() === 'error') R.consoleErrors.push({ step: stepTag, kind: 'console', text: m.text().slice(0, 240) });
    if (m.text().startsWith('[qa] world ws closed')) (R.wsCloses ??= []).push({ step: stepTag, at: new Date().toISOString(), text: m.text().slice(21) }); });
  // Server BUSTED (S2C 0xaa): an arrest respawns the player at SF General and clears wanted, which explains a crime step
  // that ends kilometres from the market with no stars (police AI can catch the scripted walk). Count it per step.
  page.on('websocket', ws => { if (/\/api\/world/.test(ws.url())) ws.on('framereceived', f => { if (typeof f.payload !== 'string' && f.payload[0] === 0xaa) (R.busted ??= []).push({ step: stepTag, at: new Date().toISOString() }); }); });
  page.on('response', r => { if (r.status() >= 400) { const u = new URL(r.url()); R.http.push({ step: stepTag, status: r.status(), method: r.request().method(), path: u.host === new URL(BASE).host ? u.pathname : u.host + u.pathname }); } });
  page.on('requestfailed', r => { const f = r.failure()?.errorText ?? ''; if (!/ERR_ABORTED/.test(f)) R.failedRequests.push({ step: stepTag, url: r.url().slice(0, 160), err: f }); });
  const api = []; page.on('response', r => { const p = new URL(r.url()).pathname; if (p.startsWith('/api/') && !p.startsWith('/api/health') && r.request().method() !== 'GET')
    r.json().then(b => api.push({ step: stepTag, p, http: r.status(), body: JSON.stringify(b).slice(0, 300) })).catch(() => api.push({ step: stepTag, p, http: r.status() })); });
  R.api = api;

  let shotN = 0;
  const shot = async name => { const f = `${out}/${String(++shotN).padStart(2, '0')}-${name}.jpg`; await page.screenshot({ path: f, type: 'jpeg', quality: 70 }).catch(() => {});
    await checkHud?.(name).catch?.(() => {}); await logTime(name).catch(() => {}); return f; }; // every screenshot moment is also an overlap sample (payout cards last 6.5 s)
  // critic N31 (night turns to grey daylight mid-session): root cause = live rain at night -> the rain-overcast grade
  // (rainNightDark off). Per screenshot: the stored time override, the SF clock, Game options open, world mode, and the
  // last /api/weather the client received (rain/fog/cloud). Rain > 0 at night = expect the grey look until rainNightDark.
  let lastWeather = null;
  page.on('response', async r => { try { if (new URL(r.url()).pathname === '/api/weather' && r.ok()) lastWeather = await r.json(); } catch {} });
  const logTime = async tag => {
    const st = await page.evaluate(() => { let ls = null; try { ls = localStorage.getItem('gtasf.timeOfDay'); } catch {}
      const sf = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
      return { ls, sf, optionsOpen: !!document.querySelector('dialog.gt-game-options[open]'), mode: window.__gtasf?.world?.mode ?? null }; });
    const w = lastWeather ? { rain: lastWeather.rain, fog: lastWeather.fog, cloud: lastWeather.cloudCover } : null;
    (R.timeLog ??= []).push({ tag, ...st, weather: w });
  };
  const vis = sel => page.evaluate(s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); }, sel);
  const txt = sel => page.evaluate(s => document.querySelector(s)?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 200) ?? null, sel);
  const press = async (code, ms = 90) => { await page.keyboard.down(code); await page.waitForTimeout(ms); await page.keyboard.up(code); };
  const tap = async sel => { const l = page.locator(sel).first(); if (touch) await l.tap({ timeout: 8000 }); else await l.click({ timeout: 8000 }); };
  // A button that exists but is covered by something else is a dead button for a player — report what covers it.
  const coveredBy = sel => page.evaluate(s => { const e = document.querySelector(s); if (!e) return 'missing'; const r = e.getBoundingClientRect();
    if (!r.width) return 'zero-size'; const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return t && (t === e || e.contains(t)) ? null : t ? `${t.tagName}.${String(t.className).slice(0, 60)}` : 'offscreen'; }, sel);
  const openDialogs = () => page.evaluate(() => [...document.querySelectorAll('dialog[open]')].map(d => d.className));
  const foot = () => page.evaluate(() => { const f = window.__gtasf?.world?.foot; return f ? { x: f.x, z: f.z } : null; });
  const combatState = () => page.evaluate(() => window.__gtasfCombat?.state?.() ?? null);
  const stars = () => page.evaluate(() => document.querySelectorAll('.gt-combat-wanted-star.lit').length);
  // Fixed-position HUD elements whose boxes overlap (excluding nesting). Wide toasts over the map count too.
  const overlaps = tag => page.evaluate(tag => {
    const els = [...document.querySelectorAll('body *')].filter(e => { if (!/gt-/.test(String(e.className))) return false; const cs = getComputedStyle(e);
      if (cs.position !== 'fixed' || !e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      const r = e.getBoundingClientRect(); return r.width > 8 && r.height > 8 && r.width < innerWidth * 0.95 && r.height < innerHeight * 0.95 && cs.pointerEvents !== 'none'; });
    const res = [];
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = els[i], b = els[j]; if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 6 && h > 6) res.push({ tag, a: String(a.className).split(' ')[0], b: String(b.className).split(' ')[0], px: Math.round(w * h) }); }
    return res; }, tag);
  // Core HUD readouts a player must always see: report anything drawn over their centre (a panel parked on the money).
  const HUD_CORE = ['.gt-hud-money', '.gt-founder-valuation', '.gt-combat-wanted', '.gt-combat-hud', '.gt-radar, .gt-minimap', '.gt-founder-quest'];
  const coveredHud = tag => page.evaluate(([tag, sels]) => { const res = [];
    for (const sel of sels) { const e = document.querySelector(sel); if (!e || !e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const r = e.getBoundingClientRect(); if (r.width < 4) continue;
      for (const [fx, fy] of [[0.5, 0.5], [0.15, 0.5], [0.85, 0.5]]) { const t = document.elementFromPoint(r.x + r.width * fx, r.y + r.height * fy);
        if (t && !e.contains(t) && !t.contains(e) && /gt-/.test(String(t.className)) && !document.querySelector('dialog[open]')?.contains(t)) { res.push({ tag, covered: sel, by: String(t.closest('[class*="gt-"]')?.className ?? t.className).split(' ')[0] }); break; } } }
    return res; }, [tag, HUD_CORE]);
  // Visual overlaps between text-bearing HUD pieces, INCLUDING pointer-events:none ones: overlaps() skips those (noise from
  // wrappers) and elementFromPoint passes through them, so DISPATCH over the street label (N25), the phone vitals over
  // PITCH NOW (N26) and the payout card over the valuation pill (N27) were never reported. Curated list; nesting excluded.
  const HUD_VISUAL = ['.gt-founder-quest', '.gt-founder-quest-cta', '.gt-founder-valuation', '.gt-combat-hud', '.gt-funding-toast-title',
    '.gt-funding-toast-amount', '.gt-dispatch', '.gt-police-bark', '.gt-street-hud', '.gt-controls-panel', '.gt-opener-banner', '.gt-opener-call',
    '.gt-drop-banner', '.gt-mission-slab', '.gt-mission-line', '.gt-toast', '.gt-weapon-chip', '.gt-hud-money', '.gt-hud-clock', '.gt-convo', '#trip-status',
    // critic N28: the radio-station toast ('RADIO SOMA') across the event banner title while driving; + other banners
    '.gt-radio-station-toast', '.gt-event-card', '.gt-event-title', '.gt-bounty-banner', '.gt-outbid-banner',
    // critic N34 / lane C centerSlotQueue (5a0ebfdf): the centre moments that must take turns with the payout card
    '.gt-mission-band', '.gt-rank-up', '.gt-sa-stinger',
    // critic N32: the right-edge black square was the EMPTY .gt-voice-status (lane C 7e3a8061; 06f9cac4 on #mayhem-item reverted)
    '#mayhem-item', '.gt-voice-status'];
  // Visible HUD boxes that must never show with no text (N32: an empty .gt-voice-status drew a black square).
  const EMPTY_WATCH = ['.gt-voice-status'];
  const emptyVisible = tag => page.evaluate(([tag, sels]) => sels.flatMap(sel => [...document.querySelectorAll(sel)].filter(e => {
    if (!e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false; const r = e.getBoundingClientRect();
    return r.width > 6 && r.height > 6 && !(e.textContent || '').trim(); }).map(e => { const r = e.getBoundingClientRect(); return { tag, sel, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }; })), [tag, EMPTY_WATCH]);
  const visualOverlaps = tag => page.evaluate(([tag, sels]) => {
    const els = sels.flatMap(sel => [...document.querySelectorAll(sel)].map(e => ({ sel, e }))).filter(({ e }) => {
      if (!e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false; const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; });
    const res = [];
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = els[i], b = els[j];
      if (a.e === b.e || a.e.contains(b.e) || b.e.contains(a.e)) continue;
      const ra = a.e.getBoundingClientRect(), rb = b.e.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 4 && h > 4) res.push({ tag, kind: 'visual', a: a.sel, b: b.sel, w: Math.round(w), h: Math.round(h),
        at: [Math.round(Math.max(ra.left, rb.left)), Math.round(Math.max(ra.top, rb.top))] }); }
    return res; }, [tag, HUD_VISUAL]);
  // Touch profiles: visible HUD text that only makes sense with a keyboard/mouse ('Press E to get off' beside an EXIT RIDE
  // button, critic N30). Fixed-position gt-* / #prompt / #trip-status text only; one entry per distinct phrase.
  const KEYBOARD_TEXT = /\bPress (?:E|F|Q|Z|Tab|Space|Shift|Esc|Enter|[\[\]])(?![a-z])|\bWASD\b|\bright[- ]mouse\b|\b(?:Click|Hold V)\b|\bSpace (?:handbrake|to)\b/;
  const keyboardText = tag => page.evaluate(([tag, src]) => { const re = new RegExp(src); const res = [];
    for (const e of document.querySelectorAll('[class*="gt-"], #prompt, #trip-status')) {
      if (e.children.length > 3 || !e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      let a = e, onHud = false; // on the HUD = itself or an ancestor is position:fixed (world-space nameplates etc. excluded)
      while (a && a !== document.body) { if (getComputedStyle(a).position === 'fixed' || a.id === 'prompt' || a.id === 'trip-status') { onHud = true; break; } a = a.parentElement; }
      if (!onHud) continue;
      const t = (e.textContent || '').replace(/\s+/g, ' ').trim(); const m = t.match(re);
      if (m && t.length < 200) res.push({ tag, el: String(e.className || e.id).split(' ')[0], match: m[0], text: t.slice(0, 120) }); }
    return res; }, [tag, KEYBOARD_TEXT.source]);
  const checkHud = async tag => {
    for (const e of await emptyVisible(tag)) if (!(R.emptyVisible ??= []).some(x => x.sel === e.sel)) R.emptyVisible.push(e);
    if (touch) for (const k of await keyboardText(tag)) if (!(R.keyboardText ??= []).some(x => x.text === k.text)) R.keyboardText.push(k);
    for (const o of await overlaps(tag)) if (!R.overlaps.some(x => x.a === o.a && x.b === o.b)) R.overlaps.push(o);
    for (const o of await visualOverlaps(tag)) if (!R.overlaps.some(x => x.a === o.a && x.b === o.b)) R.overlaps.push(o);
    for (const c of await coveredHud(tag)) if (!R.covered.some(x => x.covered === c.covered && x.by === c.by)) R.covered.push(c);
  };
  async function clearIntro() {
    for (let i = 0; i < 12; i++) {
      const b = await page.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); };
        return { intro: v('.gt-sa-intro__skip'), id: v('.gt-identity-go') }; });
      if (!b.intro && !b.id) break;
      if (b.intro) { try { await tap('.gt-sa-intro__skip'); } catch { await page.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click()); } }
      else if (b.id) { try { await tap('.gt-identity-go'); } catch {} }
      await page.waitForTimeout(500);
    }
  }
  // Walk the SERVER pose in small accepted steps (the client MOVE passes checkMovement, unlike a teleport).
  async function walkTo(t, stop = 3, maxMs = 150000) {
    const target = project(t.lat, t.lon); const t0 = Date.now(); let d = Infinity, last = Infinity, stuck = 0, i = 0, prevPos = null;
    while (Date.now() - t0 < maxMs) {
      const r = await page.evaluate(({ tx, tz, stop }) => { const f = window.__gtasf.world.foot; const dx = tx - f.x, dz = tz - f.z, d = Math.hypot(dx, dz);
        const c = window.__gtasfCombat?.state?.(); const before = { x: f.x, z: f.z, hp: c?.health, stars: Number(document.querySelector('[class*="wanted"]')?.dataset?.stars ?? NaN) };
        if (d > stop) { const k = Math.min(0.7, d - stop + 0.1) / d; f.x += dx * k; f.z += dz * k; } return { d, before }; }, { tx: target.x, tz: target.z, stop });
      d = r.d;
      // A jump the walk didn't make (server respawn after a death or bust, a relocation): record it with the vitals just before.
      if (prevPos && Math.hypot(r.before.x - prevPos.x, r.before.z - prevPos.z) > 200)
        (R.jumps ??= []).push({ step: stepTag, at: new Date().toISOString(), jumpM: Math.round(Math.hypot(r.before.x - prevPos.x, r.before.z - prevPos.z)), hpBefore: prevPos.hp, hpAfter: r.before.hp });
      prevPos = r.before;
      if (d <= stop + 0.2) break;
      if (++i % 150 === 0) await press('ShiftLeft', 30); // real input so the idle kick never fires
      if (last - d < 0.05) { if (++stuck > 60) break; } else stuck = 0;
      last = d; await page.waitForTimeout(110);
    }
    return Math.round(d);
  }
  async function step(name, fn) {
    if (!want(name)) return;
    stepTag = name; await page.evaluate(n => { if (window.__qa) window.__qa.tag = n; }, name).catch(() => {});
    const t0 = Date.now(); const s = { notes: [] }; R.steps[name] = s;
    try { await fn(s); s.ok = s.ok !== false && !s.fail; } catch (e) { s.ok = false; s.error = String(e?.message ?? e).split('\n')[0].slice(0, 300); }
    s.ms = Date.now() - t0; s.shot = await shot(`${name}-end`);
    // Drain the page probe per step: a reboot recreates window.__qa, which used to lose earlier sessions' notices.
    const q = await page.evaluate(() => { const w = window.__qa; if (!w) return null; const out = { toasts: w.toasts.splice(0), hitches: w.hitches.splice(0) }; return out; }).catch(() => null);
    if (q) { for (const t of q.toasts) R.toasts.push({ ...t, step: name }); for (const h of q.hitches) R.hitches.push({ ...h, step: name }); s.toasts = q.toasts.map(t => t.t.slice(0, 90)); }
    await checkHud(name).catch(() => {});
    // A failure with world-socket drops in the same step is usually the network (10-19: this laptop's Wi-Fi, kernel
    // LQM-WIFI slow-wifi/PendingIP before each 1006). Say so on the FAIL line so triage starts there.
    const drops = (R.wsCloses ?? []).filter(c => c.step === name).length; if (!s.ok && drops) s.socketDrops = drops;
    console.log(`[${profile}] ${s.ok ? 'PASS' : 'FAIL'} ${name} (${(s.ms / 1000).toFixed(1)}s)${s.error ? ' — ' + s.error : ''}${s.fail ? ' — ' + s.fail : ''}${!s.ok && drops ? ` [${drops} world-socket drop(s) during this step: check the network first]` : ''}`);
  }
  const fail = (s, why) => { s.fail = s.fail ? `${s.fail}; ${why}` : why; s.ok = false; };
  async function openPhone() {
    if (await vis('.gt-mission-phone')) return true;
    if (!touch) { await press('KeyN'); await page.waitForTimeout(700); return vis('.gt-mission-phone'); }
    await tap('.gt-pause-launch'); await page.waitForTimeout(500);
    await tap('#movement-mode'); await page.waitForTimeout(600);
    await page.getByRole('button', { name: /Phone: jobs/ }).first().tap({ timeout: 8000 }); await page.waitForTimeout(900);
    return vis('.gt-mission-phone');
  }
  async function closePhone() { if (await vis('.gt-mission-phone')) { await tap('.gt-mission-phone-close').catch(() => {}); await page.waitForTimeout(400); } }

  async function boot(s, url) {
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 150000 });
    s.readyMs = Date.now() - t0; s.notes.push(`READY+connected in ${(s.readyMs / 1000).toFixed(1)}s`);
    await shot('ready');
    await clearIntro();
    await page.waitForSelector('.gt-mission-phone', { state: 'attached', timeout: 120000 }).then(() => { s.sceneryMs = Date.now() - t0; }).catch(() => s.notes.push('deferred scenery (.gt-mission-phone) never mounted'));
    await clearIntro();
  }

  // ───────────── Session 1: new player ─────────────
  await step('load', async s => { await boot(s, `${BASE}/?bot=1${P.query}`); if (s.readyMs > 60000) fail(s, `slow READY ${s.readyMs}ms`); });

  // PROBE_CARS=1 (lane D, critic N5): what car-like objects are within 8 m of the player at found-end - every LOD (level
  // visibility + parent chain) and every kerb-car instance - to identify the crushed car beside the phone player.
  async function probeCars(s) {
    s.cars = await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot, out = []; let top = w.camera.camera; while (top.parent) top = top.parent;
      const roots = new Set([top]); for (const c of w.fleet?.cars?.values?.() ?? []) { let t = c.model.root; while (t.parent) t = t.parent; roots.add(t); }
      const M = new (w.camera.camera.matrixWorld.constructor)(), chain = o => { const n = []; for (let q = o.parent; q && n.length < 5; q = q.parent) n.push(q.name || q.type); return n.join(' < '); };
      for (const r of roots) r.traverse(o => {
        if (o.isLOD) { const p = o.getWorldPosition(o.position.clone()), d = Math.hypot(p.x - f.x, p.z - f.z); if (d < 8) out.push({ kind: 'lod', d: +d.toFixed(1), chain: chain(o), levels: o.levels.map(l => [l.distance, l.object.visible]), near: o.nearLowLevel !== undefined, onNear: !!o.onNear }); }
        if (o.isInstancedMesh && /kerb/i.test(o.name)) for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, M); const e = M.elements; if (!e[0] && !e[2]) continue; const d = Math.hypot(e[12] - f.x, e[14] - f.z); if (d < 8) out.push({ kind: 'kerb-instance', d: +d.toFixed(1), name: o.name }); }
      });
      return out.sort((a, b) => a.d - b.d).slice(0, 12); });
    s.notes.push('cars ' + JSON.stringify(s.cars));
  }
  await step('found', async s => {
    if (process.env.PROBE_CARS === 'early') { await page.waitForTimeout(+(process.env.PROBE_WAIT_MS ?? 15000)); await probeCars(s); await shot('probe-cars'); }
    await page.waitForSelector('.gt-founder-quest, .gt-opener-banner', { state: 'visible', timeout: 20000 });
    if (await vis('.gt-opener-banner')) {
      // guidedOpener (gtasf-dzrrn): the quest card stays hidden during the opener (critic: clean HUD); its banner is the
      // first objective, and the pitch step plays it through to the partner.
      s.opening = 'guided'; s.quest = (await txt('.gt-opener-banner-objective'))?.replace(/\s+/g, ' ').trim();
      s.notes.push(`guided opener banner: ${s.quest}`); // display-only (pointer-events none); the pitch step checks Skip
      return;
    }
    s.quest = await txt('.gt-founder-quest'); s.notes.push(`quest: ${s.quest}`);
    if (/going up on the Embarcadero|wants your pitch|You founded .*Rename it/i.test(s.quest ?? '')) {
      // actionOpening (#6.21+): no naming modal and no share card; the generated name founds and the billboard swings up.
      // 'You founded X. (Rename it…)' is its first beat (controller.ts autoFound), shown until the save returns; a slow
      // phone can be read here before billboardStep replaces it (10-19 18:3x), so it is the same opening, not a new flow.
      s.opening = 'action';
      await page.waitForFunction(() => /Pear VC/.test(document.querySelector('.gt-founder-quest')?.textContent ?? ''), null, { timeout: 30000 })
        .catch(async () => fail(s, `billboard never handed on to the Pear VC pitch (quest "${await txt('.gt-founder-quest')}")`));
      s.after = await txt('.gt-founder-quest'); s.notes.push(`next quest: ${s.after}`);
      if (process.env.PROBE_CARS === '1') await probeCars(s);
      return;
    }
    if (!/Found your startup/i.test(s.quest ?? '')) fail(s, `unexpected first quest text "${s.quest}"`);
    const cov = await coveredBy('.gt-founder-quest-cta'); if (cov) fail(s, `quest CTA covered by ${cov}`);
    await tap('.gt-founder-quest-cta');
    await page.waitForSelector('.gt-founder-found[open]', { timeout: 8000 });
    await shot('found-card');
    s.name = await txt('.gt-founder-found-name');
    await tap('.gt-founder-found-go');
    await page.waitForFunction(() => !document.querySelector('.gt-founder-found[open]'), null, { timeout: 20000 })
      .catch(async () => fail(s, `found card stuck open: "${await txt('.gt-founder-found-status')}"`));
    // billboard swing → optional share card (dismiss with Done; NEVER the X button)
    await page.waitForSelector('.gt-founder-share[open], dialog.gt-founder-share', { state: 'visible', timeout: 25000 }).then(async () => {
      await shot('share-card'); s.notes.push('share card shown');
      const cov2 = await coveredBy('.gt-founder-share-done'); if (cov2) fail(s, `share Done covered by ${cov2}`);
      await tap('.gt-founder-share-done'); await page.waitForTimeout(600);
      if (await vis('.gt-founder-share-done')) fail(s, 'share card did not close on Done');
    }).catch(() => s.notes.push('no share card within 25s'));
    s.after = await txt('.gt-founder-quest'); s.notes.push(`next quest: ${s.after}`);
    if (!/Pear VC/.test(s.after ?? '')) fail(s, `quest after founding is "${s.after}", expected the Pear VC pitch`);
  });

  // actionOpening: the pitch is an in-world conversation (.gt-convo), not a modal card. Pick a numbered reply, wait for
  // the verdict (+ cheque count-up) and for the conversation to close itself.
  async function talk(s, idx) {
    await page.waitForSelector('.gt-convo:not([hidden]) .gt-convo-choice', { timeout: 8000 });
    await shot('convo'); s.who = await txt('.gt-convo:not([hidden]) .gt-convo-who');
    const cov = await coveredBy('.gt-convo:not([hidden]) .gt-convo-choice'); if (cov) fail(s, `pitch reply covered by ${cov}`);
    await page.locator('.gt-convo:not([hidden]) .gt-convo-choice').nth(idx)[touch ? 'tap' : 'click']();
    await page.waitForFunction(() => { const c = document.querySelector('.gt-convo:not([hidden]) .gt-convo-cheque'); return c && !c.hidden && /\$/.test(c.textContent); }, null, { timeout: 20000 })
      .then(async () => { await page.waitForTimeout(1700); /* the cheque counts up over 1.4 s */ s.cheque = await txt('.gt-convo:not([hidden]) .gt-convo-cheque'); await shot('convo-cheque'); })
      .catch(async () => s.notes.push(`no cheque: "${await txt('.gt-convo:not([hidden]) .gt-convo-line')}"`));
    s.verdict = await txt('.gt-convo:not([hidden]) .gt-convo-line');
    await page.waitForFunction(() => !document.querySelector('.gt-convo:not([hidden])'), null, { timeout: 15000 })
      .catch(() => fail(s, 'pitch conversation never closed after the verdict'));
    s.notes.push(`verdict ${s.verdict} cheque ${s.cheque}`);
  }

  await step('pitch', async s => {
    // Gradual moves on world.driving / world.foot (under the server's speed cap) toward p, stopping `stop` m short.
    const moveTo = async (p, stop, step, maxMs) => { const t0 = Date.now(); let d = Infinity;
      while (Date.now() - t0 < maxMs) { d = await page.evaluate(({ x, z, stop, step }) => { const w = window.__gtasf.world, f = w.mode === 'driver' && w.driving ? w.driving : w.foot;
        const dx = x - f.x, dz = z - f.z, d = Math.hypot(dx, dz); if (d > stop) { const k = Math.min(step, d - stop) / d; f.x += dx * k; f.z += dz * k; } return d; }, { ...p, stop, step });
        if (d <= stop + 0.2) break; await page.waitForTimeout(110); } return Math.round(d); };
    const partnerAt = async () => await page.evaluate(() => { const p = window.__gtasf.world.founderPlazaInvestor?.position; return p ? { x: p.x, z: p.z } : null; }) ?? project(PEAR.lat, PEAR.lon);
    if (await vis('.gt-opener-banner')) {
      // guidedOpener (lane C, gtasf-dzrrn): a new device starts ON FOOT at the Ferry; the partner rings (call card), the
      // banner walks the player through move -> highlighted car -> drive, and the partner waits ~370 m down the
      // Embarcadero. Walking all the way there also counts as arriving (OPENER_ARRIVE_M 28 m). Record the call + each
      // objective, then walk up (same walk as below) to the same Pitch now / conversation.
      s.opening = 'guided'; s.startMode = await page.evaluate(() => window.__gtasf?.world?.mode);
      const objective = async () => (await txt('.gt-opener-banner-objective'))?.replace(/\s+/g, ' ').trim();
      s.openerCall = await txt('.gt-opener-call-who'); s.openerObjectives = [await objective()]; await shot('opener-call');
      const cov = await coveredBy('.gt-opener-skip'); if (cov) fail(s, `opener Skip covered by ${cov}`);
      const partner = await partnerAt(), f0 = await foot();
      s.partnerDistM = f0 ? Math.round(Math.hypot(partner.x - f0.x, partner.z - f0.z)) : null;
      await moveTo(partner, Math.max(2.5, (s.partnerDistM ?? 0) - 8), 0.6, 15000); // 'move' completes after 4 m
      await page.waitForTimeout(800); s.openerObjectives.push(await objective()); await shot('opener-car');
      s.walk = await moveTo(partner, 2.5, 0.6, 150000);
      await page.waitForFunction(() => document.querySelector('.gt-opener-banner')?.hidden !== false, null, { timeout: 8000 })
        .catch(async () => fail(s, `opener banner still up at the partner (objective "${await objective()}")`));
      s.notes.push(`guided opener: call "${s.openerCall}", partner ${s.partnerDistM} m, objectives ${JSON.stringify(s.openerObjectives)}, walk left ${s.walk} m`);
      await page.waitForFunction(() => !!document.querySelector('.gt-convo:not([hidden])') || /Pitch now/i.test(document.querySelector('.gt-founder-quest-cta')?.textContent ?? ''), null, { timeout: 15000 }) // walkUpPitch may open the conversation first
        .catch(async () => fail(s, `no Pitch now at the partner after the opener (quest "${await txt('.gt-founder-quest')}")`));
    } else if (/Drive to .*Pear VC/i.test(await txt('.gt-founder-quest') ?? '')) {
      // openingDrive (lane C, tools/opening-drive-verify.mjs): a new player starts IN a car at Embarcadero/Howard. Drive
      // (gradual moves on world.driving, 2.5 m / 110 ms, under the server's speed cap) to 60 m short of the partner,
      // expect "You made it… get out", E out of the car, walk up; the same Pitch now / E opens the conversation.
      s.opening = 'drive'; s.startMode = await page.evaluate(() => window.__gtasf?.world?.mode); s.notes.push(`opening drive, mode ${s.startMode}`);
      const partner = await partnerAt();
      if (s.startMode === 'driver') {
        s.drive = await moveTo(partner, 60, 2.5, 90000); await shot('opening-drive');
        await page.waitForFunction(() => /You made it/i.test(document.querySelector('.gt-founder-quest')?.textContent ?? ''), null, { timeout: 10000 })
          .catch(async () => fail(s, `no "You made it" within 60 m of the partner (quest "${await txt('.gt-founder-quest')}")`));
        await press('KeyE'); await page.waitForTimeout(1500);
      } else fail(s, `openingDrive quest but the player is ${s.startMode}, not in the opening car`);
      s.walk = await moveTo(partner, 2.5, 0.6, 60000); s.notes.push(`drive left ${s.drive} m, walk left ${s.walk} m`);
      await page.waitForFunction(() => !!document.querySelector('.gt-convo:not([hidden])') || /Pitch now/i.test(document.querySelector('.gt-founder-quest-cta')?.textContent ?? ''), null, { timeout: 15000 }) // walkUpPitch may open the conversation first
        .catch(async () => fail(s, `no Pitch now at the partner (quest "${await txt('.gt-founder-quest')}")`));
    }
    // walkUpPitch (gtasf-8c8wo): walking within 5 m of the partner opens the conversation by itself; PITCH NOW is then
    // hidden behind it, so only tap when the conversation isn't already up.
    if (await vis('.gt-convo')) { s.walkUp = true; s.notes.push('conversation opened by walking up (walkUpPitch)'); }
    else await tap('.gt-founder-quest-cta');
    if (await page.waitForSelector('.gt-convo:not([hidden])', { timeout: 4000 }).then(() => true).catch(() => false)) {
      s.opening = 'action'; await talk(s, 0);
      if (!/\$/.test(s.cheque ?? '')) fail(s, `Pre-seed paid no cheque (verdict "${s.verdict}")`);
      s.valuation = await txt('.gt-hud-money, .gt-founder-valuation, .gt-hud-money-value'); s.notes.push(`valuation HUD: ${s.valuation}`);
      const f0 = await foot(); await press('KeyW', 900); const f1 = await foot();
      if (!touch && f0 && f1 && Math.hypot(f1.x - f0.x, f1.z - f0.z) < 0.5) fail(s, 'player cannot walk (W) after the pitch conversation');
      s.next = await txt('.gt-founder-quest'); s.notes.push(`next quest: ${s.next}`);
      if (!/SEED/i.test(s.next ?? '')) fail(s, `quest after Pre-seed is "${s.next}", expected the Seed meeting`);
      return;
    }
    await page.waitForSelector('.gt-founder-pitch[open]', { timeout: 8000 });
    await shot('pitch-card');
    s.who = await txt('.gt-founder-pitch[open] .gt-founder-pitch-who');
    const cov = await coveredBy('.gt-founder-pitch[open] .gt-founder-pitch-line'); if (cov) fail(s, `pitch line covered by ${cov}`);
    await page.locator('.gt-founder-pitch[open] .gt-founder-pitch-line').first()[touch ? 'tap' : 'click']();
    await page.waitForSelector('.gt-founder-pitch[open] .gt-founder-pitch-result:not([hidden])', { timeout: 20000 })
      .catch(async () => fail(s, `no pitch result: status "${await txt('.gt-founder-pitch[open] .gt-founder-pitch-status')}"`));
    s.verdict = await txt('.gt-founder-pitch[open] .gt-founder-pitch-verdict'); s.cheque = await txt('.gt-founder-pitch[open] .gt-founder-pitch-cheque');
    s.notes.push(`verdict ${s.verdict} cheque ${s.cheque}`);
    await shot('pitch-result');
    await page.locator('.gt-founder-pitch[open] .gt-founder-pitch-done:not(.gt-founder-pitch-skip)').first()[touch ? 'tap' : 'click']();
    await page.waitForTimeout(800);
    const open = await openDialogs(); if (open.length) fail(s, `dialog still open after Continue: ${open.join(',')}`);
    s.valuation = await txt('.gt-hud-money, .gt-founder-valuation, .gt-hud-money-value'); s.notes.push(`valuation HUD: ${s.valuation}`);
    // trap check: the player can move after the pitch
    const f0 = await foot(); await press('KeyW', 900); const f1 = await foot();
    if (!touch && f0 && f1 && Math.hypot(f1.x - f0.x, f1.z - f0.z) < 0.5) fail(s, 'player cannot walk (W) after the pitch closed');
    s.next = await txt('.gt-founder-quest'); s.notes.push(`next quest: ${s.next}`);
  });

  // OBSERVER_VEST=1 (lane D, meshyTierDress remote path): a second ?bot=1 tab B joins beside A at the VC office before
  // A pitches Seed, then watches A's REMOTE avatar: the navy 'tier-dress vest' should appear within 1-2 s of SEED CLOSED
  // with no body swap (same root + same skinned-mesh geometry), and again on creation after B reloads (cached appearance).
  const unproject = (x, z) => { let lat = 37.7842 - z / 111132, lon = -122.4078 + x / (111320 * Math.cos(37.7842 * Math.PI / 180));
    for (let i = 0; i < 3; i++) { const q = project(lat, lon); lat -= (q.z - z) / -111132; lon += (x - q.x) / (111320 * Math.cos(lat * Math.PI / 180)); }
    return { lat: +lat.toFixed(6), lon: +lon.toFixed(6) }; };
  // A's avatar as B sees it: the remote nearest A's foot. body = the non-dress skinned geometry, so a re-picked body shows.
  const remoteLook = (ob, at) => ob.evaluate(at => { const m = window.__gtasf?.world?.remoteAvatars; if (!m) return { error: 'no remoteAvatars hook' };
    let best = null; for (const [id, a] of m) { const p = a.root.position, d = Math.hypot(p.x - at.x, p.z - at.z); if (!best || d < best.d) best = { id, a, d }; }
    if (!best) return { remotes: 0 };
    const body = [], dress = []; best.a.root.traverse(o => { if (/^tier-dress/.test(o.name ?? '')) { if (o.isMesh) dress.push({ name: o.name, visible: o.visible && o.parent?.visible !== false }); } else if (o.isSkinnedMesh || o.isMesh) body.push(o.geometry?.uuid); });
    return { remotes: m.size, id: best.id, d: +best.d.toFixed(1), root: best.a.root.uuid, body: body.sort().join(','), vest: dress.some(x => /vest/.test(x.name) && x.visible), dress: dress.map(x => x.name) };
  }, at);
  async function observerOpen(s) {
    const f = await foot(); if (!f) { s.notes.push('observer: no A foot'); return null; }
    const ll = unproject(f.x, f.z), url = `${BASE}/?at=${ll.lat},${ll.lon}&bot=1`;
    const octx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const ob = await octx.newPage(); ob.setDefaultTimeout(30000);
    const join = async () => { await ob.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await ob.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 150000 });
      for (let i = 0; i < 10; i++) { await ob.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await ob.waitForTimeout(300); } };
    try { await join(); } catch (e) { s.notes.push(`observer: B never joined (${e.message.slice(0, 80)})`); await octx.close(); return null; }
    let before = null; for (let i = 0; i < 20 && !(before?.id != null && before.d < 25); i++) { before = await remoteLook(ob, f); await ob.waitForTimeout(500); }
    s.observer = { url, before }; s.notes.push(`observer B sees A: ${JSON.stringify(before)}`);
    return { octx, ob, join, at: f };
  }
  async function observerWatch(s, o) {
    const t0 = Date.now(), seen = []; let vestAt = null, swapped = null;
    while (Date.now() - t0 < 8000) { const l = await remoteLook(o.ob, o.at); seen.push(l);
      if (l.vest && vestAt == null) vestAt = Date.now() - t0;
      if (s.observer.before?.root && l.root && (l.root !== s.observer.before.root || l.body !== s.observer.before.body)) swapped ??= { atMs: Date.now() - t0, before: s.observer.before.body, after: l.body, rootChanged: l.root !== s.observer.before.root };
      await o.ob.waitForTimeout(250); }
    await o.ob.screenshot({ path: `${out}/${String(++shotN).padStart(2, '0')}-observer-after-seed.jpg`, type: 'jpeg', quality: 70 }).catch(() => {});
    s.observer.live = { vestAtMs: vestAt, bodySwap: swapped, last: seen.at(-1) };
    let reload = null; try { await o.join(); for (let i = 0; i < 12 && !(reload?.id != null && reload.d < 25); i++) { reload = await remoteLook(o.ob, o.at); await o.ob.waitForTimeout(500); } }
    catch (e) { reload = { error: e.message.slice(0, 80) }; }
    s.observer.reload = reload;
    s.notes.push(`observer live: vest ${vestAt == null ? 'NEVER in 8 s' : `at +${vestAt} ms`}, body swap ${swapped ? JSON.stringify(swapped) : 'none'}; after B reload: vest ${reload?.vest ? 'present' : 'ABSENT'} (${JSON.stringify(reload)})`);
    await o.octx.close();
  }

  await step('seed', async s => {
    if (!/robotaxi/i.test(await txt('.gt-founder-quest-cta') ?? '')) { s.notes.push(`no robotaxi CTA (quest: ${await txt('.gt-founder-quest')})`); return; }
    await tap('.gt-founder-quest-cta');
    await page.waitForFunction(() => /Pitch the partner/i.test(document.querySelector('.gt-founder-quest')?.textContent ?? '') || /Couldn't reach|No robotaxi right now/i.test(document.querySelector('.gt-founder-quest')?.textContent ?? ''), null, { timeout: 120000 })
      .catch(async () => fail(s, `robotaxi never arrived in 120s (quest: ${await txt('.gt-founder-quest')})`));
    s.quest = await txt('.gt-founder-quest'); await shot('seed-arrived');
    if (/Couldn't reach|No robotaxi right now/.test(s.quest ?? '')) { fail(s, `robotaxi failed: ${s.quest}`); return; }
    if (!/Pitch the partner/.test(s.quest ?? '')) return;
    const obs = process.env.OBSERVER_VEST === '1' ? await observerOpen(s) : null;
    await tap('.gt-founder-quest-cta');
    if (await page.waitForSelector('.gt-convo:not([hidden])', { timeout: 4000 }).then(() => true).catch(() => false)) {
      s.opening = 'action'; await talk(s, 1); s.notes.push(`seed cheque ${s.cheque}`);
      const open = await openDialogs(); if (open.length) fail(s, `dialog still open after the Seed conversation: ${open.join(',')}`);
      s.next = await txt('.gt-founder-quest'); s.notes.push(`next quest: ${s.next}`);
      if (obs) await observerWatch(s, obs);
      return;
    }
    await page.waitForSelector('.gt-founder-pitch[open]', { timeout: 8000 });
    await page.locator('.gt-founder-pitch[open] .gt-founder-pitch-line').nth(1)[touch ? 'tap' : 'click']();
    await page.waitForSelector('.gt-founder-pitch[open] .gt-founder-pitch-result:not([hidden])', { timeout: 20000 }).catch(() => fail(s, 'no Seed pitch result'));
    s.cheque = await txt('.gt-founder-pitch[open] .gt-founder-pitch-cheque'); s.notes.push(`seed cheque ${s.cheque}`);
    await page.locator('.gt-founder-pitch[open] .gt-founder-pitch-done:not(.gt-founder-pitch-skip)').first()[touch ? 'tap' : 'click']();
    await page.waitForTimeout(800);
    const open = await openDialogs(); if (open.length) fail(s, `dialog still open after Seed Continue: ${open.join(',')}`);
    s.next = await txt('.gt-founder-quest'); s.notes.push(`next quest: ${s.next}`);
    if (obs) await observerWatch(s, obs);
  });

  // critic N3 / lane C chequeOnce: an award must not replay its cheque count-up after a reload. Reload (returning player)
  // right after the Seed cheque and watch 8 s for a payout card or a convo cheque. Reports chequeReplayed; not a failure
  // while #6.41 (N3 open) is live; the critic called it a nice-to-have, the 17-ready replay frame is the acceptance.
  await step('chequereload', async s => {
    await boot(s, `${BASE}/?at=${FERRY}&bot=1${P.query}`);
    const t0 = Date.now(); let seen = null;
    while (Date.now() - t0 < 8000 && !seen) {
      seen = await page.evaluate(() => { const vis = sel => { const e = document.querySelector(sel); return e && e.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) ? (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) : null; };
        return vis('.gt-funding-toast') ?? vis('.gt-convo-cheque'); });
      if (!seen) await page.waitForTimeout(250); }
    s.chequeReplayed = !!seen; s.notes.push(seen ? `cheque REPLAYED after reload: "${seen}" (critic N3)` : 'no cheque replay in 8 s after reload');
    if (seen) await shot('cheque-replayed');
  });

  // JOB=1 (critic, 10-19 22:2x: no job has been played through on frames since the 15th): play 'Find Your Co-founders'
  // end to end instead of abandoning it: follow the radar's road route (radar.route.points) to each objective, frame
  // and read every beat (mission line/band, toasts, HTTP), then the return to the hacker house and the payout.
  // JOB_ID (lane C, 10-20 13:0x): which prod job JOB=1 plays. Stops follow shared/founder/missions.ts as deployed on #6.41.
  const JOBS = {
    'cofounder-hunt': { title: 'Find Your Co-founders', start: { lat: 37.785418, lon: -122.397022 }, letter: 'C' },
    'steal-pitch-deck': { title: 'Steal the Pitch Deck', start: { lat: 37.782190, lon: -122.402980 }, letter: 'H',
      // grab at the start; 'Lose the heat' (180 m from the grab within 60 s) completes on the way to First Round
      stops: [{ id: 'grab', lat: 37.782190, lon: -122.402980, r: 10 }, { id: 'deliver', lat: 37.799653, lon: -122.400453, r: 10 }] },
    'acquihire': { title: 'Buy My Company', start: { lat: 37.776464, lon: -122.424129 }, letter: 'A',
      // debits 10% of valuation; the laptop must reach the hacker house within 10 min (~2.6 km)
      stops: [{ id: 'deliver', lat: 37.785418, lon: -122.397022, r: 15 }] } };
  const JOB = JOBS[process.env.JOB_ID ?? 'cofounder-hunt'];
  const COFOUNDER_STOPS = [{ id: 'rust', lat: 37.781691, lon: -122.394117, r: 20 }, { id: 'designer', lat: 37.776493, lon: -122.394309, r: 20 },
    { id: 'staff-eng', lat: 37.782761, lon: -122.401856, r: 20 }, { id: 'return', lat: 37.785418, lon: -122.397022, r: 15 }];
  async function routeWalk(t, stop, maxMs, stopIf = null) {
    const target = project(t.lat, t.lon);
    // Give the mission up to 8 s to draw its own route to this objective before the walker sets a QA waypoint (checking
    // once ~2.5 s after the previous arrival pre-empted missionObjectiveRoute's route, 10-20 00:4x).
    const waited = await page.waitForFunction(({ tx, tz }) => { const pts = window.__gtasf?.world?.radar?.route?.points ?? [], end = pts.at(-1);
      return pts.length > 1 && end && Math.hypot(end[0] - tx, end[2] - tz) < 45; }, { tx: target.x, tz: target.z }, { timeout: 8000 }).then(() => true).catch(() => false);
    // No mission route within 8 s (lane C, N41): snapshot what the radar IS routing to (the radar has no destination getter).
    const routeSnap = waited ? null : await page.evaluate(({ tx, tz }) => { const r = window.__gtasf?.world?.radar?.route, end = r?.points?.at(-1);
      const g = [...document.querySelectorAll('[class*="gt-guidance"], [class*="gt-route"], [class*="gt-nav"]')].filter(e => e.checkVisibility?.()).map(e => e.textContent.trim().replace(/\s+/g, ' ').slice(0, 80)).filter(Boolean);
      return r ? { points: r.points.length, end: end ? [Math.round(end[0]), Math.round(end[2])] : null, endToObjectiveM: end ? Math.round(Math.hypot(end[0] - tx, end[2] - tz)) : null, distanceM: Math.round(r.distanceM), guidance: g.slice(0, 3) } : { route: null, guidance: g.slice(0, 3) }; }, { tx: target.x, tz: target.z });
    const t0 = Date.now(); let d = Infinity, onRoute = 0, i = 0, still = 0, prev = null, setWaypoint = false, routeLandedMs = null;
    while (Date.now() - t0 < maxMs) {
      // JOB_WAYPOINT_HOLD_S (lane C, N41): with no mission route, walk straight at the objective this long before setting
      // a QA waypoint, so a route that lands once the player moves (start snapped to a stacked deck) is seen, not masked.
      const allowWaypoint = Date.now() - t0 >= Number(process.env.JOB_WAYPOINT_HOLD_S ?? 0) * 1000;
      const r = await page.evaluate(({ tx, tz, stop, allowWaypoint }) => { const w = window.__gtasf.world, f = w.foot, d = Math.hypot(tx - f.x, tz - f.z);
        // Aim at the route point after the one nearest the player (the route is re-planned as we move), if the route ends
        // here. Route points are [x, y, z] arrays. No route to this target: set a radar waypoint once (as a player could).
        let pts = w.radar?.route?.points ?? [], end = pts.at(-1), waypoint = false;
        // Only when there is NO route at all: a route to some other point is usually the game's NEXT objective (it advances
        // at the 20 m radius), and pointing a waypoint back at our own target created the 'stale route' of 10-20 (lane C, N43).
        if (pts.length < 2 && allowWaypoint && w.radar?.setDestination && !window.__qaWaypoint?.[`${tx},${tz}`]) {
          (window.__qaWaypoint ??= {})[`${tx},${tz}`] = true; waypoint = !!w.radar.setDestination({ title: 'QA objective', x: tx, y: 0, z: tz });
          pts = w.radar.route?.points ?? []; end = pts.at(-1); }
        let aim = { x: tx, z: tz }, via = false;
        // Pure pursuit: project the player onto the route polyline and aim 8 m further ALONG it. Aiming at route points
        // oscillated (the re-planned route's first points sit beside/behind the player; probes 10-19 23:1x-23:3x).
        const pursue = (pts, f, ahead = 8) => { let bestD = Infinity, bestS = 0, acc = 0; const cum = [0]; for (let j = 1; j < pts.length; j++) { const ax = pts[j - 1][0], az = pts[j - 1][2], vx = pts[j][0] - ax, vz = pts[j][2] - az, L = Math.hypot(vx, vz) || 1e-6; const t = Math.max(0, Math.min(1, ((f.x - ax) * vx + (f.z - az) * vz) / (L * L))), q = Math.hypot(f.x - (ax + vx * t), f.z - (az + vz * t)); if (q < bestD) { bestD = q; bestS = acc + t * L; } acc += L; cum.push(acc); } const goal = Math.min(acc, bestS + ahead); for (let j = 1; j < pts.length; j++) if (cum[j] >= goal) { const L = cum[j] - cum[j - 1] || 1e-6, t = (goal - cum[j - 1]) / L; return { x: pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * t, z: pts[j - 1][2] + (pts[j][2] - pts[j - 1][2]) * t, off: bestD }; } return { x: pts.at(-1)[0], z: pts.at(-1)[2], off: bestD }; };
        if (pts.length > 1 && end && Math.hypot(end[0] - tx, end[2] - tz) < 45) { const a = pursue(pts, f); aim = { x: a.x, z: a.z }; via = true; }
        if (d > stop) { const dx = aim.x - f.x, dz = aim.z - f.z, dd = Math.hypot(dx, dz) || 1, k = Math.min(0.7, dd) / dd; f.x += dx * k; f.z += dz * k; }
        return { d, via, waypoint, x: f.x, z: f.z }; }, { tx: target.x, tz: target.z, stop, allowWaypoint });
      d = r.d; if (r.via) { onRoute++; if (routeLandedMs == null && !setWaypoint && !r.waypoint) routeLandedMs = Date.now() - t0; } if (r.waypoint) setWaypoint = true; // (a route seen in the tick our own waypoint was set is ours, not the mission's)
      if (d <= stop + 0.2) break;
      if (++i % 150 === 0) await press('ShiftLeft', 30); // real input so the idle kick never fires
      if (prev && Math.hypot(r.x - prev.x, r.z - prev.z) < 0.05) { if (++still > 80) break; } else still = 0; prev = r;
      if (stopIf && i % 40 === 0 && await stopIf()) break; // e.g. the job already failed: stop walking a dead leg
      await page.waitForTimeout(110);
    }
    return { d: Math.round(d), routeShare: i ? +(onRoute / i).toFixed(2) : 0, setWaypoint, missionRouteReady: waited, routeLandedMs, routeSnap, secs: Math.round((Date.now() - t0) / 1000) };
  }
  async function playJob(s) {
    // Visible text only: a hidden quest card keeps its textContent (N39 was a false positive from reading it, 10-19).
    const vtxt = sel => page.evaluate(q => { const e = document.querySelector(q); return e && e.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) ? e.textContent.trim().replace(/\s+/g, ' ').slice(0, 200) : null; }, sel);
    const beat = async id => ({ id, line: await vtxt('.gt-mission-line'), band: await vtxt('.gt-mission-band'), quest: await vtxt('.gt-founder-quest'),
      toasts: (await page.evaluate(() => (window.__qa?.toasts ?? []).slice(-4).map(t => t.t))).map(t => t.slice(0, 140)) });
    s.beats = [await beat('start')]; const http0 = api.length;
    // The game's own failure toast ('They caught up — job failed.', 'Not counted …'), seen since the job started.
    const toasts0 = (await page.evaluate(() => (window.__qa?.toasts ?? []).length));
    let failedText = null;
    const jobFailed = () => failedText;
    // failBandReason (lane C): the reason may live only in the MISSION FAILED band (no toast), so read the band too.
    const pollFailed = async () => { if (failedText) return failedText; failedText = await page.evaluate(n => { const band = document.querySelector('.gt-mission-band'); const b = band && band.checkVisibility?.() ? band.textContent.trim().replace(/\s+/g, ' ') : '';
      return (/MISSION FAILED/i.test(b) ? b.slice(0, 120) : null) ?? (window.__qa?.toasts ?? []).slice(n).map(t => t.t).find(t => /job failed|mission failed|failed\. ?try again/i.test(t)) ?? null; }, toasts0); return failedText; };
    // cofounderShortLoop (next set): the designer moves from Caltrain to outside Moscone (missions.ts). Follow the server's flag.
    const shortLoop = await page.evaluate(() => fetch('/api/health').then(r => r.json()).then(h => !!h.flags?.cofounderShortLoop).catch(() => false));
    const stops = (JOB.stops ?? COFOUNDER_STOPS).map(o => o.id === 'designer' && shortLoop ? { ...o, lat: 37.783355, lon: -122.399594 } : o);
    if (!JOB.stops) s.notes.push(`co-founder stops: ${shortLoop ? 'short loop (designer outside Moscone)' : 'classic (designer by Caltrain)'}`);
    for (const o of stops) {
      const w = await routeWalk(o, o.r - 2, 600000, pollFailed); // end inside the objective radius, where the game advances; 10 min covers acquihire's single 2.6 km leg
      await page.waitForTimeout(2500); await shot(`job-${o.id}`);
      await pollFailed();
      const b = { ...(await beat(o.id)), walk: w }; s.beats.push(b);
      s.notes.push(`job ${o.id}: walked ${w.secs}s (route share ${w.routeShare}${w.setWaypoint ? ', via a QA waypoint' : ', mission route'}, ended ${w.d} m) | line: ${b.line} | band: ${b.band ?? '-'} | toasts: ${b.toasts.join(' / ')}`);
      if (jobFailed()) { fail(s, `job failed during '${o.id}': ${jobFailed()}`); await shot('job-failed'); return; }
      if (w.d > o.r) { fail(s, `could not reach ${o.id} (ended ${w.d} m away, radius ${o.r})`); return; }
    }
    // The payout: wait for a reward band / payout card / funding toast after the return.
    await page.waitForFunction(() => document.querySelector('.gt-mission-band:not([hidden]), .gt-funding-toast, .gt-payout-card'), null, { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1200); await shot('job-complete');
    // Job-specific completion only: a stale 'TERM SHEET SIGNED' payout card from the Seed round once read as a job payout
    // and passed a failed heist (10-20 13:4x). Require MISSION PASSED / JOB DONE, or mission-complete 'completed'.
    const completeRes = api.slice(http0).filter(a => a.p === '/api/funding/mission-complete').map(a => a.body ?? '');
    const doneToast = await page.evaluate(n => (window.__qa?.toasts ?? []).slice(n).map(t => t.t).find(t => /MISSION PASSED|JOB DONE/i.test(t)) ?? null, toasts0);
    s.done = { ...(await beat('complete')), doneToast, completed: completeRes.some(b => /"status":"completed"/.test(b)), failed: await pollFailed(), http: api.slice(http0).map(a => `${a.p} ${a.http}`) };
    s.notes.push(`job complete: ${JSON.stringify(s.done)}`);
    if (s.done.failed) fail(s, `job failed: ${s.done.failed}`);
    else if (!s.done.completed && !s.done.doneToast) fail(s, 'no job completion (no MISSION PASSED / JOB DONE and no completed mission-complete)');
  }

  await step('job', async s => {
    // The SEED CLOSED card's "Find a job" opens the phone; otherwise open it the normal way.
    // JOB_SKIP_CTA=1 (lane C, N39 edge): start the job WITHOUT the card's 'Find a job' CTA (which hides the card), as a
    // player who opens the phone directly would; the JOB=1 beats then show whether 'SEED CLOSED' stays up during the job.
    if (process.env.JOB_SKIP_CTA !== '1' && /Find a job/i.test(await txt('.gt-founder-quest-cta') ?? '') && await vis('.gt-founder-quest-cta')) { await tap('.gt-founder-quest-cta'); await page.waitForTimeout(800); s.notes.push('opened via Find a job'); }
    if (!await openPhone()) { fail(s, 'jobs phone did not open'); return; }
    await shot('phone');
    s.jobs = await page.evaluate(() => [...document.querySelectorAll('.gt-mission-phone-item-title')].map(e => e.textContent));
    s.notes.push(`jobs: ${s.jobs.join(' | ')}`);
    const cov = await coveredBy('.gt-mission-phone-start'); if (cov) fail(s, `Start job covered by ${cov}`);
    // Start job ROUTES to the job's letter marker; "H to ride" takes a robotaxi there, then E at the letter starts it.
    const startBtn = page.locator('.gt-mission-phone-item', { hasText: JOB.title }).locator('.gt-mission-phone-start').first(); // JOB_ID's row
    await startBtn[touch ? 'tap' : 'click']({ timeout: 8000 }); await page.waitForTimeout(2000);
    s.routed = await txt('.gt-hud-notice, .gt-notice, .gt-toast') ; await shot('job-routed');
    if (await vis('.gt-mission-phone')) await closePhone();
    const f0 = await foot();
    if (touch) await page.getByRole('button', { name: /robotaxi|where to/i }).first().tap({ timeout: 5000 }).catch(() => press('KeyH'));
    else await press('KeyH');
    await page.waitForTimeout(1500); await shot('job-ride');
    // "Where to?" lists the routed job as CURRENT DESTINATION; pick it.
    const dest = page.locator('.gt-taxi-picker[open] button', { hasText: JOB.title }).first();
    if (await dest.count()) await dest[touch ? 'tap' : 'click']({ timeout: 8000 }).catch(e => fail(s, `picker destination not clickable: ${e.message.slice(0, 80)}`));
    else fail(s, 'Where to? picker has no row for the routed job');
    s.rideUi = { dialogs: await openDialogs(), notice: await txt('.gt-hud-notice, .gt-notice, .gt-toast') };
    // wait until the ride drops us (foot moves > 500 m from where we hailed, and we are on foot again)
    await page.waitForFunction(f0 => { const w = window.__gtasf?.world; const f = w?.foot; return f && Math.hypot(f.x - f0.x, f.z - f0.z) > 500 && !w.vehicle?.active; }, f0, { timeout: 150000 })
      .catch(async () => fail(s, `robotaxi ride to the job letter never arrived (${JSON.stringify(s.rideUi)})`));
    await page.waitForTimeout(2500);
    const C = project(JOB.start.lat, JOB.start.lon); const fz = await foot(); s.dropDistM = fz ? Math.round(Math.hypot(fz.x - C.x, fz.z - C.z)) : null;
    s.notes.push(`robotaxi dropped ${s.dropDistM} m from the ${JOB.letter}`);
    await walkTo(JOB.start, 2, 60000);
    const startCalls0 = api.filter(a => a.p === '/api/funding/mission-start').length;
    await press('KeyE'); await page.waitForTimeout(2000);
    // acquihireConfirm (lane C c9ff7615): the first E only names the price; a second E within 6 s buys. If no mission-start
    // went out after the first E, record the price prompt and press E again.
    if (api.filter(a => a.p === '/api/funding/mission-start').length === startCalls0) {
      s.confirmPrompt = await page.evaluate(() => (window.__qa?.toasts ?? []).slice(-4).map(t => t.t).reverse().find(t => /\$[\d.,]+k?|again|to buy/i.test(t)) ?? null);
      s.notes.push(`no mission-start after the first E; prompt: ${s.confirmPrompt ?? 'none'}; pressing E again`); await shot('job-confirm-prompt');
      await press('KeyE'); await page.waitForTimeout(2000); }
    // A job that costs money (Buy My Company debits 10%) may ask first: record the prompt, then accept it.
    s.startPrompt = await page.evaluate(() => { const b = [...document.querySelectorAll('dialog[open] button, .gt-convo:not([hidden]) button, .gt-mission-phone button')].filter(e => e.checkVisibility?.());
      return b.map(e => e.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 6); });
    if (s.startPrompt.length) { s.notes.push(`start prompt buttons: ${s.startPrompt.join(' | ')}`); await shot('job-start-prompt');
      const ok = page.locator('dialog[open] button, .gt-convo:not([hidden]) button', { hasText: /buy|deal|accept|yes|start|take/i }).first();
      if (await ok.count()) { await ok[touch ? 'tap' : 'click']().catch(() => {}); await page.waitForTimeout(1500); } }
    await shot('job-started');
    s.started = { quest: await txt('.gt-founder-quest'), mission: await txt('.gt-mission-hud, .gt-mission-objective'), dialogs: await openDialogs() };
    s.notes.push(`after E: ${JSON.stringify(s.started)}`);
    if (process.env.JOB === '1') { await playJob(s); return; }
    if (!await openPhone()) { fail(s, 'phone did not reopen after starting a job'); return; }
    s.live = await txt('.gt-mission-phone-live'); s.notes.push(`live: ${s.live}`);
    if (!await vis('.gt-mission-phone-abandon')) { fail(s, 'no Abandon job button while a job is live'); return; }
    await tap('.gt-mission-phone-abandon'); await page.waitForTimeout(1200);
    if (await vis('.gt-mission-phone-live')) fail(s, 'job still live after Abandon');
    await shot('job-abandoned');
    await closePhone();
    if ((await openDialogs()).length) fail(s, `dialog open after abandoning: ${await openDialogs()}`);
    if (process.env.POSTJOB_PROBE) {
      // gtasf-phone-postjob-walk-qd9rd: can the player still move after Abandon? Nudge (harness), held W, and (phone) a
      // real touch drag on the stick through CDP — each must move world.foot.
      const state = () => page.evaluate(() => { const w = window.__gtasf?.world; return { mode: w?.mode, vehicleId: w?.vehicleId, taxi: w?.taxiState, x: w?.foot.x, z: w?.foot.z }; });
      const moved = (a, b) => Math.round(Math.hypot(b.x - a.x, b.z - a.z) * 10) / 10;
      const p0 = await state(); s.probe = { before: p0 };
      await page.evaluate(() => { const f = window.__gtasf.world.foot; f.x += 0.6; }); await page.waitForTimeout(600);
      const p1 = await state(); s.probe.nudgeKept = moved(p0, p1);
      await press('KeyW', 1500); await page.waitForTimeout(400); const p2 = await state(); s.probe.keyW = moved(p1, p2);
      if (touch) {
        const box = await page.locator('.gtasf-touch .stick').boundingBox();
        if (box) {
          const cdp = await page.context().newCDPSession(page); const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
          for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - i * 8, id: 1 }] }); await page.waitForTimeout(60); }
          await page.waitForTimeout(1500); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(400);
          const p3 = await state(); s.probe.stick = moved(p2, p3);
        } else s.probe.stick = 'no stick';
      }
      s.probe.after = await state(); s.notes.push(`post-abandon probe: ${JSON.stringify(s.probe)}`);
      if (!(s.probe.keyW > 1) || (touch && !(s.probe.stick > 1))) fail(s, `player cannot move after Abandon: ${JSON.stringify(s.probe)}`);
    }
  });

  // ───────────── Session 2: returning player at the Ferry plaza ─────────────
  await step('reload', async s => { await boot(s, `${BASE}/?at=${FERRY}&bot=1${P.query}`); s.quest = await txt('.gt-founder-quest'); s.notes.push(`quest on return: ${s.quest}`);
    const open = await openDialogs(); if (open.length) fail(s, `dialog open on return: ${open.join(',')}`); });

  await step('weapon', async s => {
    const d = await walkTo(BAT, 0.8, 40000); s.notes.push(`walked to bat pickup, ${d} m left`);
    const gate = await page.waitForSelector('.gt-age-gate', { state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
    if (!gate) { const st = await combatState(); if (st?.started) s.notes.push('combat already started (no gate)'); else fail(s, 'walking into the bat pickup did not open the 18+ gate'); }
    else { await shot('age-gate'); s.gateText = await txt('.gt-age-gate-title');
      const cov = await coveredBy('.gt-age-gate-enter'); if (cov) fail(s, `18+ Enter covered by ${cov}`);
      await tap('.gt-age-gate-enter'); await page.waitForTimeout(1200);
      if (await vis('.gt-age-gate')) fail(s, '18+ gate did not close on Enter'); }
    const st = await combatState(); s.state = st; if (!st?.owned?.includes('bat')) fail(s, `bat not granted (owned ${st?.owned})`);
  });

  await step('timetrial', async s => {
    const d = await walkTo(SPRINT.start, 2.5, 30000); s.notes.push(`at T, ${d} m`);
    await page.waitForTimeout(800);
    s.prompt = await txt('.gt-interact-prompt, .gt-prompt, .gt-hud-prompt');
    if (touch) { const btn = page.locator('.gt-touch-action, .gt-touch-interact, [data-action="interact"]').first(); if (await btn.count()) await btn.tap().catch(() => {}); else await press('KeyE'); }
    else await press('KeyE');
    await page.waitForTimeout(1500);
    s.hud = await txt('.gt-tt-hud'); s.notes.push(`tt hud: ${s.hud}`);
    if (!/SPRINT|EMBARCADERO/i.test(s.hud ?? '')) {
      // gtasf-gdx4z evidence: where the client thinks we are vs the T, what took E, then one retry.
      const T = project(SPRINT.start.lat, SPRINT.start.lon), f = await foot(), st = await combatState();
      s.atE = { footToT: f ? +Math.hypot(f.x - T.x, f.z - T.z).toFixed(1) : null, mode: await page.evaluate(() => window.__gtasf.world.mode), combatStarted: st?.started, weapon: st?.weapon,
        toasts: (await page.evaluate(() => window.__qa?.toasts ?? [])).filter(t => t.tag === 'timetrial').map(t => t.t) };
      await page.waitForTimeout(2000); await press('KeyE'); await page.waitForTimeout(1500);
      s.retryHud = await txt('.gt-tt-hud'); s.notes.push(`gdx4z: ${JSON.stringify(s.atE)} retry hud: ${s.retryHud}`);
      if (!/SPRINT|EMBARCADERO/i.test(s.retryHud ?? '')) { fail(s, `time trial did not start (prompt "${s.prompt}")`); return; }
      s.notes.push('started on the second E');
    }
    await shot('tt-running');
    for (const stop of SPRINT.stops) s.notes.push(`leg ${await walkTo(stop, stop.r - 4, 90000)} m`);
    await page.waitForTimeout(3500);
    await shot('tt-finish');
    const sub = api.find(a => a.p === '/api/funding/tt-submit');
    s.submit = sub; if (!sub || !/recorded/.test(sub.body ?? '')) fail(s, `run not recorded: ${sub ? `${sub.http} ${sub.body}` : 'no tt-submit request'}`);
    s.board = await txt('.gt-tt-board, .gt-tt-leaderboard');
  });

  // critic N38 (police presence): from the first shot to the end of 'escape', sample in-page every 500 ms which SFPD
  // cruisers (POLICE_FLAG 0x40 fleet cars) and on-foot officers exist, their distance, and whether they are inside the
  // camera's view cone (NDC test only, no occlusion). Reported, not failed: the acceptance for lane B's sfpdResponse
  // is a cruiser in view within ~15 s of the market shot.
  const startPoliceWatch = () => page.evaluate(() => { if (window.__qaPoliceT) return; const t0 = performance.now(), out = window.__qaPolice = [];
    window.__qaPoliceT = setInterval(() => { const w = window.__gtasf?.world, f = w?.foot, cam = w?.camera?.camera; if (!f || !cam) return;
      const V = cam.position.constructor, ndc = (x, y, z) => new V(x, y, z).project(cam), inView = (x, y, z) => { const v = ndc(x, y, z); return v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1; };
      // carAt: the nearest in-view cruiser's screen pixel + kind, so a frame can be matched to the unit the sampler counted.
      let cars = 0, carD = null, carIn = false, carAt = null; for (const c of w.fleet?.cars?.values?.() ?? []) if (c.data.flags & 0x40) { cars++; const p = c.model.root.position, d = Math.hypot(p.x - f.x, p.z - f.z); carD = carD == null ? d : Math.min(carD, d);
        if (d < 90 && inView(p.x, p.y + 1, p.z)) { carIn = true; const v = ndc(p.x, p.y + 1, p.z); if (!carAt || d < carAt.d) carAt = { d: Math.round(d), px: [Math.round((v.x + 1) / 2 * innerWidth), Math.round((1 - v.y) / 2 * innerHeight)], kind: c.data.kind, id: c.data.id, driver: c.data.driverId ?? null, vis: c.model.root.visible }; } }
      // Officer height: positions().y is surfaceHeightAt (null -> 0 on some spots), which put the test point under the
      // street (officers 0-1 m from the on-screen player read 'not in view', 10-19 23:4x). Use the player's height when
      // the officer's y is missing or >4 m off it, and record the gap (offDy) for the nearest officer.
      const py = w.player?.position?.y ?? f.y ?? 0;
      let offs = 0, offD = null, offIn = false, offDy = null; for (const p of w.policeOfficers?.positions?.() ?? []) { offs++; const d = Math.hypot(p.x - f.x, p.z - f.z);
        if (offD == null || d < offD) { offD = d; offDy = Number.isFinite(p.y) ? +(p.y - py).toFixed(1) : null; }
        const oy = Number.isFinite(p.y) && Math.abs(p.y - py) < 4 ? p.y : py; if (d < 60 && inView(p.x, oy + 1, p.z)) offIn = true; }
      out.push({ t: Math.round(performance.now() - t0), stars: document.querySelectorAll('.gt-combat-wanted-star.lit').length, cars, carD: carD == null ? null : Math.round(carD), carIn, carAt, offs, offD: offD == null ? null : Math.round(offD), offDy, offIn });
    }, 500); });
  // PANIC_FRAMES=1 (lane D, critic N37 crowdPanic): frames at 0 / ~2 / ~8 s after the first real shot at the market, each
  // with streetWalkers.stats (visible / panicking / alarms), plus a stats-only sample at ~20 s (no respawns nearby while
  // the alert lasts). Runs alongside the robbery flow so the slice's timing is unchanged.
  const walkerStats = () => page.evaluate(() => { const st = window.__gtasf?.world?.streetWalkers?.stats; return st ? { count: st.count, visible: st.visible, walking: st.walking, panicking: st.panicking, alarms: st.alarms } : null; }).catch(() => null);
  function panicFrames(s) {
    const t0 = Date.now(); s.panic = [];
    return (async () => { for (const [ms, label] of [[0, '0s'], [2000, '2s'], [8000, '8s'], [20000, null]]) {
      const wait = t0 + ms - Date.now(); if (wait > 0) await page.waitForTimeout(wait);
      const st = await walkerStats(); s.panic.push({ atMs: Date.now() - t0, ...st });
      if (label) await shot(`panic-${label}`); } })();
  }

  async function policePresence(s) {
    const a = await page.evaluate(() => { clearInterval(window.__qaPoliceT); window.__qaPoliceT = null; return window.__qaPolice ?? []; }).catch(() => []);
    if (!a.length) return;
    R.policeTimeline = a;
    const first = k => a.find(x => x[k])?.t ?? null, near = a.filter(x => x.carD != null).map(x => x.carD), offNear = a.filter(x => x.offD != null).map(x => x.offD);
    R.policePresence = { samples: a.length, secs: Math.round(a.at(-1).t / 1000), starredSecs: Math.round(a.filter(x => x.stars).length / 2),
      firstCruiserInViewS: first('carIn') == null ? null : +(first('carIn') / 1000).toFixed(1), firstOfficerInViewS: first('offIn') == null ? null : +(first('offIn') / 1000).toFixed(1),
      cruiserInViewSecs: a.filter(x => x.carIn).length / 2, officerInViewSecs: a.filter(x => x.offIn).length / 2,
      firstCruiserAt: a.find(x => x.carIn)?.carAt ?? null, maxCruisers: Math.max(...a.map(x => x.cars)), maxOfficers: Math.max(...a.map(x => x.offs)), minCruiserM: near.length ? Math.min(...near) : null, minOfficerM: offNear.length ? Math.min(...offNear) : null };
    s.notes.push(`police presence (N38): ${JSON.stringify(R.policePresence)}`);
  }

  await step('crime', async s => {
    // Walk to the corner market FIRST, unwanted: firing first put 2 stars on a ~2-min scripted walk and SFPD killed the
    // (throttled, slower) phone player on the way 2/3 runs on 10-17 (4.7 km jump to SF General, hp 0). Then fire the
    // starter pistol at the market (real input first, the harness hook as a fallback) and rob it.
    // Via the promenade by Pier 7 (the sprint finish): a straight line from the T runs into the waterfront blocks.
    await walkTo(SPRINT.stops[1], 6, 90000);
    const d = await walkTo(MARKET, 1.5, 90000); s.notes.push(`at market, ${d} m`);
    await page.evaluate(() => { window.__gtasfCombat?.selectWeapon?.('pistol'); });
    const a0 = (await combatState())?.ammo?.pistol;
    await startPoliceWatch();
    const panic = process.env.PANIC_FRAMES === '1' ? panicFrames(s) : null;
    if (!touch) {
      // What a click at the crosshair actually hits (a floating world label / event pin can swallow the "shot").
      s.underCursor = await page.evaluate(() => { const t = document.elementFromPoint(720, 420); return t ? `${t.tagName}.${String(t.className).slice(0, 60)}` : null; });
      s.beforeClick = await foot(); await shot('before-fire');
      await page.mouse.move(720, 420); await page.mouse.down(); await page.waitForTimeout(150); await page.mouse.up(); await page.waitForTimeout(400);
      const after = await foot(); s.clickMovedM = s.beforeClick && after ? Math.round(Math.hypot(after.x - s.beforeClick.x, after.z - s.beforeClick.z)) : null;
      s.notes.push(`click at crosshair: under=${s.underCursor} moved=${s.clickMovedM} m`);
      if (s.clickMovedM > 50) fail(s, `a left-click to shoot teleported the player ${s.clickMovedM} m (under cursor: ${s.underCursor})`);
    }
    let a1 = (await combatState())?.ammo?.pistol;
    s.realInputFired = a1 < a0; if (!s.realInputFired) { for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__gtasfCombat.fire()); await page.waitForTimeout(200); await page.evaluate(() => window.__gtasfCombat.fireStop()); } a1 = (await combatState())?.ammo?.pistol; }
    s.notes.push(`pistol ammo ${a0}→${a1} (real input fired: ${s.realInputFired})`);
    if (!(a1 < a0)) fail(s, 'firing did not use ammo');
    await shot('fired');
    s.starsAfterFire = await stars();
    // Stand in the zone through the 2.5 s server hold, but leave as soon as it pays: #6.16 busts a stationary player
    // ~2.5 s after a unit arrives, which would clear the stars before we sample them.
    for (let i = 0; i < 28 && !api.some(a => a.p === '/api/funding/rob-complete' && /robbed/.test(a.body ?? '')); i++) await page.waitForTimeout(250);
    await page.waitForTimeout(600);
    // vitalsPickups (#6.14): an armour pickup sits at this market — walking in should give +50 armour (server-owned).
    s.armour = (await combatState())?.armour; s.notes.push(`armour at the market: ${s.armour}`);
    s.stars = await stars(); s.rob = api.filter(a => /rob-/.test(a.p)).map(a => `${a.p} ${a.http} ${a.body}`);
    await shot('wanted');
    // N38 acceptance frame: the first moment the sampler has a cruiser in the view cone (it arrives ~9 s after the shot on
    // #6.41, after the 'wanted' frame), so the frame shows what the player actually sees of the response.
    if (await page.waitForFunction(() => window.__qaPolice?.at(-1)?.carIn, null, { timeout: 12000 }).then(() => true).catch(() => false)) {
      s.cruiserFrameAt = await page.evaluate(() => window.__qaPolice.at(-1)); await shot('police-in-view'); }
    else s.notes.push('no cruiser in the view cone within 12 s of the wanted frame');
    // Officer-near frame: the first sample with an officer within 10 m, so the officer view-cone number can be checked by eye.
    if (await page.waitForFunction(() => { const x = window.__qaPolice?.at(-1); return x && x.offD != null && x.offD < 10; }, null, { timeout: 15000 }).then(() => true).catch(() => false)) {
      s.officerFrameAt = await page.evaluate(() => window.__qaPolice.at(-1)); await shot('officer-near'); }
    else s.notes.push('no officer within 10 m within 15 s');
    if (panic) { await panic; s.notes.push(`crowd panic (N37): ${s.panic.map(p => `+${(p.atMs / 1000).toFixed(1)}s vis ${p.visible}/${p.count} panicking ${p.panicking} alarms ${p.alarms}`).join(' | ')}`); }
    const busts = (R.busted ?? []).filter(b => b.step === 'crime').length;
    const jumps = (R.jumps ?? []).filter(j => j.step === 'crime');
    if (!s.stars) fail(s, `no wanted star after firing + robbery (rob: ${s.rob.join(' / ') || 'no rob request'})${busts ? ` — BUSTED x${busts} on the way (SFPD arrest -> SF General respawn), not a game bug` : ''}${jumps.length ? ` — teleported on the way: ${jumps.map(j => `${j.jumpM} m, hp ${j.hpBefore}->${j.hpAfter}`).join('; ')} (likely killed by SFPD -> SF General respawn)` : ''}`);
  });

  // Opt-in (STEPS must name it): stay near the store at 2+ stars, circling at ~6 m/s (too fast to be busted), so the
  // SFPD close in and — with policeFire — shoot when they have line of sight. Samples health + nearest unit.
  if (STEPS?.has('standoff')) await step('standoff', async s => {
    const c = project(MARKET.lat, MARKET.lon); s.samples = []; const t0 = Date.now(); let a = 0;
    while (Date.now() - t0 < 45000) {
      a += 0.09; const tx = c.x + Math.cos(a) * 12, tz = c.z + Math.sin(a) * 12;
      await page.evaluate(({ tx, tz }) => { const f = window.__gtasf.world.foot; const dx = tx - f.x, dz = tz - f.z, d = Math.hypot(dx, dz); if (d > 0.1) { const k = Math.min(0.65, d) / d; f.x += dx * k; f.z += dz * k; } }, { tx, tz });
      await page.waitForTimeout(110);
      if (Math.round((Date.now() - t0) / 110) % 18 === 0) s.samples.push(await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot, st = window.__gtasfCombat?.state?.(); let d = Infinity;
        for (const car of w.fleet?.cars?.values?.() ?? []) if (car.data.flags & 0x40) { const p = car.model.root.position; d = Math.min(d, Math.hypot(p.x - f.x, p.z - f.z)); }
        return { t: Math.round(performance.now() / 1000), stars: document.querySelectorAll('.gt-combat-wanted-star.lit').length, cop: Number.isFinite(d) ? Math.round(d) : null, hp: st?.health, ar: st?.armour, dead: st?.dead }; }));
    }
    s.notes.push(JSON.stringify(s.samples.map(x => `${x.stars}★ cop${x.cop} hp${x.hp}/${x.ar}${x.dead ? ' DEAD' : ''}`)));
    await shot('standoff');
  });

  await step('escape', async s => {
    if (!await stars()) { s.notes.push('no wanted level to escape'); await policePresence(s); return; }
    // Run north along the waterfront away from the store; check the stars clear within ~2.5 min.
    const t0 = Date.now(); const legs = [{ lat: 37.8000, lon: -122.3985 }, { lat: 37.8030, lon: -122.4010 }, { lat: 37.8065, lon: -122.4045 }];
    const police = () => page.evaluate(() => { const w = window.__gtasf.world, f = w.foot; let d = Infinity, n = 0;
      for (const c of w.fleet?.cars?.values?.() ?? []) if (c.data.flags & 0x40) { n++; const p = c.model.root.position; d = Math.min(d, Math.hypot(p.x - f.x, p.z - f.z)); }
      const st = window.__gtasfCombat?.state?.();
      return { units: n, nearest: Number.isFinite(d) ? Math.round(d) : null, stars: document.querySelectorAll('.gt-combat-wanted-star.lit').length, escaping: !!document.querySelector('.gt-combat-wanted-escaping'),
        health: st?.health, armour: st?.armour, dead: st?.dead }; });
    s.samples = [{ t: 0, ...await police() }];
    for (const l of legs) { await walkTo(l, 3, 60000); s.samples.push({ t: Math.round((Date.now() - t0) / 1000), ...await police() }); if (!await stars()) break; }
    for (let i = 0; i < 12 && await stars(); i++) { await page.waitForTimeout(5000); s.samples.push({ t: Math.round((Date.now() - t0) / 1000), still: true, ...await police() }); }
    s.left = await stars(); s.secs = Math.round((Date.now() - t0) / 1000); s.dead = (await combatState())?.dead;
    // #6.14 'lose the cops' hint: any notice/toast during the chase that tells the player how to escape.
    s.escapeHint = ([...R.toasts, ...(await page.evaluate(() => window.__qa?.toasts ?? []))].filter(t => /lose the cops|lose them|lose your|line of sight|out of sight|break (their )?sight|hide from/i.test(t.t)).map(t => t.t))[0] ?? null;
    s.notes.push(`escape hint: ${s.escapeHint ?? 'none seen'}`);
    s.notes.push(`stars left ${s.left} after ${s.secs}s dead=${s.dead}`);
    await policePresence(s);
    if (s.left) fail(s, `still ${s.left} stars after ${s.secs}s of running`);
  });

  await step('gunshop', async s => {
    // Combat not started yet (no weapon pickup in this slice): Tab opens the 18+ gate first, as for a real player.
    if (!(await combatState())?.started && !touch) {
      await press('Tab'); await page.waitForTimeout(800);
      if (await vis('.gt-age-gate')) { await tap('.gt-age-gate-enter'); await page.waitForTimeout(900); s.notes.push('18+ accepted via Tab'); }
      if (await vis('.gt-weapon-wheel')) { await press('Tab'); await page.waitForTimeout(400); }
    } else if (!(await combatState())?.started && touch) {
      await page.evaluate(() => window.__gtasfCombat?.requestCombat?.()); await page.waitForTimeout(800);
      if (await vis('.gt-age-gate')) { await tap('.gt-age-gate-enter'); await page.waitForTimeout(900); s.notes.push('18+ accepted'); }
    }
    if (touch) { const btn = page.locator('.gt-weapon-chip').first(); if (await btn.count()) await btn.tap(); }
    else await press('Tab');
    await page.waitForTimeout(800);
    if (!await vis('.gt-weapon-wheel')) { fail(s, 'weapon wheel / gun shop did not open'); return; }
    await shot('gunshop');
    s.slots = await page.evaluate(() => [...document.querySelectorAll('.gt-weapon-slot')].map(e => e.textContent.trim().replace(/\s+/g, ' ')));
    s.notes.push(`slots: ${s.slots.join(' | ')}`);
    const buy = page.locator('.gt-weapon-slot', { hasText: '$' }).first();
    if (await buy.count()) { const before = await combatState(); await buy[touch ? 'tap' : 'click']().catch(e => fail(s, `buy slot not clickable: ${e.message.slice(0, 80)}`)); await page.waitForTimeout(2500);
      // A buy that would drop the round is a 409 'down-round' + "Tap it again to buy anyway" (by design). Every hourly
      // stopped at that warning until 10-20; tap again so the purchase (and savedLoadout's persistence) is exercised.
      if (api.some(a => a.p === '/api/combat/buy-weapon' && /down-round/.test(a.body ?? ''))) {
        s.downRoundWarning = (await page.evaluate(() => (window.__qa?.toasts ?? []).map(t => t.t).filter(t => /Tap it again/i.test(t)).at(-1))) ?? null;
        if (!await vis('.gt-weapon-wheel')) { if (touch) { const c = page.locator('.gt-weapon-chip').first(); if (await c.count()) await c.tap(); } else await press('Tab'); await page.waitForTimeout(800); }
        await page.locator('.gt-weapon-slot', { hasText: '$' }).first()[touch ? 'tap' : 'click']().catch(e => fail(s, `confirm tap failed: ${e.message.slice(0, 80)}`)); await page.waitForTimeout(2500); }
      s.buy = api.filter(a => a.p === '/api/combat/buy-weapon').map(a => `${a.http} ${a.body}`); const after = await combatState();
      R.boughtWeapons = (after?.owned ?? []).filter(w => !(before?.owned ?? []).includes(w));
      s.notes.push(`buy: ${s.buy.join(' / ') || 'no request'}; owned ${before?.owned} → ${after?.owned}`);
      if (!s.buy.length) fail(s, 'clicking a priced slot sent no buy request'); }
    else s.notes.push('no priced slot in the wheel');
    await shot('gunshop-after');
    if (touch) await page.mouse.click(10, 10).catch(() => {}); else await press('Escape');
    await page.waitForTimeout(500);
    s.afterEsc = { wheel: await vis('.gt-weapon-wheel'), pause: await vis('.gt-pause-menu, .gt-pause') };
    if (s.afterEsc.wheel) { fail(s, `weapon wheel did not close on ${touch ? 'tap-away' : 'Esc'} (pause menu opened: ${s.afterEsc.pause})`);
      if (!touch) { await press('Escape'); await page.waitForTimeout(300); if (await vis('.gt-weapon-wheel')) await press('Tab'); await page.waitForTimeout(300); } }
  });

  // savedLoadout (lane B 02:1x, lane C 42b12095): a gun bought at the shop must still be owned after a reload (D1
  // combat_weapons, GET /api/combat/loadout, granted on the next session). Fails only when prod's /api/health has
  // savedLoadout on; otherwise it records the baseline (ownership lost on reload).
  await step('loadoutreload', async s => {
    const before = (await combatState())?.owned ?? [];
    const flagOn = await page.evaluate(() => fetch('/api/health').then(r => r.json()).then(h => !!h.flags?.savedLoadout).catch(() => null));
    await boot(s, `${BASE}/?at=${FERRY}&bot=1${P.query}`);
    // The grant arrives with the combat session: open the 18+ gate the same way the gunshop step does.
    if (!(await combatState())?.started) { await page.evaluate(() => window.__gtasfCombat?.requestCombat?.()); await page.waitForTimeout(800);
      if (await vis('.gt-age-gate')) { await tap('.gt-age-gate-enter'); await page.waitForTimeout(1500); } }
    await page.waitForTimeout(2500);
    const after = (await combatState())?.owned ?? [];
    const bought = R.boughtWeapons ?? []; // what the gunshop step actually added (the starter fists/bat/pistol are not purchases)
    s.loadout = { flagOn, before, after, kept: bought.filter(w => after.includes(w)), lost: bought.filter(w => !after.includes(w)),
      http: api.filter(a => /loadout/.test(a.p)).map(a => `${a.p} ${a.http}`) };
    s.notes.push(`loadout after reload: ${JSON.stringify(s.loadout)}`);
    if (!bought.length) s.notes.push('nothing bought before the reload (no priced slot?)');
    else if (flagOn && s.loadout.lost.length) fail(s, `savedLoadout is on but ${s.loadout.lost.join(',')} was lost on reload`);
  });

  await step('pilgrimage', async s => {
    // Fresh session ~150 m east of the landmark on Washington St (straight-line walks across downtown hit buildings).
    await boot(s, `${BASE}/?at=37.795300,-122.401500,270&bot=1${P.query}`);
    if (!await openPhone()) { fail(s, 'phone did not open'); return; }
    const row = page.locator('.gt-mission-phone-pilgrim', { hasText: 'Transamerica' });
    if (await row.count()) await row.locator('.gt-mission-phone-pilgrim-route')[touch ? 'tap' : 'click']().catch(e => fail(s, `Route not clickable: ${e.message.slice(0, 80)}`));
    else fail(s, 'no Transamerica row in SF PILGRIMAGE');
    await page.waitForTimeout(800); await closePhone();
    const d = await walkTo(PILGRIM, 4, 160000); s.notes.push(`at Transamerica, ${d} m`);
    if (d > 25) { s.notes.push('harness could not walk in (blocked) — inconclusive'); s.inconclusive = true; return; }
    await page.waitForTimeout(4000);
    s.claims = api.filter(a => /pilgrimage-claim/.test(a.p)).map(a => `${a.http} ${a.body}`);
    await shot('pilgrimage');
    if (!s.claims.some(c => /completed|already/.test(c))) fail(s, `landmark not claimed: ${s.claims.join(' / ') || 'no claim request'}`);
  });

  const probe = await page.evaluate(() => window.__qa).catch(() => null);
  R.frames = probe?.frames; R.worstFrameMs = Math.round(probe?.worst ?? 0);
  writeFileSync(`${out}/result.json`, JSON.stringify(R, null, 2));
  await ctx.close();
}
setTimeout(() => process.exit(process.exitCode ?? 0), 8000).unref(); // never hold the heavy lock on a hung close
await browser.close();
const failed = Object.values(summary.profiles).flatMap(r => Object.entries(r.steps).filter(([, s]) => !s.ok).map(([n, s]) => `${r.profile}:${n} ${s.error ?? s.fail ?? ''}`));
summary.failed = failed;
writeFileSync(`${runDir}/summary.json`, JSON.stringify(summary, (k, v) => k === 'api' ? undefined : v, 2));
console.log(`\n${failed.length ? 'FAILED' : 'ALL PASS'} → ${runDir}`); for (const f of failed) console.log('  ' + f);
for (const r of Object.values(summary.profiles)) if (r.wsCloses?.length) console.log(`[${r.profile}] world socket closes: ${r.wsCloses.map(c => `${c.step} ${c.text}`).join(' | ')}`);
for (const r of Object.values(summary.profiles)) console.log(`[${r.profile}] console errors ${r.consoleErrors.length}, http>=400 ${r.http.length}, failed req ${r.failedRequests.length}, hitches>150ms ${r.hitches.length} (worst ${r.worstFrameMs}ms), overlaps ${r.overlaps.length}`);
for (const r of Object.values(summary.profiles)) if (r.policePresence) { const q = r.policePresence; console.log(`[${r.profile}] POLICE presence (N38, view cone, no occlusion): cruiser in view ${q.firstCruiserInViewS == null ? 'NEVER' : `at +${q.firstCruiserInViewS}s`} (${q.cruiserInViewSecs}s total), officer in view ${q.firstOfficerInViewS == null ? 'NEVER' : `at +${q.firstOfficerInViewS}s`} (${q.officerInViewSecs}s); max ${q.maxCruisers} cruisers/${q.maxOfficers} officers, nearest ${q.minCruiserM ?? '-'} m/${q.minOfficerM ?? '-'} m; ${q.starredSecs}s wanted of ${q.secs}s`); }
for (const r of Object.values(summary.profiles)) if (r.emptyVisible?.length) console.log(`[${r.profile}] EMPTY visible HUD boxes: ${r.emptyVisible.map(e => `${e.sel} ${e.box[2]}x${e.box[3]} @${e.box[0]},${e.box[1]} (${e.tag})`).join(' | ')}`);
for (const r of Object.values(summary.profiles)) if (r.timeLog?.length) console.log(`[${r.profile}] time log (tag sf override rain/fog/cloud): ${r.timeLog.map(t => `${t.tag} ${t.sf} ${t.ls ?? '-'} ${t.weather ? `${t.weather.rain}/${t.weather.fog}/${t.weather.cloud}` : 'noWx'}${t.optionsOpen ? ' OPTIONS' : ''}`).join(' | ')}`);
for (const r of Object.values(summary.profiles)) if (r.keyboardText?.length) console.log(`[${r.profile}] keyboard-only text on touch: ${r.keyboardText.map(k => `"${k.match}" in ${k.el} (${k.tag}): ${k.text.slice(0, 70)}`).join(' | ')}`);
for (const r of Object.values(summary.profiles)) { const v = r.overlaps.filter(o => o.kind === 'visual'); if (v.length) console.log(`[${r.profile}] HUD visual overlaps: ${v.map(o => `${o.a} x ${o.b} ${o.w}x${o.h}px @${o.at} (${o.tag})`).join(' | ')}`); }
process.exit(failed.length ? 1 : 0);
