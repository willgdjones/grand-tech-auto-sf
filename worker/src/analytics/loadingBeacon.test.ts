import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@gtasf/shared/flags', () => ({ flags: { loadingBeacon: true, loadingBeaconClass: true } }));
import { elapsedBucket, handleLoadingBeacon, loadingUaClass } from './loadingBeacon';

let sqlite: DatabaseSync, env: { DB: D1Database };
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  for (const file of ['0011_referrals.sql', '0037_loading_beacons.sql', '0053_loading_beacon_class.sql'])
    sqlite.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
  env = { DB: { prepare(sql: string) {
    const statement = sqlite.prepare(sql); let bindings: (string | number | null)[] = [];
    const wrapper = { bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
      async first() { return statement.get(...bindings) ?? null; }, async run() { return { meta: statement.run(...bindings), success: true }; } };
    return wrapper;
  } } as unknown as D1Database };
});
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1';
const post = (body: unknown, ua = UA) => new Request('https://gtasf.com/api/loading/beacon', { method: 'POST', body: JSON.stringify(body),
  headers: { 'content-type': 'text/plain', 'user-agent': ua, 'cf-connecting-ip': '203.0.113.7' } });
const rows = () => sqlite.prepare('SELECT kind,stage,bucket,device,count FROM loading_beacon_counts ORDER BY kind,bucket').all();
const now = Date.parse('2026-10-06T16:30:00Z');

it('buckets elapsed time', () => {
  expect([0, 2999, 3000, 9_999, 15_000, 39_999, 60_000, 200_000, -1].map(elapsedBucket))
    .toEqual(['0-3s', '0-3s', '3-6s', '6-10s', '10-20s', '20-40s', '40-90s', '90s+', 'unknown']);
});

it('counts start / ready / abandon per stage, bucket and device without storing any identifiers', async () => {
  for (const body of [{ kind: 'start', stage: 'boot', elapsedMs: 0, mobile: true }, { kind: 'start', stage: 'boot', elapsedMs: 0, mobile: true },
    { kind: 'abandon', stage: 'download', elapsedMs: 12_400, mobile: true }, { kind: 'ready', stage: 'ready', elapsedMs: 21_000, mobile: false }])
    expect((await handleLoadingBeacon(post(body), env, now))!.status).toBe(204);
  expect(rows()).toEqual([
    { kind: 'abandon', stage: 'download', bucket: '10-20s', device: 'mobile', count: 1 },
    { kind: 'ready', stage: 'ready', bucket: '20-40s', device: 'desktop', count: 1 },
    { kind: 'start', stage: 'boot', bucket: '0-3s', device: 'mobile', count: 2 },
  ]);
  expect(sqlite.prepare('SELECT day FROM loading_beacon_counts LIMIT 1').get()).toEqual({ day: '2026-10-06' });
});

it('rejects malformed input and ignores bots', async () => {
  for (const body of [{ kind: 'boom', stage: 'boot', elapsedMs: 0, mobile: true }, { kind: 'start', stage: 'nope', elapsedMs: 0, mobile: true },
    { kind: 'start', stage: 'boot', elapsedMs: '1', mobile: true }])
    expect((await handleLoadingBeacon(post(body), env, now))!.status).toBe(400);
  expect((await handleLoadingBeacon(post({ kind: 'start', stage: 'boot', elapsedMs: 0, mobile: false }, 'HeadlessChrome'), env, now))!.status).toBe(204);
  expect(rows()).toEqual([]);
  expect(await handleLoadingBeacon(new Request('https://gtasf.com/api/other'), env, now)).toBeNull();
});

it('classifies the client coarsely: link unfurlers BOT_UA misses, app WebViews, ordinary browsers (loadingBeaconClass)', () => {
  expect(loadingUaClass('WhatsApp/2.23.20.0 A')).toBe('preview');
  expect(loadingUaClass('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 (Applebot/0.1)')).toBe('preview');
  expect(loadingUaClass('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0')).toBe('inapp');
  expect(loadingUaClass('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/430.0]')).toBe('inapp');
  expect(loadingUaClass('Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36')).toBe('inapp');
  expect(loadingUaClass(UA)).toBe('browser');
  expect(loadingUaClass('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36')).toBe('browser');
});
it('also counts by ua class and page-ever-visible, without storing the user agent (loadingBeaconClass)', async () => {
  const classRows = () => sqlite.prepare('SELECT kind,device,ua,seen,count FROM loading_beacon_class_counts ORDER BY kind,ua,seen').all();
  await handleLoadingBeacon(post({ kind: 'start', stage: 'boot', elapsedMs: 900, mobile: true, seen: false }, 'WhatsApp/2.23.20.0 A'), env, now, () => 1);
  await handleLoadingBeacon(post({ kind: 'abandon', stage: 'boot', elapsedMs: 1900, mobile: true, seen: false }, 'WhatsApp/2.23.20.0 A'), env, now, () => 1);
  await handleLoadingBeacon(post({ kind: 'start', stage: 'boot', elapsedMs: 800, mobile: true, seen: true }), env, now, () => 1);
  await handleLoadingBeacon(post({ kind: 'start', stage: 'boot', elapsedMs: 800, mobile: true }), env, now, () => 1); // old client: no 'seen'
  expect(classRows()).toEqual([
    { kind: 'abandon', device: 'mobile', ua: 'preview', seen: 0, count: 1 },
    { kind: 'start', device: 'mobile', ua: 'browser', seen: 1, count: 2 },
    { kind: 'start', device: 'mobile', ua: 'preview', seen: 0, count: 1 },
  ]);
  expect(rows().reduce((n, r) => n + Number((r as { count: number }).count), 0)).toBe(4); // the 0037 counters are unchanged
  expect(JSON.stringify(sqlite.prepare('SELECT * FROM loading_beacon_class_counts').all())).not.toMatch(/WhatsApp|iPhone|Mozilla/);
});
