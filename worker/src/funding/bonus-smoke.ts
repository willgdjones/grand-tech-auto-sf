/** One real D1 boundary check for qualified friend awards and combined funding totals. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { quoteFunding } from '@gtasf/shared/funding';
import { ensureFundingDevice } from './identity';
import { recordWarmIntro } from './bonus';
import { fundingAlreadyAwarded, fundingLeaderboard, getFundingProfile, previousFundingAward, recordFundingAward, saveFundingNames } from './store';
import { ensureReferralAccount } from '../referrals/store';

const pool = new Miniflare(convertV4MiniflareOptions({ cf: false, telemetry: { enabled: false }, workers: [{
  name: 'gtasf-warm-intro-smoke', modules: true, script: 'export default { fetch() { return new Response("ok") } }',
  compatibilityDate: '2026-09-28', d1Databases: ['DB'],
}] }));
try {
  await pool.ready;
  const db = await pool.getD1Database('DB') as unknown as D1Database;
  for (const file of ['0010_funding.sql', '0011_referrals.sql', '0012_referral_ledger.sql', '0014_funding_bonus.sql',
    '0016_referral_claims.sql', '0018_fund_drops.sql', '0020_funding_credits.sql', '0021_referral_reward_amount.sql']) {
    const sql = await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
    for (const statement of sql.split(';').filter(statement => statement.trim())) await db.prepare(statement).run();
  }
  const joinedAt = Date.parse('2026-10-05T16:00:00Z'), qualifiedAt = joinedAt + 300_000;
  async function player(name: string) {
    const identity = await ensureFundingDevice(new Request('https://gtasf.test/api/funding/profile'), db, joinedAt);
    await saveFundingNames(db, identity.deviceId, name, name, joinedAt);
    await ensureReferralAccount(db, identity.deviceId, joinedAt);
    return identity.deviceId;
  }
  const referrer = await player('Referrer'), friend = await player('Friend'), second = await player('Second');
  await db.prepare('INSERT INTO referral_players(buyer_device_id,referrer_id,joined_at,played_ms) VALUES(?,?,?,299999)')
    .bind(friend, referrer, joinedAt).run();
  assert.equal((await recordWarmIntro(db, friend, qualifiedAt)).credited, false);
  await db.prepare('UPDATE referral_players SET played_ms=300000 WHERE buyer_device_id=?').bind(friend).run();
  assert.equal((await recordWarmIntro(db, friend, qualifiedAt - 1)).credited, false);
  const result = await Promise.all([recordWarmIntro(db, friend, qualifiedAt), recordWarmIntro(db, friend, qualifiedAt)]);
  assert.equal(result.filter(value => value.credited).length, 1);
  assert.equal((await getFundingProfile(db, referrer, qualifiedAt)).totalCents, '500000000'); // $5M warm intro (founder decision)
  assert.equal(await previousFundingAward(db, referrer), null);
  assert.equal(await fundingAlreadyAwarded(db, referrer, friend, qualifiedAt), false);
  const proof = await db.prepare('SELECT warm_intro_at FROM referral_players WHERE buyer_device_id=?').bind(friend).first<{ warm_intro_at: number }>();
  assert.equal(proof?.warm_intro_at, qualifiedAt);
  const event = { id: 'public-meetup', title: 'Community meetup', start: '2026-10-06T16:00:00Z' };
  const award = await recordFundingAward(db, { deviceId: referrer, eventId: event.id, eventTitle: event.title,
    enteredAt: qualifiedAt, now: qualifiedAt + 20_000, quote: quoteFunding(event, qualifiedAt, 0, 1) });
  assert.equal(award.award.profile.totalCents, '510000000'); // $5M warm + $100k event
  const board = await fundingLeaderboard(db, referrer, qualifiedAt + 21_000, new Set([referrer]));
  assert.equal(board.week[0]?.totalCents, '510000000');
  assert.equal(board.today[0]?.todayCents, '510000000');
  assert.equal(board.you.rank, 1);
  assert.equal(board.week[0]?.live, true);
  await db.prepare('UPDATE referral_players SET referrer_id=? WHERE buyer_device_id=?').bind(second, friend).run();
  assert.equal((await recordWarmIntro(db, friend, qualifiedAt + 86_400_000)).credited, false);
  assert.equal((await getFundingProfile(db, second, qualifiedAt)).totalCents, '0');
  await db.prepare('INSERT INTO referral_players(buyer_device_id,referrer_id,joined_at,played_ms) VALUES(?,?,?,300000)')
    .bind(second, second, joinedAt).run();
  assert.equal((await recordWarmIntro(db, second, qualifiedAt)).credited, false);
  assert.equal((await getFundingProfile(db, referrer, qualifiedAt + 86_400_000)).todayCents, '0');
  assert.equal((await db.prepare('SELECT COUNT(*) count FROM funding_bonuses').first<{ count: number }>())?.count, 1);
  console.log('TEST_PASSED:WarmIntro server-play boundary, atomic once-friend, no self, combined rank, no event-streak credit');
} finally { await pool.dispose(); }
