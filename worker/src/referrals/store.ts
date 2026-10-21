import { REFERRAL_WINDOW_MS, validReferralCode, validReferralVisit, type ReferralProfile } from '@gtasf/shared/referrals';
import { flags } from '@gtasf/shared/flags';

export interface ReferralAccount { id: string; code: string; created_at: number; email_hash: string | null; claimed_at: number | null; owner_id: string | null }
export async function referralAccountForDevice(db: D1Database, deviceId: string): Promise<ReferralAccount | null> {
  return db.prepare('SELECT owner.* FROM referral_devices d JOIN referral_accounts a ON d.account_id=a.id JOIN referral_accounts owner ON owner.id=COALESCE(a.owner_id,a.id) WHERE d.device_id=?').bind(deviceId).first<ReferralAccount>();
}
export async function ensureReferralAccount(db: D1Database, deviceId: string, now: number): Promise<ReferralAccount> {
  const existing = await referralAccountForDevice(db, deviceId);
  if (existing) return existing;
  const code = [...crypto.getRandomValues(new Uint8Array(12))].map(v => v.toString(16).padStart(2, '0')).join('');
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO referral_accounts(id,code,created_at) VALUES(?,?,?)').bind(deviceId, code, now),
    db.prepare('INSERT OR IGNORE INTO referral_devices(device_id,account_id,first_seen_at) VALUES(?,?,?)').bind(deviceId, deviceId, now),
  ]);
  const account = await referralAccountForDevice(db, deviceId);
  if (!account) throw new Error('REFERRAL_IDENTITY_UNAVAILABLE');
  return account;
}
/** Atomic conditional increment: parallel requests cannot exceed the limit. */
export async function referralRateLimit(db: D1Database, key: string, maximum: number, windowMs: number, now: number): Promise<boolean> {
  const row = await db.prepare(`INSERT INTO referral_limits(key,window_at,count) VALUES(?,?,1)
    ON CONFLICT(key) DO UPDATE SET window_at=CASE WHEN window_at<=? THEN excluded.window_at ELSE window_at END,
    count=CASE WHEN window_at<=? THEN 1 ELSE count+1 END WHERE window_at<=? OR count<? RETURNING count`)
    .bind(key, now, now - windowMs, now - windowMs, now - windowMs, maximum).first();
  return Boolean(row);
}
export async function recordReferralVisit(db: D1Database, deviceId: string, code: unknown, visitId: unknown, now: number): Promise<boolean> {
  if (!validReferralCode(code) || !validReferralVisit(visitId)) return false;
  // Device/account and verified email comparisons are repeated at payment settlement.
  const eligible = `SELECT ref.id FROM referral_accounts a JOIN referral_accounts ref ON ref.id=COALESCE(a.owner_id,a.id)
    JOIN referral_devices d ON d.device_id=? JOIN referral_accounts original ON original.id=d.account_id
    JOIN referral_accounts buyer ON buyer.id=COALESCE(original.owner_id,original.id) WHERE a.code=? AND ref.id<>buyer.id
    AND (ref.email_hash IS NULL OR buyer.email_hash IS NULL OR ref.email_hash<>buyer.email_hash)`;
  const result = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO referral_clicks(visit_id,referrer_id,buyer_device_id,clicked_at)
      SELECT ?,a.id,?,? FROM referral_accounts a WHERE a.id IN (${eligible})`).bind(visitId, deviceId, now, deviceId, code),
    db.prepare(`INSERT INTO referral_attributions(buyer_device_id,referrer_id,clicked_at,expires_at)
      SELECT buyer_device_id,referrer_id,clicked_at,clicked_at+? FROM referral_clicks
      WHERE visit_id=? AND buyer_device_id=? AND clicked_at=?
      ON CONFLICT(buyer_device_id) DO UPDATE SET referrer_id=excluded.referrer_id,clicked_at=excluded.clicked_at,expires_at=excluded.expires_at
      WHERE excluded.clicked_at>referral_attributions.clicked_at`).bind(REFERRAL_WINDOW_MS, visitId, deviceId, now),
  ]);
  return (result[0]?.meta.changes ?? 0) > 0;
}
export interface ReferralAttribution { referrerId: string; buyerDeviceId: string; buyerAccountId: string; firstSeenAt: number; clickedAt: number }
/** Resolve only on the server and freeze this result onto the checkout order. */
export async function activeReferral(db: D1Database, deviceId: string, now: number): Promise<ReferralAttribution | null> {
  const row = await db.prepare(`SELECT ref.id referrer_id,buyer.id account_id,min(d.first_seen_at,buyer.created_at) first_seen_at,r.clicked_at
    FROM referral_attributions r JOIN referral_devices d ON d.device_id=r.buyer_device_id
    JOIN referral_accounts original ON original.id=d.account_id JOIN referral_accounts buyer ON buyer.id=COALESCE(original.owner_id,original.id)
    JOIN referral_accounts original_ref ON original_ref.id=r.referrer_id JOIN referral_accounts ref ON ref.id=COALESCE(original_ref.owner_id,original_ref.id)
    WHERE r.buyer_device_id=? AND r.expires_at>? AND min(d.first_seen_at,buyer.created_at)+?>? AND ref.id<>buyer.id
    AND (ref.email_hash IS NULL OR buyer.email_hash IS NULL OR ref.email_hash<>buyer.email_hash)`)
    .bind(deviceId, now, REFERRAL_WINDOW_MS, now).first<{ referrer_id: string; account_id: string; first_seen_at: number; clicked_at: number }>();
  return row ? { referrerId: row.referrer_id, buyerDeviceId: deviceId, buyerAccountId: row.account_id, firstSeenAt: row.first_seen_at, clickedAt: row.clicked_at } : null;
}
/** Only call after the WorldDO has accepted this authenticated player's connection. */
export async function recordReferralPlayer(db: D1Database, deviceId: string, now: number): Promise<void> {
  const referral = await activeReferral(db, deviceId, now);
  if (referral) await db.prepare('INSERT OR IGNORE INTO referral_players(buyer_device_id,referrer_id,joined_at) VALUES(?,?,?)').bind(deviceId, referral.referrerId, now).run();
}
export async function referralProfile(db: D1Database, account: ReferralAccount): Promise<ReferralProfile> {
  const counts = await db.prepare(`SELECT (SELECT COUNT(*) FROM referral_clicks WHERE referrer_id IN (SELECT id FROM referral_accounts WHERE COALESCE(owner_id,id)=?)) clicks,
    (SELECT COUNT(*) FROM referral_players WHERE referrer_id IN (SELECT id FROM referral_accounts WHERE COALESCE(owner_id,id)=?)) players`).bind(account.id, account.id).first<{ clicks: number; players: number }>();
  // PLAN-v2: referrals award in-game funding. Keep zero-valued legacy fields for older
  // clients, but never read/reconcile the retired cash ledger during boot or sharing.
  // Historical payment settlement still owns its ledger; email identity stays intact.
  return { code: account.code, clicks: counts?.clicks ?? 0, players: counts?.players ?? 0,
    pendingCents: '0', availableCents: '0', debtCents: '0',
    claimed: account.claimed_at !== null, creditEnabled: false, claimEnabled: flags.referralClaims, cashoutEnabled: false };
}
