import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it } from 'vitest';
import { beaconLimiterKey, pruneBeaconLimits } from './beaconLimiter';

let sqlite: DatabaseSync, db: D1Database;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0011_referrals.sql', import.meta.url), 'utf8'));
  db = { prepare(sql: string) {
    const statement = sqlite.prepare(sql); let bindings: (string | number | null)[] = [];
    const wrapper = { bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
      async first() { return statement.get(...bindings) ?? null; }, async run() { return { meta: statement.run(...bindings), success: true }; } };
    return wrapper;
  } } as unknown as D1Database;
});
const req = (ip: string) => new Request('https://gtasf.com/api/net/beacon', { headers: { 'cf-connecting-ip': ip } });
const day1 = Date.parse('2026-10-17T03:00:00Z'), laterDay1 = Date.parse('2026-10-17T22:00:00Z'), day2 = Date.parse('2026-10-18T03:00:00Z');

it('keys are stable within a UTC day and unlinkable across days (the day is in the salt)', async () => {
  const a = await beaconLimiterKey('nbeacon:', 'gtasf-net-beacon', req('203.0.113.7'), day1);
  expect(a).toMatch(/^nbeacon:[0-9a-f]{24}$/);
  expect(await beaconLimiterKey('nbeacon:', 'gtasf-net-beacon', req('203.0.113.7'), laterDay1)).toBe(a);
  expect(await beaconLimiterKey('nbeacon:', 'gtasf-net-beacon', req('203.0.113.7'), day2)).not.toBe(a);
  expect(await beaconLimiterKey('nbeacon:', 'gtasf-net-beacon', req('203.0.113.8'), day1)).not.toBe(a);
  expect(await beaconLimiterKey('lbeacon:', 'gtasf-loading-beacon', req('203.0.113.7'), day1)).not.toBe(a.replace('nbeacon:', 'lbeacon:'));
  // With the secret (env.IP_HASH_SECRET) the key differs, so the public label + day alone can't rebuild it.
  expect(await beaconLimiterKey('nbeacon:', 'gtasf-net-beacon', req('203.0.113.7'), day1, 's3cret')).not.toBe(a);
  expect(await beaconLimiterKey('nbeacon:', 'gtasf-net-beacon', req('203.0.113.7'), laterDay1, 's3cret')).toBe(await beaconLimiterKey('nbeacon:', 'gtasf-net-beacon', req('203.0.113.7'), day1, 's3cret'));
});

it('prunes IP-limiter rows (beacons, recovery, email, voice, organiser) idle for over a day; device/email limiters and fresh rows stay', async () => {
  const insert = sqlite.prepare('INSERT INTO referral_limits(key,window_at,count) VALUES(?,?,1)');
  for (const [key, at] of [['lbeacon:old', day1 - 2 * 86_400_000], ['nbeacon:old', day1 - 90_000_000], ['nbeacon:fresh', day1 - 60_000],
    ['visit:device-1', day1 - 5 * 86_400_000], ['email-ip:x', day1 - 5 * 86_400_000], ['lbeacon', day1 - 5 * 86_400_000], ['nbeacon;z', day1 - 5 * 86_400_000],
    ['recover-ip:old', day1 - 2 * 86_400_000], ['voice-ice-ip:fresh', day1 - 600_000], ['email-addr:h', day1 - 5 * 86_400_000], ['otrack:old', day1 - 3 * 86_400_000],
    ['submit:ip:203.0.113.7', day1 - 60_000], ['submit-ip:fresh', day1 - 60_000], ['submit:global', day1 - 60_000]] as const)
    insert.run(key, at);
  await pruneBeaconLimits(db, day1);
  expect((sqlite.prepare('SELECT key FROM referral_limits ORDER BY key').all() as { key: string }[]).map(r => r.key))
    .toEqual(['email-addr:h', 'lbeacon', 'nbeacon:fresh', 'nbeacon;z', 'submit-ip:fresh', 'submit:global', 'visit:device-1', 'voice-ice-ip:fresh']); // legacy raw 'submit:ip:' rows go regardless of age
});
