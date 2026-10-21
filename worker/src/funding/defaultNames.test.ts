import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { defaultFundingNames } from '@gtasf/shared/startupNames';
import { normalizeFundingName } from '@gtasf/shared/funding';
import { createFundingProfile, fundingLeaderboard, getFundingProfile, saveFundingNames } from './store';

// Founder (Oct 6): nobody is ever unnamed. New profiles get a generated identity; legacy unnamed ones are
// backfilled on their next read; chosen names are never overwritten.
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  for (const m of ['0001_initial.sql', '0002_events.sql', '0010_funding.sql', '0014_funding_bonus.sql',
    '0017_community_events.sql', '0018_fund_drops.sql', '0020_funding_credits.sql', '0033_funding_profile_bot.sql'])
    sqlite.exec(readFileSync(new URL(`../../migrations/${m}`, import.meta.url), 'utf8'));
  const db = { prepare(sql: string) {
    const statement = sqlite.prepare(sql); let bindings: (string | number | null)[] = [];
    const wrapper = { bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
      async first() { return statement.get(...bindings) ?? null; },
      async all() { return { results: statement.all(...bindings), success: true }; },
      async run() { return { meta: statement.run(...bindings), success: true }; } };
    return wrapper;
  }, async batch(s: { run(): Promise<unknown> }[]) { return Promise.all(s.map(x => x.run())); } } as unknown as D1Database;
  return { sqlite, db, now: Date.parse('2026-10-06T14:00:00Z') };
}
const stored = (sqlite: DatabaseSync, id: string) => sqlite.prepare('SELECT startup_name,nickname FROM funding_profiles WHERE device_id=?').get(id);

it('generates valid, stable default names', () => {
  for (const seed of ['a', 'device-123', 'x'.repeat(64)]) {
    const names = defaultFundingNames(seed);
    expect(defaultFundingNames(seed)).toEqual(names);
    expect(normalizeFundingName(names.startupName, 'startup')).toBe(names.startupName);
    expect(normalizeFundingName(names.nickname, 'nickname')).toBe(names.nickname);
  }
});

it('new profiles are named at creation; legacy unnamed profiles are backfilled; chosen names are kept', async () => {
  const { sqlite, db, now } = setup();
  try {
    await createFundingProfile(db, 'dev-new', 'hash-new', now);
    expect(stored(sqlite, 'dev-new')).toEqual({ startup_name: defaultFundingNames('dev-new').startupName, nickname: defaultFundingNames('dev-new').nickname });

    sqlite.prepare("INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,'','',?,?)").run('dev-old', 'hash-old', now, now);
    sqlite.prepare("INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,'Fogware','',?,?)").run('dev-half', 'hash-half', now, now);
    // Others see the same deterministic default on the leaderboard before the backfill runs.
    const board = await fundingLeaderboard(db, 'dev-new', now, new Set());
    const oldRow = [...board.week, ...(board.today ?? [])].find(entry => entry.deviceId === 'dev-old');
    if (oldRow) expect(oldRow.startupName).toBe(defaultFundingNames('dev-old').startupName);

    const old = await getFundingProfile(db, 'dev-old', now);
    expect([old.startupName, old.nickname]).toEqual([defaultFundingNames('dev-old').startupName, defaultFundingNames('dev-old').nickname]);
    expect(stored(sqlite, 'dev-old')).toEqual({ startup_name: old.startupName, nickname: old.nickname });
    const half = await getFundingProfile(db, 'dev-half', now);
    expect([half.startupName, half.nickname]).toEqual(['Fogware', defaultFundingNames('dev-half').nickname]);

    // Renaming still works and is never overwritten by the backfill.
    await saveFundingNames(db, 'dev-new', 'Agentic Sourdough', 'breadmaxi', now);
    expect((await getFundingProfile(db, 'dev-new', now)).startupName).toBe('Agentic Sourdough');
  } finally { sqlite.close(); }
});
