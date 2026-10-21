import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { REFERRAL_MILESTONES, REFERRAL_STARTER_CENTS, WARM_INTRO_CENTS, recordWarmIntro } from './bonus';
import { REFERRAL_QUALIFIED_PLAY_MS } from '@gtasf/shared/funding';
import { getCapTable } from './credits';
import { getFundingProfile } from './store';

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  // Referral graph + funding ledgers. 0018 before 0020 (its view unions fund_drop_claims); 0021 relaxes
  // the funding_bonuses amount CHECK for the $5M warm intro.
  for (const m of ['0010_funding.sql', '0011_referrals.sql', '0012_referral_ledger.sql', '0014_funding_bonus.sql',
    '0016_referral_claims.sql', '0018_fund_drops.sql', '0020_funding_credits.sql', '0021_referral_reward_amount.sql'])
    sqlite.exec(readFileSync(new URL(`../../migrations/${m}`, import.meta.url), 'utf8'));
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
    async batch(statements: { run(): Promise<unknown> }[]) { return Promise.all(statements.map(s => s.run())); },
  } as unknown as D1Database;
  const now = Date.UTC(2026, 9, 5, 18, 0, 0);
  function addPlayer(id: string, nick: string): void {
    sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(id, `hash-${id}`, `${nick} Labs`, nick, now, now);
    sqlite.prepare('INSERT INTO referral_accounts(id,code,created_at) VALUES(?,?,?)').run(id, `code-${id}`, now);
    sqlite.prepare('INSERT INTO referral_devices(device_id,account_id,first_seen_at) VALUES(?,?,?)').run(id, id, now);
  }
  function refer(friend: string, nick: string, referrer: string, playedMs = REFERRAL_QUALIFIED_PLAY_MS): void {
    addPlayer(friend, nick);
    // Joined long enough ago to clear the joined_at<=now-threshold qualification gate.
    sqlite.prepare('INSERT INTO referral_players(buyer_device_id,referrer_id,joined_at,played_ms) VALUES(?,?,?,?)')
      .run(friend, referrer, now - REFERRAL_QUALIFIED_PLAY_MS, playedMs);
  }
  return { sqlite, db, now, addPlayer, refer };
}

it('smoke: a qualified friend banks a $5M warm intro and the new player a starter, once ever', async () => {
  const { sqlite, db, now, addPlayer, refer } = setup();
  try {
    addPlayer('ref-1', 'Ada');
    refer('friend-1', 'Grace', 'ref-1');

    const first = await recordWarmIntro(db, 'friend-1', now);
    expect(first.credited).toBe(true);
    // Referrer banks $5M; the new player banks the $1M welcome starter.
    expect((await getFundingProfile(db, 'ref-1', now)).totalCents).toBe(String(WARM_INTRO_CENTS));
    expect((await getFundingProfile(db, 'friend-1', now)).totalCents).toBe(String(REFERRAL_STARTER_CENTS));

    // The cap table names the warm intro after the friend, and the starter is a warm-intro source too.
    const refCap = await getCapTable(db, 'ref-1', now);
    const refWarm = refCap.groups.find(g => g.source === 'warm-intro')!;
    expect(refWarm.totalCents).toBe(String(WARM_INTRO_CENTS));
    expect(refWarm.entries[0]!.label).toBe('Warm intro: Grace');
    const friendCap = await getCapTable(db, 'friend-1', now);
    expect(friendCap.groups.find(g => g.source === 'warm-intro')!.entries[0]!.label).toBe('Welcome cheque — joined via a friend');

    // Idempotent: a second qualification does not pay the referrer or the friend twice.
    expect((await recordWarmIntro(db, 'friend-1', now + 1000)).credited).toBe(false);
    expect((await getFundingProfile(db, 'ref-1', now)).totalCents).toBe(String(WARM_INTRO_CENTS));
    expect((await getFundingProfile(db, 'friend-1', now)).totalCents).toBe(String(REFERRAL_STARTER_CENTS));
  } finally { sqlite.close(); }
});

it('still banks the $1M starter when the referred friend is unnamed at the play gate (gtasf-q7x6)', async () => {
  const { sqlite, db, now, addPlayer } = setup();
  try {
    addPlayer('ref-2', 'Lin');
    // A friend who skipped identity (onboarding allows skip-and-play) and played the 2-min gate unnamed.
    sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run('friend-unnamed', 'hash-friend-unnamed', '', '', now, now);
    sqlite.prepare('INSERT INTO referral_accounts(id,code,created_at) VALUES(?,?,?)').run('friend-unnamed', 'code-fu', now);
    sqlite.prepare('INSERT INTO referral_devices(device_id,account_id,first_seen_at) VALUES(?,?,?)').run('friend-unnamed', 'friend-unnamed', now);
    sqlite.prepare('INSERT INTO referral_players(buyer_device_id,referrer_id,joined_at,played_ms) VALUES(?,?,?,?)')
      .run('friend-unnamed', 'ref-2', now - REFERRAL_QUALIFIED_PLAY_MS, REFERRAL_QUALIFIED_PLAY_MS);

    const result = await recordWarmIntro(db, 'friend-unnamed', now);
    expect(result.credited).toBe(true); // the referrer's $5M warm intro lands
    expect((await getFundingProfile(db, 'ref-2', now)).totalCents).toBe(String(WARM_INTRO_CENTS));
    // The fix: the unnamed friend still banks the $1M welcome cheque (was silently lost before).
    expect((await getFundingProfile(db, 'friend-unnamed', now)).totalCents).toBe(String(REFERRAL_STARTER_CENTS));
    expect((await getCapTable(db, 'friend-unnamed', now)).groups.find(g => g.source === 'warm-intro')!.entries[0]!.label)
      .toBe('Welcome cheque — joined via a friend');
  } finally { sqlite.close(); }
});

it('does not pay for self-referral or an under-played friend', async () => {
  const { sqlite, db, now, addPlayer, refer } = setup();
  try {
    addPlayer('ref-2', 'Alan');
    // Self-referral (referrer === buyer), fully "qualified" on time/play, is still rejected.
    sqlite.prepare('INSERT INTO referral_players(buyer_device_id,referrer_id,joined_at,played_ms) VALUES(?,?,?,?)')
      .run('ref-2', 'ref-2', now - REFERRAL_QUALIFIED_PLAY_MS, REFERRAL_QUALIFIED_PLAY_MS);
    expect((await recordWarmIntro(db, 'ref-2', now)).credited).toBe(false);
    // Just under the qualifying play time is not yet qualified.
    refer('friend-2', 'Edsger', 'ref-2', REFERRAL_QUALIFIED_PLAY_MS - 1);
    expect((await recordWarmIntro(db, 'friend-2', now)).credited).toBe(false);
    expect((await getFundingProfile(db, 'ref-2', now)).totalCents).toBe('0');
  } finally { sqlite.close(); }
});

it('awards the 5-friend milestone bonus round', async () => {
  const { sqlite, db, now, addPlayer, refer } = setup();
  try {
    addPlayer('ref-3', 'Barbara');
    for (let i = 1; i <= 5; i++) {
      refer(`f-${i}`, `Friend${i}`, 'ref-3');
      await recordWarmIntro(db, `f-${i}`, now + i);
    }
    // 5 × $5M warm intros + the $10M "Bonus round" milestone.
    const expected = WARM_INTRO_CENTS * 5n + REFERRAL_MILESTONES[0]!.cents;
    expect((await getFundingProfile(db, 'ref-3', now + 10)).totalCents).toBe(String(expected));
    const warm = (await getCapTable(db, 'ref-3', now + 10)).groups.find(g => g.source === 'warm-intro')!;
    expect(warm.count).toBe(6); // 5 warm intros + 1 milestone
    expect(warm.entries.some(e => e.label === 'Bonus round — 5 warm intros')).toBe(true);
  } finally { sqlite.close(); }
});
