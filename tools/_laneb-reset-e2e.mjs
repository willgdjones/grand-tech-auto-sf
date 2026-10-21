// gtasf-2cprr end-to-end in the real Workers runtime: does a wanted player's heat survive a WorldDO instance reset?
// Against a local combat-stack (COMBAT_FLAGS="combat wanted streetCrimeWanted"), in two phases with a worker restart
// between them (a restarted `wrangler dev --local` = a fresh DO instance on the same on-disk SQLite, like Cloudflare's
// reset; the socket is NOT closed first, so remove() never stashes anything):
//   PHASE=1 npx tsx tools/_laneb-reset-e2e.mjs   mint a device, join, opt in, confess 2 crimes -> 2 stars, hold 5 s (saves)
//   <kill + restart the local worker>
//   PHASE=2 npx tsx tools/_laneb-reset-e2e.mjs   resume with the same device + token: expect WANTED > 0 restored
import { readFile, writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { encodeC2S } from '../shared/protocol/c2s.ts';
import { decodeS2C } from '../shared/protocol/s2c.ts';
import { PROTOCOL_SUBPROTOCOL } from '../shared/protocol/constants.ts';
import { ADMISSION_PROTOCOL_PREFIX } from '../shared/admission.ts';
import { TIME_TRIALS } from '../shared/founder/timeTrials.ts';
import { project } from '../worker/src/funding/anchors.ts';

// RUN=trial (gtasf-yufot): instead of heat, start the Embarcadero time trial in phase 1 and, in phase 2, probe the
// submit: 'no-active-run' = the run was lost, 'stale-session' = kept but not rebound, anything later = it survived.
const trial = process.env.RUN === 'trial' ? TIME_TRIALS.find(t => t.id === 'embarcadero-sprint') : undefined;
const post = (path, cookie, body) => fetch(`${http}/api/funding/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: http, Cookie: cookie }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const http = process.env.GTASF_URL ?? 'http://localhost:5319', ws = http.replace(/^http/, 'ws');
const stateFile = process.env.STATE ?? '/tmp/gtasf-laneb-reset-e2e.json';
const log = s => console.log(`[reset-e2e] ${new Date().toISOString().slice(11, 23)} ${s}`);
const wait = ms => new Promise(r => setTimeout(r, ms));

async function grant() {
  let ticket;
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`${http}/api/admission/${ticket ? 'poll' : 'enter'}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: http }, body: JSON.stringify({ ticket }) });
    const v = await r.json().catch(() => ({}));
    if (v.ticket) ticket = v.ticket;
    if (v.status === 'admitted' && v.grant) return v.grant;
    await wait(1000);
  }
  throw new Error('no admission grant');
}

async function join(cookie, resumeToken, spawn) {
  const g = await grant();
  const socket = new WebSocket(`${ws}/api/world${spawn ? `?spawn=${spawn}` : ''}`, [PROTOCOL_SUBPROTOCOL, `${ADMISSION_PROTOCOL_PREFIX}${g}`], { origin: http, headers: { Cookie: cookie } });
  socket.binaryType = 'arraybuffer';
  const seen = [];
  socket.on('message', data => { const r = decodeS2C(new Uint8Array(data)); if (r.ok) seen.push(r.msg); });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); socket.once('unexpected-response', (_q, res) => reject(new Error(`upgrade ${res.statusCode}`))); });
  socket.send(encodeC2S({ type: 'HELLO', name: 'ResetE2E', ...(resumeToken ? { resumeToken } : {}) }));
  for (let i = 0; i < 50 && !seen.some(m => m.type === 'WELCOME'); i++) await wait(100);
  const welcome = seen.find(m => m.type === 'WELCOME');
  if (!welcome) throw new Error('no WELCOME');
  return { socket, seen, welcome };
}

if (process.env.PHASE === '2') {
  const { cookie, token, id, level } = JSON.parse(await readFile(stateFile, 'utf8'));
  const { socket, seen, welcome } = await join(cookie, token);
  await wait(1500);
  if (trial) {
    const probe = await post('tt-submit', cookie, { routeId: trial.id, sid: welcome.id, splits: [] });
    const reason = probe.body.reason ?? probe.body.error ?? probe.body.status;
    log(`resumed id=${welcome.id} (was ${id}); tt-submit -> HTTP ${probe.status} ${JSON.stringify(probe.body).slice(0, 120)}`);
    console.log(`RESULT ${reason === 'no-active-run' ? 'FAIL run lost' : reason === 'stale-session' ? 'FAIL run kept but not rebound' : 'PASS run survived the reset and still belongs to this session'}`);
    socket.close(1000); process.exit(0);
  }
  const wanted = seen.filter(m => m.type === 'WANTED').map(m => m.level);
  log(`resumed id=${welcome.id} (was ${id}, resumed=${welcome.resumed}); WANTED after rejoin: ${JSON.stringify(wanted)} (had ${level} before the reset)`);
  console.log(`RESULT ${wanted.some(l => l > 0) ? 'PASS heat restored' : 'FAIL heat lost'}`);
  socket.close(1000); process.exit(0);
}

// PHASE 1
const profile = await fetch(`${http}/api/funding/profile`, { headers: { Origin: http } });
const cookie = profile.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw new Error(`no device cookie (HTTP ${profile.status})`);
const start = trial ? project(trial.start.lat, trial.start.lon) : undefined;
const { socket, seen, welcome } = await join(cookie, undefined, start ? `${Math.round(start.x * 100)},300,${Math.round(start.z * 100)},0` : undefined);
log(`joined id=${welcome.id} with a fresh device${start ? ' at the trial start' : ''}`);
if (trial) {
  const started = await post('tt-start', cookie, { routeId: trial.id, sid: welcome.id });
  log(`tt-start -> HTTP ${started.status} ${JSON.stringify(started.body)}`);
  if (started.body.status !== 'started') { console.log('RESULT SETUP-FAIL (trial did not start)'); process.exit(1); }
  const pinger = setInterval(() => socket.send(encodeC2S({ type: 'PING', nonce: 1, clientT: Date.now() % 2 ** 31 })), 500);
  await wait(5000);
  await writeFile(stateFile, JSON.stringify({ cookie, token: welcome.resumeToken, id: welcome.id, level: 0 }));
  log(`state saved; holding the socket open until the worker restart severs it (<= 90 s)`);
  await new Promise(resolve => { socket.once('close', code => { log(`socket severed by the server side (code ${code})`); resolve(); }); setTimeout(resolve, 90_000); });
  clearInterval(pinger); process.exit(0);
}
socket.send(encodeC2S({ type: 'COMBAT_READY' }));
await wait(500);
for (let i = 0; i < 3; i++) { socket.send(encodeC2S({ type: 'COMBAT_CRIME', kind: 0 })); await wait(1300); }
const level = Math.max(0, ...seen.filter(m => m.type === 'WANTED').map(m => m.level));
log(`wanted level ${level}`);
if (level < 1) { console.log('RESULT SETUP-FAIL (no wanted level: are combat/wanted/streetCrimeWanted on?)'); process.exit(1); }
const pinger = setInterval(() => socket.send(encodeC2S({ type: 'PING', nonce: 1, clientT: Date.now() % 2 ** 31 })), 500);
await wait(5000); // > SESSION_SAVE_MS: the persisted row is written
await writeFile(stateFile, JSON.stringify({ cookie, token: welcome.resumeToken, id: welcome.id, level }));
log(`state saved to ${stateFile}; holding the socket open until the worker restart severs it (<= 90 s)`);
// The socket must die with the worker (a reset), not with a close from us: remove() would stash in memory instead.
await new Promise(resolve => { socket.once('close', code => { log(`socket severed by the server side (code ${code})`); resolve(); }); setTimeout(resolve, 90_000); });
clearInterval(pinger); process.exit(0);
