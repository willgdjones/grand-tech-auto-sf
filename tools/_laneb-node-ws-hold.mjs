// gtasf-j7wvv: an INDEPENDENT Node world socket (own TCP+TLS, no browser), held alongside a Chrome soak. Chrome's net-log
// showed the edge ending the dropped sockets with a TLS close_notify (alert 01 00) from the PDX colo. If this socket dies
// in the same second as Chrome's, the edge/route drops every long-lived connection; if it never dies while Chrome's
// does, it's something about Chrome's connection. FAMILY=4|6 pins the address family (Chrome took IPv6 -> PDX, Node
// IPv4 -> SJC).   FAMILY=6 MINUTES=20 npx tsx tools/_laneb-node-ws-hold.mjs
import { encodeC2S } from '../shared/protocol/c2s.ts';
import { decodeS2C } from '../shared/protocol/s2c.ts';
import { PROTOCOL_SUBPROTOCOL } from '../shared/protocol/constants.ts';
import WebSocket from 'ws';
import { ADMISSION_PROTOCOL_PREFIX } from '../shared/admission.ts';

const base = (process.env.GTASF_URL ?? 'https://gtasf.com').replace(/^http/, 'ws');
const minutes = Number(process.env.MINUTES ?? 20);
const log = s => console.log(`[node-ws] ${new Date().toISOString()} ${s}`);
let opens = 0, closes = 0;
setTimeout(() => { log(`DONE opens=${opens} closes=${closes}`); process.exit(0); }, minutes * 60_000);

const http = base.replace(/^ws/, 'http');
let ticket;
/** worldCapacity is on in prod: every socket needs a fresh admission grant (the web client's admission/client.ts flow). */
async function admit() {
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`${http}/api/admission/${ticket ? 'poll' : 'enter'}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: http }, body: JSON.stringify({ ticket }) });
    const v = await r.json().catch(() => ({}));
    if (v.ticket) ticket = v.ticket;
    if (v.status === 'admitted' && v.grant) return v.grant;
    if (!r.ok) { log(`admission HTTP ${r.status} ${JSON.stringify(v)}`); ticket = undefined; }
    await new Promise(res => setTimeout(res, 2000));
  }
  return undefined;
}

async function connect() {
  const grant = await admit();
  return new Promise(done => {
    const ws = new WebSocket(`${base}/api/world`, grant ? [PROTOCOL_SUBPROTOCOL, `${ADMISSION_PROTOCOL_PREFIX}${grant}`] : PROTOCOL_SUBPROTOCOL, { origin: http, ...(process.env.FAMILY ? { family: Number(process.env.FAMILY) } : {}) });
    ws.on('unexpected-response', (_req, res) => { log(`upgrade refused: HTTP ${res.statusCode}`); ticket = undefined; done(); });
    ws.on('upgrade', res => log(`101 cf-ray=${res.headers['cf-ray'] ?? '-'}`));
    ws.binaryType = 'arraybuffer';
    let opened = 0, timer, nonce = 0;
    ws.addEventListener('open', () => {
      opened = Date.now(); opens++; log(`open #${opens}`);
      ws.send(encodeC2S({ type: 'HELLO', name: 'NodeHold' }));
      // A PING every second + ACTIVITY every 20 s, like the client's heartbeat — keeps the session alive, never idle.
      timer = setInterval(() => {
        ws.send(encodeC2S({ type: 'PING', nonce: ++nonce, clientT: Date.now() % 2 ** 31 }));
        if (nonce % 20 === 0) ws.send(encodeC2S({ type: 'ACTIVITY' }));
      }, 1000);
    });
    ws.addEventListener('message', e => {
      const r = decodeS2C(new Uint8Array(e.data));
      if (r.ok && r.msg.type === 'WELCOME') log(`WELCOME id=${r.msg.id}`);
    });
    ws.addEventListener('close', e => {
      clearInterval(timer); closes++; ticket = undefined; // the grant was consumed: enter afresh, like admission/client.ts
      log(`ws closed code=${e.code} clean=${e.wasClean} reason=${e.reason || '-'} after ${((Date.now() - opened) / 1000).toFixed(1)} s`);
      done();
    });
    ws.addEventListener('error', e => log(`error event ${e.message ?? ''}`));
  });
}

for (;;) { await connect(); await new Promise(r => setTimeout(r, 1500)); }
