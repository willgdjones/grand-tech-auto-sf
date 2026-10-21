/** One disposable real workerd/D1 check; no shared runtime, remote state or browser. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { nextFundingStreak, quoteFunding } from '@gtasf/shared/funding';
import { ensureFundingDevice, fundingDevice } from './identity';
import { fundingAlreadyAwarded, fundingLeaderboard, getFundingProfile, previousFundingAward, recordFundingAward, saveFundingNames } from './store';

const pool = new Miniflare(convertV4MiniflareOptions({ cf: false, telemetry: { enabled: false }, workers: [{
  name: 'gtasf-funding-store-smoke', modules: true, script: 'export default { fetch() { return new Response("ok") } }',
  compatibilityDate: '2026-09-28', d1Databases: ['DB'],
}] }));
try {
  await pool.ready;
  const db = await pool.getD1Database('DB') as unknown as D1Database;
  for (const file of ['0010_funding.sql', '0014_funding_bonus.sql']) {
    const migration = await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
    for (const statement of migration.split(';').filter(sql => sql.trim())) await db.prepare(statement).run();
  }
  const now = Date.parse('2026-10-05T16:10:00Z');
  const anonymous = await ensureFundingDevice(new Request('https://gtasf.test/api/funding/profile'), db, now);
  assert.match(anonymous.cookie!, /HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
  const request = new Request('https://gtasf.test/api/funding/profile', { headers: { cookie: anonymous.cookie!.split(';')[0]! } });
  assert.equal(await fundingDevice(request, db), anonymous.deviceId);
  assert.equal((await ensureFundingDevice(request, db, now)).deviceId, anonymous.deviceId);
  assert.equal(await fundingDevice(new Request(request.url, { headers: { cookie: 'gtasf_device=' + '0'.repeat(64) } }), db), null);
  assert.equal((await getFundingProfile(db, anonymous.deviceId, now)).totalCents, '0');
  await saveFundingNames(db, anonymous.deviceId, '  Durable   Startup ', 'Founder One', now);
  const event = { id: 'source-event-one', title: 'Public investor breakfast', host: 'Example Ventures', start: '2026-10-05T16:00:00Z', end: '2026-10-05T17:00:00Z' };
  const input = { deviceId: anonymous.deviceId, eventId: event.id, eventTitle: event.title, enteredAt: now, now: now + 20_000, quote: quoteFunding(event, now, 0, 1) };
  const duplicate = await Promise.all([recordFundingAward(db, input), recordFundingAward(db, input)]);
  assert.equal(duplicate.filter(result => result.credited).length, 1);
  assert.equal(duplicate[0]!.award.id, duplicate[1]!.award.id);
  assert.equal((await getFundingProfile(db, anonymous.deviceId, now)).totalCents, '300000000');
  assert.equal(await fundingAlreadyAwarded(db, anonymous.deviceId, event.id, now), true);
  const other = await ensureFundingDevice(new Request(request.url), db, now);
  await saveFundingNames(db, other.deviceId, 'Another Startup', 'Founder Two', now);
  await recordFundingAward(db, { ...input, deviceId: other.deviceId });
  const next = { ...event, id: 'source-event-two' }, secondAt = now + 60_000;
  const streak = nextFundingStreak(await previousFundingAward(db, anonymous.deviceId), next.id, secondAt + 20_000);
  await recordFundingAward(db, { ...input, eventId: next.id, enteredAt: secondAt, now: secondAt + 20_000, quote: quoteFunding(next, secondAt, 1, streak) });
  const leaders = await fundingLeaderboard(db, anonymous.deviceId, secondAt + 21_000, new Set([anonymous.deviceId]));
  assert.equal(leaders.you.totalCents, '712500000');
  assert.deepEqual(leaders.week.map(row => [row.startupName, row.rank, row.live]), [['Durable Startup', 1, true], ['Another Startup', 2, false]]);
  assert.equal(leaders.today[0]!.todayCents, '712500000');
  const midnight=Date.parse('2026-10-06T07:00:00Z');
  assert.equal((await fundingLeaderboard(db,anonymous.deviceId,midnight-1,new Set())).today.length,2);
  const reset=await fundingLeaderboard(db,anonymous.deviceId,midnight,new Set());
  assert.deepEqual(reset.today,[]);assert.equal(reset.you.todayCents,'0');assert.equal(reset.you.todayRank,null);
  assert.equal(reset.you.totalCents,'712500000');assert.equal(reset.you.rank,1);assert.equal(reset.week.length,2);
  const tomorrow = Date.parse('2026-10-06T16:10:00Z');
  assert.equal(await fundingAlreadyAwarded(db, anonymous.deviceId, event.id, tomorrow), false);
  const nextDay = await recordFundingAward(db, { ...input, enteredAt: tomorrow, now: tomorrow + 20_000, quote: quoteFunding(event, tomorrow, 0, 1) });
  assert.equal(nextDay.award.profile.totalCents, '762500000');
  assert.equal(nextDay.award.profile.todayCents, '50000000');
  const rows = await db.prepare('SELECT COUNT(*) count FROM funding_awards').first<{ count: number }>();
  assert.equal(rows?.count, 4);
  console.log('TEST_PASSED:FundingPersistence identity, atomic duplicate, totals, SF-day, leaderboard');
} finally { await pool.dispose(); }
