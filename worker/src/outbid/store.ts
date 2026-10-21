import { OUTBID_MAXIMUM_BID_CENTS, type OutbidCheckoutRequest, type OutbidEntry, type OutbidSnapshot, type OutbidViewer } from '@gtasf/shared/outbid';
import type { ReferralBuyer, ReferralOrderInput, ReferralPayment } from '../referrals/ledger';
import type { AnalyticsContext } from '@gtasf/shared/analytics';
import type { AnalyticsServerContext, ConversionReceipt } from '../analytics/xConversions';
import { remainingReferralCredit } from '../referrals/credit';

type Bidder = { id: string; token_hash: string; total_cents: string; reached_at: number; profile_at: number; name: string; message: string; url: string; logo_asset_id: string | null; blocked: number };
export type OutbidOrder = { id: string; bidder_id: string; request_key: string; body_hash: string; created_at: number; amount_cents: number; credit_cents: number; profile_json: string; session_id: string | null; checkout_url: string | null; status: string; context_json: string | null };
export interface OutbidOrderContext { referralBuyer?: ReferralBuyer; analytics?: AnalyticsContext; analyticsServer?: AnalyticsServerContext; conversionId?: string; returnOrigin?: string }
export interface OutbidReferralEffect { eventId: string; order: ReferralOrderInput; payment: ReferralPayment }
export interface OutbidAnalyticsEffect { orderId: string; context: AnalyticsContext; server?: AnalyticsServerContext; receipt: ConversionReceipt }
type Payment = { intent_id: string; order_id: string; credit_cents: number; refunded_cents: number; disputed: number };
export type OutbidAsset = { id: string; bidder_id: string; key: string; mime: string; width: number; height: number; status: string; review_id: string | null };
export interface ConfirmedPayment { orderId: string; intentId: string; amountCents: number; refundedCents: number; disputed: boolean; sessionId?: string; paidAt?: number; observedAt?: number; email?: string | null; cardFingerprint?: string | null }

/** SQLite serializes balances; cumulative money never crosses Number arithmetic. */
export class OutbidStore {
  private readonly sql: SqlStorage;
  constructor(private readonly storage: Pick<DurableObjectStorage, 'sql' | 'transactionSync'>) {
    this.sql = storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS outbid_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      INSERT OR IGNORE INTO outbid_meta VALUES('revision','0');
      CREATE TABLE IF NOT EXISTS outbid_bidders(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,total_cents TEXT NOT NULL DEFAULT '0',reached_at INTEGER NOT NULL,profile_at INTEGER NOT NULL DEFAULT 0,name TEXT NOT NULL DEFAULT '',message TEXT NOT NULL DEFAULT '',url TEXT NOT NULL DEFAULT '',logo_asset_id TEXT,blocked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS outbid_orders(id TEXT PRIMARY KEY,bidder_id TEXT NOT NULL,request_key TEXT NOT NULL,body_hash TEXT NOT NULL,created_at INTEGER NOT NULL,amount_cents INTEGER NOT NULL,profile_json TEXT NOT NULL,session_id TEXT UNIQUE,checkout_url TEXT,status TEXT NOT NULL DEFAULT 'pending',UNIQUE(bidder_id,request_key));
      CREATE TABLE IF NOT EXISTS outbid_payments(intent_id TEXT PRIMARY KEY,order_id TEXT NOT NULL UNIQUE,credit_cents INTEGER NOT NULL,refunded_cents INTEGER NOT NULL,disputed INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS outbid_webhooks(id TEXT PRIMARY KEY,processed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS outbid_limits(key TEXT PRIMARY KEY,window_at INTEGER NOT NULL,count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS outbid_assets(id TEXT PRIMARY KEY,bidder_id TEXT NOT NULL,key TEXT NOT NULL,mime TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',review_id TEXT);
      CREATE TABLE IF NOT EXISTS outbid_reviews(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL,decision TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS outbid_referral_outbox(event_id TEXT PRIMARY KEY,payload TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS outbid_analytics_outbox(order_id TEXT PRIMARY KEY,payload TEXT NOT NULL);`);
    if (!this.sql.exec<{ name: string }>('PRAGMA table_info(outbid_orders)').toArray().some(column => column.name === 'context_json'))
      this.sql.exec('ALTER TABLE outbid_orders ADD COLUMN context_json TEXT');
    if (!this.sql.exec<{ name: string }>('PRAGMA table_info(outbid_orders)').toArray().some(column => column.name === 'credit_cents'))
      this.sql.exec('ALTER TABLE outbid_orders ADD COLUMN credit_cents INTEGER NOT NULL DEFAULT 0');
  }
  private bump() {
    this.sql.exec("UPDATE outbid_meta SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='revision'");
    this.sql.exec("INSERT INTO outbid_meta(key,value) SELECT 'notify_revision',value FROM outbid_meta WHERE key='revision' ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  }
  get revision() { return Number(this.sql.exec<{ value: string }>("SELECT value FROM outbid_meta WHERE key='revision'").one().value); }
  pendingNotice(): number | null {
    const values = Object.fromEntries(this.sql.exec<{ key: string; value: string }>("SELECT key,value FROM outbid_meta WHERE key IN ('notify_revision','notified_revision')").toArray().map(row => [row.key, Number(row.value)]));
    return (values.notify_revision ?? 0) > (values.notified_revision ?? 0) ? values.notify_revision! : null;
  }
  markNotified(revision: number) { this.sql.exec("INSERT INTO outbid_meta VALUES('notified_revision',?) ON CONFLICT(key) DO UPDATE SET value=CAST(max(CAST(value AS INTEGER),CAST(excluded.value AS INTEGER)) AS TEXT)", String(revision)); }
  rateLimit(key: string, maximum: number, windowMs: number, now = Date.now()): boolean {
    return this.storage.transactionSync(() => {
      const prior = this.sql.exec<{ window_at: number; count: number }>('SELECT window_at,count FROM outbid_limits WHERE key=?', key).toArray()[0];
      const fresh = !prior || now - prior.window_at >= windowMs;
      if (!fresh && prior.count >= maximum) return false;
      this.sql.exec('INSERT INTO outbid_limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET window_at=excluded.window_at,count=excluded.count', key, fresh ? now : prior.window_at, fresh ? 1 : prior.count + 1);
      this.sql.exec('DELETE FROM outbid_limits WHERE window_at<?', now - 86_400_000);
      return true;
    });
  }
  createBidder(id: string, tokenHash: string, now = Date.now()) {
    this.sql.exec('INSERT INTO outbid_bidders(id,token_hash,reached_at) VALUES(?,?,?)', id, tokenHash, now);
  }
  authenticate(id: string, tokenHash: string): OutbidViewer | null {
    const bidder = this.sql.exec<Bidder>('SELECT * FROM outbid_bidders WHERE id=? AND token_hash=? AND blocked=0', id, tokenHash).toArray()[0];
    return bidder ? { bidderId: bidder.id, totalCents: bidder.total_cents } : null;
  }
  createOrder(id: string, bidderId: string, requestKey: string, bodyHash: string, profile: OutbidCheckoutRequest, now = Date.now(), context: OutbidOrderContext = {}): OutbidOrder {
    if (!Number.isSafeInteger(profile.amountCents) || profile.amountCents < 100 || profile.amountCents > OUTBID_MAXIMUM_BID_CENTS) throw new Error('INVALID_AMOUNT');
    const credit = profile.useCredit ? profile.expectedCreditCents! : 0;
    if (!Number.isSafeInteger(credit) || credit < 0 || credit > profile.amountCents || (credit !== profile.amountCents && profile.amountCents - credit < 50)) throw new Error('INVALID_CREDIT_QUOTE');
    return this.storage.transactionSync(() => {
      const prior = this.sql.exec<OutbidOrder>('SELECT * FROM outbid_orders WHERE bidder_id=? AND request_key=?', bidderId, requestKey).toArray()[0];
      if (prior) { if (prior.body_hash !== bodyHash) throw new Error('IDEMPOTENCY_CONFLICT'); return prior; }
      const bidder = this.sql.exec<Bidder>('SELECT * FROM outbid_bidders WHERE id=? AND blocked=0', bidderId).toArray()[0];
      if (!bidder) throw new Error('BIDDER_UNAVAILABLE');
      this.sql.exec('INSERT INTO outbid_orders(id,bidder_id,request_key,body_hash,created_at,amount_cents,profile_json,context_json,credit_cents) VALUES(?,?,?,?,?,?,?,?,?)', id, bidderId, requestKey, bodyHash, now, profile.amountCents, JSON.stringify(profile), JSON.stringify(context), credit);
      return this.order(id)!;
    });
  }
  order(id: string) { return this.sql.exec<OutbidOrder>('SELECT * FROM outbid_orders WHERE id=?', id).toArray()[0] ?? null; }
  orderForRequest(bidderId: string, requestKey: string) { return this.sql.exec<OutbidOrder>('SELECT * FROM outbid_orders WHERE bidder_id=? AND request_key=?', bidderId, requestKey).toArray()[0] ?? null; }
  bindCheckout(orderId: string, sessionId: string, url: string) {
    this.storage.transactionSync(() => {
      const order = this.order(orderId); if (!order || (order.session_id && order.session_id !== sessionId)) throw new Error('CHECKOUT_MISMATCH');
      this.sql.exec('UPDATE outbid_orders SET session_id=?,checkout_url=? WHERE id=?', sessionId, url, orderId);
    });
  }
  bindRecoveredSession(orderId: string, sessionId: string) {
    this.sql.exec('UPDATE outbid_orders SET session_id=? WHERE id=? AND (session_id IS NULL OR session_id=?)', sessionId, orderId, sessionId);
  }
  expiredCreditOrders(now: number): OutbidOrder[] { return this.sql.exec<OutbidOrder>("SELECT * FROM outbid_orders WHERE status='pending' AND credit_cents>0 AND created_at<=? ORDER BY created_at LIMIT 10", now - 1_800_000).toArray(); }
  nextCreditExpiry(): number | null { return this.sql.exec<{ at: number | null }>("SELECT min(created_at)+1801000 at FROM outbid_orders WHERE status='pending' AND credit_cents>0").one().at; }
  expireOrder(orderId: string) { this.sql.exec("UPDATE outbid_orders SET status='expired' WHERE id=? AND status='pending'", orderId); }
  eventSeen(id: string) { return this.sql.exec('SELECT id FROM outbid_webhooks WHERE id=?', id).toArray().length > 0; }
  /** Called only after a verified webhook and retrieval of current Stripe payment state. */
  settle(eventId: string, payment: ConfirmedPayment, now = Date.now(), referral?: OutbidReferralEffect): { changed: boolean; credited: boolean; bidderId: string } {
    return this.storage.transactionSync(() => {
      const order = this.order(payment.orderId); if (!order) throw new Error('ORDER_NOT_FOUND');
      if (this.eventSeen(eventId)) return { changed: false, credited: false, bidderId: order.bidder_id };
      if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents !== order.amount_cents - order.credit_cents
        || !Number.isSafeInteger(payment.refundedCents) || payment.refundedCents < 0 || payment.refundedCents > payment.amountCents) throw new Error('PAYMENT_AMOUNT_MISMATCH');
      if (payment.amountCents === 0 && (!payment.sessionId || payment.sessionId !== order.session_id)) throw new Error('PAYMENT_ID_MISMATCH');
      const previous = this.sql.exec<Payment>('SELECT * FROM outbid_payments WHERE intent_id=? OR order_id=?', payment.intentId, order.id).toArray()[0];
      if (previous && (previous.order_id !== order.id || previous.intent_id !== payment.intentId)) throw new Error('PAYMENT_ID_MISMATCH');
      const refunded = Math.max(previous?.refunded_cents ?? 0, payment.refundedCents);
      const credit = payment.disputed ? 0 : payment.amountCents - refunded + remainingReferralCredit(order.credit_cents, payment.amountCents, refunded, false);
      const delta = BigInt(credit) - BigInt(previous?.credit_cents ?? 0);
      const bidder = this.sql.exec<Bidder>('SELECT * FROM outbid_bidders WHERE id=?', order.bidder_id).one();
      const total = BigInt(bidder.total_cents) + delta;
      if (total < 0n || total.toString().length > 19) throw new Error('BALANCE_RANGE');
      this.sql.exec('INSERT INTO outbid_payments VALUES(?,?,?,?,?) ON CONFLICT(intent_id) DO UPDATE SET credit_cents=excluded.credit_cents,refunded_cents=excluded.refunded_cents,disputed=excluded.disputed', payment.intentId, order.id, credit, refunded, Number(payment.disputed));
      const profile = JSON.parse(order.profile_json) as OutbidCheckoutRequest;
      const updateProfile = credit > 0 && order.created_at >= bidder.profile_at;
      const changed = delta !== 0n || (updateProfile && (bidder.name !== profile.name || bidder.message !== profile.message || bidder.url !== profile.url || bidder.logo_asset_id !== (profile.logoAssetId ?? null)));
      this.sql.exec('UPDATE outbid_bidders SET total_cents=?,reached_at=? WHERE id=?', total.toString(), delta !== 0n ? now : bidder.reached_at, bidder.id);
      if (updateProfile) this.sql.exec('UPDATE outbid_bidders SET profile_at=?,name=?,message=?,url=?,logo_asset_id=? WHERE id=?', order.created_at, profile.name, profile.message, profile.url, profile.logoAssetId ?? null, bidder.id);
      this.sql.exec("UPDATE outbid_orders SET status='paid' WHERE id=?", order.id);
      this.sql.exec('INSERT INTO outbid_webhooks VALUES(?,?)', eventId, now);
      if (referral) this.sql.exec('INSERT OR IGNORE INTO outbid_referral_outbox VALUES(?,?,?)', eventId, JSON.stringify(referral), now);
      const context = JSON.parse(order.context_json ?? '{}') as OutbidOrderContext;
      if (!previous && credit > 0 && context.analytics && context.conversionId) {
        const effect: OutbidAnalyticsEffect = { orderId: order.id, context: context.analytics,
          server: { ...context.analyticsServer, ...(payment.email ? { email: payment.email } : {}) },
          receipt: { conversionId: context.conversionId, amountCents: payment.amountCents } };
        this.sql.exec('INSERT OR IGNORE INTO outbid_analytics_outbox VALUES(?,?)', order.id, JSON.stringify(effect));
      }
      if (changed) this.bump();
      return { changed, credited: !previous && credit > 0, bidderId: bidder.id };
    });
  }
  referralEffects(): OutbidReferralEffect[] {
    return this.sql.exec<{ payload: string }>('SELECT payload FROM outbid_referral_outbox ORDER BY created_at,event_id LIMIT 20').toArray().map(row => JSON.parse(row.payload) as OutbidReferralEffect);
  }
  acknowledgeReferral(eventId: string) { this.sql.exec('DELETE FROM outbid_referral_outbox WHERE event_id=?', eventId); }
  analyticsEffects(): OutbidAnalyticsEffect[] { return this.sql.exec<{ payload: string }>('SELECT payload FROM outbid_analytics_outbox LIMIT 20').toArray().map(row => JSON.parse(row.payload) as OutbidAnalyticsEffect); }
  acknowledgeAnalytics(orderId: string) { this.sql.exec('DELETE FROM outbid_analytics_outbox WHERE order_id=?', orderId); }
  receipt(orderId: string, bidderId: string): ConversionReceipt | null {
    const order = this.order(orderId); if (!order || order.bidder_id !== bidderId || order.status !== 'paid') return null;
    const context = JSON.parse(order.context_json ?? '{}') as OutbidOrderContext;
    return context.conversionId && context.analytics ? { conversionId: context.conversionId, amountCents: order.amount_cents - order.credit_cents } : null;
  }
  snapshot(checkoutAvailable: boolean): OutbidSnapshot {
    const rows = this.sql.exec<Bidder>("SELECT * FROM outbid_bidders WHERE total_cents<>'0' AND blocked=0 ORDER BY length(total_cents) DESC,total_cents DESC,reached_at ASC,id ASC LIMIT 50").toArray();
    const entries: OutbidEntry[] = rows.map((row, index) => {
      const asset = row.logo_asset_id ? this.asset(row.logo_asset_id) : null;
      return { bidderId: row.id, rank: index + 1, name: row.name, message: row.message, url: row.url, totalCents: row.total_cents,
        ...(asset?.status === 'approved' && asset.bidder_id === row.id ? { logoUrl: `/api/media/approved/${asset.id}` } : {}) };
    });
    return { version: 1, revision: this.revision, currency: 'usd', mode: 'test', checkoutAvailable, minimumBidCents: 100, entries };
  }
  addAsset(asset: Omit<OutbidAsset, 'status' | 'review_id'>) {
    this.sql.exec('INSERT INTO outbid_assets(id,bidder_id,key,mime,width,height) VALUES(?,?,?,?,?,?)', asset.id, asset.bidder_id, asset.key, asset.mime, asset.width, asset.height);
  }
  asset(id: string) { return this.sql.exec<OutbidAsset>('SELECT * FROM outbid_assets WHERE id=?', id).toArray()[0] ?? null; }
  /** Internal ad-review consumer hook. No public HTTP approval route exists. */
  applyMediaReview(assetId: string, reviewId: string, approved: boolean, normalized?: { key: string; width: number; height: number }, now = Date.now()) {
    return this.storage.transactionSync(() => {
      const asset = this.asset(assetId); if (!asset) throw new Error('ASSET_NOT_FOUND');
      if (approved && (!normalized || normalized.key !== `outbid/approved/${assetId}.webp` || !Number.isSafeInteger(normalized.width)
        || !Number.isSafeInteger(normalized.height) || normalized.width <= 0 || normalized.height <= 0 || normalized.width * normalized.height > 1_000_000)) throw new Error('NORMALIZED_ASSET_REQUIRED');
      if (this.sql.exec('SELECT id FROM outbid_reviews WHERE id=?', reviewId).toArray().length) return false;
      const status = approved ? 'approved' : 'rejected';
      this.sql.exec('INSERT INTO outbid_reviews VALUES(?,?,?,?)', reviewId, assetId, status, now);
      this.sql.exec('UPDATE outbid_assets SET status=?,review_id=? WHERE id=?', status, reviewId, assetId);
      if (approved && normalized) this.sql.exec("UPDATE outbid_assets SET key=?,mime='image/webp',width=?,height=? WHERE id=?", normalized.key, normalized.width, normalized.height, assetId);
      if (asset.status !== status) this.bump();
      return asset.status !== status;
    });
  }
}
