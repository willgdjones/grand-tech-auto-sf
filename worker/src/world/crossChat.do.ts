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
function cellWorld(cx: number, cy: number) { return bindings.WORLD.get(bindings.WORLD.idFromName(zoneId(cx, cy))) as DurableObjectStub<WorldDO>; }

function reader(ws: WebSocket) {
  ws.binaryType = 'arraybuffer'; ws.accept(); sockets.push(ws);
  const messages: S2CMessage[] = [];
  const listeners = new Set<() => void>();
  ws.addEventListener('message', event => {
    if (typeof event.data === 'string') throw new Error('Unexpected text frame');
    const decoded = decodeS2C(new Uint8Array(event.data as ArrayBuffer));
    if (!decoded.ok) throw new Error(`Bad server frame: ${decoded.err}`);
    messages.push(decoded.msg); for (const l of listeners) l();
  });
  function next<T extends S2CMessage['type']>(type: T, predicate?: (m: Extract<S2CMessage, { type: T }>) => boolean, timeoutMs = 5000): Promise<Extract<S2CMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listeners.delete(check); reject(new Error(`No ${type}; got ${messages.map(m => m.type)}`)); }, timeoutMs);
      function check() {
        const found = messages.find((m): m is Extract<S2CMessage, { type: T }> => m.type === type && (!predicate || predicate(m as Extract<S2CMessage, { type: T }>)));
        if (found) { clearTimeout(timer); listeners.delete(check); resolve(found); }
      }
      listeners.add(check); check();
    });
  }
  return { ws, messages, next, send: (m: C2SMessage) => ws.send(encodeC2S(m)) };
}

type Pose3 = { x: number; y: number; z: number };
async function player(cx: number, cy: number, spawn: Pose3, name: string) {
  const stub = cellWorld(cx, cy);
  const url = `https://test/api/world?zone=${cx},${cy}&spawn=${spawn.x},${spawn.y},${spawn.z},0`;
  const response = await stub.fetch(url, { headers: await worldTestHeaders(stub) });
  expect(response.status).toBe(101);
  const r = reader(response.webSocket!); r.send({ type: 'HELLO', name });
  return r;
}

// Cell (0,0)|(1,0) border is at x=-4100 m. A sits 10 m inside cell 0, B 10 m inside cell 1 (20 m apart,
// < CHAT_RADIUS_M=40). C sits deep in the opposite corner cell (4,3), which never borders cell (0,0).
const A_SPAWN = { x: -411_000, y: 300, z: -530_000 }; // -4110 m, -5300 m
const B_SPAWN = { x: -409_000, y: 300, z: -530_000 }; // -4090 m, -5300 m
const C_SPAWN = { x: 500_000, y: 300, z: 250_000 };    //  5000 m,  2500 m

it('relays a proximity chat to a listener across the cell border', async () => {
  const a = await player(0, 0, A_SPAWN, 'Ada'); const wa = await a.next('WELCOME');
  const b = await player(1, 0, B_SPAWN, 'Boz'); await b.next('WELCOME');
  a.send({ type: 'CHAT', clientMsgId: 1, eventId: 0, text: 'hey neighbour across the line' });
  const heard = await b.next('CHAT_BROADCAST', m => m.senderId === wa.id);
  expect(heard.text).toBe('hey neighbour across the line');
});

it('does not relay to a non-bordering cell', async () => {
  const a = await player(0, 0, A_SPAWN, 'Ada'); const wa = await a.next('WELCOME');
  const b = await player(1, 0, B_SPAWN, 'Boz'); await b.next('WELCOME');
  const c = await player(4, 3, C_SPAWN, 'Cy'); await c.next('WELCOME');
  a.send({ type: 'CHAT', clientMsgId: 2, eventId: 0, text: 'only the neighbour should hear this' });
  // Once the bordering neighbour has heard it, the fan-out set is exhausted — C is never a target.
  await b.next('CHAT_BROADCAST', m => m.senderId === wa.id);
  expect(c.messages.some(m => m.type === 'CHAT_BROADCAST')).toBe(false);
});
