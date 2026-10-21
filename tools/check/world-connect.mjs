#!/usr/bin/env node
/**
 * World connectivity canary (gtasf-hfo8 follow-up). A fast, headless check that an *admitted* client
 * can open the WorldDO WebSocket — i.e. the exact failure class that took local dev down before the
 * Oct-4 playtest: a stale `WorldDO('sf')` whose persisted state was incompatible with hot-reloaded
 * changes, so the `/api/world` WS upgrade hung ("socket hang up") even though HTTP was fine.
 *
 * This runs the real admission handshake (`GET /api/admission` -> `POST /api/admission/enter`) and
 * then upgrades the WebSocket with the returned grant, sends a C2S HELLO, and asserts the server's
 * WELCOME (opcode 0x81) — the WorldDO can 101 the socket yet never send WELCOME (seen in local/open
 * mode), which leaves a real client stuck at spawn, so upgrade-only is not enough. It is HTTP+WS
 * only (no browser, ~1-2s), so it is safe to run under load and before deploys as a quick canary —
 * it complements, not replaces, the full browser founder-path smoke (which also verifies the in-game
 * spawn -> drive -> fund journey this check does not).
 *
 *   node tools/check/world-connect.mjs                 # check http://localhost:8787
 *   node tools/check/world-connect.mjs https://gtasf.com
 *   GTASF_WS_TIMEOUT=12000 node tools/check/world-connect.mjs
 *
 * Exit 0 = an admitted client connected (networking healthy); exit 1 = unreachable / rejected / hang.
 */
import WebSocket from 'ws';

const base = (process.argv[2] || process.env.GTASF_BASE || 'http://localhost:8787').replace(/\/+$/, '');
const wsBase = base.replace(/^http/, 'ws');
const SPAWN = process.env.GTASF_SPAWN || '37.7955,-122.3937'; // Ferry Building default spawn.
const TIMEOUT = Number(process.env.GTASF_WS_TIMEOUT || 8000);

const die = (msg) => { console.error(`FAIL  ${msg}`); process.exit(1); };
const note = (msg) => console.log(`OK    ${msg}`);

// 1. Admission config. A fresh worker answers this even while the WS is wedged, so it isolates the
//    HTTP layer from the WS layer (the whole point: HTTP-fine + WS-hung was the stale-DO signature).
let cfg;
try {
  const res = await fetch(`${base}/api/admission`, { headers: { Origin: base }, cache: 'no-store' });
  if (!res.ok) die(`GET /api/admission -> ${res.status}`);
  cfg = await res.json();
} catch (error) {
  die(`GET /api/admission unreachable: ${error.message} — is \`npm run dev\` running on ${base}?`);
}
note(`admission: launchMode=${cfg.launchMode} allowed=${cfg.allowed} enabled=${cfg.enabled} capacity=${cfg.capacity ?? '?'}`);
if (cfg.allowed === false) die(`launch not allowed (launchMode=${cfg.launchMode}); cannot verify a normal client connect here`);

// 2. Admission grant (only when world capacity/admission is enabled; otherwise connect ungated).
let grant;
if (cfg.enabled) {
  const res = await fetch(`${base}/api/admission/enter`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}',
  });
  const body = await res.json().catch(() => ({}));
  if (body.status !== 'admitted' || !body.grant) die(`admission/enter did not admit: ${JSON.stringify(body).slice(0, 140)}`);
  grant = body.grant;
  note('admission granted');
} else {
  console.log('OK    admission disabled (worldCapacity off) — connecting without a grant');
}

// 3. Full handshake: WS upgrade (the step that hung) -> send a C2S HELLO -> await WELCOME (0x81).
//    Upgrade-only is not enough: the WorldDO can 101 the socket yet never send WELCOME (seen in
//    local/open mode), leaving a real client stuck at spawn. So this asserts WELCOME, not just open.
const protocols = grant ? ['gtasf.v2', `gtasf.admit.${grant}`] : 'gtasf.v2';
const ws = new WebSocket(`${wsBase}/api/world?at=${SPAWN}`, protocols, { origin: base });
let opened = false, helloSent = false, upgradeStatus, done = false;
const finish = (code, msg) => {
  if (done) return; done = true; // first verdict wins (our own ws.close() re-fires 'close')
  try { ws.close(); } catch { /* already closed */ }
  (code ? console.error : console.log)(`${code ? 'FAIL ' : 'OK   '} ${msg}`);
  setTimeout(() => process.exit(code), 80);
};
const timer = setTimeout(() => finish(1, !opened
  ? `WS did not open within ${TIMEOUT}ms (hang) — stale WorldDO? try: rm -rf worker/.wrangler/state && restart npm run dev`
  : `WS opened (HTTP ${upgradeStatus || 101}) + HELLO sent, but NO WELCOME within ${TIMEOUT}ms — WorldDO handshake stalled (upgrade works; WELCOME missing; seen in local/open mode)`),
  TIMEOUT);
ws.on('upgrade', (res) => { upgradeStatus = res.statusCode; });
ws.on('open', () => {
  opened = true;
  // C2S HELLO: u8 op(1) + u8 PROTOCOL_VERSION(2) + str8 name (u8 len + utf8) + str8 '' resume token (u8 0).
  const name = Buffer.from('canary', 'utf8');
  ws.send(Buffer.concat([Buffer.from([0x01, 0x02, name.length]), name, Buffer.from([0x00])]));
  helloSent = true;
  console.log(`OK    WS OPEN (HTTP ${upgradeStatus || 101}); HELLO sent, awaiting WELCOME…`);
});
ws.on('message', (data) => {
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (b[0] === 0x81) { clearTimeout(timer); finish(0, 'WELCOME received (0x81) — full admit -> upgrade -> HELLO -> WELCOME handshake healthy'); }
  // Other opcodes before WELCOME are fine; keep waiting for 0x81.
});
ws.on('error', (error) => { clearTimeout(timer); finish(1, `WS error (HTTP ${upgradeStatus ?? '?'}): ${error.message}`); });
ws.on('close', (code, reason) => {
  clearTimeout(timer);
  if (!opened) finish(1, `WS closed before open: ${code} ${reason || ''} (HTTP ${upgradeStatus ?? '?'})`);
  else finish(1, `WS closed after open (code ${code}${reason ? ' ' + reason : ''})${helloSent ? ' after HELLO' : ''} before WELCOME — handshake rejected`);
});
