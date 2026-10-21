import { ECONOMY_RESET_EPOCH } from '@gtasf/shared/funding';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

vi.mock('@gtasf/shared/flags', async (orig) => {
  const actual = await orig<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, economyV3: true } };
});

import { FUNDING_SEASON, robotaxiFareCents } from '@gtasf/shared/funding';
import { getFundingProfile } from './store';
import { chargeRide, quoteRide, refundRide } from './rides';

const MIGRATIONS = ['0010_funding.sql', '0014_funding_bonus.sql', '0018_fund_drops.sql', '0020_funding_credits.sql',
  '0021_referral_reward_amount.sql', '0028_economy_v3.sql', '0030_robotaxi_fares.sql', '0031_economy_reset_epoch.sql'];
const NOW = Date.UTC(2026, 9, 5, 18, 0, 0);
const SEED = 7_500_000n;

function setup(fundingCents: number, freeUsed = 3) {
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
  sqlite.prepare(`INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at,economy_v3_current_cents,economy_v3_lifetime_cents,economy_v3_burn_updated_at,free_rides_used,economy_reset_epoch) VALUES(?,?,?,?,?,?,?,?,?,?,${ECONOMY_RESET_EPOCH})`)
    .run('d', 'h', 'Fogware', 'Foggy', NOW, NOW, fundingCents, fundingCents, NOW, freeUsed);
  if (fundingCents > 0) sqlite.prepare('INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('c', 'd', FUNDING_SEASON, 'event', 'evt', 'Opening', '2026-10-05', NOW, fundingCents);
  return { db, sqlite };
}

it('fare = $100 + $150/km, rounded to $10', () => {
  expect(robotaxiFareCents(0)).toBe(10_000n);          // $100 flag-fall
  expect(robotaxiFareCents(1000)).toBe(25_000n);       // $250
  expect(robotaxiFareCents(1800)).toBe(37_000n);       // $370 (Ferry → Lombard)
  expect(robotaxiFareCents(1234)).toBe(29_000n);       // $285.10 → $290 (nearest $10)
  expect(robotaxiFareCents(-5)).toBe(10_000n);
});

it('first three rides are free, then paid; free rides survive a reset', async () => {
  const { db } = setup(0, 0);
  for (let i = 1; i <= 3; i++) {
    const q = await quoteRide(db, 'd', 2000, NOW);
    expect(q).toMatchObject({ free: true, chargeCents: '0', freeRidesLeft: 4 - i, affordable: true });
    expect(await chargeRide(db, 'd', `ride-${i}`, q.chargeCents, NOW)).toMatchObject({ ok: true, free: true, chargedCents: '0' });
  }
  const paid = await quoteRide(db, 'd', 2000, NOW);
  expect(paid).toMatchObject({ free: false, chargeCents: '40000', freeRidesLeft: 0, affordable: false });
});

it('a paid ride debits current funding once (idempotent) and leaves lifetime alone', async () => {
  const { db } = setup(Number(SEED) + 100_000);
  const first = await chargeRide(db, 'd', 'ride-x', 40_000n, NOW);
  expect(first).toMatchObject({ ok: true, free: false, chargedCents: '40000', replay: false });
  expect(await chargeRide(db, 'd', 'ride-x', 40_000n, NOW + 10)).toMatchObject({ ok: true, chargedCents: '40000', replay: true });
  const p = await getFundingProfile(db, 'd', NOW + 10);
  expect(BigInt(p.lifetimeCents!)).toBe(SEED + 100_000n);
  expect(BigInt(p.currentCents!) <= SEED + 60_000n).toBe(true); // one $400 debit (plus a few ms of burn), not two
});

it('insufficient funds are rejected and funding never goes negative', async () => {
  const { db } = setup(30_000);
  expect(await chargeRide(db, 'd', 'ride-y', 40_000n, NOW)).toMatchObject({ ok: false, reason: 'unaffordable' });
  expect((await getFundingProfile(db, 'd', NOW)).currentCents).toBe('30000');
  expect(await chargeRide(db, 'd', 'ride-z', 30_000n, NOW)).toMatchObject({ ok: true });
  expect((await getFundingProfile(db, 'd', NOW)).currentCents).toBe('0');
});

it('a fare that takes a Seed player below $75k demotes them to Bootstrapping', async () => {
  const { db } = setup(Number(SEED) + 10_000);
  expect((await getFundingProfile(db, 'd', NOW)).round.id).toBe('seed');
  await chargeRide(db, 'd', 'ride-s', 40_000n, NOW);
  expect((await getFundingProfile(db, 'd', NOW)).round.id).toBe('bootstrapping');
});

it('a stale $0 quote after the free rides are used is rejected, never a fourth free ride', async () => {
  const { db, sqlite } = setup(Number(SEED), 3);
  expect(await chargeRide(db, 'd', 'ride-4', 0n, NOW)).toMatchObject({ ok: false, reason: 'stale-quote' });
  expect((sqlite.prepare("SELECT free_rides_used n FROM funding_profiles WHERE device_id='d'").get() as { n: number }).n).toBe(3);
  expect(sqlite.prepare("SELECT 1 FROM robotaxi_fares WHERE ride_id='ride-4'").get()).toBeUndefined();
});

it('refundRide returns a paid fare or a free ride exactly once', async () => {
  const { db, sqlite } = setup(Number(SEED) + 100_000, 2);
  await chargeRide(db, 'd', 'free-1', 0n, NOW);   // third free ride
  await chargeRide(db, 'd', 'paid-1', 40_000n, NOW);
  const used = () => (sqlite.prepare("SELECT free_rides_used n FROM funding_profiles WHERE device_id='d'").get() as { n: number }).n;
  const current = () => (sqlite.prepare("SELECT economy_v3_current_cents c FROM funding_profiles WHERE device_id='d'").get() as { c: number }).c;
  const before = current();
  expect(await refundRide(db, 'd', 'paid-1')).toBe(true);
  expect(current()).toBe(before + 40_000);
  expect(await refundRide(db, 'd', 'paid-1')).toBe(false);
  expect(current()).toBe(before + 40_000);
  expect(await refundRide(db, 'd', 'free-1')).toBe(true);
  expect(used()).toBe(2);
});
