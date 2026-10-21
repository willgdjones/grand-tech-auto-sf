import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ensureFundingDevice } from './identity';

// Automated test visits (gtasf_bot=1 cookie) are marked is_bot=1 so player counts can exclude them (migration 0033).
const MIGRATIONS = ['0010_funding.sql', '0024_onboarding.sql', '0028_economy_v3.sql', '0030_robotaxi_fares.sql', '0031_economy_reset_epoch.sql', '0033_funding_profile_bot.sql'];
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
const isBot = (sqlite: DatabaseSync, id: string) => (sqlite.prepare('SELECT is_bot b FROM funding_profiles WHERE device_id=?').get(id) as { b: number | null }).b;

it('a new device from an automated visit is marked is_bot=1; a normal visit is not', async () => {
  const { sqlite, db } = freshDb();
  const bot = await ensureFundingDevice(new Request('https://gtasf.com/api/funding/session', { headers: { cookie: 'gtasf_bot=1' } }), db, 1);
  const human = await ensureFundingDevice(new Request('https://gtasf.com/api/funding/session'), db, 1);
  expect(isBot(sqlite, bot.deviceId)).toBe(1);
  expect(isBot(sqlite, human.deviceId)).toBeNull();
});

it('an existing device revisited by automation is marked once', async () => {
  const { sqlite, db } = freshDb();
  const first = await ensureFundingDevice(new Request('https://gtasf.com/x'), db, 1);
  const token = first.cookie!.split(';')[0]!;
  await ensureFundingDevice(new Request('https://gtasf.com/x', { headers: { cookie: `${token}; gtasf_bot=1` } }), db, 2);
  expect(isBot(sqlite, first.deviceId)).toBe(1);
});
