import { FUNDING_MAX_CENTS, FUNDING_SEASON, fundingCents, fundingDay, fundingRound,
  type FundingAward, type FundingProfile, type FundingRound, type FundingSource } from '@gtasf/shared/funding';
import { groupCapTableRows, isFundingSource, type CapTable, type CapTableEntry } from '@gtasf/shared/captable';
import { flags } from '@gtasf/shared/flags';
import { getFundingProfile } from './store';
import { refreshEconomyV3Current } from './economyV3';

/** Single-cheque ceiling for a credit. v2: generous enough for celebrity mega-cheques ($100M). Economy v3:
 *  $200k, above the largest legitimate cheque (a 12× investor event ≈ $135.6k) and far below a v2 amount. */
export const MAX_CREDIT_CENTS = flags.economyV3 ? 20_000_000n : 10_000_000_000n;

export interface FundingCreditInput {
  deviceId: string;
  source: FundingSource;
  /** Unique within (device, season, source): the event id, drop id, celebrity id or intro id. */
  sourceRef: string;
  /** Public display name of the backer (event title, fund name, investor). */
  label: string;
  amountCents: bigint | string;
  now: number;
  /** Optional JSON blob for provenance (e.g. the event funding quote). Never shown publicly. */
  metaJson?: string;
  /** Skip the named-startup requirement (only the server-validated Founder Orientation award, which
   *  pays before the identity screen). */
  allowUnnamed?: boolean;
}
export interface FundingCredit {
  id: string; source: FundingSource; sourceRef: string; label: string;
  amountCents: string; awardedAt: number; day: string;
}
export interface FundingCreditResult {
  /** false => already credited (once-ever) or the season funding ceiling was reached. */
  credited: boolean;
  credit: FundingCredit;
  profile: FundingProfile;
  previousRound: FundingRound;
}

interface CreditRow {
  id: string; device_id: string; season: string; source: string; source_ref: string;
  label: string; day: string; awarded_at: number; amount_cents: number; meta_json: string | null;
}

/** Trim, strip control characters and bound a backer label before it is stored or shown. */
export function normalizeCreditLabel(value: unknown): string {
  if (typeof value !== 'string') throw new RangeError('Invalid funding label');
  const clean = value.normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, '')
    .replace(/\s+/g, ' ').trim();
  if (clean.length < 1 || [...clean].length > 120) throw new RangeError('Invalid funding label');
  return clean;
}

export async function alreadyCredited(db: D1Database, deviceId: string, source: FundingSource, sourceRef: string): Promise<boolean> {
  return Boolean(await db.prepare('SELECT id FROM funding_credits WHERE device_id=? AND season=? AND source=? AND source_ref=?')
    .bind(deviceId, FUNDING_SEASON, source, sourceRef).first());
}

/** All source_refs a device has already been credited for in a source, for an in-memory once-ever cache. */
export async function creditedRefs(db: D1Database, deviceId: string, source: FundingSource): Promise<Set<string>> {
  const rows = await db.prepare('SELECT source_ref FROM funding_credits WHERE device_id=? AND season=? AND source=?')
    .bind(deviceId, FUNDING_SEASON, source).all<{ source_ref: string }>();
  return new Set(rows.results.map(row => row.source_ref));
}

function rowToCredit(row: CreditRow): FundingCredit {
  return { id: row.id, source: row.source as FundingSource, sourceRef: row.source_ref, label: row.label,
    amountCents: String(row.amount_cents), awardedAt: row.awarded_at, day: row.day };
}

/**
 * Shared v2 payout API (PLAN-v2 decision 5). One conditional INSERT is the atomic money
 * boundary: the UNIQUE(device,season,source,source_ref) guarantees "pays once, ever", and the
 * SUM guard keeps the season total under the ceiling even under concurrent calls. VC fund drops,
 * celebrity angels and drive-through events all credit through here so they appear on the cap table.
 */
export async function recordFundingCredit(db: D1Database, input: FundingCreditInput): Promise<FundingCreditResult> {
  if (!isFundingSource(input.source)) throw new RangeError('Invalid funding source');
  // VC fund drops have their own capacity-aware ledger (fund_drop_claims, pane 7); routing them here
  // too would double-count a drop cheque in funding_earnings. Keep them out of this ledger.
  if (input.source === 'vc-drop') throw new RangeError('VC fund drops are recorded via fund_drop_claims');
  if (typeof input.sourceRef !== 'string' || input.sourceRef.length < 1 || input.sourceRef.length > 200) throw new RangeError('Invalid funding source reference');
  const label = normalizeCreditLabel(input.label);
  const amount = typeof input.amountCents === 'bigint' ? input.amountCents : fundingCents(input.amountCents);
  if (amount <= 0n || amount > MAX_CREDIT_CENTS) throw new RangeError('Invalid funding credit amount');
  const before = await getFundingProfile(db, input.deviceId, input.now);
  if (!input.allowUnnamed && (!before.startupName || !before.nickname)) throw new RangeError('Choose your startup and nickname first');
  const id = crypto.randomUUID(), day = fundingDay(input.now);
  await db.prepare(`INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents,meta_json)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(amount_cents),0) FROM funding_earnings WHERE device_id=? AND season=?) <= ?
    ON CONFLICT(device_id,season,source,source_ref) DO NOTHING`).bind(id, input.deviceId, FUNDING_SEASON, input.source, input.sourceRef,
    label, day, input.now, Number(amount), input.metaJson ?? null, input.deviceId, FUNDING_SEASON, Number(FUNDING_MAX_CENTS - amount)).run();
  const stored = await db.prepare('SELECT * FROM funding_credits WHERE device_id=? AND season=? AND source=? AND source_ref=?')
    .bind(input.deviceId, FUNDING_SEASON, input.source, input.sourceRef).first<CreditRow>();
  if (!stored) throw new RangeError('Funding limit reached');
  const credited = stored.id === id;
  if (flags.economyV3 && credited) await refreshEconomyV3Current(db, input.deviceId, input.now); // fold burn + book this credit into current
  const profile = await getFundingProfile(db, input.deviceId, input.now);
  return { credited, credit: rowToCredit(stored), profile,
    previousRound: credited ? before.round : fundingRound(fundingCents(profile.totalCents) - BigInt(stored.amount_cents)) };
}

/** Map a fresh credit to the award shape the HUD toast renders. */
export function creditAward(result: FundingCreditResult, now: number): FundingAward {
  const amount = result.credit.amountCents;
  return {
    id: result.credit.id, eventId: result.credit.sourceRef, eventTitle: result.credit.label,
    awardedAt: result.credit.awardedAt || now, day: result.credit.day, previousRound: result.previousRound,
    profile: result.profile, source: result.credit.source,
    kind: 'investor', baseCents: amount, timing: 'live', timeMultiplier: 1,
    crowdCount: 0, crowdMultiplier: 1, streakCount: 1, streakMultiplier: 1, preview: false, amountCents: amount,
  };
}

/**
 * A player's public cap table across every ledger: v2 credits (drive-through events, celebrity
 * angels, warm intros via {@link recordFundingCredit}), VC fund-drop cheques (pane 7's
 * fund_drop_claims, read as the vc-drop source), plus v1 event-room awards (as events) and referral
 * warm-intro bonuses. VC drops come only from fund_drop_claims, so nothing is double-counted.
 * Public fields only; never identity, email or payment data.
 */
export async function getCapTable(db: D1Database, deviceId: string, now: number): Promise<CapTable> {
  const profile = await getFundingProfile(db, deviceId, now);
  const rows = await db.prepare(`SELECT source,label,amount_cents,awarded_at FROM (
      SELECT source,label,amount_cents,awarded_at FROM funding_credits WHERE device_id=? AND season=? AND source<>'vc-drop'
      UNION ALL SELECT 'event' source,event_title label,amount_cents,awarded_at FROM funding_awards WHERE device_id=? AND season=?
      UNION ALL SELECT 'warm-intro' source,'Warm intro: ' || COALESCE(NULLIF(fp.nickname,''),'a friend') label,fb.amount_cents,fb.awarded_at FROM funding_bonuses fb LEFT JOIN funding_profiles fp ON fp.device_id=fb.friend_device_id WHERE fb.device_id=? AND fb.season=?
      UNION ALL SELECT 'vc-drop' source,fund_name label,amount_cents,claimed_at awarded_at FROM fund_drop_claims WHERE device_id=? AND season=?
    ) ORDER BY awarded_at DESC,label`)
    .bind(deviceId, FUNDING_SEASON, deviceId, FUNDING_SEASON, deviceId, FUNDING_SEASON, deviceId, FUNDING_SEASON)
    .all<{ source: string; label: string; amount_cents: number; awarded_at: number }>();
  const entries: CapTableEntry[] = rows.results.flatMap(row => isFundingSource(row.source)
    ? [{ source: row.source, label: row.label, amountCents: String(row.amount_cents), awardedAt: row.awarded_at }] : []);
  return { deviceId, startupName: profile.startupName, nickname: profile.nickname, round: profile.round,
    totalCents: profile.totalCents, groups: groupCapTableRows(entries), serverNow: now };
}
