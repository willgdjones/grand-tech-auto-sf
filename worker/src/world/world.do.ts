/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { afterEach, expect, it, onTestFailed, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { abortAllDurableObjects, evictDurableObject, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import { CloseCode, PROTOCOL_SUBPROTOCOL } from '@gtasf/shared/protocol/constants';
import type { C2SMessage, S2CMessage } from '@gtasf/shared/protocol/types';
import { WorldSessions, RESUME_GRACE_MS } from './sessions';
import type { WorldDO } from './WorldDO';
import type { Env } from '../env';
import { LOCAL_SPAWN } from './localSpawn';
import { worldTestHeaders } from './admission/test-headers';

const bindings = env as unknown as Env;
const pose = { ...LOCAL_SPAWN };
const sockets: WebSocket[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const ws of sockets.splice(0)) { try { ws.close(); } catch { /* closed */ } } await abortAllDurableObjects(); });
function world() { return bindings.WORLD.get(bindings.WORLD.newUniqueId()) as DurableObjectStub<WorldDO>; }
async function open(stub: DurableObjectStub<WorldDO>) {
  const response = await stub.fetch('https://test/api/world', { headers: await worldTestHeaders(stub) });
  expect(response.status).toBe(101);
  const ws = response.webSocket!; ws.binaryType = 'arraybuffer'; ws.accept(); sockets.push(ws);
  const messages: S2CMessage[] = [];
  const listeners = new Set<() => void>();
  ws.addEventListener('message', event => {
    if (typeof event.data === 'string') throw new Error('Unexpected text frame');
    const decoded = decodeS2C(new Uint8Array(event.data));
    if (!decoded.ok) throw new Error(`Bad server frame: ${decoded.err}`);
    messages.push(decoded.msg); for (const listener of listeners) listener();
  });
  function next<T extends S2CMessage['type']>(type: T, from = 0): Promise<Extract<S2CMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listeners.delete(check); reject(new Error(`No ${type}; received ${messages.map(m => m.type)}`)); }, 5000);
      function check() {
        const message = messages.slice(from).find(m => m.type === type);
        if (message) { clearTimeout(timer); listeners.delete(check); resolve(message as Extract<S2CMessage, { type: T }>); }
      }
      listeners.add(check); check();
    });
  }
  const closed = new Promise<number>(resolve => ws.addEventListener('close', event => resolve(event.code), { once: true }));
  return { ws, messages, next, closed, send: (m: C2SMessage) => ws.send(encodeC2S(m)) };
}

it('admits direct anonymous nicknames, announces peers and snapshots their movement', async () => {
  const stub = world(), a = await open(stub), b = await open(stub);
  a.send({ type: 'HELLO', name: '  Ｋａｒｌ  ' }); const aw = await a.next('WELCOME');
  b.send({ type: 'HELLO', name: '雪 🌉' }); const bw = await b.next('WELCOME');
  expect(aw.name).toBe('Karl'); expect(bw.name).toBe('雪 🌉'); expect(aw.resumed).toBe(false);
  expect((await a.next('PLAYER_JOIN')).name).toBe('雪 🌉'); expect((await b.next('PLAYER_JOIN')).id).toBe(aw.id);
  a.send({ type: 'MOVE', seq: 65535, ...pose, x: pose.x + 50 });
  a.send({ type: 'PING', nonce: 1, clientT: 1 }); await a.next('PONG');
  await expect.poll(() => b.messages.some(m => m.type === 'SNAPSHOT' && m.entries.some(e => e.id === aw.id && e.x === pose.x + 50))).toBe(true);
  a.ws.close(1000); expect((await b.next('PLAYER_LEAVE')).id).toBe(aw.id);
});

it('fences live takeovers and restores ID, canonical name, pose and sequence across restart', async () => {
  let phase = 'initial join';
  onTestFailed(() => { console.error('Reconnect lifecycle phase:', phase); });
  const stub = world(), a = await open(stub);
  a.send({ type: 'HELLO', name: 'Karl' }); const original = await a.next('WELCOME');
  a.send({ type: 'MOVE', seq: 65535, ...pose, x: pose.x + 50 }); a.send({ type: 'PING', nonce: 1, clientT: 1 }); await a.next('PONG');
  const b = await open(stub); b.send({ type: 'HELLO', name: 'Impersonation', resumeToken: original.resumeToken });
  const resumed = await b.next('WELCOME');
  expect(resumed).toMatchObject({ id: original.id, name: 'Karl', resumed: true, pose: { x: pose.x + 50 }, lastMoveSeq: 65535 });
  phase = 'old socket close'; expect(await a.closed).toBe(CloseCode.SUPERSEDED);
  b.send({ type: 'MOVE', seq: 0, ...pose, x: pose.x + 60 }); b.send({ type: 'PING', nonce: 2, clientT: 2 }); await b.next('PONG');
  // The active simulation interval intentionally keeps its DO awake. A runtime restart tears it down.
  phase = 'restart'; await abortAllDurableObjects();
  phase = 'reconnect after restart';
  const restarted = bindings.WORLD.get(stub.id) as DurableObjectStub<WorldDO>;
  const c = await open(restarted); c.send({ type: 'HELLO', name: 'Other', resumeToken: original.resumeToken });
  expect(await c.next('WELCOME')).toMatchObject({ id: original.id, name: 'Karl', pose: { x: pose.x + 60 }, lastMoveSeq: 0, resumed: true });
  c.send({ type: 'MOVE', seq: 0, ...pose, x: pose.x + 61 }); expect((await c.next('CORRECTION')).pose.x).toBe(pose.x + 60);
});

it('recovers a pending hibernated socket before anonymous admission', async () => {
  const stub = world(), a = await open(stub);
  await evictDurableObject(stub);
  a.send({ type: 'HELLO', name: 'Karl' });
  expect(await a.next('WELCOME')).toMatchObject({ name: 'Karl', resumed: false });
});

it('keeps an idle recovered session resumable during its grace period', async () => {
  const stub = world(), a = await open(stub);
  const saved = await runInDurableObject(stub, (_instance, ctx) => {
    const sessions = new WorldSessions(ctx.storage), session = sessions.admit('Karl', undefined, Date.now() - 31_000);
    if (typeof session === 'string') throw new Error(session);
    session.movement.pose.x = 900_000; sessions.save(session);
    // Persist the state a runtime suspension sees, without an active simulation timer in the fixture.
    ctx.getWebSockets()[0]!.serializeAttachment({ kind: 'session', id: session.id, generation: session.generation });
    return { id: session.id, token: session.token };
  });
  await evictDurableObject(stub);
  a.send({ type: 'PING', nonce: 1, clientT: 1 });
  expect(await a.closed).toBe(CloseCode.IDLE);
  const b = await open(stub); b.send({ type: 'HELLO', name: 'Other', resumeToken: saved.token });
  expect(await b.next('WELCOME')).toMatchObject({ id: saved.id, name: 'Karl', pose: { x: 900_000 }, resumed: true });
});

it('rejects bad names, forged resume tokens, repeated HELLO and oversize frames', async () => {
  const stub = world();
  const invalidName = await open(stub); invalidName.send({ type: 'HELLO', name: '\u202e' }); expect(await invalidName.closed).toBe(CloseCode.BAD_HELLO);
  const invalidToken = await open(stub); invalidToken.send({ type: 'HELLO', name: 'Karl', resumeToken: '0'.repeat(64) }); expect(await invalidToken.closed).toBe(CloseCode.BAD_RESUME);
  const repeated = await open(stub); repeated.send({ type: 'HELLO', name: 'Karl' }); await repeated.next('WELCOME'); repeated.send({ type: 'HELLO', name: 'Other' }); expect(await repeated.closed).toBe(CloseCode.PROTOCOL);
  const oversized = await open(stub); oversized.ws.send(new Uint8Array(2049)); expect(await oversized.closed).toBe(CloseCode.PROTOCOL);
});

it('has no 250-session ceiling, never reuses IDs, expires tokens and preserves signed movement debt in SQLite', async () => {
  const stub = world();
  await runInDurableObject(stub, (_instance, ctx) => {
    const sessions = new WorldSessions(ctx.storage), now = Date.now();
    const ids = new Set<number>();
    for (let i = 0; i < 301; i++) {
      const session = sessions.admit('Karl', undefined, now);
      if (typeof session === 'string') throw new Error(session);
      ids.add(session.id);
      if (i === 0) {
        session.movement.carryCm = -1; sessions.save(session);
        expect(sessions.get(session.id)?.movement.carryCm).toBe(-1);
        sessions.disconnect(session, now);
        expect(sessions.admit('x', session.token, now + RESUME_GRACE_MS)).toBe('BAD_RESUME');
      }
    }
    expect(ids.size).toBe(301);
    sessions.prune(now + RESUME_GRACE_MS + 30001);
    const after = sessions.admit('Karl', undefined, now + RESUME_GRACE_MS + 30002);
    expect(typeof after !== 'string' && after.id).toBe(302);
  });
});

it('prunes abandoned sessions with an alarm after the last player leaves', async () => {
  const stub = world(), a = await open(stub);
  a.send({ type: 'HELLO', name: 'Karl' }); const w = await a.next('WELCOME');
  a.ws.close(1000); await a.closed;
  await runInDurableObject(stub, (_instance, ctx) => {
    ctx.storage.sql.exec('UPDATE world_sessions SET expires_at = ? WHERE id = ?', Date.now() - 1, w.id);
  });
  await runDurableObjectAlarm(stub);
  expect(await runInDurableObject(stub, (_instance, ctx) => ctx.storage.sql.exec<{ n: number }>('SELECT count(*) AS n FROM world_sessions').one().n)).toBe(0);
});

it('expires silent handshakes and broadcasts idle departures to a still-active peer', async () => {
  const stub = world(), a = await open(stub), b = await open(stub), pending = await open(stub);
  a.send({ type: 'HELLO', name: 'Karl' }); const aw = await a.next('WELCOME');
  b.send({ type: 'HELLO', name: 'Fog' }); await b.next('WELCOME');
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);
  b.send({ type: 'PING', nonce: 1, clientT: 1 }); await b.next('PONG');
  await runDurableObjectAlarm(stub);
  expect(await pending.closed).toBe(CloseCode.BAD_HELLO);
  expect(await a.closed).toBe(CloseCode.IDLE);
  expect((await b.next('PLAYER_LEAVE')).id).toBe(aw.id);
  b.send({ type: 'PING', nonce: 2, clientT: 2 });
  expect((await b.next('PONG', b.messages.findIndex(m => m.type === 'PONG') + 1)).nonce).toBe(2);
});
