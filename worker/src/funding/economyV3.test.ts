import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ECONOMY_RESET_EPOCH, FUNDING_SEASON, FUNDING_ROUNDS_V2, ECON_V3_ROUNDS, rescaleV2ToV3Cents } from '@gtasf/shared/funding';
import { getFundingProfile } from './store';
import { getCapTable } from './credits';
import { rescaleDeviceToEconomyV3, enableEconomyV3Migration, resetDeviceToEconomyV3 } from './economyV3';

/**
 * The economy-v3 enable migration (PLAN-economy-v3 decision 7): rescaleDeviceToEconomyV3 scales every
 * earned-funding ledger row by the player's uniform factor so the v2 total becomes the proportional v3
 * total. This verifies the properties that make it safe to run over live money: the star is preserved
 * (nobody jumps to max), each backer keeps their share, the cap table still reconciles, rows stay > 0,
 * and it is idempotent. This is a flag-gated routine — these tests are its only caller.
 */
const v2Star = (c: bigint) => [...FUNDING_ROUNDS_V2].reverse().find(r => c >= BigInt(r.thresholdCents))!.stars;
const v3Star = (c: bigint) => [...ECON_V3_ROUNDS].reverse().find(r => c >= BigInt(r.thresholdCents))!.stars;

const MIGRATIONS = ['0010_funding.sql', '0014_funding_bonus.sql', '0018_fund_drops.sql', '0020_funding_credits.sql', '0021_referral_reward_amount.sql', '0023_account_recovery.sql', '0025_friends.sql', '0028_economy_v3.sql', '0030_robotaxi_fares.sql', '0031_economy_reset_epoch.sql'];
const NOW = Date.UTC(2026, 9, 5, 18, 0, 0), DAY = '2026-10-05';
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
      try { const out = statements.map(s => s.run()); sqlite.exec('COMMIT'); return await Promise.all(out); } // run() executes synchronously, like D1's server-side batch
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as D1Database;
  return { sqlite, db };
}
function setup() {
  const { sqlite, db } = freshDb();
  const now = NOW;
  const day = DAY;
  sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run('dev-1', 'hash-dev-1', 'Fogware', 'Foggy', now, now);
  sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run('dev-friend', 'hash-friend', 'Palsoft', 'Pal', now, now);

  // A realistic v2 mix across all four ledgers (= $11.05M, a Seed-band player).
  const amounts = { award: 50_000_000, creditEvent: 30_000_000, celebrity: 500_000_000, warmIntro: 500_000_000, vcDrop: 25_000_000 };
  sqlite.prepare('INSERT INTO funding_awards(id,device_id,season,event_id,event_title,day,entered_at,awarded_at,amount_cents,quote_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('aw-1', 'dev-1', FUNDING_SEASON, 'evt-v1', 'Investor Happy Hour', day, now, now, amounts.award, '{"streakCount":1}');
  sqlite.prepare('INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('cr-evt', 'dev-1', FUNDING_SEASON, 'event', 'evt-v2', 'Hack Night', day, now, amounts.creditEvent);
  sqlite.prepare('INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('cr-celeb', 'dev-1', FUNDING_SEASON, 'celebrity', 'ron-conway', 'Ron Conway', day, now, amounts.celebrity);
  sqlite.prepare('INSERT INTO funding_bonuses(id,device_id,friend_device_id,season,kind,day,awarded_at,amount_cents) VALUES(?,?,?,?,?,?,?,?)')
    .run('bn-1', 'dev-1', 'dev-friend', FUNDING_SEASON, 'warm-intro', day, now, amounts.warmIntro);
  sqlite.prepare('INSERT INTO fund_drop_claims(id,device_id,season,drop_id,slot,fund_name,sponsored,position,amount_cents,claimed_at,day) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('fd-1', 'dev-1', FUNDING_SEASON, 'drop-7', 7, 'Softbank Vision Fund XLII', 0, 3, amounts.vcDrop, now, day);

  const oldTotal = BigInt(Object.values(amounts).reduce((a, b) => a + b, 0));
  return { sqlite, db, now, oldTotal, amounts };
}

it('rescales every ledger to v3 scale, preserves the star, and keeps the cap table reconciling', async () => {
  const { db, now, oldTotal } = setup();

  const res = await rescaleDeviceToEconomyV3(db, 'dev-1', now);
  expect(res.migrated).toBe(true);
  expect(res.rowsScaled).toBe(5); // 1 award + 2 credits + 1 bonus + 1 drop

  const newTotal = BigInt(res.lifetimeCents);
  expect(newTotal).toBeLessThan(oldTotal); // rescaled DOWN to the v3 scale ($11M → thousands)
  // newTotal = Σ floor(row·target/old) across 5 rows, so it sits within a few cents below the exact target.
  const target = rescaleV2ToV3Cents(oldTotal);
  expect(newTotal <= target && target - newTotal <= 10n).toBe(true);
  expect(v3Star(newTotal)).toBe(v2Star(oldTotal)); // nobody jumps to max — same star after

  // Reconciliation: lifetime is still SUM(funding_earnings), so the profile total and the cap-table
  // groups still sum to the same number (both now at v3 scale).
  const profile = await getFundingProfile(db, 'dev-1', now);
  const cap = await getCapTable(db, 'dev-1', now);
  const capGroupSum = cap.groups.reduce((s, g) => s + BigInt(g.totalCents), 0n);
  expect(profile.totalCents).toBe(newTotal.toString());
  expect(cap.totalCents).toBe(newTotal.toString());
  expect(capGroupSum).toBe(newTotal);
});

it('preserves each backer’s share and keeps every row > 0', async () => {
  const { db, now, oldTotal, amounts } = setup();
  await rescaleDeviceToEconomyV3(db, 'dev-1', now);
  const cap = await getCapTable(db, 'dev-1', now);
  const newTotal = BigInt(cap.totalCents);
  const share = (c: bigint) => Number(c) / Number(newTotal);
  const bySource = new Map(cap.groups.map(g => [g.source, BigInt(g.totalCents)]));
  // celebrity was 500M/1105M ≈ 45.2% of the old total; its v3 share must match within rounding.
  expect(Math.abs(share(bySource.get('celebrity')!) - amounts.celebrity / Number(oldTotal))).toBeLessThan(0.005);
  // event folds the $500k award + $300k credit; share preserved too.
  expect(Math.abs(share(bySource.get('event')!) - (amounts.award + amounts.creditEvent) / Number(oldTotal))).toBeLessThan(0.005);
  for (const [, c] of bySource) expect(c > 0n).toBe(true); // amount CHECK is > 0 — nothing rounded to zero
});

it('is idempotent — a second run does not double-rescale', async () => {
  const { db, now } = setup();
  const first = await rescaleDeviceToEconomyV3(db, 'dev-1', now);
  const second = await rescaleDeviceToEconomyV3(db, 'dev-1', now + 60_000);
  expect(second.migrated).toBe(false); // burn stamp already set → skipped
  const profile = await getFundingProfile(db, 'dev-1', now);
  expect(profile.totalCents).toBe(first.lifetimeCents); // ledgers unchanged by the second call
});

it('stamps a never-funded player at zero without touching empty ledgers', async () => {
  const { db, now } = setup();
  const res = await rescaleDeviceToEconomyV3(db, 'dev-friend', now); // no ledger rows
  expect(res).toMatchObject({ migrated: true, lifetimeCents: '0', rowsScaled: 0 });
  const stamp = await db.prepare('SELECT economy_v3_burn_updated_at AS at, economy_v3_current_cents AS cur FROM funding_profiles WHERE device_id=?')
    .bind('dev-friend').first<{ at: number; cur: number }>();
  expect(stamp).toMatchObject({ at: now, cur: 0 }); // stamped so burn starts now; current 0
});

it('enableEconomyV3Migration resets every player once and is idempotent', async () => {
  const { db, now } = setup(); // dev-1 (5 ledger rows) + dev-friend (none)
  const first = await enableEconomyV3Migration(db, now);
  expect(first).toMatchObject({ reset: 2, skipped: 0 }); // both devices reset this pass
  const dev1 = await db.prepare('SELECT economy_v3_burn_updated_at AS at, economy_v3_current_cents AS cur FROM funding_profiles WHERE device_id=?').bind('dev-1').first<{ at: number; cur: number }>();
  expect(dev1).toMatchObject({ at: now, cur: 0 }); // stamped + funding zeroed
  // Re-running must not double-reset (idempotent via the burn stamp).
  const second = await enableEconomyV3Migration(db, now + 60_000);
  expect(second).toMatchObject({ reset: 0, skipped: 2 });
});

it('economy reset wipes an existing v2 player to $0/Bootstrapping once, keeping name/looks/friends (founder 07:5x)', async () => {
  const { db, sqlite } = setup(); // dev-1 has 5 funding ledger rows across all tables + name Fogware/Foggy
  // dev-1 also has a friendship and a wardrobe — both in tables the reset must NOT touch.
  sqlite.prepare('INSERT INTO friendships(a,b,created_at) VALUES(?,?,?)').run('dev-1', 'dev-friend', NOW);
  sqlite.prepare('INSERT INTO profile_cosmetics(device_id,outfit,updated_at) VALUES(?,?,?)').run('dev-1', '{"hat":"beanie"}', NOW);
  const sum = () => Number((sqlite.prepare('SELECT COALESCE(SUM(amount_cents),0) AS s FROM funding_earnings WHERE device_id=? AND season=?').get('dev-1', FUNDING_SEASON) as { s: number }).s);
  const hasFriend = () => Boolean(sqlite.prepare('SELECT 1 FROM friendships WHERE a=? AND b=?').get('dev-1', 'dev-friend'));
  expect(sum()).toBeGreaterThan(0); // had funding across the ledgers

  const r = await resetDeviceToEconomyV3(db, 'dev-1', NOW);
  expect(r.reset).toBe(true);
  expect(sum()).toBe(0);                    // every ledger wiped -> $0 total/lifetime, events can pay again
  expect(v3Star(0n)).toBe(0);               // $0 is Bootstrapping ★0
  const prof = sqlite.prepare('SELECT startup_name AS s, nickname AS n, economy_v3_current_cents AS c, economy_v3_lifetime_cents AS l, economy_v3_burn_updated_at AS at FROM funding_profiles WHERE device_id=?').get('dev-1');
  expect(prof).toMatchObject({ s: 'Fogware', n: 'Foggy', c: 0, l: 0, at: NOW }); // identity kept; snapshot zeroed + stamped
  expect(hasFriend()).toBe(true);           // friend kept
  expect((sqlite.prepare('SELECT outfit AS o FROM profile_cosmetics WHERE device_id=?').get('dev-1') as { o: string }).o).toBe('{"hat":"beanie"}'); // looks kept

  const again = await resetDeviceToEconomyV3(db, 'dev-1', NOW + 60_000); // never resets twice
  expect(again.reset).toBe(false);
  expect(sum()).toBe(0);
  expect(hasFriend()).toBe(true);
});

it('a band-edge player with many small rows lands EXACTLY on the target — no star drift (uvy6)', async () => {
  // These v2 totals rescale onto each exact v3 band edge (Seed/Series-A/Series-B/Series-C/Series-D=★1..★5).
  // Split each into many varied rows (all under the amount CHECK) so per-row floor truncation WOULD push
  // newTotal below the edge (−1 star); the remainder-on-the-largest-row correction must land newTotal
  // EXACTLY on rescaleV2ToV3Cents(T).
  const v3Edges = new Set(ECON_V3_ROUNDS.map(r => r.thresholdCents));
  const edges: [bigint, number][] = [
    [50_000_000n, 1], [300_000_000n, 2], [1_500_000_000n, 3], [100_000_000_000n, 4], [1_000_000_000_000n, 5],
  ];
  let anyDrift = false;
  for (const [T, expectedStar] of edges) {
    const target = rescaleV2ToV3Cents(T);
    expect(v3Edges.has(target.toString())).toBe(true); // sanity: T really sits on a v3 band edge

    // Varied split: N rows near base = T/N (± a little), so each stays under funding_credits' 10B CHECK
    // and Σ floor(amt·target/T) truncates below target.
    const N = T <= 2_000_000_000n ? 40 : Number(T / 8_000_000_000n) + 40;
    const base = T / BigInt(N);
    const amounts: bigint[] = [];
    let placed = 0n;
    for (let i = 0; i < N - 1; i++) { const a = base + BigInt((i * 7) % 11) - 5n; amounts.push(a); placed += a; }
    amounts.push(T - placed); // balances the sum back to exactly T; still ≈ base, under the CHECK

    // The UNFIXED per-row floor would land at or below the edge (strictly below for at least one edge).
    const preFix = amounts.reduce((s, a) => s + ((a * target / T) < 1n ? 1n : a * target / T), 0n);
    expect(preFix <= target).toBe(true);
    if (preFix < target) anyDrift = true;

    const { sqlite, db } = freshDb();
    sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run('edge', 'h-edge', 'EdgeCo', 'Edgy', NOW, NOW);
    amounts.forEach((a, i) => sqlite.prepare('INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(`c${i}`, 'edge', FUNDING_SEASON, 'event', `e${i}`, 'E', DAY, NOW, Number(a)));

    const res = await rescaleDeviceToEconomyV3(db, 'edge', NOW);
    const newTotal = BigInt(res.lifetimeCents);
    expect(newTotal).toBe(target);               // EXACT, not target − (#rows cents)
    expect(v3Star(newTotal)).toBe(expectedStar); // on the edge, not one star below
    const cap = await getCapTable(db, 'edge', NOW);
    expect(cap.totalCents).toBe(target.toString()); // cap table still reconciles at the corrected total
  }
  expect(anyDrift).toBe(true); // the test genuinely exercises the drift the fix corrects
});

it('economy reset is atomic: a second concurrent first load cannot wipe an award booked after the first reset (o1pf.2)', async () => {
  const { db, sqlite } = setup();
  const [a, b] = await Promise.all([resetDeviceToEconomyV3(db, 'dev-1', NOW), resetDeviceToEconomyV3(db, 'dev-1', NOW)]);
  expect([a.reset, b.reset].filter(Boolean)).toHaveLength(1);
  sqlite.prepare('INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('fresh', 'dev-1', FUNDING_SEASON, 'event', 'ev-new', 'New', DAY, NOW + 1, 90_000);
  expect((await resetDeviceToEconomyV3(db, 'dev-1', NOW + 2)).reset).toBe(false);
  expect(sqlite.prepare("SELECT 1 FROM funding_credits WHERE id='fresh'").get()).toBeTruthy();
});

it('a bumped epoch (now 3, founder 14:0x): a profile reset under an earlier epoch resets exactly once more, keeping identity, giving free rides back', async () => {
  const { db, sqlite } = setup();
  // Simulate the morning reset: stamped burn marker, still on the old epoch, two free rides used.
  sqlite.prepare("UPDATE funding_profiles SET economy_v3_burn_updated_at=?, economy_reset_epoch=2, free_rides_used=2 WHERE device_id='dev-1'").run(NOW);
  sqlite.prepare('INSERT INTO friendships(a,b,created_at) VALUES(?,?,?)').run('dev-1', 'dev-friend', NOW);
  const sum = () => Number((sqlite.prepare('SELECT COALESCE(SUM(amount_cents),0) AS s FROM funding_earnings WHERE device_id=? AND season=?').get('dev-1', FUNDING_SEASON) as { s: number }).s);
  expect(sum()).toBeGreaterThan(0);
  const [a, b] = await Promise.all([resetDeviceToEconomyV3(db, 'dev-1', NOW + 1), resetDeviceToEconomyV3(db, 'dev-1', NOW + 1)]);
  expect([a.reset, b.reset].filter(Boolean)).toHaveLength(1);         // concurrent first loads: one reset
  expect(sum()).toBe(0);
  const prof = sqlite.prepare("SELECT startup_name s, nickname n, economy_reset_epoch e, free_rides_used f FROM funding_profiles WHERE device_id='dev-1'").get();
  expect(prof).toMatchObject({ s: 'Fogware', n: 'Foggy', e: ECONOMY_RESET_EPOCH, f: 0 });
  expect(sqlite.prepare("SELECT 1 FROM friendships WHERE a='dev-1'").get()).toBeTruthy();
  // A cheque earned after the epoch-2 reset is never wiped by a later read.
  sqlite.prepare('INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('after', 'dev-1', FUNDING_SEASON, 'event', 'ev-after', 'After', DAY, NOW + 2, 90_000);
  expect((await resetDeviceToEconomyV3(db, 'dev-1', NOW + 3)).reset).toBe(false);
  expect(sum()).toBe(90_000);
});
