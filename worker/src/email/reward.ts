import { flags } from '@gtasf/shared/flags';
import { EMAIL_VERIFY_BONUS_CENTS, type EmailReward } from '@gtasf/shared/email/contract';
import { FUNDING_MAX_CENTS, FUNDING_SEASON, fundingDay } from '@gtasf/shared/funding';
import { refreshEconomyV3Current } from '../funding/economyV3';
import { getFundingProfile } from '../funding/store';
import { getCapture } from './store';

export const EMAIL_REWARD_REF = 'founder-email-verification';

/** A server-verified milestone, like Founder Orientation. Never store an email
 * or its hash in the public credit reference/label. D1 batches serialize the
 * credit and address claim together, so concurrent verifies cannot pay twice.
 */
export async function grantEmailReward(db: D1Database, deviceId: string, now: number): Promise<EmailReward> {
  if (!flags.emailCapture) return { verifiedFounder: false, bonusCents: 0 };
  if (!Number.isSafeInteger(now) || now < 0) throw new RangeError('Invalid server clock');
  const capture = await getCapture(db, deviceId);
  if (capture?.verified_at == null) return { verifiedFounder: false, bonusCents: 0 };
  // Use the canonical enable/reset path before booking the cheque, so a later
  // first v3 profile read cannot wipe the new reward as old progress.
  if (flags.economyV3) await getFundingProfile(db, deviceId, now);
  const result = await db.batch([
    db.prepare(`INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents)
      SELECT ?,e.device_id,?,'event',?,'Verified Founder bonus',?,?,? FROM email_captures e
      WHERE e.device_id=? AND e.verified_at IS NOT NULL AND e.rewarded_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM funding_credits prior WHERE prior.device_id=e.device_id
        AND prior.source='event' AND prior.source_ref=?)
      AND NOT EXISTS(SELECT 1 FROM email_captures paid WHERE paid.email_hash=e.email_hash
        AND paid.device_id<>e.device_id AND paid.rewarded_at IS NOT NULL)
      AND (SELECT COALESCE(SUM(amount_cents),0) FROM funding_earnings WHERE device_id=e.device_id AND season=?)<=?
      ON CONFLICT(device_id,season,source,source_ref) DO NOTHING`)
      .bind(crypto.randomUUID(), FUNDING_SEASON, EMAIL_REWARD_REF, fundingDay(now), now, EMAIL_VERIFY_BONUS_CENTS,
        deviceId, EMAIL_REWARD_REF, FUNDING_SEASON, Number(FUNDING_MAX_CENTS - BigInt(EMAIL_VERIFY_BONUS_CENTS))),
    db.prepare(`UPDATE email_captures SET rewarded_at=COALESCE(rewarded_at,?)
      WHERE device_id=? AND verified_at IS NOT NULL AND EXISTS(SELECT 1 FROM funding_credits
        WHERE device_id=? AND source='event' AND source_ref=?)`)
      .bind(now, deviceId, deviceId, EMAIL_REWARD_REF),
  ]);
  if (flags.economyV3) await refreshEconomyV3Current(db, deviceId, now);
  return { verifiedFounder: true, bonusCents: result[0]?.meta.changes === 1 ? EMAIL_VERIFY_BONUS_CENTS : 0 };
}
