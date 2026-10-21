/** Spoken bubbles + live voice local check (gtasf-gc9q/qjja, docs/engineering/spoken-bubbles.md "Verification").
 *  Needs the dev servers already running with dev flags and REMOTE Workers AI (`GTASF_DEV_REMOTE_AI=1 npm run dev`, or
 *  worker: `npm run dev:ai -w @gtasf/worker`; plain --local has no Workers AI) (worker: which reads worker/.dev.vars for
 *  ELEVENLABS_API_KEY/TYPESAFE_API_KEY; web: `npm run dev:web`). Headless Chromium with a fake mic playing a WAV.
 *  1. Unverified speaker A (voice off) holds V 2 s -> near tab B shows a 🎙 bubble; far tab C (~80 m) shows nothing.
 *  2. Verified speaker V (voice on) holds V -> pill shows, B (voice on) hears audio and its radio ducks, B gets the bubble.
 *  Usage: tools/heavy.sh node tools/voice/caption-two-tab.mjs [wav]   (local only; never production) */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.GTASF_BASE ?? 'http://127.0.0.1:5173';
const wav = resolve(process.argv[2] ?? '/tmp/gtasf-whats-up-guys.wav');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
// The running `wrangler dev` holds the local D1; a second wrangler process can't query it, so use its SQLite file.
import { readdirSync } from 'node:fs';
const D1_DIR = 'worker/.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const D1_FILE = `${D1_DIR}/${readdirSync(D1_DIR).find(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite')}`;
const d1 = sql => { const out = execFileSync('sqlite3', ['-json', '-cmd', '.timeout 5000', D1_FILE, sql], { encoding: 'utf8' }).trim(); return out ? JSON.parse(out) : []; };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const report = { steps: [] };
const step = (name, data) => { report.steps.push({ name, ...data }); console.error(name, JSON.stringify(data)); };

async function tab(name, query = '') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, userAgent: UA, permissions: ['microphone'] });
  // Record every media-element volume write (the radio's <audio> is never in the DOM).
  await context.addInitScript(() => {
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
    Object.defineProperty(HTMLMediaElement.prototype, 'volume', { configurable: true, get() { return desc.get.call(this); },
      set(v) { (window.__volumes ??= []).push([Math.round(performance.now()), Math.round(v * 1000) / 1000]); desc.set.call(this, v); } });
  });
  await context.addInitScript(() => {
    const log = (...a) => (window.__capLog ??= []).push(`${Math.round(performance.now())} ${a.join(' ')}`);
    const gum = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (gum) navigator.mediaDevices.getUserMedia = c => { log('gum'); return gum(c).then(s => { log('gum ok', s.getAudioTracks().length); return s; }, e => { log('gum fail', e?.name); throw e; }); };
    const MR = window.MediaRecorder;
    if (MR) window.MediaRecorder = class extends MR { constructor(...a) { super(...a); log('mr new', this.mimeType); } start(...a) { log('mr start'); return super.start(...a); } stop() { log('mr stop'); return super.stop(); } };
    const WS = window.WebSocket;
    window.WebSocket = class extends WS { constructor(...a) { super(...a); this.addEventListener('close', e => log('ws close', e.code, e.reason, String(a[0]).replace(/^.*\/api/, '/api'))); } };
    const f = window.fetch.bind(window);
    window.fetch = async (input, init) => { if (String(input).includes('/api/voice/caption') && init?.body instanceof Blob) {
      const bytes = new Uint8Array(await init.body.arrayBuffer()); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); window.__clip = btoa(bin); } return f(input, init); };
    window.addEventListener('keydown', e => { if (e.code === 'KeyV') log('keydown V reached window(capture,first)'); }, true);
    // Spoken-bubble DOM lifecycle (add/remove/text change) for the speaker's own-bubble check.
    new MutationObserver(records => { for (const r of records) {
      for (const n of r.addedNodes) if (n.nodeType === 1 && n.classList?.contains('gt-chat-bubble-spoken')) log('bubble +', n.textContent);
      for (const n of r.removedNodes) if (n.nodeType === 1 && n.classList?.contains('gt-chat-bubble-spoken')) log('bubble -', n.textContent);
    } }).observe(document.documentElement, { childList: true, subtree: true });
  });
  // GTASF_LOCAL_DIST=<vite outDir>: serve the page + /assets from a local build while /api and the world socket stay on
  // GTASF_BASE (e.g. live). Proves a client fix against the production server before it ships.
  if (process.env.GTASF_LOCAL_DIST) {
    const { readFile } = await import('node:fs/promises'), { join, extname } = await import('node:path');
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
    await context.route(url => url.origin === new URL(BASE).origin && !url.pathname.startsWith('/api'), async route => {
      const path = new URL(route.request().url()).pathname, file = join(process.env.GTASF_LOCAL_DIST, path === '/' ? 'index.html' : path);
      try { await route.fulfill({ body: await readFile(file), contentType: types[extname(file)] ?? 'application/octet-stream' }); }
      catch { await route.continue(); }
    });
  }
  const page = await context.newPage();
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) step(`${name} console`, { text: m.text().slice(0, 160) }); });
  page.on('pageerror', e => step(`${name} pageerror`, { error: String(e).slice(0, 200) }));
  // Spoken chat frames (S2C.CHAT_SPOKEN 0x88) as they arrive on this tab's world socket.
  page.on('websocket', ws => ws.on('framereceived', f => { const b = f.payload; if (typeof b !== 'string' && b[0] === 0x88) step(`${name} CHAT_SPOKEN frame`, { at: Date.now(), bytes: b.length }); }));
  page.on('request', q => { if (q.url().includes('/api/voice/caption')) { const body = q.postDataBuffer(); if (body && process.env.SAVE_CLIP) import('node:fs').then(fs => fs.writeFileSync(process.env.SAVE_CLIP, body)); } });
  page.on('response', r => { if (r.url().includes('/api/voice/caption')) r.json().then(j => step(`${name} caption answer`, { status: r.status(), body: j, at: Date.now() })).catch(() => {}); });
  const t0 = Date.now();
  await page.goto(`${BASE}/?voice=1${query}`);
  for (let i = 0; i < 300; i++) { if (await page.evaluate(() => document.querySelector('#loading')?.hidden).catch(() => false)) break; await page.waitForTimeout(500); }
  // READY is not enough: talking needs the world socket joined (#connection reads exactly 'Connected').
  for (let i = 0; i < 120; i++) { if (await page.evaluate(() => document.querySelector('#connection')?.textContent === 'Connected').catch(() => false)) break; await page.waitForTimeout(500); }
  await page.waitForTimeout(1500);
  // Dismiss the first-visit intro slides / overlays (they cover the speaker's own bubble in screenshots).
  for (const label of ['Skip', 'Looks good', 'Skip intro', 'Skip tutorial', 'Close ×', "Let's go"]) {
    const b = page.getByRole('button', { name: label, exact: true }); if (await b.count().catch(() => 0) === 1 && await b.isVisible().catch(() => false)) await b.click().catch(() => {}); }
  step(`${name} ready`, { ms: Date.now() - t0, connection: await page.evaluate(() => document.querySelector('#connection')?.textContent).catch(() => null) });
  return page;
}
const spokenBubbles = page => page.evaluate(() => [...document.querySelectorAll('.gt-chat-bubble-spoken')].map(e => e.textContent));
async function waitBubble(page, since, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    // A finished bubble isn't the speaker's own placeholder ('🎙 You…'); a transcript may itself contain '…'.
    const found = (await spokenBubbles(page).catch(() => [])).filter(t => !t.startsWith('🎙 You') && !/^🎙\s*\S*…$/.test(t));
    if (found.length) return { text: found, msAfterRelease: Date.now() - since };
    await page.waitForTimeout(150);
  }
  return { text: [], msAfterRelease: null, raw: await spokenBubbles(page).catch(() => []) };
}
async function hold(page, ms) {
  await page.bringToFront(); await page.mouse.click(640, 400).catch(() => {});
  step('before V', await page.evaluate(() => ({ active: `${document.activeElement?.tagName}.${document.activeElement?.className ?? ''}`,
    dialogs: [...document.querySelectorAll('dialog[open], [role=dialog]')].filter(d => (d).offsetParent !== null || d.open).map(d => d.className || d.getAttribute('aria-label')),
    captionBtn: (() => { const b = document.querySelector('.gt-caption-ptt'); return b ? { hidden: b.hidden } : null; })(),
    voiceBtn: [...document.querySelectorAll('.gt-voice-ptt')].map(b => ({ hidden: b.hidden, cls: b.className })),
    panels: ['.gt-upcoming', '.gt-event-card', '.gt-map', '.gt-pause', '.gt-funding-panel'].map(s => { const e = document.querySelector(s); return e ? `${s}:${e.hidden ? 'hidden' : getComputedStyle(e).display}` : null; }).filter(Boolean),
    connection: document.querySelector('#connection')?.textContent, population: document.querySelector('#population')?.textContent })).catch(e => ({ error: String(e) })));
  await page.keyboard.down('KeyV');
  await page.waitForTimeout(400);
  const pill = await page.evaluate(() => { const p = document.querySelector('.gt-voice-pill'); return p && !p.hidden ? p.textContent : null; }).catch(() => null);
  const own = await spokenBubbles(page).catch(() => []);
  await page.waitForTimeout(ms - 400);
  const atEnd = await page.evaluate(() => ({ pill: (() => { const p = document.querySelector('.gt-voice-pill'); return p && !p.hidden ? p.textContent : null; })(),
    status: document.querySelector('.gt-voice-status')?.textContent ?? null })).catch(() => null);
  await page.keyboard.up('KeyV');
  return { releasedAt: Date.now(), pill, atEnd, ownBubbleWhileHeld: own };
}
const enableVoice = page => page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Enable voice'); b?.click(); return Boolean(b); });

try {
  // 1. Unverified speaker, voice off: bubble only.
  const A = await tab('A'), B = await tab('B'), C = await tab('C', '&at=37.7962,-122.3937');
  // First press opens the mic (permission). COLD_HOLD=1 holds again immediately, while getUserMedia may still be
  // pending — the case that broke live in #5.34 (a hold during a pending mic request must still record).
  await hold(A, 300);
  // Warm: wait until the first press's getUserMedia has actually resolved (live headless took ~6 s), then hold.
  if (!process.env.COLD_HOLD) { for (let i = 0; i < 60 && !(await A.evaluate(() => (window.__capLog ?? []).some(l => l.includes('gum ok'))).catch(() => false)); i++) await A.waitForTimeout(250); await A.waitForTimeout(500); }
  const a = await hold(A, Number(process.env.HOLD_MS ?? 2000));
  step('A held V 2 s (unverified, voice off)', { pill: a.pill, ownBubbleWhileHeld: a.ownBubbleWhileHeld });
  step('B (near) bubble', await waitBubble(B, a.releasedAt));
  // The speaker must see their OWN transcript bubble too (the founder only ever sees this one). Poll from release.
  const own = await waitBubble(A, a.releasedAt, 1000);
  await A.waitForTimeout(600); // a new bubble stays visibility:hidden until the next frame measures and places it
  const ownVisible = await A.evaluate(() => [...document.querySelectorAll('.gt-chat-bubble-spoken')].map(e => ({ text: e.textContent,
    shown: !e.hidden && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0,
    hidden: e.hidden, visibility: e.style.visibility, left: e.style.left, top: e.style.top, w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) }))).catch(() => []);
  if (process.env.SHOT_DIR) await A.screenshot({ path: `${process.env.SHOT_DIR}/speaker-own-bubble.png` }).catch(() => {});
  step('A own transcript bubble', { ...own, visible: ownVisible, ok: own.text.length > 0 && ownVisible.some(b => b.shown && !b.text.startsWith('🎙 You')) });
  step('C (~80 m) bubble', await waitBubble(C, a.releasedAt, 4000));
  if (process.env.SAVE_CLIP) { const b64 = await A.evaluate(() => window.__clip ?? null).catch(() => null); if (b64) (await import('node:fs')).writeFileSync(process.env.SAVE_CLIP, Buffer.from(b64, 'base64')); }
  step('A own bubble after', { text: await spokenBubbles(A).catch(() => []), capLog: await A.evaluate(() => window.__capLog ?? []).catch(() => null) });

  // 2. Verified speaker with live voice; B listens with voice on.
  if (!process.env.STEP1_ONLY) {
  // Four game tabs in one headless browser starve each other's timers (30 s idle closes); keep only B + V now.
  await A.context().close(); await C.context().close();
  const V = await tab('V');
  const newest = d1('SELECT device_id FROM funding_profiles ORDER BY created_at DESC LIMIT 1')[0]?.device_id;
  d1(`INSERT INTO email_captures(device_id,email,email_hash,last_sent_at,verified_at,created_at) VALUES('${newest}','test@example.com','test',0,${Date.now()},${Date.now()}) ON CONFLICT(device_id) DO UPDATE SET verified_at=${Date.now()}`);
  step('V marked verified (local D1)', { device: newest ? 'ok' : 'missing' });
  step('enable voice', { V: await enableVoice(V), B: await enableVoice(B) });
  await V.waitForTimeout(6000);
  const before = await B.evaluate(() => (window.__volumes ?? []).slice(-1)[0] ?? null);
  const v = await hold(V, Number(process.env.VOICE_HOLD_MS ?? 6000));
  const duringB = await B.evaluate(() => (window.__volumes ?? []).slice(-4));
  step('V held V (verified, voice on)', { pill: v.pill, atEnd: v.atEnd, radioBeforeOnB: before, radioWritesOnB: duringB });
  step('B bubble from V', await waitBubble(B, v.releasedAt));
  step('V log', { capLog: await V.evaluate(() => window.__capLog ?? []).catch(() => null), status: await V.evaluate(() => document.querySelector('.gt-voice-status')?.textContent).catch(() => null) });
  }
} finally {
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
}
