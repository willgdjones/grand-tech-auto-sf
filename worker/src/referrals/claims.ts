import { secretToken } from '../world/admission/http';
import { sha256 } from '../outbid/linkcheck';
import { referralFraudHash, referralReconciliation } from './ledger';
import { referralAccountForDevice, referralRateLimit } from './store';

/** Founder provisions a GTASF-only transactional-email service; absent binding means no delivery. */
export interface ReferralMailEnv { REFERRAL_MAILER?: Fetcher }
export function claimDeliveryAvailable(env: ReferralMailEnv): boolean { return Boolean(env.REFERRAL_MAILER); }
export async function requestReferralClaim(db: D1Database, deviceId: string, rawEmail: unknown, origin: string, env: ReferralMailEnv, now: number): Promise<void> {
  if (!env.REFERRAL_MAILER) throw new Error('CLAIM_DELIVERY_UNAVAILABLE');
  if (typeof rawEmail !== 'string') throw new Error('INVALID_EMAIL');
  const email = rawEmail.trim().toLowerCase(), emailHash = await referralFraudHash('email', email);
  if (!emailHash) throw new Error('INVALID_EMAIL');
  const account = await referralAccountForDevice(db, deviceId);
  if (!account || (account.email_hash && account.email_hash !== emailHash)) throw new Error('CLAIM_ACCOUNT_UNAVAILABLE');
  if (!await referralRateLimit(db, `claim-device:${deviceId}`, 3, 3_600_000, now)
    || !await referralRateLimit(db, `claim-email:${emailHash}`, 3, 3_600_000, now)) throw new Error('CLAIM_RATE_LIMIT');
  const id = crypto.randomUUID(), token = secretToken();
  await db.prepare('INSERT INTO referral_email_claims(id,device_id,account_id,email_hash,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?)')
    .bind(id, deviceId, account.id, emailHash, await sha256(token), now, now + 30 * 60_000).run();
  const url = new URL('/', origin); url.hash = `referral-claim=${id}.${token}`;
  const response = await env.REFERRAL_MAILER.fetch('https://referral-mailer.internal/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id },
    body: JSON.stringify({ to: email, subject: 'Verify your GTASF referral earnings',
      text: `You requested to claim your GTASF referral earnings. Open this link in the same browser that requested it within 30 minutes: ${url.href}\n\nThis verifies your email and may restore your existing referral balance. It does not buy anything or enable cash-out. If you did not request this, ignore this email.` }),
    signal: AbortSignal.timeout(5000),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error('CLAIM_DELIVERY_UNAVAILABLE');
}

export async function verifyReferralClaim(db: D1Database, deviceId: string, rawProof: unknown, now: number): Promise<void> {
  if (typeof rawProof !== 'string') throw new Error('INVALID_CLAIM');
  const match = /^([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(rawProof);
  if (!match) throw new Error('INVALID_CLAIM');
  const claim = await db.prepare('SELECT account_id,email_hash FROM referral_email_claims WHERE id=? AND token_hash=? AND device_id=? AND used_at IS NULL AND expires_at>?')
    .bind(match[1]!, await sha256(match[2]!), deviceId, now).first<{ account_id: string; email_hash: string }>();
  const account = await referralAccountForDevice(db, deviceId);
  if (!claim || !account || account.id !== claim.account_id || (account.email_hash && account.email_hash !== claim.email_hash)) throw new Error('INVALID_CLAIM');
  const nonce = crypto.randomUUID();
  const guard = `EXISTS(SELECT 1 FROM referral_email_claims WHERE id=? AND consume_nonce=?)`;
  const result = await db.batch([
    db.prepare(`UPDATE referral_email_claims SET used_at=?,consume_nonce=? WHERE id=? AND device_id=? AND used_at IS NULL AND expires_at>?
      AND EXISTS(SELECT 1 FROM referral_accounts a WHERE a.id=referral_email_claims.account_id AND a.owner_id IS NULL
        AND (a.email_hash IS NULL OR a.email_hash=referral_email_claims.email_hash))`)
      .bind(now, nonce, match[1]!, deviceId, now),
    db.prepare(`UPDATE referral_accounts SET email_hash=?,claimed_at=? WHERE id=? AND ${guard}
      AND NOT EXISTS(SELECT 1 FROM referral_accounts WHERE email_hash=?)`).bind(claim.email_hash, now, account.id, match[1]!, nonce, claim.email_hash),
    // Keep the oldest first visit when recovering/combining verified earnings.
    db.prepare(`UPDATE referral_accounts SET created_at=min(created_at,?) WHERE email_hash=? AND ${guard}`).bind(account.created_at, claim.email_hash, match[1]!, nonce),
    // Flatten every alias in the anonymous source group into the verified owner.
    db.prepare(`UPDATE referral_accounts SET owner_id=(SELECT id FROM referral_accounts WHERE email_hash=?)
      WHERE (id=? OR owner_id=?) AND id<>(SELECT id FROM referral_accounts WHERE email_hash=?) AND ${guard}`)
      .bind(claim.email_hash, account.id, account.id, claim.email_hash, match[1]!, nonce),
    db.prepare(`INSERT OR IGNORE INTO referral_fraud_identities(account_id,kind,hash)
      SELECT id,'email',? FROM referral_accounts WHERE COALESCE(owner_id,id)=(SELECT id FROM referral_accounts WHERE email_hash=?) AND ${guard}`)
      .bind(claim.email_hash, claim.email_hash, match[1]!, nonce),
    ...referralReconciliation(db, account.id, `claim:${nonce}`, now),
  ]);
  if (result[0]?.meta.changes !== 1) throw new Error('INVALID_CLAIM');
}
