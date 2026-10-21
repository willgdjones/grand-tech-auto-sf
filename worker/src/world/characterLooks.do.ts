/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { afterEach, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { abortAllDurableObjects } from 'cloudflare:test';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import type { C2SMessage, S2CMessage } from '@gtasf/shared/protocol/types';
import type { WorldDO } from './WorldDO';
import type { Env } from '../env';
import { worldTestHeaders } from './admission/test-headers';

const bindings = env as unknown as Env;
const sockets: WebSocket[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const ws of sockets.splice(0)) { try { ws.close(); } catch { /* closed */ } } await abortAllDurableObjects(); });
function world() { return bindings.WORLD.get(bindings.WORLD.newUniqueId()) as DurableObjectStub<WorldDO>; }

function reader(ws: WebSocket) {
  ws.binaryType = 'arraybuffer'; ws.accept(); sockets.push(ws);
  const messages: S2CMessage[] = [];
  const listeners = new Set<() => void>();
  ws.addEventListener('message', event => {
    if (typeof event.data === 'string') throw new Error('Unexpected text frame');
    const decoded = decodeS2C(new Uint8Array(event.data as ArrayBuffer));
    if (!decoded.ok) throw new Error(`Bad server frame: ${decoded.err}`);
    messages.push(decoded.msg); for (const listener of listeners) listener();
  });
  function next<T extends S2CMessage['type']>(type: T, predicate?: (m: Extract<S2CMessage, { type: T }>) => boolean): Promise<Extract<S2CMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listeners.delete(check); reject(new Error(`No ${type}; got ${messages.map(m => m.type)}`)); }, 5000);
      function check() {
        const found = messages.find((m): m is Extract<S2CMessage, { type: T }> => m.type === type && (!predicate || predicate(m as Extract<S2CMessage, { type: T }>)));
        if (found) { clearTimeout(timer); listeners.delete(check); resolve(found); }
      }
      listeners.add(check); check();
    });
  }
  return { ws, messages, next, send: (m: C2SMessage) => ws.send(encodeC2S(m)) };
}
async function player(stub: DurableObjectStub<WorldDO>, name = 'Founder') {
  const response = await stub.fetch('https://test/api/world', { headers: await worldTestHeaders(stub) });
  expect(response.status).toBe(101);
  const r = reader(response.webSocket!); r.send({ type: 'HELLO', name });
  return r;
}

it('relays a player\'s SET_APPEARANCE to the others', async () => {
  const stub = world();
  const a = await player(stub, 'Ada'); const wa = await a.next('WELCOME');
  const b = await player(stub, 'Boz'); await b.next('WELCOME');
  a.send({ type: 'SET_APPEARANCE', appearance: 12345 });
  // b sees a's default (0) at join, then the relayed update.
  await b.next('APPEARANCE', m => m.id === wa.id && m.appearance === 12345);
});

it('replays an existing player\'s appearance to a joiner, after its PLAYER_JOIN', async () => {
  const stub = world();
  const a = await player(stub, 'Ada'); const wa = await a.next('WELCOME');
  a.send({ type: 'SET_APPEARANCE', appearance: 777 });
  const c = await player(stub, 'Cy'); await c.next('WELCOME');
  // The joiner eventually learns a's real look (either via the join replay or a follow-up relay).
  await c.next('APPEARANCE', m => m.id === wa.id && m.appearance === 777);
  // The first APPEARANCE for a (the join replay) arrives only after a's PLAYER_JOIN.
  const joinIdx = c.messages.findIndex(m => m.type === 'PLAYER_JOIN' && m.id === wa.id);
  const apprIdx = c.messages.findIndex(m => m.type === 'APPEARANCE' && m.id === wa.id);
  expect(apprIdx).toBeGreaterThan(joinIdx);
});

it('drops an out-of-range (>= 2^26) appearance and relays only the valid one', async () => {
  const stub = world();
  const a = await player(stub, 'Ada'); await a.next('WELCOME');
  const b = await player(stub, 'Boz'); const wb = await b.next('WELCOME');
  b.send({ type: 'SET_APPEARANCE', appearance: 0x4000000 }); // 2^26 — invalid, dropped
  b.send({ type: 'SET_APPEARANCE', appearance: 999 });        // valid, relayed
  await a.next('APPEARANCE', m => m.id === wb.id && m.appearance === 999);
  expect(a.messages.every(m => m.type !== 'APPEARANCE' || m.appearance !== 0x4000000)).toBe(true);
});
