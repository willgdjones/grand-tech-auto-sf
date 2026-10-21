/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { afterEach, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { abortAllDurableObjects } from 'cloudflare:test';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import { zoneId } from '@gtasf/shared/world/zones';
import type { C2SMessage, S2CMessage } from '@gtasf/shared/protocol/types';
import type { WorldDO } from './WorldDO';
import type { Env } from '../env';
import { worldTestHeaders } from './admission/test-headers';

const bindings = env as unknown as Env;
const sockets: WebSocket[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const ws of sockets.splice(0)) { try { ws.close(); } catch { /* closed */ } } await abortAllDurableObjects(); });
function cell(cx: number, cy: number) { return bindings.WORLD.get(bindings.WORLD.idFromName(zoneId(cx, cy))) as DurableObjectStub<WorldDO>; }

function reader(ws: WebSocket) {
  ws.binaryType = 'arraybuffer'; ws.accept(); sockets.push(ws);
  const messages: S2CMessage[] = [];
  const listeners = new Set<() => void>();
  ws.addEventListener('message', e => {
    const d = decodeS2C(new Uint8Array(e.data as ArrayBuffer));
    if (!d.ok) throw new Error(`bad frame: ${d.err}`);
    messages.push(d.msg); for (const l of listeners) l();
  });
  function next<T extends S2CMessage['type']>(type: T, predicate?: (m: Extract<S2CMessage, { type: T }>) => boolean): Promise<Extract<S2CMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listeners.delete(check); reject(new Error(`no ${type}; got ${messages.map(m => m.type)}`)); }, 6000);
      function check() {
        const f = messages.find((m): m is Extract<S2CMessage, { type: T }> => m.type === type && (!predicate || predicate(m as Extract<S2CMessage, { type: T }>)));
        if (f) { clearTimeout(timer); listeners.delete(check); resolve(f); }
      }
      listeners.add(check); check();
    });
  }
  return { ws, messages, next, send: (m: C2SMessage) => ws.send(encodeC2S(m)), close: () => { try { ws.close(); } catch { /* closed */ } } };
}
const SPAWN = 'spawn=-540000,300,-530000,0';
async function player(name: string, resumeToken?: string) {
  const stub = cell(0, 0);
  const r = await stub.fetch(`https://test/api/world?zone=0,0&${SPAWN}`, { headers: await worldTestHeaders(stub) });
  expect(r.status).toBe(101);
  const rd = reader(r.webSocket!); rd.send({ type: 'HELLO', name, ...(resumeToken ? { resumeToken } : {}) });
  return rd;
}
async function observer() {
  const stub = cell(0, 0);
  const r = await stub.fetch(`https://test/api/world?observe=1&zone=0,0&${SPAWN}`, { headers: await worldTestHeaders(stub) });
  expect(r.status).toBe(101);
  return reader(r.webSocket!);
}

it('restores a persisted appearance after a resume (no re-send needed)', async () => {
  const a = await player('Ada'); const wa = await a.next('WELCOME');
  a.send({ type: 'SET_APPEARANCE', appearance: 777 });
  await new Promise(res => setTimeout(res, 150)); // let the save() land
  a.close();
  // Resume the same session; the client does NOT re-send SET_APPEARANCE.
  const a2 = await player('Ada', wa.resumeToken); await a2.next('WELCOME', m => m.id === wa.id && m.resumed);
  // A newcomer's join-replay now carries A's persisted look, proving install restored it from the row.
  const b = await player('Boz'); await b.next('WELCOME');
  expect((await b.next('APPEARANCE', m => m.id === wa.id)).appearance).toBe(777);
});

it('sends a visible player\'s appearance to a cross-zone observer socket', async () => {
  const a = await player('Ada'); const wa = await a.next('WELCOME');
  a.send({ type: 'SET_APPEARANCE', appearance: 555 });
  const obs = await observer();
  expect((await obs.next('APPEARANCE', m => m.id === wa.id && m.appearance === 555)).appearance).toBe(555);
});
