import { domainEmail } from '../../../shared/gtm/lead';
import { randomToken, tokenHash, tokenPattern } from './tokens';
export interface OfficeOffer {token_hash:string;lead_slug:string;company:string;domain:string;building_id:string;expires_at:number;revoked:number}
export async function getOffer(db:D1Database,token:string,now=Date.now()):Promise<OfficeOffer|null> {
  if(!tokenPattern.test(token))return null;
  return db.prepare('SELECT * FROM office_offers WHERE token_hash=? AND expires_at>? AND revoked=0').bind(await tokenHash(token),now).first<OfficeOffer>();
}
/** Writes a private draft only. Raw magic tokens are never returned to the requester or logged. */
export async function requestVerification(db:D1Database,offer:OfficeOffer,inputEmail:string,origin:string,now=Date.now()):Promise<'draft'|'domain-mismatch'|'rate-limited'> {
  const email=domainEmail(inputEmail,offer.domain);if(!email)return 'domain-mismatch';
  const token=randomToken(),hash=await tokenHash(token);
  // Atomic D1 write: at most five drafts per offer per rolling day, one per minute.
  const insert=await db.prepare(`INSERT INTO office_verifications(token_hash,offer_hash,email,created_at,expires_at)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM office_offers WHERE token_hash=? AND expires_at>? AND revoked=0)
    AND (SELECT COUNT(*) FROM office_verifications WHERE offer_hash=? AND created_at>?)<5
    AND NOT EXISTS(SELECT 1 FROM office_verifications WHERE offer_hash=? AND created_at>?)`).bind(hash,offer.token_hash,email,now,now+15*60_000,offer.token_hash,now,offer.token_hash,now-86400_000,offer.token_hash,now-60_000).run();
  if(!insert.meta.changes)return 'rate-limited';
  const url=`${origin}/claim/verify/${token}`;
  try {
    await db.prepare('INSERT INTO office_verification_drafts(token_hash,recipient,subject,body,created_at) VALUES(?,?,?,?,?)')
      .bind(hash,email,`Verify ${offer.company}'s GTASF office wrap`, `You requested verification for ${offer.company}. Open ${url} and confirm within 15 minutes. This only verifies your company email; it does not purchase or publish an ad. If you did not request this, ignore this draft.`,now).run();
  } catch(error) {await db.prepare('DELETE FROM office_verifications WHERE token_hash=?').bind(hash).run();throw error;}
  return 'draft';
}
export async function verifyEmail(db:D1Database,token:string,now=Date.now()):Promise<string|null> {
  if(!tokenPattern.test(token))return null;
  const session=randomToken();
  const result=await db.prepare(`UPDATE office_verifications SET used_at=?,session_hash=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?
    AND EXISTS(SELECT 1 FROM office_offers o WHERE o.token_hash=offer_hash AND o.revoked=0 AND o.expires_at>?)`)
    .bind(now,await tokenHash(session),await tokenHash(token),now,now).run();
  if(!result.meta.changes)return null;
  await db.prepare("UPDATE office_verification_drafts SET body='',status='expired' WHERE token_hash=?").bind(await tokenHash(token)).run();
  return session;
}
export async function verifiedOffer(db:D1Database,session:string,now=Date.now()):Promise<OfficeOffer|null> {
  if(!tokenPattern.test(session))return null;
  return db.prepare(`SELECT o.* FROM office_offers o JOIN office_verifications v ON v.offer_hash=o.token_hash
    WHERE v.session_hash=? AND v.used_at>? AND o.expires_at>? AND o.revoked=0`)
    .bind(await tokenHash(session),now-3600_000,now).first<OfficeOffer>();
}
