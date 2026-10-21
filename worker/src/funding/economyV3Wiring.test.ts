import { ECONOMY_RESET_EPOCH } from '@gtasf/shared/funding';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

// Economy v3 is a load-time flag (shared/funding.ts binds FUNDING_ROUNDS/FUNDING_BASE_CENTS once), so the
// whole module graph must load with it ON to exercise the v3 read/write wiring. Mock it before importing.
vi.mock('@gtasf/shared/flags', async (orig) => {
  const actual = await orig<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, economyV3: true } };
});

import { FUNDING_SEASON, applyEconomyV3Burn, fundingRound, ECON_V3_BURN_PER_MIN_CENTS } from '@gtasf/shared/funding';
import { fundingLeaderboard, getFundingProfile } from './store';
import { recordFundingCredit } from './credits';

const MIGRATIONS = ['0010_funding.sql', '0014_funding_bonus.sql', '0018_fund_drops.sql', '0020_funding_credits.sql', '0021_referral_reward_amount.sql', '0028_economy_v3.sql', '0030_robotaxi_fares.sql', '0031_economy_reset_epoch.sql', '0033_funding_profile_bot.sql'];
const NOW = Date.UTC(2026, 9, 5, 18, 0, 0), DAY = '2026-10-05';
const SERIES_A = 69_841_638n, SERIES_B = 258_591_292n, X = 200_000_000n; // X ($2M) sits mid ★2 (Series A) band

/** A migrated ★2 player: one $2M credit (SUM = lifetime = X) and a snapshot stamped at NOW (current == lifetime).
 *  The burn-stamp marker is pre-set, so getFundingProfile's lazy enable trigger is an idempotent no-op here. */
function freshDb() {
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
    async batch(statements: { run(): Promise<unknown> }[]) { // D1 batches are one transaction
      sqlite.exec('BEGIN');
      try { const out = statements.map(s => s.run()); sqlite.exec('COMMIT'); return await Promise.all(out); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as D1Database;
  return { db, sqlite };
}
function setup() {
  const { db, sqlite } = freshDb();
  sqlite.prepare(`INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at,economy_v3_current_cents,economy_v3_lifetime_cents,economy_v3_burn_updated_at,economy_reset_epoch) VALUES(?,?,?,?,?,?,?,?,?,${ECONOMY_RESET_EPOCH})`)
    .run('d', 'h', 'Fogware', 'Foggy', NOW, NOW, Number(X), Number(X), NOW);
  sqlite.prepare('INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('seed-row', 'd', FUNDING_SEASON, 'event', 'evt-0', 'Opening', DAY, NOW, Number(X));
  return { db, sqlite };
}

it('a v3 profile reports current/lifetime/burn; idle burn lowers current while lifetime holds', async () => {
  const { db } = setup();
  const at0 = await getFundingProfile(db, 'd', NOW);
  expect(at0.lifetimeCents).toBe(X.toString());                 // cumulative raised = ledger SUM
  expect(at0.currentCents).toBe(X.toString());                  // no elapsed burn yet
  expect(at0.totalCents).toBe(X.toString());                    // headline total == current in v3
  expect(at0.round.id).toBe('series-a');                        // ★2, via the v3 ladder (flag ON)
  // Profile exposes the flat ★2 burn as a per-SECOND figure (= the −$X/min rate ÷ 60) for pane 3's runway meter.
  expect(at0.burnPerSecCents).toBe((ECON_V3_BURN_PER_MIN_CENTS['series-a']! / 60n).toString());

  const day = 86_400_000;
  const at1 = await getFundingProfile(db, 'd', NOW + day);       // one idle day
  expect(BigInt(at1.currentCents!)).toBe(applyEconomyV3Burn(X, 86_400).currentCents); // exactly the flat-burn result
  expect(BigInt(at1.currentCents!) < X).toBe(true);             // current fell (gentle burn)
  expect(at1.lifetimeCents).toBe(X.toString());                 // lifetime never burns
  expect(fundingRound(at1.currentCents!).id).toBe('series-a');  // mid-band → still ★2 after one idle day
});

it('a credited event raises both current and lifetime (write path folds burn + books the award)', async () => {
  const { db } = setup();
  const res = await recordFundingCredit(db, { deviceId: 'd', source: 'event', sourceRef: 'evt-new', label: 'Hack Night', amountCents: 10_000_000n, now: NOW });
  expect(res.credited).toBe(true);
  const p = await getFundingProfile(db, 'd', NOW);
  expect(p.lifetimeCents).toBe('210000000'); // 200M + 10M booked into the ledger
  expect(p.currentCents).toBe('210000000');  // folded into current (no elapsed burn at the same instant)
});

it('current self-heals from the ledger SUM when a snapshot write was missed (non-atomic award)', async () => {
  const { db, sqlite } = setup();
  // Simulate a crash AFTER the award INSERT but BEFORE refreshEconomyV3Current: book a row directly, leaving
  // the snapshot (current=lifetime=X at NOW) stale. The read must still reflect it via SUM − snapshot lifetime.
  sqlite.prepare('INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('heal-1', 'd', FUNDING_SEASON, 'event', 'evt-heal', 'Heal', DAY, NOW, 30_000_000);
  const p = await getFundingProfile(db, 'd', NOW);
  expect(p.lifetimeCents).toBe('230000000'); // SUM includes the un-refreshed row
  expect(p.currentCents).toBe('230000000');  // self-healed: burn(X,0)=X plus (230M − snapshot 200M)
});

it('flipping economyV3 on lazily RESETS an existing v2 player to $0 — exactly once (s5yg, founder 07:5x)', async () => {
  const { db, sqlite } = freshDb();
  // A pre-existing v2 player with funding ($11.05M) and NO economy_v3 snapshot (not yet reset).
  sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run('v2p', 'h', 'OldCo', 'Old', NOW, NOW);
  sqlite.prepare('INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('v2-row', 'v2p', FUNDING_SEASON, 'event', 'e0', 'Legacy raise', DAY, NOW, 1_105_000_000);
  // First profile read after the flag is on: the lazy enable trigger wipes their funding to $0 / Bootstrapping.
  const p1 = await getFundingProfile(db, 'v2p', NOW);
  expect(p1).toMatchObject({ totalCents: '0', lifetimeCents: '0', startupName: 'OldCo' }); // wiped; identity kept
  expect(p1.round.id).toBe('bootstrapping');
  expect((await db.prepare('SELECT COUNT(*) AS c FROM funding_credits WHERE device_id=?').bind('v2p').first<{ c: number }>())?.c).toBe(0); // ledger deleted
  const stamp = await db.prepare('SELECT economy_v3_burn_updated_at AS at FROM funding_profiles WHERE device_id=?').bind('v2p').first<{ at: number }>();
  expect(stamp?.at).toBe(NOW);                    // reset marker set
  // The player earns fresh in v3; a later read must NOT re-reset it (the reset ran exactly once).
  await recordFundingCredit(db, { deviceId: 'v2p', source: 'event', sourceRef: 'fresh-1', label: 'Fresh', amountCents: 5_000_000n, now: NOW + 1000 });
  const p2 = await getFundingProfile(db, 'v2p', NOW + 2000);
  expect(p2.lifetimeCents).toBe('5000000');       // fresh earning survived — no second reset
});

it('v3 leaderboard adds a CURRENT board: a burned-down big raiser ranks below an active smaller one (gu7k)', async () => {
  const { db, sqlite } = setup(); // 'd': lifetime $2M, snapshot at NOW
  const later = NOW + 3 * 86_400_000; // three idle days for 'd'
  sqlite.prepare(`INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at,economy_v3_current_cents,economy_v3_lifetime_cents,economy_v3_burn_updated_at,economy_reset_epoch) VALUES(?,?,?,?,?,?,?,?,?,${ECONOMY_RESET_EPOCH})`)
    .run('e', 'h2', 'Bayware', 'Bay', later, later, 150_000_000, 150_000_000, later);
  sqlite.prepare('INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('e-row', 'e', FUNDING_SEASON, 'event', 'evt-e', 'Fresh', DAY, later, 150_000_000);
  const board = await fundingLeaderboard(db, 'd', later, new Set());
  expect(board.week.map(l => l.deviceId)).toEqual(['d', 'e']);           // lifetime: $2M beats $1.5M
  expect(board.current!.map(l => l.deviceId)).toEqual(['e', 'd']);       // current: 'd' burned below $1.5M
  expect(board.current![1]!.totalCents).toBe(applyEconomyV3Burn(X, 3 * 86_400).currentCents.toString());
});

it('leaderboard resets players who have not logged in since the flip, so old v2 totals never show', async () => {
  const { db, sqlite } = setup();
  sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run('old', 'h3', 'Oldco', 'Oldie', NOW, NOW); // never read since the flip: marker NULL
  sqlite.prepare('INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('old-row', 'old', FUNDING_SEASON, 'event', 'evt-old', 'v2 cheque', DAY, NOW, 900_000_000);
  const board = await fundingLeaderboard(db, 'd', NOW, new Set());
  expect(board.week.map(l => l.deviceId)).toEqual(['d']);
  expect(board.current!.map(l => l.deviceId)).toEqual(['d']);
});
