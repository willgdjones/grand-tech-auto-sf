/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { afterEach, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { SELF, abortAllDurableObjects } from 'cloudflare:test';
import { quoteFunding, type FundingProfile, type FundingStatus, type FundingLeaderboard } from '@gtasf/shared/funding';
import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { PROTOCOL_SUBPROTOCOL } from '@gtasf/shared/protocol/constants';
import type { C2SMessage, Pose, S2CMessage } from '@gtasf/shared/protocol/types';
import type { Env } from '../env';
import type { TechWeekEvent } from '../events/types';
import { storeEvents } from '../events/store';
import { fundingAnchor } from './anchors';
import snapshot from '../events/data/sf-tech-week.json';

const bindings = env as unknown as Env & { FUNDING_MIGRATIONS: string }, sockets: WebSocket[] = [];
afterEach(async () => { for (const socket of sockets.splice(0)) try { socket.close(); } catch { /* Closed. */ } await abortAllDurableObjects(); });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const call = (cookie: string, path: string, body?: unknown) => SELF.fetch(`https://test/api/funding/${path}`, {
  method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
async function identity(name: string) {
  const response = await call('', 'profile'); expect(response.ok).toBe(true);
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  const saved = await call(cookie, 'profile', { startupName: `${name} Startup`, nickname: name }); expect(saved.ok).toBe(true);
  return { cookie, profile: await saved.json<FundingProfile>() };
}
async function join(cookie: string, pose: Pose) {
  const spawn = [pose.x, pose.y, pose.z, pose.yaw].join(',');
  const response = await SELF.fetch(`https://test/api/world?spawn=${spawn}`, { headers: { Cookie: cookie, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': PROTOCOL_SUBPROTOCOL } });
  expect(response.status).toBe(101);
  const socket = response.webSocket!; socket.binaryType = 'arraybuffer'; socket.accept(); sockets.push(socket);
  const messages: S2CMessage[] = [], errors: string[] = [];
  socket.addEventListener('message', event => { if (typeof event.data === 'string') { errors.push('Unexpected text'); return; }
    const value = decodeS2C(new Uint8Array(event.data)); if (value.ok) messages.push(value.msg); else errors.push(value.err); });
  const send = (message: C2SMessage) => socket.send(encodeC2S(message));
  send({ type: 'HELLO', name: 'Room tester' });
  await expect.poll(() => messages.some(message => message.type === 'WELCOME')).toBe(true); expect(errors).toEqual([]);
  return { socket, send, messages, errors };
}

it('keeps a pending arrival idle until the accepted server pose reaches the marker', async () => {
  for (const sql of JSON.parse(bindings.FUNDING_MIGRATIONS) as string[])
    for (const statement of sql.split(';').filter(value => value.trim())) await bindings.DB.prepare(statement).run();
  const event = snapshot.events.find(event => event.id === 'tech-week:22eb5208-ca3b-4daf-93e1-65b4689f038b') as TechWeekEvent;
  await storeEvents(bindings.DB, [event], snapshot.capturedAt);
  const anchor = fundingAnchor(event)!, player = await identity('Approaching founder');
  const outside = { x: Math.round(anchor.x * 100) + 850, y: Math.round(anchor.y * 100), z: Math.round(anchor.z * 100), yaw: 0, flags: 0 };
  const peer = await join(player.cookie, outside);
  const response = await call(player.cookie, 'start', { eventId: event.id });
  expect(response.status).toBe(200);
  const waiting = await response.json<FundingStatus>();
  expect(waiting.state).toBe('idle'); expect(waiting.room).toBeNull(); expect(waiting.award).toBeNull(); expect(waiting.profile.totalCents).toBe('0');
  await wait(500); const movedAt = Date.now(); peer.send({ type: 'MOVE', seq: 1, ...outside, x: outside.x - 100 });
  await expect.poll(async () => {
    const value = await call(player.cookie, 'start', { eventId: event.id }).then(response => response.json<FundingStatus>());
    if (value.room) expect(value.room.startedAt).toBeGreaterThanOrEqual(movedAt);
    return value.state;
  }, { interval: 250 }).toBe('working');
  expect((await call(player.cookie, 'profile').then(response => response.json<FundingProfile>())).totalCents).toBe('0');
  expect(peer.errors).toEqual([]);
});

it('uses real WorldDO time/poses for 20 seconds, cancels departure, excludes own tabs and persists one daily award', async () => {
  for (const sql of JSON.parse(bindings.FUNDING_MIGRATIONS) as string[])
    for (const statement of sql.split(';').filter(value => value.trim())) await bindings.DB.prepare(statement).run();
  const event = snapshot.events.find(event => event.id === 'tech-week:22eb5208-ca3b-4daf-93e1-65b4689f038b') as TechWeekEvent;
  await storeEvents(bindings.DB, [event], snapshot.capturedAt);
  const anchor = fundingAnchor(event)!;
  // The server's traffic lane subset can choose the adjacent lane to the full radar road graph.
  expect(Math.hypot(anchor.x - 1183.2668846333365, anchor.z + 1200.2860857442251)).toBeLessThan(8);
  const pose = { x: Math.round(anchor.x * 100), y: Math.round(anchor.y * 100), z: Math.round(anchor.z * 100), yaw: 0, flags: 0 };
  const a = await identity('First founder'), b = await identity('Second founder');
  expect((await call('', 'status')).status).toBe(401);
  expect((await call(a.cookie, 'start', { eventId: event.id })).status).toBe(409); // No live peer.
  const boundary = { ...pose, x: pose.x + 750 }, first = await join(a.cookie, boundary);
  const sameDevice = await join(a.cookie, pose), other = await join(b.cookie, pose);
  const legacy = await join('', pose); // Older clients can walk, but an unverified device cannot earn or boost a crowd.
  expect((await call(a.cookie, 'start', { eventId: event.id, amountCents: '999999999', startedAt: 0 })).status).toBe(400);
  const entered = await call(a.cookie, 'start', { eventId: event.id }).then(response => response.json<FundingStatus>());
  expect(entered.state).toBe('working'); expect(entered.room!.quote.crowdCount).toBe(1);
  await wait(500);
  first.send({ type: 'MOVE', seq: 1, ...boundary, x: pose.x + 950 });
  await expect.poll(async () => (await call(a.cookie, 'status').then(response => response.json<FundingStatus>())).state, { interval: 250 }).toBe('cancelled');
  expect((await call(a.cookie, 'profile').then(response => response.json<FundingProfile>())).totalCents).toBe('0');
  await wait(500); first.send({ type: 'MOVE', seq: 2, ...boundary });
  await wait(150);
  const restarted = await call(a.cookie, 'start', { eventId: event.id }).then(response => response.json<FundingStatus>());
  expect(restarted.state).toBe('working'); expect(restarted.room!.finishesAt - restarted.room!.startedAt).toBe(20_000);
  let completed: FundingStatus | undefined;
  await expect.poll(async () => { const value = await call(a.cookie, 'status').then(response => response.json<FundingStatus>()); completed = value; return value.state; }, { interval: 1000, timeout: 25_000 }).toBe('awarded');
  expect(completed!.award!.awardedAt - restarted.room!.startedAt).toBeGreaterThanOrEqual(20_000);
  expect(completed!.award!.amountCents).toBe(quoteFunding(event, restarted.room!.startedAt, 1, 1).amountCents);
  expect(completed!.award!.crowdCount).toBe(1); // A second tab on the same persistent device adds no crowd bonus.
  expect((await call(a.cookie, 'start', { eventId: event.id }).then(response => response.json<FundingStatus>())).state).toBe('already-awarded');
  expect((await bindings.DB.prepare('SELECT COUNT(*) count FROM funding_awards').first<{ count: number }>())!.count).toBe(1);
  expect((await call(b.cookie, 'start', { eventId: event.id }).then(response => response.json<FundingStatus>())).state).toBe('working');
  other.socket.close();
  await expect.poll(async () => (await call(b.cookie, 'status').then(response => response.json<FundingStatus>())).state).toBe('cancelled');
  const leaders = await call(a.cookie, 'leaderboard').then(response => response.json<FundingLeaderboard>());
  expect(leaders.week[0]).toMatchObject({ deviceId: a.profile.deviceId, rank: 1, live: true });
  expect([...first.errors, ...sameDevice.errors, ...other.errors, ...legacy.errors]).toEqual([]);
  first.socket.close(); sameDevice.socket.close(); legacy.socket.close(); await abortAllDurableObjects();
  const restored = await call(a.cookie, 'profile').then(response => response.json<FundingProfile>());
  expect(restored.totalCents).toBe(completed!.award!.amountCents);
});
