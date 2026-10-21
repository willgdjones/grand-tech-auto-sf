// Real-SQL harness for the bounty tests (node:sqlite behind a minimal D1 shim).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { ECONOMY_RESET_EPOCH, FUNDING_SEASON } from '@gtasf/shared/funding';

export const MIGRATIONS = ['0010_funding.sql', '0014_funding_bonus.sql', '0018_fund_drops.sql', '0020_funding_credits.sql',
  '0021_referral_reward_amount.sql', '0028_economy_v3.sql', '0030_robotaxi_fares.sql', '0031_economy_reset_epoch.sql',
  '0025_friends.sql', '0048_bounty_claims.sql', '0050_pvp_kill_log.sql'];
export const NOW = Date.UTC(2026, 9, 14, 18, 0, 0);
export const START_CENTS = 5_000_000; // killers sit below Seed: no burn, exact balances

export function freshDb(): { sqlite: DatabaseSync; db: D1Database } {
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
export function seedPlayer(sqlite: DatabaseSync, deviceId: string, currentCents: number): void {
  sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run(deviceId, `hash-${deviceId}`, `Startup ${deviceId}`, deviceId, NOW, NOW);
  sqlite.prepare('INSERT INTO funding_awards(id,device_id,season,event_id,event_title,day,entered_at,awarded_at,amount_cents,quote_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(`aw-${deviceId}`, deviceId, FUNDING_SEASON, `evt-${deviceId}`, 'Seed', '2026-10-14', NOW, NOW, currentCents, '{}');
  // A real, already-migrated profile: stamped at the current reset epoch, so the credit path's lazy one-time economy
  // reset (economyV3.ts resetDeviceToEconomyV3) doesn't wipe the seeded ledger mid-test.
  sqlite.prepare('UPDATE funding_profiles SET economy_v3_current_cents=?, economy_v3_lifetime_cents=?, economy_v3_burn_updated_at=?, economy_reset_epoch=? WHERE device_id=?')
    .run(currentCents, currentCents, NOW, ECONOMY_RESET_EPOCH, deviceId);
}
export const balance = (sqlite: DatabaseSync, d: string) => (sqlite.prepare('SELECT economy_v3_current_cents AS c FROM funding_profiles WHERE device_id=?').get(d) as { c: number }).c;
