import { flags } from '@gtasf/shared/flags';
import { FUNDING_MAX_CENTS, FUNDING_SEASON, REFERRAL_QUALIFIED_PLAY_MS, fundingDay, type FundingProfile } from '@gtasf/shared/funding';
import { getFundingProfile } from './store';
import { recordFundingCredit } from './credits';

/** Founder decision (2026-10-03): referrals are in-game only — one qualified friend earns a generous $5M (v2).
 *  Economy v3 (Seed $75k) rescales every referral cheque so none can skip the ladder: a warm intro is worth
 *  $10k (under the ⅓-Seed angel cap), the friend's welcome cheque $2.5k (about one event), milestones $15k/$25k. */
const V3 = flags.economyV3;
export const WARM_INTRO_CENTS = V3 ? 1_000_000n : 500_000_000n;
/** A welcome cheque for the new player who arrived via a friend's link and actually played. */
export const REFERRAL_STARTER_CENTS = V3 ? 250_000n : 100_000_000n; // v3 $2.5k · v2 $1M
/** Escalating milestones for a referrer, keyed on their qualified-friend count. */
export const REFERRAL_MILESTONES: readonly { count: number; cents: bigint; label: string }[] = Object.freeze([
  { count: 5, cents: V3 ? 1_500_000n : 1_000_000_000n, label: 'Bonus round — 5 warm intros' },      // v3 $15k · v2 $10M
  { count: 10, cents: V3 ? 2_500_000n : 3_000_000_000n, label: 'Network effect — 10 warm intros' }, // v3 $25k · v2 $30M
]);
export interface WarmIntroResult { credited: boolean; profile: FundingProfile | null }

/** How many qualified warm intros a referrer has banked this season (drives the milestones). */
async function referrerWarmIntroCount(db: D1Database, referrer: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) n FROM funding_bonuses WHERE device_id=? AND season=? AND kind='warm-intro'")
    .bind(referrer, FUNDING_SEASON).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** Server-only adapter. Qualification is rechecked against durable WorldDO-observed play. */
export async function recordWarmIntro(db: D1Database, friendDeviceId: string, now: number): Promise<WarmIntroResult> {
  if (!Number.isSafeInteger(now) || now < 0) throw new RangeError('Invalid server clock');
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO funding_bonuses(id,device_id,friend_device_id,season,kind,day,awarded_at,amount_cents)
      SELECT ?,p.device_id,r.buyer_device_id,?,'warm-intro',?,?,?
      FROM referral_players r JOIN referral_devices friend ON friend.device_id=r.buyer_device_id
      JOIN referral_accounts buyer ON buyer.id=friend.account_id JOIN referral_accounts ref ON ref.id=r.referrer_id
      JOIN referral_accounts buyer_owner ON buyer_owner.id=COALESCE(buyer.owner_id,buyer.id)
      JOIN referral_accounts ref_owner ON ref_owner.id=COALESCE(ref.owner_id,ref.id)
      JOIN funding_profiles p ON p.device_id=ref.id
      WHERE r.buyer_device_id=? AND r.played_ms>=${REFERRAL_QUALIFIED_PLAY_MS} AND r.joined_at<=?
      AND ref_owner.id<>buyer_owner.id AND p.device_id<>r.buyer_device_id
      AND (ref_owner.email_hash IS NULL OR buyer_owner.email_hash IS NULL OR ref_owner.email_hash<>buyer_owner.email_hash)
      AND NOT EXISTS(SELECT 1 FROM referral_fraud_identities bi JOIN referral_fraud_identities ri ON bi.kind=ri.kind AND bi.hash=ri.hash
        JOIN referral_accounts ba ON ba.id=bi.account_id JOIN referral_accounts ra ON ra.id=ri.account_id
        WHERE COALESCE(ba.owner_id,ba.id)=buyer_owner.id AND COALESCE(ra.owner_id,ra.id)=ref_owner.id)
      AND (SELECT COALESCE(SUM(amount_cents),0) FROM funding_earnings WHERE device_id=p.device_id AND season=?)<=?
      ON CONFLICT(friend_device_id) DO NOTHING`).bind(id, FUNDING_SEASON, fundingDay(now), now, Number(WARM_INTRO_CENTS),
      friendDeviceId, now - REFERRAL_QUALIFIED_PLAY_MS, FUNDING_SEASON, Number(FUNDING_MAX_CENTS - WARM_INTRO_CENTS)),
    db.prepare(`UPDATE referral_players SET warm_intro_at=(SELECT awarded_at FROM funding_bonuses WHERE friend_device_id=?)
      WHERE buyer_device_id=? AND EXISTS(SELECT 1 FROM funding_bonuses WHERE friend_device_id=?)`)
      .bind(friendDeviceId, friendDeviceId, friendDeviceId),
  ]);
  const stored = await db.prepare('SELECT id,device_id FROM funding_bonuses WHERE friend_device_id=?')
    .bind(friendDeviceId).first<{ id: string; device_id: string }>();
  if (!stored) return { credited: false, profile: null };
  const referrer = stored.device_id;
  // In-game referral rewards (founder decision): a welcome cheque for the new player, plus escalating
  // milestones for the referrer. Both route through the cap-table credits ledger and are idempotent
  // (once-ever). allowUnnamed: a friend can qualify (2-min play) while still unnamed — onboarding
  // permits skip-and-play — and recordWarmIntro fires only once, so without this the starter would
  // throw on the unnamed profile, be swallowed, and never retry, losing the $1M forever (gtasf-q7x6).
  // The anti-farm gates already passed above; an unnamed profile holds the credit like the Orientation
  // award, and it shows on their total/cap table the moment they name their startup.
  await recordFundingCredit(db, { deviceId: friendDeviceId, source: 'warm-intro', sourceRef: 'referral-starter',
    label: 'Welcome cheque — joined via a friend', amountCents: REFERRAL_STARTER_CENTS, now, allowUnnamed: true }).catch(() => {});
  const warmIntros = await referrerWarmIntroCount(db, referrer);
  const milestone = REFERRAL_MILESTONES.find(m => m.count === warmIntros);
  if (milestone) await recordFundingCredit(db, { deviceId: referrer, source: 'warm-intro', sourceRef: `milestone:${milestone.count}`,
    label: milestone.label, amountCents: milestone.cents, now }).catch(() => {});
  return { credited: stored.id === id, profile: await getFundingProfile(db, referrer, now) };
}
