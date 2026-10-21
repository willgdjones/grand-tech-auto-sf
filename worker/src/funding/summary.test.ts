import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { fundingRound } from '@gtasf/shared/funding';
import { fundingSummariesByNickname, fundingDeviceByNickname, FUNDING_SUMMARY_MAX } from './store';

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of ['0010_funding.sql', '0014_funding_bonus.sql', '0018_fund_drops.sql', '0020_funding_credits.sql'])
    sqlite.exec(readFileSync(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8'));
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
  } as unknown as D1Database;
  const now = Date.UTC(2026, 9, 5, 18, 0, 0); // Oct 5 2026, 11:00 SF time.
  const addProfile = (device: string, startup: string, nick: string) =>
    sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(device, `hash-${device}`, startup, nick, now, now);
  const addCredit = (device: string, ref: string, cents: number) =>
    sqlite.prepare('INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(`c-${device}-${ref}`, device, 'sf-tech-week-2026', 'event', ref, 'An event', '2026-10-05', now, cents);
  return { sqlite, db, now, addProfile, addCredit };
}

it('summarises matched peers by nickname with the right total and ladder round', async () => {
  const { db, now, addProfile, addCredit } = setup();
  addProfile('dev-1', 'Fogware', 'Foggy');
  addCredit('dev-1', 'e1', 300_000_000); // $3M -> Seed (threshold 300000000)
  addProfile('dev-2', 'Ringpost', 'Ringo');
  // no credits -> $0, Bootstrapping

  const out = await fundingSummariesByNickname(db, ['Foggy', 'Ringo'], now);
  const byNick = new Map(out.map(p => [p.nickname, p]));

  expect(byNick.get('Foggy')).toMatchObject({ startupName: 'Fogware', totalCents: '300000000', round: fundingRound('300000000') });
  expect(byNick.get('Foggy')!.round.label).toBe('Seed');
  // A named but un-funded peer still gets a plate (startup + Bootstrapping + $0), better than nick-only.
  expect(byNick.get('Ringo')).toMatchObject({ startupName: 'Ringpost', totalCents: '0' });
  expect(byNick.get('Ringo')!.round.stars).toBe(0);
  // Merge-behind contract: no rank/crown/streak is asserted by a batch summary.
  for (const p of out) { expect(p.rank).toBeNull(); expect(p.todayRank).toBeNull(); expect(p.lastAwardAt).toBeNull(); expect(p.streak).toBe(0); }
});

it('omits unknown nicknames and returns [] for an empty/blank batch', async () => {
  const { db, now, addProfile } = setup();
  addProfile('dev-1', 'Fogware', 'Foggy');
  expect(await fundingSummariesByNickname(db, ['Nobody', 'Ghost'], now)).toEqual([]);
  expect(await fundingSummariesByNickname(db, [], now)).toEqual([]);
  expect(await fundingSummariesByNickname(db, [''], now)).toEqual([]); // empty nickname filtered out
});

it('resolves a duplicated nickname to the best-funded profile (deterministic)', async () => {
  const { db, now, addProfile, addCredit } = setup();
  addProfile('dev-a', 'Alpha', 'Twin');
  addCredit('dev-a', 'e1', 50_000_000); // $500k
  addProfile('dev-b', 'Beta', 'Twin');
  addCredit('dev-b', 'e1', 900_000_000); // $9M — the richer twin wins

  const out = await fundingSummariesByNickname(db, ['Twin'], now);
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ nickname: 'Twin', startupName: 'Beta', totalCents: '900000000' });
});

it('bounds the batch and ignores over-long nicknames', async () => {
  const { db, now, addProfile, addCredit } = setup();
  // One real profile past the cap must not be reachable once we overflow the batch with filler.
  addProfile('dev-real', 'RealCo', 'RealNick');
  addCredit('dev-real', 'e1', 100_000_000);
  const filler = Array.from({ length: FUNDING_SUMMARY_MAX }, (_, i) => `filler-${i}`);
  const out = await fundingSummariesByNickname(db, [...filler, 'RealNick'], now);
  // 'RealNick' is the (MAX+1)-th entry, trimmed off by the cap -> not returned.
  expect(out).toEqual([]);
  // An over-long nickname is filtered before the query (never returned, never a SQL hazard).
  expect(await fundingSummariesByNickname(db, ['x'.repeat(65)], now)).toEqual([]);
});

it('fundingDeviceByNickname resolves to the best-funded holder (click-any-player), else null', async () => {
  const { db, now, addProfile, addCredit } = setup();
  addProfile('dev-a', 'Alpha', 'Twin');
  addCredit('dev-a', 'e1', 50_000_000);  // $500k
  addProfile('dev-b', 'Beta', 'Twin');
  addCredit('dev-b', 'e1', 900_000_000); // $9M — richer twin wins the nickname
  addProfile('dev-solo', 'Solo', 'Solo');

  expect(await fundingDeviceByNickname(db, 'Twin', now)).toBe('dev-b'); // best-funded holder
  expect(await fundingDeviceByNickname(db, 'Solo', now)).toBe('dev-solo');
  expect(await fundingDeviceByNickname(db, 'Nobody', now)).toBeNull(); // unknown nickname
  expect(await fundingDeviceByNickname(db, 'x'.repeat(65), now)).toBeNull(); // over-long: filtered, no match
});
