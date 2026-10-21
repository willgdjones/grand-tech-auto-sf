import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// Death/busted costs are only spendable under economy v3 (same gate as robotaxi fares); flip it on so the
// debit path runs. In production economyV3 is force-on (prepare.ts productionOverrides).
vi.mock('@gtasf/shared/flags', async (orig) => {
  const actual = await orig<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, economyV3: true } };
});

import { FUNDING_SEASON } from '@gtasf/shared/funding';
import { flags } from '@gtasf/shared/flags';
import { applyCombatPenalty, currentValuationCents } from './penalty';
import { refreshEconomyV3Current } from './economyV3';

const MIGRATIONS = ['0010_funding.sql', '0014_funding_bonus.sql', '0018_fund_drops.sql', '0020_funding_credits.sql',
  '0021_referral_reward_amount.sql', '0028_economy_v3.sql', '0030_robotaxi_fares.sql', '0031_economy_reset_epoch.sql',
  '0042_combat_penalties.sql'];
const NOW = Date.UTC(2026, 9, 13, 18, 0, 0);
const SEASON = FUNDING_SEASON;

function freshDb(): { sqlite: DatabaseSync; db: D1Database } {
  const sqlite = new DatabaseSync(':memory:');
  for (const m of MIGRATIONS) sqlite.exec(readFileSync(new URL(`../../migrations/${m}`, import.meta.url), 'utf8'));
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
    async batch(statements: { run(): Promise<unknown> }[]) {
      sqlite.exec('BEGIN');
      try { const out = statements.map(s => s.run()); sqlite.exec('COMMIT'); return await Promise.all(out); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as D1Database;
  return { sqlite, db };
}

/** Seed a player sitting at exactly `currentCents` of valuation at NOW (lifetime == current, snapshot stamped now). */
function seedPlayer(sqlite: DatabaseSync, deviceId: string, currentCents: number): void {
  sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run(deviceId, `hash-${deviceId}`, `Startup ${deviceId}`, deviceId, NOW, NOW);
  // One award row so funding_earnings (the lifetime SUM) matches; then stamp the v3 snapshot at NOW.
  sqlite.prepare('INSERT INTO funding_awards(id,device_id,season,event_id,event_title,day,entered_at,awarded_at,amount_cents,quote_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(`aw-${deviceId}`, deviceId, SEASON, `evt-${deviceId}`, 'Seed round', '2026-10-13', NOW, NOW, currentCents, '{}');
  sqlite.prepare('UPDATE funding_profiles SET economy_v3_current_cents=?, economy_v3_lifetime_cents=?, economy_v3_burn_updated_at=? WHERE device_id=?')
    .run(currentCents, currentCents, NOW, deviceId);
}

function balance(sqlite: DatabaseSync, deviceId: string): number {
  return (sqlite.prepare('SELECT economy_v3_current_cents AS c FROM funding_profiles WHERE device_id=?').get(deviceId) as { c: number }).c;
}

it('WASTED debits 2% of current valuation once, and reports the new balance', async () => {
  const { sqlite, db } = freshDb();
  seedPlayer(sqlite, 'dev-1', 10_000_000); // $100,000
  const r = await applyCombatPenalty(db, 'dev-1', 'inc-1', 'wasted', NOW);
  expect(r).toMatchObject({ ok: true, kind: 'wasted', costCents: '200000', currentCents: '9800000', replay: false });
  expect(balance(sqlite, 'dev-1')).toBe(9_800_000);
  expect((sqlite.prepare('SELECT COUNT(*) AS n FROM combat_penalties').get() as { n: number }).n).toBe(1);
});

it('BUSTED debits 5% of current valuation', async () => {
  const { sqlite, db } = freshDb();
  seedPlayer(sqlite, 'dev-1', 10_000_000);
  const r = await applyCombatPenalty(db, 'dev-1', 'inc-b', 'busted', NOW);
  expect(r).toMatchObject({ ok: true, kind: 'busted', costCents: '500000', currentCents: '9500000', replay: false });
  expect(balance(sqlite, 'dev-1')).toBe(9_500_000);
});

it('WASTED applies the $1,000 floor when 2% is below it', async () => {
  const { sqlite, db } = freshDb();
  seedPlayer(sqlite, 'dev-1', 1_000_000); // $10,000 → 2% = $200 < $1,000 floor
  const r = await applyCombatPenalty(db, 'dev-1', 'inc-1', 'wasted', NOW);
  expect(r).toMatchObject({ ok: true, costCents: '100000' });
  expect(balance(sqlite, 'dev-1')).toBe(900_000);
});

it('never debits more than the player has (valuation floored at 0)', async () => {
  const { sqlite, db } = freshDb();
  seedPlayer(sqlite, 'dev-1', 50_000); // $500; floor is $1,000 → takes all $500
  const r = await applyCombatPenalty(db, 'dev-1', 'inc-1', 'wasted', NOW);
  expect(r).toMatchObject({ ok: true, costCents: '50000', currentCents: '0' });
  expect(balance(sqlite, 'dev-1')).toBe(0);
});

it('is idempotent on the incident id: a replay returns the original charge and does not debit again', async () => {
  const { sqlite, db } = freshDb();
  seedPlayer(sqlite, 'dev-1', 10_000_000);
  const first = await applyCombatPenalty(db, 'dev-1', 'inc-1', 'wasted', NOW);
  const replay = await applyCombatPenalty(db, 'dev-1', 'inc-1', 'wasted', NOW);
  expect(first).toMatchObject({ costCents: '200000', replay: false });
  expect(replay).toMatchObject({ costCents: '200000', replay: true });
  expect(balance(sqlite, 'dev-1')).toBe(9_800_000); // only the first debited
  expect((sqlite.prepare('SELECT COUNT(*) AS n FROM combat_penalties').get() as { n: number }).n).toBe(1);
});

it('stacks distinct incidents', async () => {
  const { sqlite, db } = freshDb();
  seedPlayer(sqlite, 'dev-1', 10_000_000);
  await applyCombatPenalty(db, 'dev-1', 'inc-1', 'wasted', NOW); // 10,000,000 → 9,800,000
  const second = await applyCombatPenalty(db, 'dev-1', 'inc-2', 'wasted', NOW); // 2% of 9,800,000 = 196,000
  expect(second).toMatchObject({ ok: true, costCents: '196000' });
  expect(balance(sqlite, 'dev-1')).toBe(9_604_000);
});

it('rejects an unknown profile', async () => {
  const { db } = freshDb();
  const r = await applyCombatPenalty(db, 'ghost', 'inc-1', 'wasted', NOW);
  expect(r).toEqual({ ok: false, reason: 'unknown-profile' });
});

it('rejects a replay from a different device', async () => {
  const { sqlite, db } = freshDb();
  seedPlayer(sqlite, 'dev-1', 10_000_000);
  seedPlayer(sqlite, 'dev-2', 10_000_000);
  await applyCombatPenalty(db, 'dev-1', 'inc-shared', 'wasted', NOW);
  await expect(applyCombatPenalty(db, 'dev-2', 'inc-shared', 'wasted', NOW)).rejects.toThrow(/another player/);
});

it('validates the kind and incident id', async () => {
  const { sqlite, db } = freshDb();
  seedPlayer(sqlite, 'dev-1', 10_000_000);
  await expect(applyCombatPenalty(db, 'dev-1', '', 'wasted', NOW)).rejects.toThrow(/incident id/);
  await expect(applyCombatPenalty(db, 'dev-1', 'inc-1', 'boom' as 'wasted', NOW)).rejects.toThrow(/death kind/);
});

describe('settleWithRetry (review: a lost-race death debit is retried, not dropped)', () => {
  it('retries only on retry, up to the limit, and returns the first settled result', async () => {
    const { settleWithRetry } = await import('./penalty');
    let calls = 0;
    const flaky = async () => (++calls < 3 ? { ok: false as const, reason: 'retry' as const } : { ok: true as const });
    expect(await settleWithRetry(flaky)).toEqual({ ok: true });
    expect(calls).toBe(3);
    calls = 0;
    expect(await settleWithRetry(async () => { calls++; return { ok: false as const, reason: 'unknown-profile' as const }; })).toMatchObject({ reason: 'unknown-profile' });
    expect(calls).toBe(1);
    calls = 0;
    expect(await settleWithRetry(async () => { calls++; return { ok: false as const, reason: 'retry' as const }; }, 4)).toMatchObject({ reason: 'retry' });
    expect(calls).toBe(4);
  });
});

it('a debit committing between a snapshot refresh\'s read and write is NOT overwritten (compare-and-swap, review A-H1)', async () => {
  const { sqlite, db } = freshDb();
  seedPlayer(sqlite, 'dev-1', 10_000_000); // $100,000, snapshot stamped at NOW
  // Race: the refresh has read the snapshot; just before its write lands, a death debit commits (another request).
  let raced = false;
  const racing = { ...db, prepare(sql: string) {
    const stmt = db.prepare(sql);
    if (!raced && /^UPDATE funding_profiles SET economy_v3_current_cents=\?, economy_v3_lifetime_cents=\?/.test(sql)) {
      raced = true;
      sqlite.prepare('UPDATE funding_profiles SET economy_v3_current_cents=economy_v3_current_cents-200000 WHERE device_id=?').run('dev-1');
    }
    return stmt;
  } } as unknown as D1Database;
  await refreshEconomyV3Current(racing, 'dev-1', NOW);
  expect(raced).toBe(true);
  expect(balance(sqlite, 'dev-1')).toBe(9_800_000); // the debit survives (it used to be written back to 10,000,000)
});
it('an uncontended refresh still writes the snapshot at `now`', async () => {
  const { sqlite, db } = freshDb();
  seedPlayer(sqlite, 'dev-1', 10_000_000);
  await refreshEconomyV3Current(db, 'dev-1', NOW + 5_000);
  expect((sqlite.prepare('SELECT economy_v3_burn_updated_at AS at FROM funding_profiles WHERE device_id=?').get('dev-1') as { at: number }).at).toBe(NOW + 5_000);
});

describe('riskReward rebalance on the debit path (critique #12)', () => {
  const withRebalance = async (run: () => Promise<void>) => {
    const f = flags as { riskReward: boolean }, before = f.riskReward;
    f.riskReward = true;
    try { await run(); } finally { f.riskReward = before; }
  };
  it('BUSTED at the QA Seed valuation ($81k) debits the $2,500 cap, not $4,050', () => withRebalance(async () => {
    const { sqlite, db } = freshDb();
    seedPlayer(sqlite, 'dev-1', 8_100_000);
    const r = await applyCombatPenalty(db, 'dev-1', 'inc-b', 'busted', NOW);
    expect(r).toMatchObject({ ok: true, kind: 'busted', costCents: '250000', currentCents: '7850000' });
    expect(balance(sqlite, 'dev-1')).toBe(7_850_000);
  }));
  it('WASTED at $100k debits a flat $1,000 (not 2% = $2,000), and replays the same charge', () => withRebalance(async () => {
    const { sqlite, db } = freshDb();
    seedPlayer(sqlite, 'dev-1', 10_000_000);
    expect(await applyCombatPenalty(db, 'dev-1', 'inc-w', 'wasted', NOW)).toMatchObject({ ok: true, costCents: '100000', currentCents: '9900000' });
    expect(await applyCombatPenalty(db, 'dev-1', 'inc-w', 'wasted', NOW)).toMatchObject({ ok: true, costCents: '100000', replay: true });
    expect(balance(sqlite, 'dev-1')).toBe(9_900_000);
  }));
  it('currentValuationCents reads the snapshot (robbery payout input) and is null for an unknown device', async () => {
    const { sqlite, db } = freshDb();
    seedPlayer(sqlite, 'dev-1', 8_100_000);
    expect(await currentValuationCents(db, 'dev-1', NOW)).toBe(8_100_000n);
    expect(await currentValuationCents(db, 'nobody', NOW)).toBeNull();
  });
});
