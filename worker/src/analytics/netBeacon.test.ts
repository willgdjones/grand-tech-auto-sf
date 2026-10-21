import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@gtasf/shared/flags', () => ({ flags: { netBeacon: true } }));
import { closeCodeLabel, gapBucket, handleNetBeacon, upBucket } from './netBeacon';

let sqlite: DatabaseSync, env: { DB: D1Database };
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  for (const file of ['0011_referrals.sql', '0052_net_beacons.sql'])
    sqlite.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
  env = { DB: { prepare(sql: string) {
    const statement = sqlite.prepare(sql); let bindings: (string | number | null)[] = [];
    const wrapper = { bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
      async first() { return statement.get(...bindings) ?? null; }, async run() { return { meta: statement.run(...bindings), success: true }; } };
    return wrapper;
  } } as unknown as D1Database };
});
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1';
const post = (body: unknown, ua = UA, ip = '203.0.113.7') => new Request('https://gtasf.com/api/net/beacon', { method: 'POST', body: JSON.stringify(body),
  headers: { 'content-type': 'text/plain', 'user-agent': ua, 'cf-connecting-ip': ip } });
const rows = () => sqlite.prepare('SELECT kind,code,bucket,device,count FROM net_beacon_counts ORDER BY kind,code,bucket,device').all();
const now = Date.parse('2026-10-17T03:30:00Z');

it('buckets session age, rejoin gap and close codes', () => {
  expect([0, 59_999, 60_000, 400_000, 1_000_000, 2_000_000, 4_000_000, -1].map(upBucket))
    .toEqual(['0-1m', '0-1m', '1-5m', '5-15m', '15-30m', '30-60m', '60m+', 'unknown']);
  expect([0, 999, 1_500, 4_000, 9_000, 20_000, 60_000].map(gapBucket)).toEqual(['0-1s', '0-1s', '1-2s', '2-5s', '5-10s', '10-30s', '30s+']);
  expect([1006, 1001, 4000, 999, 5000, 1006.5, '1006', undefined].map(closeCodeLabel)).toEqual(['1006', '1001', '4000', 'other', 'other', 'other', 'other', 'other']);
});

it('counts sessions, drops by code and session age, and rejoins by gap — no identifiers stored', async () => {
  for (const body of [{ kind: 'session', ms: 0, mobile: true }, { kind: 'session', ms: 0, mobile: false },
    { kind: 'drop', code: 1006, ms: 400_000, mobile: true }, { kind: 'drop', code: 1006, ms: 420_000, mobile: true },
    { kind: 'rejoin', ms: 2_300, mobile: true }, { kind: 'drop', code: 77, ms: 10, mobile: false }])
    expect((await handleNetBeacon(post(body), env, now))!.status).toBe(204);
  expect(rows()).toEqual([
    { kind: 'drop', code: '1006', bucket: '5-15m', device: 'mobile', count: 2 },
    { kind: 'drop', code: 'other', bucket: '0-1m', device: 'desktop', count: 1 },
    { kind: 'rejoin', code: '-', bucket: '2-5s', device: 'mobile', count: 1 },
    { kind: 'session', code: '-', bucket: '-', device: 'desktop', count: 1 },
    { kind: 'session', code: '-', bucket: '-', device: 'mobile', count: 1 },
  ]);
  expect(sqlite.prepare('SELECT day FROM net_beacon_counts LIMIT 1').get()).toEqual({ day: '2026-10-17' });
  const columns = (sqlite.prepare('PRAGMA table_info(net_beacon_counts)').all() as { name: string }[]).map(c => c.name);
  expect(columns).toEqual(['day', 'kind', 'code', 'bucket', 'device', 'count']); // nothing that identifies a player
});

it('rejects malformed input, cross-origin posts and other methods; ignores bots; caps one client per minute', async () => {
  for (const body of [{ kind: 'boom', ms: 0, mobile: true }, { kind: 'drop', code: 1006, ms: '1', mobile: true }, { kind: 'session', ms: 0 }])
    expect((await handleNetBeacon(post(body), env, now))!.status).toBe(400);
  const cross = new Request('https://gtasf.com/api/net/beacon', { method: 'POST', body: '{}', headers: { origin: 'https://evil.example' } });
  expect((await handleNetBeacon(cross, env, now))!.status).toBe(403);
  expect((await handleNetBeacon(new Request('https://gtasf.com/api/net/beacon'), env, now))!.status).toBe(405);
  expect((await handleNetBeacon(post({ kind: 'session', ms: 0, mobile: false }, 'HeadlessChrome'), env, now))!.status).toBe(204);
  expect(rows()).toEqual([]);
  for (let i = 0; i < 70; i++) await handleNetBeacon(post({ kind: 'drop', code: 1006, ms: 1, mobile: false }, UA, '198.51.100.9'), env, now);
  expect(rows()).toEqual([{ kind: 'drop', code: '1006', bucket: '0-1m', device: 'desktop', count: 60 }]);
  expect(await handleNetBeacon(new Request('https://gtasf.com/api/other'), env, now)).toBeNull();
});
