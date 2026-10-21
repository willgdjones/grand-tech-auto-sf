/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { afterEach, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { abortAllDurableObjects, runInDurableObject } from 'cloudflare:test';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import { SF_ZONE_GRID, cellIndex, globalPlayerId, zoneId } from '@gtasf/shared/world/zones';
import type { C2SMessage, Pose, S2CMessage } from '@gtasf/shared/protocol/types';
import type { WorldDO } from './WorldDO';
import { WorldSessions } from './sessions';
import type { Env } from '../env';
import { worldTestHeaders } from './admission/test-headers';

const bindings = env as unknown as Env;
const sockets: WebSocket[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const ws of sockets.splice(0)) { try { ws.close(); } catch { /* closed */ } } await abortAllDurableObjects(); });
function cell(cx: number, cy: number) { return bindings.WORLD.get(bindings.WORLD.idFromName(zoneId(cx, cy))) as DurableObjectStub<WorldDO>; }
const id = (cx: number, cy: number, local: number) => globalPlayerId(cellIndex(SF_ZONE_GRID, cx, cy), local);
const token = (seed: string) => seed.repeat(64).slice(0, 64);

async function welcome(stub: DurableObjectStub<WorldDO>, cx: number, cy: number, name: string, resumeToken?: string) {
  const r = await stub.fetch(`https://test/api/world?zone=${cx},${cy}&spawn=-280000,300,-530000,0`, { headers: await worldTestHeaders(stub) });
  expect(r.status).toBe(101);
  const ws = r.webSocket!; ws.binaryType = 'arraybuffer'; ws.accept(); sockets.push(ws);
  const got = new Promise<Extract<S2CMessage, { type: 'WELCOME' }>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no WELCOME')), 5000);
    ws.addEventListener('message', e => {
      const d = decodeS2C(new Uint8Array(e.data as ArrayBuffer));
      if (d.ok && d.msg.type === 'WELCOME') { clearTimeout(timer); resolve(d.msg); }
    });
  });
  ws.send(encodeC2S({ type: 'HELLO', name, ...(resumeToken ? { resumeToken } : {}) }));
  return got;
}
async function sendHandoff(stub: DurableObjectStub<WorldDO>, session: object) {
  const r = await stub.fetch('https://world.internal/internal/handoff/receive', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session }),
  });
  return { status: r.status, body: await r.json() as { ok?: boolean; id?: number; error?: string } };
}

it('preserves a transferred player id across a cross-zone resume (no border blink)', async () => {
  const originId = id(0, 0, 5); // lives in cell (0,0)'s block; handed to cell (1,0)
  const tok = token('a');
  const dest = cell(1, 0);
  const posted = await sendHandoff(dest, { id: originId, token: tok, name: 'Ada', generation: 1,
    pose: { x: -280_000, y: 300, z: -530_000, yaw: 0, flags: 0 }, seq: 3, accepted: true, carryCm: 0 });
  expect(posted.status).toBe(200);
  expect(posted.body.id).toBe(originId);
  const w = await welcome(dest, 1, 0, 'Ada', tok);
  expect(w.id).toBe(originId);   // same id, not a freshly minted cell-(1,0) id
  expect(w.resumed).toBe(true);
});

it('keeps this cell\'s native ids in its own block even after adopting an out-of-block session', async () => {
  const dest = cell(2, 1);
  // Adopt an id from cell (0,0)'s block into cell (2,1) first.
  const posted = await sendHandoff(dest, { id: id(0, 0, 9), token: token('b'), name: 'Boz', generation: 1,
    pose: { x: -280_000, y: 300, z: -530_000, yaw: 0, flags: 0 }, seq: 0, accepted: true, carryCm: 0 });
  expect(posted.status).toBe(200);
  // A fresh native join must still land in cell (2,1)'s block (local 1), not continue from the adopted id.
  const w = await welcome(dest, 2, 1, 'Cy');
  expect(w.id).toBe(id(2, 1, 1));
  expect(w.resumed).toBe(false);
});

it('rejects a malformed or bad-token handoff', async () => {
  const dest = cell(3, 2);
  expect((await sendHandoff(dest, { id: id(0, 0, 1), token: 'too-short', name: 'X', generation: 1, pose: { x: 0, y: 0, z: 0, yaw: 0, flags: 0 } })).status).toBe(400);
  expect((await sendHandoff(dest, { id: 0, token: token('c'), name: 'X', generation: 1, pose: { x: 0, y: 0, z: 0, yaw: 0, flags: 0 } })).status).toBe(400); // id out of range
  expect((await sendHandoff(dest, { token: token('d'), name: 'X', generation: 1 })).status).toBe(400); // no pose
});

/** Real socket crossing: exercises detection -> sibling DO transfer -> resumed WELCOME,
 * rather than directly posting a fabricated session to the receiver. */
it('hands off an accepted border move with the same id, pose, sequence and appearance', async () => {
  const origin = cell(0, 3), destination = cell(1, 3);
  // Already inside the 50 m hysteresis band; 40 cm crosses its edge inside the 75 cm burst budget.
  const before: Pose = { x: -405020, y: 300, z: 250000, yaw: 64, flags: 0 };
  async function join(stub: DurableObjectStub<WorldDO>, zone: string, spawn?: Pose, resumeToken?: string) {
    const q = new URLSearchParams({ zone });
    if (spawn) q.set('spawn', `${spawn.x},${spawn.y},${spawn.z},${spawn.yaw}`);
    const response = await stub.fetch(`https://test/api/world?${q}`, { headers: await worldTestHeaders(stub) });
    expect(response.status).toBe(101);
    const ws = response.webSocket!; ws.binaryType = 'arraybuffer'; ws.accept(); sockets.push(ws);
    const messages: S2CMessage[] = [];
    ws.addEventListener('message', e => { const d = decodeS2C(new Uint8Array(e.data as ArrayBuffer)); if (d.ok) messages.push(d.msg); });
    ws.send(encodeC2S({ type: 'HELLO', name: 'Crosser', ...(resumeToken ? { resumeToken } : {}) }));
    async function next<T extends S2CMessage['type']>(type: T) {
      await vi.waitFor(() => expect(messages.some(m => m.type === type)).toBe(true), { timeout: 5000, interval: 20 });
      return messages.find((m): m is Extract<S2CMessage, { type: T }> => m.type === type)!;
    }
    return { ws, messages, next, send: (m: C2SMessage) => ws.send(encodeC2S(m)) };
  }
  const watcher = await join(origin, '0,3', before); await watcher.next('WELCOME');
  const a = await join(origin, '0,3', before); const wa = await a.next('WELCOME');
  const after = { ...before, x: before.x + 40 };
  a.send({ type: 'SET_APPEARANCE', appearance: 1 });
  a.send({ type: 'MOVE', seq: 1, ...after });
  const handoff = await a.next('ZONE_HANDOFF');
  expect({ cx: handoff.cx, cy: handoff.cy }).toEqual({ cx: 1, cy: 3 });
  expect(handoff.token).toBe(wa.resumeToken);
  const b = await join(destination, '1,3', undefined, handoff.token);
  const wb = await b.next('WELCOME');
  expect(wb).toMatchObject({ id: wa.id, resumed: true, pose: after, lastMoveSeq: 1 });
  a.ws.close(1000);
  // A peer in the origin keeps the id while the same id is now streamed by the destination.
  watcher.send({ type: 'PING', nonce: 123, clientT: Date.now() }); await watcher.next('PONG');
  expect(watcher.messages.some(m => m.type === 'PLAYER_LEAVE' && m.id === wa.id)).toBe(false);
  b.send({ type: 'MOVE', seq: 2, ...after });
  b.send({ type: 'PING', nonce: 124, clientT: Date.now() }); await b.next('PONG');
  expect(b.messages.filter(m => m.type === 'CORRECTION')).toHaveLength(0);
  // A transport reconnect must still resume THIS cell, not the default Ferry cell.
  b.ws.close(1000);
  const reconnect = await join(destination, '1,3', undefined, handoff.token);
  expect(await reconnect.next('WELCOME')).toMatchObject({ id: wa.id, resumed: true, lastMoveSeq: 2 });
});

it('never reuses an expired native id that may still belong to a player in another zone', async () => {
  await runInDurableObject(cell(4, 3), (_instance, state) => {
    const sessions = new WorldSessions(state.storage), firstId = id(4, 3, 1);
    const first = sessions.admit('One', undefined, 1000, firstId);
    expect(typeof first).toBe('object');
    sessions.prune(1_000_000);
    const second = sessions.admit('Two', undefined, 1_000_001, firstId);
    expect(second).toMatchObject({ id: firstId + 1 });
  });
});
