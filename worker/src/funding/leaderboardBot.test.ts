import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FUNDING_SEASON, fundingDay } from '@gtasf/shared/funding';
import { createFundingProfile, fundingLeaderboard } from './store';

// The player-facing leaderboard must exclude automated-test visits (is_bot=1, migration 0033) — is_bot's stated
// purpose is "so player counts exclude it". This guards the WHERE p.is_bot IS NOT 1 filter in fundingLeaderboard.
// funding_earnings is a VIEW over awards+bonuses+fund_drop_claims+credits, so the whole chain is needed.
const MIGRATIONS = ['0010_funding.sql', '0014_funding_bonus.sql', '0018_fund_drops.sql', '0020_funding_credits.sql',
  '0021_referral_reward_amount.sql', '0028_economy_v3.sql', '0031_economy_reset_epoch.sql', '0033_funding_profile_bot.sql'];

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const m of MIGRATIONS) sqlite.exec(readFileSync(new URL(`../../migrations/${m}`, import.meta.url), 'utf8'));
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql); let bindings: (string | number | null)[] = [];
      const wrapper = {
        bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
        async first() { return statement.get(...bindings) ?? null; },
        async all() { return { results: statement.all(...bindings), success: true }; },
        async run() { return { meta: statement.run(...bindings), success: true }; },
      };
      return wrapper;
    },
  } as unknown as D1Database;
  return { sqlite, db };
}

const NOW = Date.parse('2026-10-14T07:00:00Z');

async function seedEarner(sqlite: DatabaseSync, db: D1Database, id: string, name: string, cents: number, bot: boolean): Promise<void> {
  await createFundingProfile(db, id, `${id}-hash`, NOW);
  sqlite.prepare('UPDATE funding_profiles SET startup_name=? WHERE device_id=?').run(name, id);
  if (bot) sqlite.prepare('UPDATE funding_profiles SET is_bot=1 WHERE device_id=?').run(id);
  sqlite.prepare('INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(`${id}-c`, id, FUNDING_SEASON, 'event', `event:test:${id}`, 'Test earn', fundingDay(NOW), NOW, cents);
}

describe('fundingLeaderboard excludes automated-test (is_bot) profiles', () => {
  it('keeps a real earner and drops a higher-earning bot from the board + ranks', async () => {
    const { sqlite, db } = freshDb();
    await seedEarner(sqlite, db, 'real-a', 'Real Startup', 100_000, false);
    await seedEarner(sqlite, db, 'bot-a', 'Harness Startup', 500_000, true); // earns MORE, must still be hidden
    const board = await fundingLeaderboard(db, 'real-a', NOW, new Set());
    const weekIds = board.week.map(l => l.deviceId);
    expect(weekIds).toContain('real-a');
    expect(weekIds).not.toContain('bot-a');
    // the real earner ranks #1 despite the bot's larger total (bot excluded before ranking → no rank gap)
    expect(board.week.find(l => l.deviceId === 'real-a')?.rank).toBe(1);
    sqlite.close();
  });
});

describe('Most Wanted bounty credits stay off the lifetime / today boards (review A-M1)', () => {
  const credit = (sqlite: DatabaseSync, id: string, ref: string, cents: number) =>
    sqlite.prepare('INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(`${id}-${ref}`, id, FUNDING_SEASON, 'celebrity', ref, 'x', fundingDay(NOW), NOW, cents);
  it('a killer\'s bounty credit does not lift them on the week or today board, or in their board rank', async () => {
    const { sqlite, db } = freshDb();
    await seedEarner(sqlite, db, 'killer', 'Ring Startup', 100_000, false);
    await seedEarner(sqlite, db, 'honest', 'Honest Startup', 300_000, false);
    credit(sqlite, 'killer', `bounty:${fundingDay(NOW)}`, 5_000_000); // a $50k bounty
    const board = await fundingLeaderboard(db, 'killer', NOW, new Set());
    expect(board.week.map(l => l.deviceId)).toEqual(['honest', 'killer']);
    expect(board.week.find(l => l.deviceId === 'killer')).toMatchObject({ totalCents: '100000', rank: 2 });
    expect(board.today.find(l => l.deviceId === 'killer')).toMatchObject({ todayCents: '100000', todayRank: 2 });
    expect(board.you).toMatchObject({ rank: 2, todayRank: 2 }); // their own place matches the board
    sqlite.close();
  });
  it('only bounty refs are excluded: an ordinary celebrity credit (a mission payout) still counts', async () => {
    const { sqlite, db } = freshDb();
    await seedEarner(sqlite, db, 'worker', 'Worker Startup', 100_000, false);
    credit(sqlite, 'worker', `mission:steal-pitch-deck:${fundingDay(NOW)}`, 900_000);
    const board = await fundingLeaderboard(db, 'worker', NOW, new Set());
    expect(board.week.find(l => l.deviceId === 'worker')?.totalCents).toBe('1000000');
    sqlite.close();
  });
});
