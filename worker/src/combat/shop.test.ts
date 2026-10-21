import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

// Gun-shop purchases debit spendable valuation, which only exists under economy v3 (force-on in prod).
vi.mock('@gtasf/shared/flags', async (orig) => {
  const actual = await orig<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, economyV3: true } };
});

import { FUNDING_SEASON } from '@gtasf/shared/funding';
import { buyArmour, buyWeapon, ownedWeapons } from './shop';

const MIGRATIONS = ['0010_funding.sql', '0014_funding_bonus.sql', '0018_fund_drops.sql', '0020_funding_credits.sql',
  '0021_referral_reward_amount.sql', '0028_economy_v3.sql', '0030_robotaxi_fares.sql', '0031_economy_reset_epoch.sql',
  '0043_combat_weapons.sql', '0049_combat_armour.sql'];
const NOW = Date.UTC(2026, 9, 13, 18, 0, 0);

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

function seedPlayer(sqlite: DatabaseSync, deviceId: string, currentCents: number): void {
  sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run(deviceId, `h-${deviceId}`, `S ${deviceId}`, deviceId, NOW, NOW);
  sqlite.prepare('INSERT INTO funding_awards(id,device_id,season,event_id,event_title,day,entered_at,awarded_at,amount_cents,quote_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(`aw-${deviceId}`, deviceId, FUNDING_SEASON, `e-${deviceId}`, 'Round', '2026-10-13', NOW, NOW, currentCents, '{}');
  sqlite.prepare('UPDATE funding_profiles SET economy_v3_current_cents=?, economy_v3_lifetime_cents=?, economy_v3_burn_updated_at=? WHERE device_id=?')
    .run(currentCents, currentCents, NOW, deviceId);
}
const balance = (sqlite: DatabaseSync, id: string) =>
  (sqlite.prepare('SELECT economy_v3_current_cents AS c FROM funding_profiles WHERE device_id=?').get(id) as { c: number }).c;

it('buys a weapon at the current-stage price and debits valuation once', async () => {
  const { sqlite, db } = freshDb();
  seedPlayer(sqlite, 'dev-1', 10_000_000); // $100k → Seed (stars 1); pistol = 500k × 2 = 1,000,000
  const r = await buyWeapon(db, 'dev-1', 'pistol', NOW);
  expect(r).toMatchObject({ ok: true, weapon: 'pistol', owned: false, chargedCents: '1000000', currentCents: '9000000' });
  expect(balance(sqlite, 'dev-1')).toBe(9_000_000);
});

it('is idempotent on ownership: re-buying an owned weapon does not charge again', async () => {
  const { sqlite, db } = freshDb();
  seedPlayer(sqlite, 'dev-1', 10_000_000);
  await buyWeapon(db, 'dev-1', 'pistol', NOW);
  const again = await buyWeapon(db, 'dev-1', 'pistol', NOW + 1000);
  expect(again).toMatchObject({ ok: true, owned: true, chargedCents: '0' });
  expect(balance(sqlite, 'dev-1')).toBe(9_000_000); // unchanged
  expect((sqlite.prepare('SELECT COUNT(*) AS n FROM combat_weapons WHERE device_id=?').get('dev-1') as { n: number }).n).toBe(1);
});

it('prices by stage: a bootstrapping founder pays the base, a later stage pays more', async () => {
  const { sqlite, db } = freshDb();
  seedPlayer(sqlite, 'boot', 5_000_000); // $50k < $75k Seed threshold → bootstrapping (stars 0)
  const r = await buyWeapon(db, 'boot', 'pistol', NOW);
  expect(r).toMatchObject({ ok: true, chargedCents: '500000' }); // base, no multiplier
  expect(balance(sqlite, 'boot')).toBe(4_500_000);
});

it('rejects an unaffordable purchase without charging (below the \$500 shop floor)', async () => {
  const { sqlite, db } = freshDb();
  seedPlayer(sqlite, 'dev-1', 30_000); // $300 < the $500 minimum price
  const r = await buyWeapon(db, 'dev-1', 'rifle', NOW);
  expect(r).toEqual({ ok: false, reason: 'unaffordable' });
  expect(balance(sqlite, 'dev-1')).toBe(30_000);
});

it('caps a weapon at 10% of current valuation (orchestrator, gtasf-euhs0)', async () => {
  const { sqlite, db } = freshDb();
  seedPlayer(sqlite, 'dev-1', 10_000_000); // $100k; rifle at Seed = $160k stage price → capped to $10k
  const r = await buyWeapon(db, 'dev-1', 'rifle', NOW);
  expect(r).toMatchObject({ ok: true, chargedCents: '1000000' });
  expect(balance(sqlite, 'dev-1')).toBe(9_000_000);
});

it('rejects melee / unknown weapons as not for sale', async () => {
  const { sqlite, db } = freshDb();
  seedPlayer(sqlite, 'dev-1', 10_000_000);
  expect(await buyWeapon(db, 'dev-1', 'fists', NOW)).toEqual({ ok: false, reason: 'not-for-sale' });
  expect(await buyWeapon(db, 'dev-1', 'bazooka', NOW)).toEqual({ ok: false, reason: 'not-for-sale' });
});

it('rejects an unknown profile', async () => {
  const { db } = freshDb();
  expect(await buyWeapon(db, 'ghost', 'pistol', NOW)).toEqual({ ok: false, reason: 'unknown-profile' });
});

it('armour: charges the current-stage price once, and a replayed request never charges again', async () => {
  const { sqlite, db } = freshDb();
  seedPlayer(sqlite, 'dev-1', 10_000_000); // $100k → Seed (stars 1); armour = 250k × 2 = 500,000
  const r = await buyArmour(db, 'dev-1', 'req-0001-aaaa', NOW);
  expect(r).toMatchObject({ ok: true, duplicate: false, chargedCents: '500000', currentCents: '9500000' });
  const again = await buyArmour(db, 'dev-1', 'req-0001-aaaa', NOW + 500);
  expect(again).toMatchObject({ ok: true, duplicate: true, chargedCents: '0' });
  expect(balance(sqlite, 'dev-1')).toBe(9_500_000);
  const second = await buyArmour(db, 'dev-1', 'req-0002-bbbb', NOW + 1000); // a NEW purchase is a new vest
  expect(second).toMatchObject({ ok: true, duplicate: false, chargedCents: '500000' });
  // −$5,000 again, plus one second of economy-v3 burn folded in by the refresh before pricing.
  expect(balance(sqlite, 'dev-1')).toBeLessThanOrEqual(9_000_000);
  expect(balance(sqlite, 'dev-1')).toBeGreaterThan(9_000_000 - 1_000);
});

it('armour: unaffordable never debits; bad / foreign request ids are refused', async () => {
  const { sqlite, db } = freshDb();
  seedPlayer(sqlite, 'dev-1', 30_000); // $300 < the $500 floor
  expect(await buyArmour(db, 'dev-1', 'req-0003-cccc', NOW)).toEqual({ ok: false, reason: 'unaffordable' });
  expect(balance(sqlite, 'dev-1')).toBe(30_000);
  expect(await buyArmour(db, 'dev-1', 'x', NOW)).toEqual({ ok: false, reason: 'bad-request' });
  seedPlayer(sqlite, 'dev-2', 10_000_000);
  await buyArmour(db, 'dev-2', 'req-0004-dddd', NOW);
  expect(await buyArmour(db, 'dev-1', 'req-0004-dddd', NOW)).toEqual({ ok: false, reason: 'bad-request' }); // dev-2's id
});

it('a purchase that would DOWN-ROUND is refused (no debit) unless the player confirms it (gtasf-euhs0)', async () => {
  const { sqlite, db } = freshDb();
  seedPlayer(sqlite, 'dev-1', 8_140_000); // $81.4k: just over Seed ($75k); pistol capped to 10% = $8,140 → $73.3k = Bootstrapping
  expect(await buyWeapon(db, 'dev-1', 'pistol', NOW)).toEqual({ ok: false, reason: 'down-round', round: 'Bootstrapping', priceCents: '814000' });
  expect(balance(sqlite, 'dev-1')).toBe(8_140_000);
  expect((sqlite.prepare('SELECT COUNT(*) AS n FROM combat_weapons').get() as { n: number }).n).toBe(0);
  const confirmed = await buyWeapon(db, 'dev-1', 'pistol', NOW, { allowDownRound: true });
  expect(confirmed).toMatchObject({ ok: true, owned: false, chargedCents: '814000' });
  expect(balance(sqlite, 'dev-1')).toBe(7_326_000);
});

it('armour: same down-round confirm; a purchase that stays in the round needs none', async () => {
  const { sqlite, db } = freshDb();
  seedPlayer(sqlite, 'dev-1', 7_900_000); // armour at Seed = $5k → $74k < $75k
  expect(await buyArmour(db, 'dev-1', 'req-0005-eeee', NOW)).toMatchObject({ ok: false, reason: 'down-round', round: 'Bootstrapping' });
  expect(balance(sqlite, 'dev-1')).toBe(7_900_000);
  expect(await buyArmour(db, 'dev-1', 'req-0005-eeee', NOW, { allowDownRound: true })).toMatchObject({ ok: true, duplicate: false, chargedCents: '500000' });
  seedPlayer(sqlite, 'dev-2', 8_200_000); // $82k − $5k = $77k: still Seed
  expect(await buyArmour(db, 'dev-2', 'req-0006-ffff', NOW)).toMatchObject({ ok: true, chargedCents: '500000' });
});

it('savedLoadout: ownedWeapons lists only what this device bought, oldest first, and never writes', async () => {
  const { sqlite, db } = freshDb();
  sqlite.prepare('INSERT INTO combat_weapons(device_id,weapon,price_cents,purchased_at) VALUES (?,?,?,?)').run('dev-a', 'rifle', 900, NOW + 2);
  sqlite.prepare('INSERT INTO combat_weapons(device_id,weapon,price_cents,purchased_at) VALUES (?,?,?,?)').run('dev-a', 'smg', 500, NOW + 1);
  sqlite.prepare('INSERT INTO combat_weapons(device_id,weapon,price_cents,purchased_at) VALUES (?,?,?,?)').run('dev-b', 'rifle', 900, NOW);
  const before = sqlite.prepare('SELECT COUNT(*) AS n FROM combat_weapons').get();
  expect(await ownedWeapons(db, 'dev-a')).toEqual(['smg', 'rifle']);
  expect(await ownedWeapons(db, 'dev-c')).toEqual([]);
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM combat_weapons').get()).toEqual(before);
});
