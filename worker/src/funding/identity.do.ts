/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { afterEach, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { SELF, abortAllDurableObjects, runInDurableObject } from 'cloudflare:test';
import type { FundingProfile, FundingStatus } from '@gtasf/shared/funding';
import { chatEventId } from '@gtasf/shared/chat/constants';
import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { PROTOCOL_SUBPROTOCOL } from '@gtasf/shared/protocol/constants';
import type { C2SMessage, Pose, S2CMessage } from '@gtasf/shared/protocol/types';
import type { Env } from '../env';
import type { WorldDO } from '../world/WorldDO';
import type { TechWeekEvent } from '../events/types';
import { storeEvents } from '../events/store';
import { fundingAnchor } from './anchors';
import snapshot from '../events/data/sf-tech-week.json';

const bindings = env as unknown as Env & { FUNDING_MIGRATIONS: string }, sockets: WebSocket[] = [];
afterEach(async () => { for (const socket of sockets.splice(0)) try { socket.close(); } catch { /* Closed. */ } await abortAllDurableObjects(); });
const call = (cookie: string, path: string, body?: unknown, origin?: string) => SELF.fetch(`https://test/api/funding/${path}`, {
  method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, ...(origin ? { Origin: origin } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
async function identity() {
  const response = await call('', 'profile'); expect(response.status).toBe(200);
  return { cookie: response.headers.get('set-cookie')!.split(';')[0]!, profile: await response.json<FundingProfile>() };
}
async function open(cookie: string, pose?: Pose) {
  const query = pose ? '?spawn=' + [pose.x, pose.y, pose.z, pose.yaw].join(',') : '';
  const response = await SELF.fetch(`https://test/api/world${query}`, { headers: { Cookie: cookie, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': PROTOCOL_SUBPROTOCOL } });
  expect(response.status).toBe(101);
  const socket = response.webSocket!; socket.binaryType = 'arraybuffer'; socket.accept(); sockets.push(socket);
  const messages: S2CMessage[] = [], errors: string[] = [];
  socket.addEventListener('message', event => { if (typeof event.data === 'string') { errors.push('Unexpected text'); return; }
    const decoded = decodeS2C(new Uint8Array(event.data)); if (decoded.ok) messages.push(decoded.msg); else errors.push(decoded.err); });
  const send = (message: C2SMessage) => socket.send(encodeC2S(message));
  async function next<T extends S2CMessage['type']>(type: T, from = 0) {
    await expect.poll(() => messages.slice(from).some(message => message.type === type), { timeout: 3000, interval: 20 }).toBe(true);
    return messages.slice(from).find(message => message.type === type) as Extract<S2CMessage, { type: T }>;
  }
  return { socket, send, messages, errors, next, async hello(name = 'Founder', resumeToken?: string) {
    send({ type: 'HELLO', name, ...(resumeToken ? { resumeToken } : {}) }); return next('WELCOME');
  } };
}
async function state() {
  const stub = bindings.WORLD.get(bindings.WORLD.idFromName('sf')) as DurableObjectStub<WorldDO>;
  return runInDurableObject(stub, (_instance, ctx) => ({
    sessions: ctx.storage.sql.exec<{ id: number; name: string; generation: number; x: number; y: number; z: number; yaw: number; flags: number; seq: number }>('SELECT id,name,generation,x,y,z,yaw,flags,seq FROM world_sessions ORDER BY id').toArray(),
    members: ctx.storage.sql.exec('SELECT player_id,generation,event_id,x,y,z FROM world_chat_members ORDER BY player_id').toArray(),
  }));
}

it('updates verified live and pending sessions from canonical saves without resetting their room, pose or sequence', async () => {
  for (const sql of JSON.parse(bindings.FUNDING_MIGRATIONS) as string[])
    for (const statement of sql.split(';').filter(value => value.trim())) await bindings.DB.prepare(statement).run();
  const event = snapshot.events.find(value => value.id === 'tech-week:22eb5208-ca3b-4daf-93e1-65b4689f038b') as TechWeekEvent;
  await storeEvents(bindings.DB, [event], snapshot.capturedAt);
  const anchor = fundingAnchor(event)!;
  const pose = { x: Math.round(anchor.x * 100), y: Math.round(anchor.y * 100), z: Math.round(anchor.z * 100), yaw: 0, flags: 0 };
  const a = await identity(), b = await identity();
  expect((await call(b.cookie, 'profile', { startupName: 'Other startup', nickname: 'Other founder' })).status).toBe(200);
  const first = await open(a.cookie, pose), firstWelcome = await first.hello();
  const sameDevice = await open(a.cookie, pose), sameWelcome = await sameDevice.hello();
  const other = await open(b.cookie, pose), otherWelcome = await other.hello('Other founder');
  const room = chatEventId(event.id);
  first.send({ type: 'EVENT_JOIN', eventId: room }); sameDevice.send({ type: 'EVENT_JOIN', eventId: room }); other.send({ type: 'EVENT_JOIN', eventId: room });
  await expect.poll(async () => (await state()).members.length).toBe(3);
  // Prime the old funding profile, just as the open game does before onboarding.
  expect((await call(a.cookie, 'status').then(response => response.json<FundingStatus>())).profile.nickname).toBe('');
  const before = await state(), pending = await open(a.cookie, pose);
  const savedResponse = await call(a.cookie, 'profile', { startupName: 'Sky startup', nickname: '  Sky   founder  ' });
  expect(savedResponse.status).toBe(200); const saved = await savedResponse.json<FundingProfile>();
  const status = await call(a.cookie, 'status').then(response => response.json<FundingStatus>());
  first.send({ type: 'CHAT', eventId: room, clientMsgId: 1, text: 'Meet by the clock tower' });
  const chat = await other.next('CHAT_BROADCAST');
  console.log('IDENTITY_OBSERVATION', JSON.stringify({ saved: saved.nickname, status: status.profile.nickname, chat: chat.name }));
  expect(saved.nickname).toBe('Sky founder'); expect(status.profile.nickname).toBe(saved.nickname); expect(chat.name).toBe(saved.nickname);
  expect(chat.senderId).toBe(firstWelcome.id); expect(chat.eventId).toBe(room);
  const after = await state();
  expect(after.sessions.filter(row => [firstWelcome.id, sameWelcome.id].includes(row.id)).map(row => row.name)).toEqual(['Sky founder', 'Sky founder']);
  expect(after.sessions.find(row => row.id === otherWelcome.id)?.name).toBe('Other founder');
  expect(after.sessions.map(({ name: _name, ...row }) => row)).toEqual(before.sessions.map(({ name: _name, ...row }) => row));
  expect(after.members).toEqual(before.members);
  expect((await pending.hello('Stale name')).name).toBe('Sky founder');
  const joined = other.messages.filter((message): message is Extract<S2CMessage, { type: 'PLAYER_JOIN' }> => message.type === 'PLAYER_JOIN' && [firstWelcome.id, sameWelcome.id].includes(message.id));
  expect(joined.filter(message => message.name === 'Sky founder')).toHaveLength(2);
  expect((await call(a.cookie, 'profile', { startupName: 'Sky startup', nickname: '\u202e' })).status).toBe(400);
  expect((await call(a.cookie, 'profile', { startupName: 'Sky startup', nickname: 'Forged', deviceId: b.profile.deviceId })).status).toBe(400);
  expect((await call(a.cookie, 'profile', { startupName: 'Sky startup', nickname: 'Foreign' }, 'https://foreign.test')).status).toBe(403);
  expect((await call('', 'profile', { startupName: 'Sky startup', nickname: 'Anonymous' })).status).toBe(401);
  expect((await state()).sessions.find(row => row.id === firstWelcome.id)?.name).toBe('Sky founder');
  expect((await call(a.cookie, 'profile', { startupName: 'Harbour startup', nickname: 'Harbour founder' })).status).toBe(200);
  expect((await call(a.cookie, 'status').then(response => response.json<FundingStatus>())).profile.nickname).toBe('Harbour founder');
  const edited = await state(); expect(edited.members).toEqual(before.members);
  expect(edited.sessions.find(row => row.id === firstWelcome.id)?.name).toBe('Harbour founder');
  expect(first.messages.filter(message => message.type === 'WELCOME')).toHaveLength(1);
  first.socket.close(); sameDevice.socket.close(); pending.socket.close();
  await expect.poll(async () => (await state()).members.length).toBe(1);
  expect((await call(a.cookie, 'profile', { startupName: 'Offline startup', nickname: 'Offline founder' })).status).toBe(200);
  await abortAllDurableObjects();
  const resumed = await open(a.cookie), welcome = await resumed.hello('Stale HELLO', firstWelcome.resumeToken);
  expect(welcome.id).toBe(firstWelcome.id); expect(welcome.name).toBe('Offline founder'); expect(welcome.resumed).toBe(true);
  expect(welcome.pose).toEqual(firstWelcome.pose); expect(welcome.lastMoveSeq).toBe(firstWelcome.lastMoveSeq);
  expect([...first.errors, ...sameDevice.errors, ...other.errors, ...pending.errors, ...resumed.errors]).toEqual([]);
});
