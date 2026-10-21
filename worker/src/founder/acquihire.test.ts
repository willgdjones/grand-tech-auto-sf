import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// The escrow only exists under economy v3 (force-on in production); flip it on so the debit path runs.
vi.mock('@gtasf/shared/flags', async (orig) => {
  const actual = await orig<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, economyV3: true } };
});

import { flags } from '@gtasf/shared/flags';
import { ECONOMY_RESET_EPOCH, FUNDING_SEASON } from '@gtasf/shared/funding';
import { missionById, missionCredit } from '@gtasf/shared/founder/missions';
import { recordFundingCredit } from '../funding/credits';
import {
  ACQUIHIRE_CLAIM_GRACE_MS, ACQUIHIRE_MIN_CENTS, ACQUIHIRE_TIMEOUT_MS, acquihireCapCents, acquihireCostCents, acquihireCreditRef, acquihirePayoutCents,
  deliverAcquisition, getAcquisition, openAcquisition, refundAcquisition, startAcquisition, sweepExpiredAcquisitions, type AcquihireDeps,
} from './acquihire';

const MIGRATIONS = ['0010_funding.sql', '0014_funding_bonus.sql', '0018_fund_drops.sql', '0020_funding_credits.sql',
  '0021_referral_reward_amount.sql', '0028_economy_v3.sql', '0030_robotaxi_fares.sql', '0031_economy_reset_epoch.sql',
  '0046_acquisitions.sql', '0047_acquisitions_delivering.sql'];
const NOW = Date.UTC(2026, 9, 14, 18, 0, 0);
const START_CENTS = 5_000_000; // $50k: below Seed, so Bootstrapping never burns and balances stay exact

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
    .run(deviceId, `hash-${deviceId}`, `Startup ${deviceId}`, deviceId, NOW, NOW);
  sqlite.prepare('INSERT INTO funding_awards(id,device_id,season,event_id,event_title,day,entered_at,awarded_at,amount_cents,quote_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(`aw-${deviceId}`, deviceId, FUNDING_SEASON, `evt-${deviceId}`, 'Seed', '2026-10-14', NOW, NOW, currentCents, '{}');
  // A real, already-migrated profile: stamped at the current reset epoch, so the credit path's lazy one-time economy
  // reset (economyV3.ts resetDeviceToEconomyV3) doesn't wipe the seeded ledger mid-test.
  sqlite.prepare('UPDATE funding_profiles SET economy_v3_current_cents=?, economy_v3_lifetime_cents=?, economy_v3_burn_updated_at=?, economy_reset_epoch=? WHERE device_id=?')
    .run(currentCents, currentCents, NOW, ECONOMY_RESET_EPOCH, deviceId);
}
const balance = (sqlite: DatabaseSync, d: string) => (sqlite.prepare('SELECT economy_v3_current_cents AS c FROM funding_profiles WHERE device_id=?').get(d) as { c: number }).c;
const credits = (sqlite: DatabaseSync, d: string) => (sqlite.prepare("SELECT COUNT(*) AS n FROM funding_credits WHERE device_id=? AND source_ref LIKE 'mission:acquihire:%'").get(d) as { n: number }).n;
/** The real reviewed credit path, as WorldFunding.award would call it. */
const realAward = (db: D1Database, deviceId: string, now: number): AcquihireDeps => ({ award: input => recordFundingCredit(db, { ...input, deviceId, now }) });
const COST = 500_000, PAYOUT = 750_000; // 10% of $50k, then 1.5×

describe('pricing (pure)', () => {
  it('10% clamped to [$1k, demo×4]; unaffordable below $1k; never above current', () => {
    expect(acquihireCostCents(ACQUIHIRE_MIN_CENTS - 1n)).toBeNull();
    expect(acquihireCostCents(ACQUIHIRE_MIN_CENTS)).toBe(ACQUIHIRE_MIN_CENTS);          // = current, never more
    expect(acquihireCostCents(5_000_000n)).toBe(500_000n);
    expect(acquihireCostCents(10n ** 12n)).toBe(acquihireCapCents());
    for (const c of [100_000n, 999_999n, 7_654_321n, 10n ** 10n]) expect(acquihireCostCents(c)! <= c).toBe(true);
    expect(acquihirePayoutCents(500_000n)).toBe(750_000n);
  });
  it('the credit ref is the mission cooldown ref', () => {
    expect(acquihireCreditRef('2026-10-14')).toBe(missionCredit(missionById('acquihire')!, NOW).sourceRef);
  });
});

describe('debit at start', () => {
  it('debits the price once and opens the escrow', async () => {
    const { sqlite, db } = freshDb(); seedPlayer(sqlite, 'p', START_CENTS);
    const r = await startAcquisition(db, 'p', NOW);
    expect(r).toMatchObject({ ok: true, costCents: String(COST), deadlineAt: NOW + ACQUIHIRE_TIMEOUT_MS });
    expect(balance(sqlite, 'p')).toBe(START_CENTS - COST);
    expect((await openAcquisition(db, 'p'))?.cost_cents).toBe(COST);
  });
  it('a second start supersedes the first (refund + one debit), never a double debit', async () => {
    const { sqlite, db } = freshDb(); seedPlayer(sqlite, 'p', START_CENTS);
    const a = await startAcquisition(db, 'p', NOW), b = await startAcquisition(db, 'p', NOW);
    expect(a.ok && b.ok).toBe(true);
    expect(balance(sqlite, 'p')).toBe(START_CENTS - COST);
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM acquisitions WHERE device_id='p' AND status='open'").get() as { n: number }).n).toBe(1);
    expect(a.ok && (await getAcquisition(db, 'p', a.acqId))?.status).toBe('refunded');
  });
  it('the schema allows at most one open purchase per device', () => {
    const { sqlite } = freshDb(); seedPlayer(sqlite, 'p', START_CENTS);
    const ins = sqlite.prepare("INSERT INTO acquisitions VALUES (?, 'p', '2026-10-14', 1, ?, 0, 1, NULL)");
    ins.run('x1', 'open');
    expect(() => ins.run('x2', 'open')).toThrow();
    expect(() => ins.run('x3', 'delivering')).toThrow(); // a purchase being delivered is active too
  });
  it('unaffordable below $1k: nothing debited, no row', async () => {
    const { sqlite, db } = freshDb(); seedPlayer(sqlite, 'p', 99_999);
    expect(await startAcquisition(db, 'p', NOW)).toEqual({ ok: false, reason: 'unaffordable' });
    expect(balance(sqlite, 'p')).toBe(99_999);
    expect(await openAcquisition(db, 'p')).toBeNull();
  });
  it('a balance of exactly the minimum can buy, and never goes negative', async () => {
    const { sqlite, db } = freshDb(); seedPlayer(sqlite, 'p', 100_000);
    expect((await startAcquisition(db, 'p', NOW)).ok).toBe(true);
    expect(balance(sqlite, 'p')).toBe(0);
  });
  it('unknown profile and economy-off are refused without writes', async () => {
    const { db } = freshDb();
    expect(await startAcquisition(db, 'ghost', NOW)).toEqual({ ok: false, reason: 'unknown-profile' });
    (flags as { economyV3: boolean }).economyV3 = false;
    try { expect(await startAcquisition(db, 'ghost', NOW)).toEqual({ ok: false, reason: 'economy-off' }); }
    finally { (flags as { economyV3: boolean }).economyV3 = true; }
  });
  it('once delivered today, another start is on cooldown until the next SF day', async () => {
    const { sqlite, db } = freshDb(); seedPlayer(sqlite, 'p', START_CENTS);
    const a = await startAcquisition(db, 'p', NOW); if (!a.ok) throw new Error('start');
    await deliverAcquisition(db, 'p', a.acqId, realAward(db, 'p', NOW + 60_000), NOW + 60_000);
    expect(await startAcquisition(db, 'p', NOW + 120_000)).toEqual({ ok: false, reason: 'cooldown' });
    expect((await startAcquisition(db, 'p', NOW + 86_400_000)).ok).toBe(true);
  });
});

describe('credit at delivery', () => {
  it('pays 1.5× the price once (real credit path) and settles delivered', async () => {
    const { sqlite, db } = freshDb(); seedPlayer(sqlite, 'p', START_CENTS);
    const a = await startAcquisition(db, 'p', NOW); if (!a.ok) throw new Error('start');
    const r = await deliverAcquisition(db, 'p', a.acqId, realAward(db, 'p', NOW + 60_000), NOW + 60_000);
    expect(r).toEqual({ status: 'completed', credited: true, costCents: String(COST), payoutCents: String(PAYOUT) });
    expect(balance(sqlite, 'p')).toBe(START_CENTS - COST + PAYOUT);
    expect((await getAcquisition(db, 'p', a.acqId))?.status).toBe('delivered');
    expect(await deliverAcquisition(db, 'p', a.acqId, realAward(db, 'p', NOW + 61_000), NOW + 61_000)).toEqual({ status: 'already-delivered' });
    expect(credits(sqlite, 'p')).toBe(1);
  });
  it('after the deadline it is refunded instead of paid', async () => {
    const { sqlite, db } = freshDb(); seedPlayer(sqlite, 'p', START_CENTS);
    const a = await startAcquisition(db, 'p', NOW); if (!a.ok) throw new Error('start');
    const award = vi.fn<AcquihireDeps['award']>();
    expect(await deliverAcquisition(db, 'p', a.acqId, { award }, NOW + ACQUIHIRE_TIMEOUT_MS + 1)).toEqual({ status: 'expired' });
    expect(award).not.toHaveBeenCalled();
    expect(balance(sqlite, 'p')).toBe(START_CENTS);
  });
  it('if the credit cannot be booked (e.g. unnamed / ledger cap) the price is refunded', async () => {
    const { sqlite, db } = freshDb(); seedPlayer(sqlite, 'p', START_CENTS);
    const a = await startAcquisition(db, 'p', NOW); if (!a.ok) throw new Error('start');
    const r = await deliverAcquisition(db, 'p', a.acqId, { award: async () => { throw new RangeError('Funding limit reached'); } }, NOW + 1000);
    expect(r).toEqual({ status: 'refunded-on-error', reason: 'Funding limit reached' });
    expect(balance(sqlite, 'p')).toBe(START_CENTS);
    expect((await getAcquisition(db, 'p', a.acqId))?.status).toBe('refunded');
  });
  it('a refunded or unknown purchase pays nothing', async () => {
    const { sqlite, db } = freshDb(); seedPlayer(sqlite, 'p', START_CENTS);
    const a = await startAcquisition(db, 'p', NOW); if (!a.ok) throw new Error('start');
    await refundAcquisition(db, 'p', a.acqId, NOW + 1);
    const award = vi.fn<AcquihireDeps['award']>();
    expect(await deliverAcquisition(db, 'p', a.acqId, { award }, NOW + 2)).toEqual({ status: 'refunded' });
    expect(await deliverAcquisition(db, 'p', 'nope', { award }, NOW + 2)).toEqual({ status: 'no-acquisition' });
    expect(await deliverAcquisition(db, 'q', a.acqId, { award }, NOW + 2)).toEqual({ status: 'no-acquisition' }); // another device's id
    expect(award).not.toHaveBeenCalled();
  });
});

describe('refund (abandon / teleport / disconnect / timeout)', () => {
  it('returns the price once; a repeat is a no-op', async () => {
    const { sqlite, db } = freshDb(); seedPlayer(sqlite, 'p', START_CENTS);
    const a = await startAcquisition(db, 'p', NOW); if (!a.ok) throw new Error('start');
    expect(await refundAcquisition(db, 'p', a.acqId, NOW + 1)).toBe(true);
    expect(await refundAcquisition(db, 'p', a.acqId, NOW + 2)).toBe(false);
    expect(balance(sqlite, 'p')).toBe(START_CENTS);
    expect((await getAcquisition(db, 'p', a.acqId))?.status).toBe('refunded');
  });
  it("another device can't refund my purchase", async () => {
    const { sqlite, db } = freshDb(); seedPlayer(sqlite, 'p', START_CENTS); seedPlayer(sqlite, 'q', START_CENTS);
    const a = await startAcquisition(db, 'p', NOW); if (!a.ok) throw new Error('start');
    expect(await refundAcquisition(db, 'q', a.acqId, NOW + 1)).toBe(false);
    expect(balance(sqlite, 'q')).toBe(START_CENTS);
    expect(balance(sqlite, 'p')).toBe(START_CENTS - COST);
  });
  it('the sweep refunds only expired open purchases', async () => {
    const { sqlite, db } = freshDb(); seedPlayer(sqlite, 'old', START_CENTS); seedPlayer(sqlite, 'new', START_CENTS);
    await startAcquisition(db, 'old', NOW);
    await startAcquisition(db, 'new', NOW + ACQUIHIRE_TIMEOUT_MS);
    expect(await sweepExpiredAcquisitions(db, NOW + ACQUIHIRE_TIMEOUT_MS + 1)).toBe(1);
    expect(balance(sqlite, 'old')).toBe(START_CENTS);
    expect(balance(sqlite, 'new')).toBe(START_CENTS - COST);
  });
});

describe('claim-first delivery: races with refunds (review fix)', () => {
  const setup = async () => {
    const { sqlite, db } = freshDb(); seedPlayer(sqlite, 'p', START_CENTS);
    const a = await startAcquisition(db, 'p', NOW); if (!a.ok) throw new Error('start');
    return { sqlite, db, acqId: a.acqId };
  };
  it('complete vs abandon: an abandon landing during the award refunds nothing (+50%, never +150%)', async () => {
    const { sqlite, db, acqId } = await setup();
    let raced: boolean | undefined;
    const r = await deliverAcquisition(db, 'p', acqId, { award: async input => {
      raced = await refundAcquisition(db, 'p', acqId, NOW + 1_001); // the racing abandon
      return recordFundingCredit(db, { ...input, deviceId: 'p', now: NOW + 1_002 });
    } }, NOW + 1_000);
    expect(r.status).toBe('completed');
    expect(raced).toBe(false);
    expect(balance(sqlite, 'p')).toBe(START_CENTS - COST + PAYOUT);
    expect((await getAcquisition(db, 'p', acqId))?.status).toBe('delivered');
  });
  it('complete vs disconnect: the socket-close refund after delivery is a no-op', async () => {
    const { sqlite, db, acqId } = await setup();
    await deliverAcquisition(db, 'p', acqId, realAward(db, 'p', NOW + 1_000), NOW + 1_000);
    expect(await refundAcquisition(db, 'p', acqId, NOW + 1_001)).toBe(false); // dropMissionRun's refund, arriving late
    expect(balance(sqlite, 'p')).toBe(START_CENTS - COST + PAYOUT);
  });
  it("second tab: a start during the delivery can't refund it or debit again", async () => {
    const { sqlite, db, acqId } = await setup();
    let second: Awaited<ReturnType<typeof startAcquisition>> | undefined;
    await deliverAcquisition(db, 'p', acqId, { award: async input => {
      second = await startAcquisition(db, 'p', NOW + 1_001);
      return recordFundingCredit(db, { ...input, deviceId: 'p', now: NOW + 1_002 });
    } }, NOW + 1_000);
    expect(second).toEqual({ ok: false, reason: 'retry' });
    expect(balance(sqlite, 'p')).toBe(START_CENTS - COST + PAYOUT);
    expect(await startAcquisition(db, 'p', NOW + 2_000)).toEqual({ ok: false, reason: 'cooldown' }); // and today is done
  });
  it('two deliveries at once: only the claim winner awards', async () => {
    const { sqlite, db, acqId } = await setup();
    const award = vi.fn<AcquihireDeps['award']>(async input => recordFundingCredit(db, { ...input, deviceId: 'p', now: NOW + 1_002 }));
    let inner: Awaited<ReturnType<typeof deliverAcquisition>> | undefined;
    await deliverAcquisition(db, 'p', acqId, { award: async input => { inner = await deliverAcquisition(db, 'p', acqId, { award }, NOW + 1_001); return award(input); } }, NOW + 1_000);
    expect(inner).toEqual({ status: 'in-progress' });
    expect(award).toHaveBeenCalledOnce();
    expect(credits(sqlite, 'p')).toBe(1);
  });
  it('an award that is not credited refunds the claimed price', async () => {
    const { sqlite, db, acqId } = await setup();
    expect(await deliverAcquisition(db, 'p', acqId, { award: async () => ({ credited: false }) }, NOW + 1_000)).toEqual({ status: 'refunded-on-error', reason: 'not-credited' });
    expect(balance(sqlite, 'p')).toBe(START_CENTS);
    expect((await getAcquisition(db, 'p', acqId))?.status).toBe('refunded');
  });
  it('a claim past the deadline fails and refunds (no award)', async () => {
    const { sqlite, db, acqId } = await setup();
    const award = vi.fn<AcquihireDeps['award']>();
    expect(await deliverAcquisition(db, 'p', acqId, { award }, NOW + ACQUIHIRE_TIMEOUT_MS + 1)).toEqual({ status: 'expired' });
    expect(award).not.toHaveBeenCalled();
    expect(balance(sqlite, 'p')).toBe(START_CENTS);
  });
  it('a crash between claim and settle is recovered by the sweep (refund if unpaid, delivered if paid)', async () => {
    const unpaid = await setup();
    unpaid.sqlite.prepare("UPDATE acquisitions SET status='delivering', settled_at=? WHERE acq_id=?").run(NOW + 1_000, unpaid.acqId);
    expect(await refundAcquisition(unpaid.db, 'p', unpaid.acqId, NOW + 2_000)).toBe(false); // abandon can't touch a claim
    expect(await sweepExpiredAcquisitions(unpaid.db, NOW + 1_000 + ACQUIHIRE_CLAIM_GRACE_MS - 1)).toBe(0); // within grace
    expect(await sweepExpiredAcquisitions(unpaid.db, NOW + 1_001 + ACQUIHIRE_CLAIM_GRACE_MS)).toBe(1);
    expect(balance(unpaid.sqlite, 'p')).toBe(START_CENTS);
    const paid = await setup();
    paid.sqlite.prepare("UPDATE acquisitions SET status='delivering', settled_at=? WHERE acq_id=?").run(NOW + 1_000, paid.acqId);
    await recordFundingCredit(paid.db, { deviceId: 'p', source: 'celebrity', sourceRef: acquihireCreditRef('2026-10-14'), label: 'x', amountCents: String(PAYOUT), now: NOW + 1_000 });
    await sweepExpiredAcquisitions(paid.db, NOW + 1_001 + ACQUIHIRE_CLAIM_GRACE_MS);
    expect((await getAcquisition(paid.db, 'p', paid.acqId))?.status).toBe('delivered');
    expect(balance(paid.sqlite, 'p')).toBe(START_CENTS - COST + PAYOUT);
  });
  it('the cooldown is enforced inside the debit batch', async () => {
    const { sqlite, db } = freshDb(); seedPlayer(sqlite, 'p', START_CENTS);
    await recordFundingCredit(db, { deviceId: 'p', source: 'celebrity', sourceRef: acquihireCreditRef('2026-10-14'), label: 'x', amountCents: String(PAYOUT), now: NOW });
    const before = balance(sqlite, 'p');
    expect(await startAcquisition(db, 'p', NOW + 10)).toEqual({ ok: false, reason: 'cooldown' });
    expect(balance(sqlite, 'p')).toBe(before);
    expect(await openAcquisition(db, 'p')).toBeNull();
  });
});

describe('a claimed purchase is never both paid and refunded (review E-H1)', () => {
  it('an award that throws AFTER its credit row is written settles delivered (+50%), not refunded (+150%)', async () => {
    const { sqlite, db } = freshDb(); seedPlayer(sqlite, 'p', START_CENTS);
    const a = await startAcquisition(db, 'p', NOW); if (!a.ok) throw new Error('start');
    const r = await deliverAcquisition(db, 'p', a.acqId, { award: async input => {
      await recordFundingCredit(db, { ...input, deviceId: 'p', now: NOW + 1_000 });
      throw new Error('D1 hiccup after the INSERT');
    } }, NOW + 1_000);
    expect(r).toMatchObject({ status: 'completed', credited: true });
    expect(balance(sqlite, 'p')).toBe(START_CENTS - COST + PAYOUT);
    expect((await getAcquisition(db, 'p', a.acqId))?.status).toBe('delivered');
  });
  it('the crash sweep never refunds a claim whose credit exists, and refunds one whose credit does not (atomic)', async () => {
    const { sqlite, db } = freshDb(); seedPlayer(sqlite, 'p', START_CENTS);
    const a = await startAcquisition(db, 'p', NOW); if (!a.ok) throw new Error('start');
    sqlite.prepare("UPDATE acquisitions SET status='delivering', settled_at=? WHERE acq_id=?").run(NOW + 1_000, a.acqId);
    await recordFundingCredit(db, { deviceId: 'p', source: 'celebrity', sourceRef: acquihireCreditRef('2026-10-14'), label: 'x', amountCents: String(PAYOUT), now: NOW + 1_000 });
    expect(await sweepExpiredAcquisitions(db, NOW + 1_001 + ACQUIHIRE_CLAIM_GRACE_MS)).toBe(0); // settled delivered, nothing refunded
    expect((await getAcquisition(db, 'p', a.acqId))?.status).toBe('delivered');
    expect(balance(sqlite, 'p')).toBe(START_CENTS - COST + PAYOUT);
  });
});
