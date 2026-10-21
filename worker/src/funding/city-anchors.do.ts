/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { afterEach, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { SELF, abortAllDurableObjects, runInDurableObject } from 'cloudflare:test';
import type { FundingStatus } from '@gtasf/shared/funding';
import { chatEventId } from '@gtasf/shared/chat/constants';
import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { PROTOCOL_SUBPROTOCOL } from '@gtasf/shared/protocol/constants';
import type { C2SMessage, Pose, S2CMessage } from '@gtasf/shared/protocol/types';
import type { Env } from '../env';
import type { WorldDO } from '../world/WorldDO';
import type { TechWeekEvent } from '../events/types';
import { storeEvents } from '../events/store';
import snapshot from '../events/data/sf-tech-week.json';
import { cityAnchorRoadBytes, cityAnchorRoadKey, cityAnchorEventId } from './city-anchors.fixture';

const bindings = env as unknown as Env & { FUNDING_MIGRATIONS: string }, sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) try { socket.close(); } catch { /* Already closed. */ }
  await abortAllDurableObjects();
});
const call = (cookie: string, path: string, body?: unknown) => SELF.fetch(`https://test/api/funding/${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
async function identity(nickname: string) {
  const response = await call('', 'profile'); expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  expect((await call(cookie, 'profile', { startupName: 'Park startup', nickname })).status).toBe(200);
  return cookie;
}
async function join(cookie: string, pose: Pose) {
  const response = await SELF.fetch('https://test/api/world?spawn=' + [pose.x, pose.y, pose.z, pose.yaw].join(','), {
    headers: { Cookie: cookie, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': PROTOCOL_SUBPROTOCOL },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket!; socket.binaryType = 'arraybuffer'; socket.accept(); sockets.push(socket);
  const messages: S2CMessage[] = [], errors: string[] = [];
  socket.addEventListener('message', event => {
    if (typeof event.data === 'string') { errors.push('Unexpected text'); return; }
    const decoded = decodeS2C(new Uint8Array(event.data));
    if (decoded.ok) messages.push(decoded.msg); else errors.push(decoded.err);
  });
  const send = (message: C2SMessage) => socket.send(encodeC2S(message));
  send({ type: 'HELLO', name: 'City marker founder' });
  await expect.poll(() => messages.some(message => message.type === 'WELCOME'), { interval: 20 }).toBe(true);
  return { send, messages, errors, id: (messages.find(message => message.type === 'WELCOME') as Extract<S2CMessage, { type: 'WELCOME' }>).id };
}
async function members() {
  const stub = bindings.WORLD.get(bindings.WORLD.idFromName('sf')) as DurableObjectStub<WorldDO>;
  return runInDurableObject(stub, (_instance, ctx) =>
    ctx.storage.sql.exec<{ player_id: number; x: number; y: number; z: number }>('SELECT player_id,x,y,z FROM world_chat_members').toArray());
}

it('uses the R2-loaded city road for the real outer-city event, funding and chat with unchanged room limits', async () => {
  for (const sql of JSON.parse(bindings.FUNDING_MIGRATIONS) as string[])
    for (const statement of sql.split(';').filter(value => value.trim())) await bindings.DB.prepare(statement).run();
  await bindings.ASSETS.put(cityAnchorRoadKey, cityAnchorRoadBytes);
  const event = snapshot.events.find(value => value.id === cityAnchorEventId) as TechWeekEvent;
  expect(event.venue).toBe('Golden Gate Park'); expect(event.approx).toBe(true);
  await storeEvents(bindings.DB, [event], snapshot.capturedAt);
  const cookie = await identity('Park founder');
  const response = await call(cookie, 'event?id=' + encodeURIComponent(event.id));
  const info = await response.json<{ eventId: string; anchor: { x: number; y: number; z: number }; approx: boolean }>();
  console.log('CITY_ANCHOR_OBSERVATION', JSON.stringify({ status: response.status, info }));
  expect(response.status).toBe(200);
  expect(info).toMatchObject({ eventId: event.id, approx: true, anchor: { x: -6778.7, y: 58.03, z: 1754.49 } });
  const pose = { x: Math.round(info.anchor.x * 100), y: Math.round(info.anchor.y * 100), z: Math.round(info.anchor.z * 100), yaw: 0, flags: 0 };
  const outsideCookie = await identity('Outside founder'), aboveCookie = await identity('Upper floor founder');
  const inside = await join(cookie, pose), outside = await join(outsideCookie, { ...pose, x: pose.x + 1000 }),
    above = await join(aboveCookie, { ...pose, y: pose.y + 600 });
  const room = chatEventId(event.id);
  for (const peer of [inside, outside, above]) peer.send({ type: 'EVENT_JOIN', eventId: room });
  await expect.poll(() => inside.messages.some(message => message.type === 'EVENT_STATE' && message.present), { interval: 20 }).toBe(true);
  expect(await members()).toEqual([{ player_id: inside.id, ...info.anchor }]);
  const working = await call(cookie, 'start', { eventId: event.id }).then(value => value.json<FundingStatus>());
  expect(working.state).toBe('working'); expect(working.room?.anchor).toEqual(info.anchor); expect(working.room?.approx).toBe(true);
  expect(working.room?.quote.crowdCount).toBe(0);
  for (const rejectedCookie of [outsideCookie, aboveCookie]) {
    const status = await call(rejectedCookie, 'start', { eventId: event.id }).then(value => value.json<FundingStatus>());
    expect(status.state).toBe('idle'); expect(status.room).toBeNull();
  }
  inside.send({ type: 'CHAT', eventId: room, clientMsgId: 1, text: 'Hello Golden Gate Park' });
  await expect.poll(() => inside.messages.some(message => message.type === 'CHAT_BROADCAST'), { interval: 20 }).toBe(true);
  expect([...outside.messages, ...above.messages].some(message => message.type === 'CHAT_BROADCAST' || message.type === 'EVENT_STATE' && message.present)).toBe(false);
  expect([...inside.errors, ...outside.errors, ...above.errors]).toEqual([]);
});
