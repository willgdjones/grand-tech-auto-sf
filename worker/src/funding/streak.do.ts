/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { afterEach, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { SELF, abortAllDurableObjects } from 'cloudflare:test';
import { fundingTiming, type FundingProfile, type FundingQuote, type FundingStatus } from '@gtasf/shared/funding';
import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { PROTOCOL_SUBPROTOCOL } from '@gtasf/shared/protocol/constants';
import type { S2CMessage } from '@gtasf/shared/protocol/types';
import type { Env } from '../env';
import type { TechWeekEvent } from '../events/types';
import { storeEvents } from '../events/store';
import { fundingAnchor } from './anchors';
import snapshot from '../events/data/sf-tech-week.json';

const bindings = env as unknown as Env & { FUNDING_MIGRATIONS: string };
const sockets: WebSocket[] = [], errors: string[] = [];
async function restartWorld() {
  for (const socket of sockets.splice(0)) try { socket.close(); } catch { /* Already closed. */ }
  await abortAllDurableObjects();
}
afterEach(restartWorld);
async function call<T>(cookie: string, path: string, body?: unknown): Promise<T> {
  const response = await SELF.fetch(`https://test/api/funding/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  expect(response.status).toBe(200);
  return response.json<T>();
}
async function identity(name: string) {
  const response = await SELF.fetch('https://test/api/funding/profile'); expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  const profile = await call<FundingProfile>(cookie, 'profile', { startupName: `${name} Startup`, nickname: name });
  return { cookie, profile };
}
async function join(cookie: string, event: TechWeekEvent) {
  const anchor = fundingAnchor(event); expect(anchor).not.toBeNull();
  const spawn = [Math.round(anchor!.x * 100), Math.round(anchor!.y * 100), Math.round(anchor!.z * 100), 0].join(',');
  const response = await SELF.fetch(`https://test/api/world?spawn=${spawn}`, { headers: {
    Cookie: cookie, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': PROTOCOL_SUBPROTOCOL,
  } });
  expect(response.status).toBe(101);
  const socket = response.webSocket!; socket.binaryType = 'arraybuffer'; socket.accept(); sockets.push(socket);
  const messages: S2CMessage[] = [];
  socket.addEventListener('message', event => {
    if (typeof event.data === 'string') { errors.push('Unexpected text'); return; }
    const decoded = decodeS2C(new Uint8Array(event.data));
    if (decoded.ok) messages.push(decoded.msg); else errors.push(decoded.err);
  });
  socket.send(encodeC2S({ type: 'HELLO', name: 'Streak founder' }));
  await expect.poll(() => messages.some(message => message.type === 'WELCOME')).toBe(true);
  expect(errors).toEqual([]);
}
async function earn(cookie: string, event: TechWeekEvent, crowd: number, streak: number) {
  const started = await call<FundingStatus>(cookie, 'start', { eventId: event.id });
  expect(started.state).toBe('working');
  const room = started.room!;
  expect(room.finishesAt - room.startedAt).toBe(20_000);
  expect(room.quote).toMatchObject({ kind: 'community', baseCents: '20000000', crowdCount: crowd,
    crowdMultiplier: crowd ? 1.1 : 1, streakCount: streak, streakMultiplier: streak === 1 ? 1 : 1.25 });
  let completed: FundingStatus | undefined;
  await expect.poll(async () => {
    completed = await call<FundingStatus>(cookie, 'status'); return completed.state;
  }, { interval: 1000, timeout: 25_000 }).toBe('awarded');
  const award = completed!.award!;
  expect(award.awardedAt - room.startedAt).toBeGreaterThanOrEqual(20_000);
  expect(award).toMatchObject({ eventId: event.id, crowdCount: crowd, streakCount: streak,
    crowdMultiplier: crowd ? 1.1 : 1, streakMultiplier: streak === 1 ? 1 : 1.25 });
  const timing = fundingTiming(event, room.startedAt), timeFactor = timing === 'live' ? 3 : timing === 'upcoming' ? 1.5 : .5;
  // Both untouched source records are community events; check the concrete policy amounts.
  expect(award.timing).toBe(timing); expect(award.timeMultiplier).toBe(timeFactor);
  const expected = (crowd ? 22_000_000 : 25_000_000) * timeFactor;
  expect(award.amountCents).toBe(String(expected));
  return { award, enteredAt: room.startedAt, elapsedMs: award.awardedAt - room.startedAt };
}

it('derives a second-event streak from D1 after a real crowd award and WorldDO restart', async () => {
  for (const sql of JSON.parse(bindings.FUNDING_MIGRATIONS) as string[])
    for (const statement of sql.split(';').filter(value => value.trim())) await bindings.DB.prepare(statement).run();
  const first = snapshot.events.find(event => event.id === 'tech-week:22eb5208-ca3b-4daf-93e1-65b4689f038b') as TechWeekEvent;
  const second = snapshot.events.find(event => event.id === 'tech-week:9dcd3aa0-94da-45a3-b0c5-43f9a04fb8cb') as TechWeekEvent;
  await storeEvents(bindings.DB, [first, second], snapshot.capturedAt);
  const player = await identity('Returning founder'), friend = await identity('Other founder');
  await join(player.cookie, first); await join(friend.cookie, first);
  const a = await earn(player.cookie, first, 1, 1);
  expect((await call<FundingProfile>(friend.cookie, 'profile')).totalCents).toBe('0');

  // A normal new accepted spawn at the second public road marker, with no in-memory funding state.
  await restartWorld();
  const restored = await call<FundingProfile>(player.cookie, 'profile');
  expect(restored.totalCents).toBe(a.award.amountCents); expect(restored.streak).toBe(1);
  await join(player.cookie, second);
  const b = await earn(player.cookie, second, 0, 2);
  expect(b.enteredAt - a.award.awardedAt).toBeGreaterThanOrEqual(0);
  expect(b.award.awardedAt - a.award.awardedAt).toBeLessThan(15 * 60_000);
  const total = (BigInt(a.award.amountCents) + BigInt(b.award.amountCents)).toString();
  expect(b.award.profile.totalCents).toBe(total); expect(b.award.profile.streak).toBe(2);
  expect((await call<FundingStatus>(player.cookie, 'start', { eventId: second.id })).state).toBe('already-awarded');
  const rows = await bindings.DB.prepare('SELECT event_id,entered_at,awarded_at,amount_cents,quote_json FROM funding_awards WHERE device_id=? ORDER BY awarded_at')
    .bind(player.profile.deviceId).all<{ event_id: string; entered_at: number; awarded_at: number; amount_cents: number; quote_json: string }>();
  expect(rows.results).toHaveLength(2);
  expect(rows.results.map(row => row.event_id)).toEqual([first.id, second.id]);
  expect(rows.results.map(row => (JSON.parse(row.quote_json) as FundingQuote).streakCount)).toEqual([1, 2]);
  expect(rows.results.map(row => (JSON.parse(row.quote_json) as FundingQuote).crowdCount)).toEqual([1, 0]);
  expect(rows.results.every(row => row.awarded_at - row.entered_at >= 20_000)).toBe(true);
  expect(rows.results.reduce((sum, row) => sum + BigInt(row.amount_cents), 0n).toString()).toBe(total);
  await restartWorld();
  expect(await call<FundingProfile>(player.cookie, 'profile')).toMatchObject({ totalCents: total, streak: 2, rank: 1 });
  expect(errors).toEqual([]);
  console.log('FUNDING_NATIVE_STREAK', JSON.stringify({ capturedAt: new Date().toISOString(),
    first: { eventId: first.id, elapsedMs: a.elapsedMs, amountCents: a.award.amountCents, crowd: 1, streak: 1 },
    second: { eventId: second.id, elapsedMs: b.elapsedMs, amountCents: b.award.amountCents, crowd: 0, streak: 2 },
    totalCents: total, persistedAwards: rows.results.length, errors }));
});
