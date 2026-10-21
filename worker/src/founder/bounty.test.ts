import { describe, expect, it, vi } from 'vitest';

vi.mock('@gtasf/shared/flags', async (orig) => {
  const actual = await orig<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, economyV3: true } };
});

import type { DatabaseSync } from 'node:sqlite';
import { wastedCostCents } from '@gtasf/shared/combat/economy';
import { recordFundingCredit } from '../funding/credits';
import {
  BOUNTY_CAP_CENTS, BOUNTY_MIN_HELD_MS, BOUNTY_MIN_TARGET_CENTS, BOUNTY_PAIR_COOLDOWN_MS, advertisedBountyCents, bountyAmountCents,
  bountyEligible, claimBounty, claimedTargetsToday, pickMostWanted, recordPvpKill, type BountyDeps, type BountyHolder,
} from './bounty';
import { NOW, START_CENTS, balance, freshDb, seedPlayer } from './bountyTestDb';

const RICH_CENTS = 100_000_000;                   // $1M target (WASTED debit $20k < cap), >= 3x every $50k killer
const DEBIT = wastedCostCents(BigInt(RICH_CENTS)); // the victim's WASTED debit for one takedown
const deps = (db: D1Database, sqlite: DatabaseSync): BountyDeps => ({
  award: input => recordFundingCredit(db, { ...input, source: 'celebrity' }),
  valuation: async device => BigInt(balance(sqlite, device)),
});
const holder = (over: Partial<BountyHolder> = {}): BountyHolder => ({ sid: 9, device: 'rich', name: 'Rich', cents: BigInt(RICH_CENTS), since: NOW - BOUNTY_MIN_HELD_MS, amountCents: BOUNTY_CAP_CENTS, ...over });
/** The normal PvP death already debited the victim before the claim (applyPvpDeath → applyCombatPenalty). */
const debitVictim = (sqlite: DatabaseSync, device: string, cents: bigint) => sqlite.prepare('UPDATE funding_profiles SET economy_v3_current_cents=economy_v3_current_cents-? WHERE device_id=?').run(Number(cents), device);
const setup = () => {
  const { sqlite, db } = freshDb(); seedPlayer(sqlite, 'rich', RICH_CENTS);
  for (const d of ['k1', 'k2']) seedPlayer(sqlite, d, START_CENTS);
  debitVictim(sqlite, 'rich', DEBIT);
  return { sqlite, db, d: deps(db, sqlite) };
};

describe('bounty rules (pure)', () => {
  it('the bounty is the victim’s WASTED debit, capped at $50k; nothing without a debit', () => {
    expect(bountyAmountCents(1_234_500n)).toBe(1_234_500n);
    expect(bountyAmountCents(80_000_000n)).toBe(BOUNTY_CAP_CENTS);
    expect(bountyAmountCents(0n)).toBe(0n);
    expect(advertisedBountyCents(BigInt(RICH_CENTS))).toBe(DEBIT < BOUNTY_CAP_CENTS ? DEBIT : BOUNTY_CAP_CENTS);
  });
  it('picks the richest eligible candidate over the floor; a tie keeps the holder; a new holder restarts the clock', () => {
    const a = { sid: 1, device: 'a', name: 'A', cents: 50_000_000n }, b = { sid: 2, device: 'b', name: 'B', cents: 50_000_000n };
    expect(pickMostWanted([{ ...a, cents: BOUNTY_MIN_TARGET_CENTS - 1n }], null, NOW)).toBeNull();
    const first = pickMostWanted([a, b], null, NOW)!;
    expect(pickMostWanted([b, a], first, NOW + 5_000)).toMatchObject({ device: first.device, since: NOW });
    expect(pickMostWanted([a, { ...b, cents: 90_000_000n }], first, NOW + 9_000)).toMatchObject({ device: 'b', since: NOW + 9_000 });
  });
  it('a takedown qualifies only on the holder, by someone else, after the marker has been up 3 minutes', () => {
    const h = holder({ since: NOW });
    expect(BOUNTY_MIN_HELD_MS).toBe(180_000);
    expect(bountyEligible(h, 9, 'rich', 'k1', NOW + BOUNTY_MIN_HELD_MS)).toBe(true);
    expect(bountyEligible(h, 9, 'someone-else', 'k1', NOW + BOUNTY_MIN_HELD_MS)).toBe(false); // sid reused by another device (A-L2)
    expect(bountyEligible(h, 9, 'rich', 'k1', NOW + BOUNTY_MIN_HELD_MS - 1)).toBe(false);
    expect(bountyEligible(h, 8, 'rich', 'k1', NOW + BOUNTY_MIN_HELD_MS)).toBe(false);
    expect(bountyEligible(h, 9, 'rich', 'rich', NOW + BOUNTY_MIN_HELD_MS)).toBe(false);
    expect(bountyEligible(null, 9, 'rich', 'k1', NOW)).toBe(false);
  });
});

describe('claimBounty (real SQL, victim-funded)', () => {
  it('transfers exactly the victim’s debit to the killer: the pair nets zero (collusion gains nothing)', async () => {
    const { sqlite, db, d } = setup();
    const pairBefore = RICH_CENTS + START_CENTS; // before the takedown's debit
    expect(await claimBounty(db, holder(), 'k1', DEBIT, d, NOW)).toEqual({ status: 'paid', amountCents: DEBIT });
    expect(balance(sqlite, 'k1')).toBe(START_CENTS + Number(DEBIT));
    expect(balance(sqlite, 'rich') + balance(sqlite, 'k1')).toBe(pairBefore); // nothing minted
    expect(await claimedTargetsToday(db, NOW)).toEqual(new Set(['rich']));
  });
  it('alternating takedowns between two players never grow their combined valuation', async () => {
    const { sqlite, db } = freshDb();
    seedPlayer(sqlite, 'a', 50_000_000); seedPlayer(sqlite, 'b', 10_000_000);
    const d = deps(db, sqlite), total = () => balance(sqlite, 'a') + balance(sqlite, 'b'), start = total();
    for (let day = 0; day < 4; day++) {
      const t = NOW + day * 86_400_000, [victim, killer] = day % 2 ? ['b', 'a'] : ['a', 'b'];
      const debit = wastedCostCents(BigInt(balance(sqlite, victim))); debitVictim(sqlite, victim, debit);
      await claimBounty(db, holder({ device: victim, cents: BigInt(balance(sqlite, victim)) }), killer, debit, d, t);
      await recordPvpKill(db, killer, victim, t);
    }
    expect(total()).toBeLessThan(start); // the WASTED debits cost the pair; a bounty only ever moves some of it back
  });
  it('the cap holds whatever the debit or advertised amount', async () => {
    const { sqlite, db, d } = setup();
    await claimBounty(db, holder({ amountCents: 999_999_999n }), 'k1', 90_000_000n, d, NOW);
    expect(balance(sqlite, 'k1')).toBe(START_CENTS + Number(BOUNTY_CAP_CENTS));
  });
  it('no debit (the victim had nothing) pays nothing', async () => {
    const { db, d } = setup();
    expect(await claimBounty(db, holder(), 'k1', 0n, d, NOW)).toEqual({ status: 'refused', reason: 'no-debit' });
  });
  it('the target must be worth >= 3x the killer (fresh valuations, target valued before the debit)', async () => {
    const { sqlite, db, d } = setup();
    seedPlayer(sqlite, 'whale', 50_000_000); // $500k killer vs a $1M target: < 3x
    expect(await claimBounty(db, holder(), 'whale', DEBIT, d, NOW)).toEqual({ status: 'refused', reason: 'target-too-small' });
    expect(balance(sqlite, 'whale')).toBe(50_000_000);
    // A stale cached holder can't sneak past: the check reads the live profile, not holder.cents.
    sqlite.prepare('UPDATE funding_profiles SET economy_v3_current_cents=? WHERE device_id=?').run(5_000_000, 'rich');
    expect(await claimBounty(db, holder({ cents: 9_000_000_000n }), 'k1', DEBIT, d, NOW)).toEqual({ status: 'refused', reason: 'target-too-small' });
  });
  it('friends never pay each other a bounty', async () => {
    const { sqlite, db, d } = setup();
    sqlite.prepare('INSERT INTO friendships(a,b,created_at) VALUES(?,?,?)').run('rich', 'k1', NOW);
    expect(await claimBounty(db, holder(), 'k1', DEBIT, d, NOW)).toEqual({ status: 'refused', reason: 'friends' });
    expect(balance(sqlite, 'k1')).toBe(START_CENTS);
  });
  it('no bounty between a pair with a PvP kill either way in the last 7 days; old kills are pruned', async () => {
    const { sqlite, db, d } = setup();
    await recordPvpKill(db, 'rich', 'k1', NOW - 86_400_000); // the target killed this killer yesterday
    expect(await claimBounty(db, holder(), 'k1', DEBIT, d, NOW)).toEqual({ status: 'refused', reason: 'recent-pair' });
    await recordPvpKill(db, 'k2', 'rich', NOW - BOUNTY_PAIR_COOLDOWN_MS - 1); // 7 days + 1 ms ago: no longer counts
    expect((await claimBounty(db, holder(), 'k2', DEBIT, d, NOW)).status).toBe('paid');
    await recordPvpKill(db, 'x', 'y', NOW);
    expect((sqlite.prepare('SELECT COUNT(*) n FROM pvp_kill_log WHERE killed_at < ?').get(NOW - BOUNTY_PAIR_COOLDOWN_MS) as { n: number }).n).toBe(0);
  });
  it('once per target per day: a second takedown (another killer) pays nothing; tomorrow pays again', async () => {
    const { sqlite, db, d } = setup();
    await claimBounty(db, holder(), 'k1', DEBIT, d, NOW);
    expect(await claimBounty(db, holder(), 'k2', DEBIT, d, NOW + 1_000)).toEqual({ status: 'already' });
    expect(balance(sqlite, 'k2')).toBe(START_CENTS);
    expect((await claimBounty(db, holder(), 'k2', DEBIT, d, NOW + 86_400_000)).status).toBe('paid');
  });
  it('once per killer per day, across different targets', async () => {
    const { sqlite, db, d } = setup(); seedPlayer(sqlite, 'rich2', RICH_CENTS);
    await claimBounty(db, holder(), 'k1', DEBIT, d, NOW);
    expect(await claimBounty(db, holder({ device: 'rich2', sid: 10 }), 'k1', DEBIT, d, NOW + 1_000)).toEqual({ status: 'already' });
  });
  it('two simultaneous takedowns of the same target: only the claim winner is paid', async () => {
    const { sqlite, db, d } = setup();
    let inner: Awaited<ReturnType<typeof claimBounty>> | undefined;
    await claimBounty(db, holder(), 'k1', DEBIT, { ...d, award: async input => {
      inner = await claimBounty(db, holder(), 'k2', DEBIT, d, NOW + 1);
      return recordFundingCredit(db, { ...input, source: 'celebrity' });
    } }, NOW);
    expect(inner).toEqual({ status: 'already' });
    expect(balance(sqlite, 'k2')).toBe(START_CENTS);
  });
  it('the target cannot claim their own bounty', async () => {
    const { sqlite, db, d } = setup();
    expect(await claimBounty(db, holder(), 'rich', DEBIT, d, NOW)).toEqual({ status: 'refused', reason: 'self' });
    expect(() => sqlite.prepare("INSERT INTO bounty_claims VALUES('x','2026-10-14','a','a',1,'paid',0)").run()).toThrow(); // schema too
  });
  it('a credit that does not land releases the claim', async () => {
    const { db, d } = setup();
    expect(await claimBounty(db, holder(), 'k1', DEBIT, { ...d, award: async () => ({ credited: false }) }, NOW)).toEqual({ status: 'failed', reason: 'not-credited' });
    expect(await claimedTargetsToday(db, NOW)).toEqual(new Set());
    expect((await claimBounty(db, holder(), 'k2', DEBIT, d, NOW + 1)).status).toBe('paid');
  });
  it('an award that throws after its credit committed counts as paid (no second payout)', async () => {
    const { db, d } = setup();
    const r = await claimBounty(db, holder(), 'k1', DEBIT, { ...d, award: async input => { await recordFundingCredit(db, { ...input, source: 'celebrity' }); throw new Error('refresh failed'); } }, NOW);
    expect(r).toEqual({ status: 'paid', amountCents: DEBIT });
    expect(await claimBounty(db, holder(), 'k2', DEBIT, d, NOW + 1)).toEqual({ status: 'already' });
  });
  it('an award that throws before crediting releases the claim', async () => {
    const { db, d } = setup();
    expect(await claimBounty(db, holder(), 'k1', DEBIT, { ...d, award: async () => { throw new Error('Funding limit reached'); } }, NOW)).toEqual({ status: 'failed', reason: 'Funding limit reached' });
    expect(await claimedTargetsToday(db, NOW)).toEqual(new Set());
  });
});
