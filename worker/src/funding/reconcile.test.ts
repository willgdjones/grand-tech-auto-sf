import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { FUNDING_SEASON, fundingRound } from '@gtasf/shared/funding';
import { FUNDING_SOURCES } from '@gtasf/shared/captable';
import { fundingLeaderboard, fundingSummariesByNickname, getFundingProfile } from './store';
import { getCapTable } from './credits';

/**
 * A player's season funding is read back through four independent code paths — the profile, the
 * leaderboard, the cap table, and the nameplate summary. They must all report the SAME total and the
 * SAME ladder round, or the money layer is lying somewhere. This asserts that invariant after a
 * realistic mix of ALL four earned-funding ledgers (v1 event awards, v2 credits for events +
 * celebrity angels, referral warm-intro bonuses, and VC fund-drop cheques), which is exactly what the
 * funding_earnings view (migration 0021) and getCapTable's UNION are each supposed to cover.
 */
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of ['0010_funding.sql', '0014_funding_bonus.sql', '0018_fund_drops.sql', '0020_funding_credits.sql', '0021_referral_reward_amount.sql', '0033_funding_profile_bot.sql'])
    sqlite.exec(readFileSync(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8'));
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let bindings: (string | number | null)[] = [];
      const wrapper = {
        bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
        async first() { return statement.get(...bindings) ?? null; },
        async all() { return { results: statement.all(...bindings), success: true }; },
        async run() { return { meta: statement.run(...bindings), success: true }; },
      };
      return wrapper;
    },
  } as unknown as D1Database;
  const now = Date.UTC(2026, 9, 5, 18, 0, 0); // Oct 5 2026, 11:00 SF time.
  const day = '2026-10-05';
  const profile = (device: string, startup: string, nick: string) =>
    sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(device, `hash-${device}`, startup, nick, now, now);
  profile('dev-1', 'Fogware', 'Foggy');
  profile('dev-friend', 'Palsoft', 'Pal'); // the referred friend (funding_bonuses.friend_device_id FK + UNIQUE)

  // One row in each earned-funding ledger for dev-1 (all amounts within their table CHECKs).
  const amounts = { award: 50_000_000, creditEvent: 30_000_000, celebrity: 500_000_000, warmIntro: 500_000_000, vcDrop: 25_000_000 };
  sqlite.prepare('INSERT INTO funding_awards(id,device_id,season,event_id,event_title,day,entered_at,awarded_at,amount_cents,quote_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('aw-1', 'dev-1', FUNDING_SEASON, 'evt-v1', 'Investor Happy Hour', day, now, now, amounts.award, JSON.stringify({ streakCount: 1 }));
  sqlite.prepare('INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('cr-evt', 'dev-1', FUNDING_SEASON, 'event', 'evt-v2', 'Hack Night', day, now, amounts.creditEvent);
  sqlite.prepare('INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('cr-celeb', 'dev-1', FUNDING_SEASON, 'celebrity', 'ron-conway', 'Ron Conway', day, now, amounts.celebrity);
  sqlite.prepare('INSERT INTO funding_bonuses(id,device_id,friend_device_id,season,kind,day,awarded_at,amount_cents) VALUES(?,?,?,?,?,?,?,?)')
    .run('bn-1', 'dev-1', 'dev-friend', FUNDING_SEASON, 'warm-intro', day, now, amounts.warmIntro);
  sqlite.prepare('INSERT INTO fund_drop_claims(id,device_id,season,drop_id,slot,fund_name,sponsored,position,amount_cents,claimed_at,day) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('fd-1', 'dev-1', FUNDING_SEASON, 'drop-7', 7, 'Softbank Vision Fund XLII', 0, 3, amounts.vcDrop, now, day);

  const expectedTotal = Object.values(amounts).reduce((a, b) => a + b, 0);
  return { db, now, expectedTotal };
}

it('every read path reports the same season total after a mix of all four funding ledgers', async () => {
  const { db, now, expectedTotal } = setup();
  const expected = String(expectedTotal);

  const profile = await getFundingProfile(db, 'dev-1', now);
  const board = await fundingLeaderboard(db, 'dev-1', now, new Set(['dev-1']));
  const cap = await getCapTable(db, 'dev-1', now);
  const [summary] = await fundingSummariesByNickname(db, ['Foggy'], now);
  const capTotal = cap.groups.reduce((sum, g) => sum + BigInt(g.totalCents), 0n).toString();

  expect(profile.totalCents).toBe(expected);       // funding_earnings view
  expect(board.you.totalCents).toBe(expected);      // leaderboard 'you'
  expect(cap.totalCents).toBe(expected);            // cap table header total
  expect(capTotal).toBe(expected);                  // sum of cap-table group subtotals
  expect(summary?.totalCents).toBe(expected);       // nameplate summary endpoint
});

it('the cap table lists every funding source and groups fold awards+credits correctly', async () => {
  const { db, now } = setup();
  const cap = await getCapTable(db, 'dev-1', now);
  const bySource = new Map(cap.groups.map(g => [g.source, g]));
  // All four PLAN-v2 decision-5 sources are present.
  expect([...bySource.keys()].sort()).toEqual([...FUNDING_SOURCES].sort());
  // 'event' folds the v1 award ($500k) and the v2 event credit ($300k) into one group of two.
  expect(bySource.get('event')).toMatchObject({ count: 2, totalCents: '80000000' });
  expect(bySource.get('vc-drop')).toMatchObject({ count: 1, totalCents: '25000000' });
  expect(bySource.get('celebrity')).toMatchObject({ count: 1, totalCents: '500000000' });
  expect(bySource.get('warm-intro')).toMatchObject({ count: 1, totalCents: '500000000' });
});

it('every read path reports the same ladder round', async () => {
  const { db, now, expectedTotal } = setup();
  const round = fundingRound(String(expectedTotal));
  const profile = await getFundingProfile(db, 'dev-1', now);
  const board = await fundingLeaderboard(db, 'dev-1', now, new Set(['dev-1']));
  const cap = await getCapTable(db, 'dev-1', now);
  const [summary] = await fundingSummariesByNickname(db, ['Foggy'], now);

  expect(round.id).toBe('seed'); // $11.05M: past Seed ($3M), short of Series A ($15M)
  expect(profile.round.id).toBe(round.id);
  expect(board.you.round.id).toBe(round.id);
  expect(cap.round.id).toBe(round.id);
  expect(summary?.round.id).toBe(round.id);
});
