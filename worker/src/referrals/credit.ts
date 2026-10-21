import { referralBalances } from './ledger';

export interface ReferralCreditQuote { grossCents: number; creditCents: number; cashCents: number; availableCents: string; claimed: boolean }
export interface ReferralCreditHold {
  order_id: string; account_id: string; gross_cents: number; credit_cents: number; consumed_cents: number;
  state: 'held' | 'consumed' | 'released'; session_id: string | null; payment_id: string | null; created_at: number; expires_at: number; refunded_cents: number;
}
function validGross(cents: number) { return Number.isSafeInteger(cents) && cents >= 100 && cents <= 99_999_999; }
/** Amount limits apply to gross purchases; Stripe cash remainder is either $0 or >=$0.50. */
export async function quoteReferralCredit(db: D1Database, accountId: string, grossCents: number, now: number): Promise<ReferralCreditQuote> {
  if (!validGross(grossCents)) throw new Error('INVALID_AMOUNT');
  const account = await db.prepare('SELECT claimed_at FROM referral_accounts WHERE id=?').bind(accountId).first<{ claimed_at: number | null }>();
  const balances = await referralBalances(db, accountId, now), available = BigInt(balances.availableCents);
  const claimed = account?.claimed_at != null;
  let credit = claimed ? (available < BigInt(grossCents) ? available : BigInt(grossCents)) : 0n;
  if (credit < BigInt(grossCents) && BigInt(grossCents) - credit < 50n) credit = BigInt(grossCents - 50);
  return { grossCents, creditCents: Number(credit), cashCents: grossCents - Number(credit), availableCents: balances.availableCents, claimed };
}
export async function referralCreditHold(db: D1Database, orderId: string): Promise<ReferralCreditHold | null> {
  return db.prepare('SELECT * FROM referral_credit_holds WHERE order_id=?').bind(orderId).first<ReferralCreditHold>();
}
/** The quoted discount is fixed. Insufficient balance never silently increases the cash charge. */
export async function reserveReferralCredit(db: D1Database, orderId: string, accountId: string, grossCents: number, creditCents: number, now: number): Promise<ReferralCreditHold> {
  if (!validGross(grossCents) || !Number.isSafeInteger(creditCents) || creditCents <= 0 || creditCents > grossCents
    || (grossCents !== creditCents && grossCents - creditCents < 50)) throw new Error('INVALID_CREDIT_QUOTE');
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO referral_credit_holds(order_id,account_id,gross_cents,credit_cents,consumed_cents,state,created_at,expires_at)
      SELECT ?,?,?,?,?, 'held',?,? FROM referral_accounts WHERE id=? AND claimed_at IS NOT NULL
      AND COALESCE((SELECT SUM(amount_cents) FROM referral_ledger WHERE account_id IN
        (SELECT id FROM referral_accounts WHERE COALESCE(owner_id,id)=?) AND available_at<=?),0)>=?`)
      .bind(orderId, accountId, grossCents, creditCents, creditCents, now, now + 1_800_000, accountId, accountId, now, creditCents),
    db.prepare(`INSERT OR IGNORE INTO referral_ledger(id,order_id,account_id,amount_cents,available_at,kind,source_id,created_at)
      SELECT 'hold:'||order_id,NULL,account_id,-credit_cents,created_at,'credit',order_id,created_at FROM referral_credit_holds WHERE order_id=?`).bind(orderId),
  ]);
  const hold = await referralCreditHold(db, orderId);
  if (!hold || hold.state !== 'held') throw new Error('CREDIT_UNAVAILABLE');
  if (hold.account_id !== accountId || hold.gross_cents !== grossCents || hold.credit_cents !== creditCents) throw new Error('CREDIT_ORDER_MISMATCH');
  return hold;
}
export async function bindReferralCredit(db: D1Database, orderId: string, sessionId: string): Promise<void> {
  const result = await db.prepare("UPDATE referral_credit_holds SET session_id=? WHERE order_id=? AND state='held' AND (session_id IS NULL OR session_id=?)")
    .bind(sessionId, orderId, sessionId).run();
  if (result.meta.changes !== 1) throw new Error('CREDIT_SESSION_MISMATCH');
}
/** No release on a browser redirect or elapsed clock: caller must retrieve a verified expired Stripe session. */
export async function releaseReferralCredit(db: D1Database, orderId: string, sessionId: string | null, now: number): Promise<void> {
  await db.batch([
    db.prepare("UPDATE referral_credit_holds SET state='released',consumed_cents=0 WHERE order_id=? AND session_id IS ? AND state='held'").bind(orderId, sessionId),
    db.prepare(`INSERT OR IGNORE INTO referral_ledger(id,order_id,account_id,amount_cents,available_at,kind,source_id,created_at)
      SELECT 'release:'||order_id,NULL,account_id,credit_cents,?,'credit',order_id,? FROM referral_credit_holds WHERE order_id=? AND state='released' AND session_id IS ?`)
      .bind(now, now, orderId, sessionId),
  ]);
}
export function remainingReferralCredit(creditCents: number, cashCents: number, refundedCents: number, disputed: boolean): number {
  if (disputed) return 0;
  return creditCents - (cashCents > 0 ? Number(BigInt(creditCents) * BigInt(refundedCents) / BigInt(cashCents)) : 0);
}
/** Consume before granting the cosmetic purchase. Replays after either DB commit remain safe. */
export async function settleReferralCredit(db: D1Database, orderId: string, sessionId: string, paymentId: string,
  cashCents: number, refundedCents: number, disputed: boolean, now: number): Promise<number> {
  const hold = await referralCreditHold(db, orderId);
  if (!hold || hold.state === 'released' || hold.session_id !== sessionId || (hold.payment_id && hold.payment_id !== paymentId)
    || cashCents !== hold.gross_cents - hold.credit_cents || !Number.isSafeInteger(refundedCents)
    || refundedCents < 0 || refundedCents > cashCents) throw new Error('CREDIT_PAYMENT_MISMATCH');
  const result = await db.batch([
    db.prepare(`UPDATE referral_credit_holds SET state='consumed',payment_id=?,
      consumed_cents=CASE WHEN ? THEN 0 WHEN gross_cents=credit_cents THEN credit_cents
      ELSE credit_cents-credit_cents*max(refunded_cents,?)/(gross_cents-credit_cents) END,
      refunded_cents=max(refunded_cents,?) WHERE order_id=? AND state<>'released' AND session_id=? AND (payment_id IS NULL OR payment_id=?) RETURNING consumed_cents`)
      .bind(paymentId, Number(disputed), refundedCents, refundedCents, orderId, sessionId, paymentId),
    db.prepare(`INSERT INTO referral_ledger(id,order_id,account_id,amount_cents,available_at,kind,source_id,created_at)
      SELECT lower(hex(randomblob(16))),NULL,account_id,-consumed_cents-COALESCE((SELECT SUM(amount_cents) FROM referral_ledger WHERE source_id=? AND kind='credit'),0),
      ?,'credit',order_id,? FROM referral_credit_holds WHERE order_id=? AND state='consumed'
      AND -consumed_cents<>COALESCE((SELECT SUM(amount_cents) FROM referral_ledger WHERE source_id=? AND kind='credit'),0)`)
      .bind(orderId, now, now, orderId, orderId),
  ]);
  if (result[0]?.meta.changes !== 1) throw new Error('CREDIT_PAYMENT_MISMATCH');
  return (result[0]!.results[0] as { consumed_cents: number }).consumed_cents;
}
