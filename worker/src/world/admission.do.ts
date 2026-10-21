/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { afterEach, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { SELF, abortAllDurableObjects, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import type { Env } from '../env';
import type { WorldDO } from './WorldDO';
import type { LobbyDO } from './LobbyDO';
import type { WorldSession } from './sessions';
import { WorldSessions } from './sessions';
import type { AdmissionResponse } from '@gtasf/shared/admission';
import { INPUT_IDLE_MS, ADMISSION_PROTOCOL_PREFIX } from '@gtasf/shared/admission';
import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { CloseCode, PROTOCOL_SUBPROTOCOL } from '@gtasf/shared/protocol/constants';
import type { C2SMessage, S2CMessage } from '@gtasf/shared/protocol/types';
import { launchAllowed } from './admission/invite';

const bindings = env as unknown as Env, sockets: WebSocket[] = [];
let cookie = '';
afterEach(async () => { for (const socket of sockets.splice(0)) try { socket.close(); } catch { /* closed */ } await abortAllDurableObjects(); });
const post = (path: string, body: unknown) => SELF.fetch(`https://test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
async function admission(path = 'enter', ticket?: string) {
  const response = await post(`/api/admission/${path}`, { ticket }); expect(response.ok).toBe(true); return response.json<AdmissionResponse>();
}
async function open(grant: string) {
  const response = await SELF.fetch('https://test/api/world', { headers: { Upgrade: 'websocket', Cookie: cookie,
    'Sec-WebSocket-Protocol': `${PROTOCOL_SUBPROTOCOL}, ${ADMISSION_PROTOCOL_PREFIX}${grant}` } });
  expect(response.status).toBe(101);
  const socket = response.webSocket!; socket.binaryType = 'arraybuffer'; socket.accept(); sockets.push(socket);
  const messages: S2CMessage[] = [];
  socket.addEventListener('message', event => { if (typeof event.data !== 'string') { const result = decodeS2C(new Uint8Array(event.data)); if (result.ok) messages.push(result.msg); else throw new Error(result.err); } });
  const closed = new Promise<number>(resolve => socket.addEventListener('close', event => resolve(event.code), { once: true }));
  const send = (message: C2SMessage) => socket.send(encodeC2S(message));
  async function next<T extends S2CMessage['type']>(type: T, after = 0) {
    await expect.poll(() => messages.slice(after).some(message => message.type === type)).toBe(true);
    return messages.slice(after).find(message => message.type === type) as Extract<S2CMessage, { type: T }>;
  }
  send({ type: 'HELLO', name: 'Queue tester' }); const welcome = await next('WELCOME');
  return { socket, messages, send, next, closed, welcome };
}

it('enforces invite + FIFO capacity, releases input-idle slots, expires reservations and captures one pending signup', async () => {
  expect((await SELF.fetch('https://test/api/admission').then(response => response.json<{ allowed: boolean }>())).allowed).toBe(false);
  expect((await admission()).status).toBe('waitlist');
  expect((await post('/api/invite', { code: 'incorrect' })).status).toBe(403);
  const invite = await post('/api/invite', { code: 'native-smoke-invite' }); expect(invite.ok).toBe(true);
  cookie = invite.headers.get('set-cookie')!.split(';')[0]!;
  expect(await launchAllowed(new Request('https://test', { headers: { Cookie: cookie } }), bindings)).toBe(true);
  expect(await launchAllowed(new Request('https://test', { headers: { Cookie: cookie + '0' } }), bindings)).toBe(false);
  expect(await launchAllowed(new Request('https://test'), { LAUNCH_MODE: 'open' })).toBe(true);
  expect(await launchAllowed(new Request('https://test', { headers: { Cookie: cookie } }), { ...bindings, LAUNCH_MODE: 'waitlist' })).toBe(false);
  const a = await admission(); expect(a.status).toBe('admitted'); if (a.status !== 'admitted' || !a.grant) throw new Error('A not admitted');
  const b = await admission(), c = await admission();
  expect(b).toMatchObject({ status: 'queued', position: 1, etaSeconds: null });
  expect(c).toMatchObject({ status: 'queued', position: 2 });
  if (b.status !== 'queued' || c.status !== 'queued') throw new Error('Expected FIFO');
  const peer = await open(a.grant);
  const replay = await SELF.fetch('https://test/api/world', { headers: { Upgrade: 'websocket', Cookie: cookie,
    'Sec-WebSocket-Protocol': `${PROTOCOL_SUBPROTOCOL}, ${ADMISSION_PROTOCOL_PREFIX}${a.grant}` } });
  expect(replay.status).toBe(429);
  expect((await SELF.fetch('https://test/api/world', { headers: { Upgrade: 'websocket', Cookie: cookie, 'Sec-WebSocket-Protocol': PROTOCOL_SUBPROTOCOL } })).status).toBe(429);
  const world = bindings.WORLD.get(bindings.WORLD.idFromName('sf')) as DurableObjectStub<WorldDO>;
  const previous = await runInDurableObject(world, (instance, ctx) => {
    const session = (instance as unknown as { peers: Map<number, { session: WorldSession }> }).peers.get(peer.welcome.id)!.session;
    session.lastInput = Date.now() - INPUT_IDLE_MS + 20_000; new WorldSessions(ctx.storage).save(session); return session.lastInput;
  });
  peer.send({ type: 'MOVE', seq: 1, ...peer.welcome.pose }); peer.send({ type: 'PING', nonce: 1, clientT: 1 }); await peer.next('PONG');
  expect(await runInDurableObject(world, (_instance, ctx) => new WorldSessions(ctx.storage).get(peer.welcome.id)!.lastInput)).toBe(previous);
  peer.send({ type: 'ACTIVITY' }); peer.send({ type: 'PING', nonce: 2, clientT: 2 }); await peer.next('PONG', peer.messages.length - 1);
  await expect.poll(() => runInDurableObject(world, (_instance, ctx) => new WorldSessions(ctx.storage).get(peer.welcome.id)!.lastInput)).toBeGreaterThan(previous);
  await runInDurableObject(world, (instance, ctx) => {
    const session = (instance as unknown as { peers: Map<number, { session: WorldSession }> }).peers.get(peer.welcome.id)!.session;
    session.lastInput = Date.now() - INPUT_IDLE_MS - 1; session.lastSeen = Date.now(); new WorldSessions(ctx.storage).save(session);
  });
  await runDurableObjectAlarm(world); expect(await peer.closed).toBe(CloseCode.INPUT_IDLE);
  await expect.poll(async () => (await admission('poll', b.ticket)).status).toBe('admitted');
  expect(await admission('poll', c.ticket)).toMatchObject({ status: 'queued', position: 1 });
  // Abandon B during loading. World expiry frees the slot; the oldest remaining visitor is C.
  await runInDurableObject(world, (_instance, ctx) => { ctx.storage.sql.exec("UPDATE world_admissions SET expires_at=? WHERE state='reserved'", Date.now() - 1); });
  await runDurableObjectAlarm(world);
  const lobby = bindings.LOBBY.get(bindings.LOBBY.idFromName('sf')) as DurableObjectStub<LobbyDO>;
  await runDurableObjectAlarm(lobby);
  const admittedC = await admission('poll', c.ticket); expect(admittedC.status).toBe('admitted');
  if (admittedC.status !== 'admitted' || !admittedC.grant) throw new Error('C not admitted');
  const final = await open(admittedC.grant);
  expect(final.welcome.id).not.toBe(peer.welcome.id);
  expect(await runInDurableObject(world, instance => (instance as unknown as { peers: Map<number, unknown> }).peers.size)).toBe(1);
  expect((await SELF.fetch('https://test/internal/admission/reserve')).status).toBe(404);
  await bindings.DB.exec("CREATE TABLE waitlist_signups(email TEXT PRIMARY KEY,source TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL)");
  expect((await post('/api/waitlist', { email: ' Karl@Example.com ', source: 'queue' })).ok).toBe(true);
  expect((await post('/api/waitlist', { email: 'karl@example.com', source: 'launch' })).ok).toBe(true);
  expect(await bindings.DB.prepare('SELECT email,source,status FROM waitlist_signups').all()).toMatchObject({ results: [{ email: 'karl@example.com', source: 'queue', status: 'pending' }] });
});
