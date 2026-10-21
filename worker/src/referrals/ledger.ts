import { REFERRAL_PENDING_MS, REFERRAL_WINDOW_MS, type ReferralProduct } from '@gtasf/shared/referrals';
import { activeReferral, ensureReferralAccount } from './store';

export interface ReferralBuyer { deviceId: string; accountId: string; referrerId: string | null; firstSeenAt: number }
export interface ReferralOrderInput { orderId: string; product: ReferralProduct; buyer: ReferralBuyer; createdAt: number; cashCents: number }
export interface ReferralPayment {
  orderId: string; paymentId: string; cashCents: number; refundedCents: number; disputed: boolean;
  paidAt: number; observedAt: number; emailHash?: string; cardHash?: string;
}
export async function referralBuyer(db: D1Database, deviceId: string, now: number): Promise<ReferralBuyer> {
  const account = await ensureReferralAccount(db, deviceId, now);
  const device = await db.prepare('SELECT first_seen_at FROM referral_devices WHERE device_id=?').bind(deviceId).first<{ first_seen_at: number }>();
  const referral = await activeReferral(db, deviceId, now);
  return { deviceId, accountId: account.id, referrerId: referral?.referrerId ?? null, firstSeenAt: Math.min(device!.first_seen_at, account.created_at) };
}
function boundedCents(value: number) { return Number.isSafeInteger(value) && value >= 0 && value <= 99_999_999; }
/** Called before opening payment. Retry uses the immutable original checkout snapshot. */
export async function freezeReferralOrder(db: D1Database, input: ReferralOrderInput): Promise<void> {
  if (!boundedCents(input.cashCents) || !['outbid','ad','billboard'].includes(input.product)) throw new Error('INVALID_REFERRAL_ORDER');
  await db.prepare(`INSERT OR IGNORE INTO referral_orders(order_id,product,buyer_device_id,buyer_account_id,referrer_id,created_at,eligible_until,cash_cents)
    VALUES(?,?,?,?,?,?,?,?)`).bind(input.orderId, input.product, input.buyer.deviceId, input.buyer.accountId,
      input.buyer.referrerId, input.createdAt, input.buyer.firstSeenAt + REFERRAL_WINDOW_MS, input.cashCents).run();
  const row = await db.prepare('SELECT * FROM referral_orders WHERE order_id=?').bind(input.orderId).first<{
    product: string; buyer_device_id: string; buyer_account_id: string; referrer_id: string | null; cash_cents: number;
  }>();
  if (!row || row.product !== input.product || row.buyer_device_id !== input.buyer.deviceId || row.buyer_account_id !== input.buyer.accountId
    || row.referrer_id !== input.buyer.referrerId || row.cash_cents !== input.cashCents) throw new Error('REFERRAL_ORDER_MISMATCH');
}
/** Stable normalized hashes; never store a card fingerprint or billing email in the ledger. */
export async function referralFraudHash(kind: 'email' | 'card', raw: string | null | undefined): Promise<string | undefined> {
  if (!raw) return;
  const value = kind === 'email' ? raw.trim().toLowerCase() : raw;
  if (!value || value.length > 320 || (kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) return;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${kind}:${value}`)));
  return [...hash].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

const selfReferral = `EXISTS(SELECT 1 FROM referral_accounts buyer JOIN referral_accounts ref
  WHERE buyer.id=o.buyer_account_id AND ref.id=o.referrer_id AND
  (COALESCE(buyer.owner_id,buyer.id)=COALESCE(ref.owner_id,ref.id)
  OR EXISTS(SELECT 1 FROM referral_fraud_identities bi JOIN referral_fraud_identities ri ON bi.kind=ri.kind AND bi.hash=ri.hash
    JOIN referral_accounts ba ON ba.id=bi.account_id JOIN referral_accounts ra ON ra.id=ri.account_id
    WHERE COALESCE(ba.owner_id,ba.id)=COALESCE(buyer.owner_id,buyer.id) AND COALESCE(ra.owner_id,ra.id)=COALESCE(ref.owner_id,ref.id))))`;
const affected = `EXISTS(SELECT 1 FROM referral_accounts side JOIN referral_accounts actor WHERE actor.id=?
  AND (side.id=o.buyer_account_id OR side.id=o.referrer_id) AND COALESCE(side.owner_id,side.id)=COALESCE(actor.owner_id,actor.id))`;

/** Append corrections for this buyer/referrer's affected orders inside the same D1 transaction. */
export function referralReconciliation(db: D1Database, accountId: string, sourceId: string, now: number): D1PreparedStatement[] {
  return [
    db.prepare(`UPDATE referral_payments SET target_cents=CASE WHEN blocked=1 OR disputed=1 THEN 0 ELSE
      (SELECT CASE WHEN o.referrer_id IS NULL OR referral_payments.paid_at>=min(o.eligible_until,owner.created_at+?) THEN 0
       ELSE (o.cash_cents-referral_payments.refunded_cents)/5 END FROM referral_orders o
       JOIN referral_accounts buyer ON buyer.id=o.buyer_account_id JOIN referral_accounts owner ON owner.id=COALESCE(buyer.owner_id,buyer.id)
       WHERE o.order_id=referral_payments.order_id) END
      WHERE order_id IN (SELECT o.order_id FROM referral_orders o WHERE ${affected})`).bind(REFERRAL_WINDOW_MS, accountId),
    db.prepare(`UPDATE referral_payments SET blocked=1,target_cents=0 WHERE order_id IN
      (SELECT o.order_id FROM referral_orders o WHERE ${affected} AND ${selfReferral})`).bind(accountId),
    db.prepare(`INSERT INTO referral_ledger(id,order_id,account_id,amount_cents,available_at,kind,source_id,created_at)
      SELECT lower(hex(randomblob(16))),p.order_id,o.referrer_id,
        p.target_cents-COALESCE((SELECT SUM(l.amount_cents) FROM referral_ledger l WHERE l.order_id=p.order_id AND l.kind='commission'),0),
        p.paid_at+?,'commission',?,? FROM referral_payments p JOIN referral_orders o ON o.order_id=p.order_id
      WHERE o.referrer_id IS NOT NULL AND ${affected}
      AND p.target_cents<>COALESCE((SELECT SUM(l.amount_cents) FROM referral_ledger l WHERE l.order_id=p.order_id AND l.kind='commission'),0)`)
      .bind(REFERRAL_PENDING_MS, sourceId, now, accountId),
  ];
}
/** Only verified Stripe settlement callers may invoke this; no public route accepts amounts. */
export async function applyReferralPayment(db: D1Database, eventId: string, payment: ReferralPayment): Promise<void> {
  if (!boundedCents(payment.cashCents) || !boundedCents(payment.refundedCents) || payment.refundedCents > payment.cashCents
    || !Number.isSafeInteger(payment.paidAt) || !Number.isSafeInteger(payment.observedAt)) throw new Error('INVALID_REFERRAL_PAYMENT');
  const order = await db.prepare('SELECT buyer_account_id,cash_cents FROM referral_orders WHERE order_id=?').bind(payment.orderId).first<{ buyer_account_id: string; cash_cents: number }>();
  if (!order || order.cash_cents !== payment.cashCents) throw new Error('REFERRAL_PAYMENT_MISMATCH');
  const prior = await db.prepare('SELECT payment_id FROM referral_payments WHERE order_id=?').bind(payment.orderId).first<{ payment_id: string }>();
  if (prior && prior.payment_id !== payment.paymentId) throw new Error('REFERRAL_PAYMENT_ID_MISMATCH');
  const statements: D1PreparedStatement[] = [];
  for (const [kind, hash] of [['email', payment.emailHash], ['card', payment.cardHash]] as const) {
    if (hash && /^[a-f0-9]{64}$/.test(hash)) statements.push(db.prepare('INSERT OR IGNORE INTO referral_fraud_identities(account_id,kind,hash) VALUES(?,?,?)').bind(order.buyer_account_id, kind, hash));
  }
  statements.push(db.prepare(`INSERT INTO referral_payments(order_id,payment_id,refunded_cents,disputed,paid_at,observed_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET refunded_cents=max(refunded_cents,excluded.refunded_cents),
    disputed=excluded.disputed,observed_at=excluded.observed_at
    WHERE payment_id=excluded.payment_id AND excluded.observed_at>=observed_at`)
    .bind(payment.orderId, payment.paymentId, payment.refundedCents, Number(payment.disputed), payment.paidAt, payment.observedAt));
  statements.push(db.prepare(`UPDATE referral_payments SET target_cents=CASE WHEN blocked=1 OR disputed=1 THEN 0
    ELSE (SELECT CASE WHEN o.referrer_id IS NULL OR referral_payments.paid_at>=o.eligible_until THEN 0
      ELSE (o.cash_cents-referral_payments.refunded_cents)/5 END FROM referral_orders o WHERE o.order_id=referral_payments.order_id) END
    WHERE order_id=?`).bind(payment.orderId));
  statements.push(...referralReconciliation(db, order.buyer_account_id, eventId, payment.observedAt));
  await db.batch(statements);
}
/** Claim verification can discover an existing self-referral and must claw it back. */
export async function recordReferralVerifiedEmail(db: D1Database, accountId: string, emailHash: string, now: number): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(emailHash)) throw new Error('INVALID_EMAIL_HASH');
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO referral_fraud_identities(account_id,kind,hash) VALUES(?,'email',?)").bind(accountId, emailHash),
    ...referralReconciliation(db, accountId, `email:${crypto.randomUUID()}`, now),
  ]);
}
export async function referralBalances(db: D1Database, accountId: string, now: number): Promise<{ pendingCents: string; availableCents: string; debtCents: string }> {
  // Decimal conversion happens in SQLite, avoiding lossy JS Number aggregate reads.
  const row = await db.prepare(`SELECT CAST(COALESCE(SUM(CASE WHEN available_at>? THEN amount_cents ELSE 0 END),0) AS TEXT) pending,
    CAST(COALESCE(SUM(CASE WHEN available_at<=? THEN amount_cents ELSE 0 END),0) AS TEXT) available
    FROM referral_ledger WHERE account_id IN (SELECT id FROM referral_accounts WHERE COALESCE(owner_id,id)=
      (SELECT COALESCE(owner_id,id) FROM referral_accounts WHERE id=?))`).bind(now, now, accountId).first<{ pending: string; available: string }>();
  const pending = BigInt(row?.pending ?? '0'), available = BigInt(row?.available ?? '0');
  return { pendingCents: (pending > 0n ? pending : 0n).toString(), availableCents: (available > 0n ? available : 0n).toString(),
    debtCents: (available < 0n ? -available : 0n).toString() };
}
