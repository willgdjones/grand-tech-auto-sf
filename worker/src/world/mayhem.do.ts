/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { afterEach, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { abortAllDurableObjects } from 'cloudflare:test';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import type { C2SMessage, Pose, S2CMessage } from '@gtasf/shared/protocol/types';
import type { WorldDO } from './WorldDO';
import type { Env } from '../env';
import { worldTestHeaders } from './admission/test-headers';

const bindings = env as unknown as Env;
const sockets: WebSocket[] = [];
afterEach(async () => { for (const ws of sockets.splice(0)) { try { ws.close(); } catch { /* closed */ } } await abortAllDurableObjects(); });
const world = () => bindings.WORLD.get(bindings.WORLD.idFromName('sf')) as DurableObjectStub<WorldDO>;

/** A near B (same spot, within the relay radius); C is 300 m away (> MAYHEM_RELAY_RADIUS_M 250). */
const NEAR: Pose = { x: -280000, y: 300, z: -530000, yaw: 0, flags: 0 };
const FAR: Pose = { x: -280000, y: 300, z: -500000, yaw: 0, flags: 0 }; // +300 m north
const AT: [number, number, number] = [-2800, 3, -5300]; // NEAR in metres (the splat position)

async function join(name: string, spawn: Pose) {
  const stub = world();
  const q = `spawn=${spawn.x},${spawn.y},${spawn.z},${spawn.yaw}`;
  const r = await stub.fetch(`https://test/api/world?${q}`, { headers: await worldTestHeaders(stub) });
  expect(r.status).toBe(101);
  const ws = r.webSocket!; ws.binaryType = 'arraybuffer'; ws.accept(); sockets.push(ws);
  const messages: S2CMessage[] = [];
  ws.addEventListener('message', e => { const d = decodeS2C(new Uint8Array(e.data as ArrayBuffer)); if (d.ok) messages.push(d.msg); });
  ws.send(encodeC2S({ type: 'HELLO', name }));
  const send = (m: C2SMessage) => ws.send(encodeC2S(m));
  async function next<T extends S2CMessage['type']>(type: T) {
    await vi.waitFor(() => expect(messages.some(m => m.type === type)).toBe(true), { timeout: 5000, interval: 20 });
    return messages.find((m): m is Extract<S2CMessage, { type: T }> => m.type === type)!;
  }
  const fires = () => messages.filter((m): m is Extract<S2CMessage, { type: 'MAYHEM_FIRE' }> => m.type === 'MAYHEM_FIRE');
  const welcome = await next('WELCOME');
  return { ws, messages, send, next, fires, id: welcome.id };
}

it('relays a fire to nearby peers only, stamps the sender, never echoes the firer, and rate-limits', async () => {
  const a = await join('Firer', NEAR);
  const b = await join('Nearby', NEAR);
  const c = await join('FarAway', FAR);

  a.send({ type: 'MAYHEM_FIRE', item: 0, at: AT, colour: 0xff2d7a, normal: [0, 1, 0] });
  const relayed = await b.next('MAYHEM_FIRE');
  expect(relayed).toEqual({ type: 'MAYHEM_FIRE', senderId: a.id, item: 0, at: AT, colour: 0xff2d7a, normal: [0, 1, 0] });

  // An immediate second fire is inside the 350 ms cooldown, so the server drops it.
  a.send({ type: 'MAYHEM_FIRE', item: 2, at: AT, colour: 0x5ab6ff, normal: null });

  // Flush both other sockets with a round-trip so any (erroneous) delivery would have arrived.
  a.send({ type: 'PING', nonce: 1, clientT: Date.now() }); await a.next('PONG');
  c.send({ type: 'PING', nonce: 2, clientT: Date.now() }); await c.next('PONG');
  b.send({ type: 'PING', nonce: 3, clientT: Date.now() }); await b.next('PONG');

  expect(b.fires()).toHaveLength(1);           // the near peer saw exactly one fire (second was rate-limited)
  expect(a.fires()).toHaveLength(0);           // the firer is never echoed (it renders locally)
  expect(c.fires()).toHaveLength(0);           // 300 m away is beyond the relay radius
});
