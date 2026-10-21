/**
 * "Most Wanted founder" bounty (flag mostWantedBounty; GTA-pivot lane C multiplayer, GTA Online style). The highest-
 * valuation player online who has opted into combat carries a bounty marker; the first OTHER player who takes them down
 * with a server-validated PvP kill collects it. Money rules (review fix 2026-10-14), all server-side:
 * - VICTIM-FUNDED: the bounty is the victim's own WASTED debit (already charged by the normal PvP death), capped at $50k,
 *   transferred to the killer. Nothing is minted, so a colluding pair (or ring of alts) nets nothing.
 * - the target must be worth >= $100k and >= 3x the killer (fresh profiles at claim, target valued before the debit);
 * - never between friends, nor between a pair with any PvP kill either way in the last 7 days (pvp_kill_log);
 * - the marker must have been public BOUNTY_MIN_HELD_MS (3 min) before a takedown pays;
 * - at most one bounty per target and per killer per SF day (unique indexes on bounty_claims);
 * - claim first (INSERT OR IGNORE must change 1 row), then credit; a credit that doesn't land releases the claim.
 */
import { fundingDay } from '@gtasf/shared/funding';
import { deathCostCents } from '@gtasf/shared/combat/economy';
import { flags } from '@gtasf/shared/flags';
import type { FundingCreditResult } from '../funding/credits';

export const BOUNTY_CAP_CENTS = 5_000_000n;             // $50k
export const BOUNTY_MIN_TARGET_CENTS = 10_000_000n;     // $100k: below this nobody is Most Wanted
export const BOUNTY_TARGET_MULTIPLE = 3n;               // the target must be worth >= 3x the killer
export const BOUNTY_MIN_HELD_MS = 180_000;              // the marker is public for 3 minutes before a takedown pays
export const BOUNTY_PAIR_COOLDOWN_MS = 7 * 86_400_000;  // no bounty between a pair who killed each other within 7 days
export const bountyCreditRef = (day: string) => `bounty:${day}`; // per killer per day (funding_credits unique key)

/** The transfer: the victim's WASTED debit for this takedown, capped. */
export function bountyAmountCents(victimDebitCents: bigint): bigint {
  return victimDebitCents <= 0n ? 0n : victimDebitCents > BOUNTY_CAP_CENTS ? BOUNTY_CAP_CENTS : victimDebitCents;
}
/** What the marker advertises: the WASTED cost the target would pay now, capped. */
export const advertisedBountyCents = (targetCents: bigint) => bountyAmountCents(deathCostCents('wasted', targetCents, flags.riskReward));

export interface BountyCandidate { readonly sid: number; readonly device: string; readonly name: string; readonly cents: bigint }
export interface BountyHolder extends BountyCandidate { readonly since: number; readonly amountCents: bigint }

/** The Most Wanted: the richest eligible candidate (eligibility — online, combat opted-in, not a bot, not already claimed
 *  today — is the caller's filter). A tie keeps the current holder so the marker doesn't flicker. */
export function pickMostWanted(candidates: readonly BountyCandidate[], current: BountyHolder | null, now: number): BountyHolder | null {
  let best: BountyCandidate | null = null;
  for (const c of candidates) {
    if (c.cents < BOUNTY_MIN_TARGET_CENTS) continue;
    if (!best || c.cents > best.cents || (c.cents === best.cents && current?.device === c.device)) best = c;
  }
  if (!best) return null;
  const amountCents = advertisedBountyCents(best.cents);
  if (current && current.device === best.device && current.sid === best.sid) return { ...best, since: current.since, amountCents };
  return { ...best, since: now, amountCents };
}

/** Does a server-validated kill of `victimSid` (device `victimDevice`) by `killer` qualify for the claim? (pure gate
 *  before the DB checks; the device must match the holder's too — review A-L2.) */
export function bountyEligible(holder: BountyHolder | null, victimSid: number, victimDevice: string | undefined, killerDevice: string | undefined, now: number): holder is BountyHolder {
  return !!holder && holder.sid === victimSid && victimDevice === holder.device && !!killerDevice && killerDevice !== holder.device
    && now - holder.since >= BOUNTY_MIN_HELD_MS;
}

export interface BountyDeps {
  /** Credit the killer (source 'celebrity', ref bountyCreditRef(day)); the WorldDO passes recordFundingCredit. */
  award(input: { deviceId: string; sourceRef: string; label: string; amountCents: bigint; now: number }): Promise<Pick<FundingCreditResult, 'credited'>>;
  /** A device's CURRENT valuation (fresh, not cached). */
  valuation(device: string, now: number): Promise<bigint>;
}
export type BountyClaimResult =
  | { status: 'paid'; amountCents: bigint }
  | { status: 'already' }          // this target was already taken down for a bounty today, or this killer already has one
  | { status: 'refused'; reason: 'self' | 'no-debit' | 'target-too-small' | 'friends' | 'recent-pair' }
  | { status: 'failed'; reason: string };

const CREDIT_EXISTS = "SELECT 1 AS ok FROM funding_credits WHERE device_id=? AND source='celebrity' AND source_ref=? LIMIT 1";

/** Friends (either direction) never pay each other a bounty. Missing table (pre-0025) = not friends. */
async function areFriends(db: D1Database, a: string, b: string): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 AS ok FROM friendships WHERE (a=? AND b=?) OR (a=? AND b=?) LIMIT 1').bind(a, b, b, a).first().catch(() => null));
}
/** Any PvP kill between the pair, either way, since `since` (excluding the takedown being judged, logged after). */
async function killedRecently(db: D1Database, a: string, b: string, since: number): Promise<boolean> {
  return !!(await db.prepare(`SELECT 1 AS ok FROM pvp_kill_log WHERE ((killer_device=? AND victim_device=?) OR (killer_device=? AND victim_device=?))
    AND killed_at>=? LIMIT 1`).bind(a, b, b, a, since).first());
}
/** Log a server-validated PvP kill (and prune entries past the pair cooldown). */
export async function recordPvpKill(db: D1Database, killer: string, victim: string, now: number): Promise<void> {
  await db.batch([
    db.prepare('INSERT INTO pvp_kill_log(killer_device,victim_device,killed_at) VALUES(?,?,?)').bind(killer, victim, now),
    db.prepare('DELETE FROM pvp_kill_log WHERE killed_at<?').bind(now - BOUNTY_PAIR_COOLDOWN_MS),
  ]);
}

/**
 * Claim the bounty for a takedown whose WASTED debit of the victim was `victimDebitCents`, then pay that (capped) to the
 * killer. Never pays twice per target or killer per day; never pays more than the victim just lost.
 */
export async function claimBounty(db: D1Database, holder: BountyHolder, killerDevice: string, victimDebitCents: bigint, deps: BountyDeps, now: number): Promise<BountyClaimResult> {
  if (killerDevice === holder.device) return { status: 'refused', reason: 'self' };
  const amount = bountyAmountCents(victimDebitCents);
  if (amount <= 0n) return { status: 'refused', reason: 'no-debit' };
  // Fresh valuations (the holder's 10 s cache can be stale): the target is valued as before this takedown's debit.
  const [targetNow, killerNow] = await Promise.all([deps.valuation(holder.device, now), deps.valuation(killerDevice, now)]);
  const targetBefore = targetNow + victimDebitCents;
  if (targetBefore < BOUNTY_MIN_TARGET_CENTS || targetBefore < killerNow * BOUNTY_TARGET_MULTIPLE) return { status: 'refused', reason: 'target-too-small' };
  if (await areFriends(db, killerDevice, holder.device)) return { status: 'refused', reason: 'friends' };
  if (await killedRecently(db, killerDevice, holder.device, now - BOUNTY_PAIR_COOLDOWN_MS)) return { status: 'refused', reason: 'recent-pair' };
  const day = fundingDay(now), claimId = crypto.randomUUID(), ref = bountyCreditRef(day);
  const claim = await db.prepare(`INSERT OR IGNORE INTO bounty_claims(claim_id,day,target_device,killer_device,amount_cents,status,claimed_at)
    VALUES(?,?,?,?,?,'claiming',?)`).bind(claimId, day, holder.device, killerDevice, Number(amount), now).run();
  if ((claim.meta?.changes ?? 0) !== 1) return { status: 'already' };
  let credited = false, reason = 'not-credited';
  try {
    credited = (await deps.award({ deviceId: killerDevice, sourceRef: ref, label: `Bounty: took down ${holder.name}`.slice(0, 80), amountCents: amount, now })).credited;
  } catch (error) {
    reason = error instanceof Error ? error.message.slice(0, 60) : 'award-failed';
    // The credit may have committed before the throw (e.g. a later profile refresh failed): then it's paid.
    credited = !!(await db.prepare(CREDIT_EXISTS).bind(killerDevice, ref).first().catch(() => null));
  }
  if (credited) {
    await db.prepare("UPDATE bounty_claims SET status='paid' WHERE claim_id=?").bind(claimId).run();
    return { status: 'paid', amountCents: amount };
  }
  // Nothing was paid: release the claim so the target is still worth taking down today.
  await db.prepare("DELETE FROM bounty_claims WHERE claim_id=? AND status='claiming'").bind(claimId).run();
  return { status: 'failed', reason };
}

/** Targets already taken down for a bounty today (they stop being Most Wanted until tomorrow). */
export async function claimedTargetsToday(db: D1Database, now: number): Promise<Set<string>> {
  const rows = await db.prepare('SELECT target_device FROM bounty_claims WHERE day=?').bind(fundingDay(now)).all<{ target_device: string }>();
  return new Set(rows.results.map(r => r.target_device));
}
