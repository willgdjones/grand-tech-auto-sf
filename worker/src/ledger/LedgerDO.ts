import { DurableObject } from 'cloudflare:workers';
import Stripe from 'stripe';
import { flags } from '@gtasf/shared/flags';
import type { Env } from '../env';
import { OutbidStore, type OutbidOrderContext, type OutbidReferralEffect } from '../outbid/store';
import { createOutbidStripe, confirmedOutbidPayment, outbidCheckoutParameters } from '../outbid/stripe';
import { settleSponsoredAngelSession } from './sponsoredAngelCheckout';
import { settleFundDropSponsorSession } from './fundDropSponsorCheckout';
import { checkoutConfigured, stripeSecretKey, stripeWebhookSecret } from '../outbid/stripeEnv';
import { moderateOutbidDraft, validateOutbidDraft } from '../outbid/moderation';
import { readBounded, sha256 } from '../outbid/linkcheck';
import { inspectLogo } from '../outbid/media';
import { worldBroadcastTargets } from '../world/zoneRouting';
import { applyReferralPayment, freezeReferralOrder, referralFraudHash } from '../referrals/ledger';
import { bindReferralCredit, releaseReferralCredit, reserveReferralCredit, settleReferralCredit } from '../referrals/credit';
import { analyticsServerContext, captureConfirmedPurchase } from '../analytics/xConversions';

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const randomHex = (length: number) => [...crypto.getRandomValues(new Uint8Array(length))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const cookieName = 'gtasf_outbid';
// Stripe key selection + checkout gating live in outbid/stripeEnv.ts: TEST keys in non-production,
// live keys in production, and checkout is always off in production until the founder approves a test charge.
function sameOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin'); if (!origin) return null;
  if (origin === new URL(request.url).origin) return origin;
  if (env.ENVIRONMENT === 'local' && ['http://127.0.0.1:5173','http://localhost:5173'].includes(origin)) return origin;
  return null;
}

/** Separate named LedgerDO instance owns Outbid. Rental holds retain their later entry point. */
export class LedgerDO extends DurableObject<Env> {
  private readonly outbid: OutbidStore;
  private settlement: Promise<unknown> = Promise.resolve();
  private checkoutQueue: Promise<unknown> = Promise.resolve();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env); this.outbid = new OutbidStore(ctx.storage);
    ctx.blockConcurrencyWhile(async () => { if (this.outbid.pendingNotice() !== null || this.outbid.referralEffects().length || this.outbid.analyticsEffects().length || this.outbid.nextCreditExpiry() !== null) await ctx.storage.setAlarm(Date.now() + 1000); });
  }
  private checkoutAvailable(): boolean { return Boolean(flags.outbidCheckout && checkoutConfigured(this.env) && this.env.TYPESAFE_API_KEY); }
  private async viewer(request: Request) {
    const match = request.headers.get('Cookie')?.match(/(?:^|;\s*)gtasf_outbid=([a-f0-9]{32})\.([a-f0-9]{64})(?:;|$)/);
    return match ? this.outbid.authenticate(match[1]!, await sha256(match[2]!)) : null;
  }
  private async catalogue(request: Request) {
    let viewer = await this.viewer(request), cookie: string | undefined;
    if (!viewer && this.checkoutAvailable()) {
      const address = request.headers.get('CF-Connecting-IP') ?? 'local';
      if (!this.outbid.rateLimit(`identity:${await sha256(address)}`, 30, 3_600_000)) return json({ error: 'Please try again later.' }, 429);
      const bidderId = randomHex(16), token = randomHex(32); this.outbid.createBidder(bidderId, await sha256(token));
      viewer = { bidderId, totalCents: '0' };
      const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
      cookie = `${cookieName}=${bidderId}.${token}; HttpOnly${secure}; SameSite=Lax; Path=/api/outbid; Max-Age=31536000`;
    }
    const response = json({ snapshot: this.outbid.snapshot(this.checkoutAvailable()), ...(viewer ? { viewer } : {}) });
    if (cookie) response.headers.set('Set-Cookie', cookie); return response;
  }
  private async checkout(request: Request) {
    const origin = sameOrigin(request, this.env); if (!origin) return json({ error: 'Open Checkout from the game.' }, 403);
    if (!this.checkoutAvailable()) return json({ error: 'Test Checkout is not configured yet.' }, 503);
    const viewer = await this.viewer(request); if (!viewer) return json({ error: 'Refresh the leaderboard before bidding.' }, 401);
    if (!this.outbid.rateLimit(`checkout:${viewer.bidderId}`, 6, 60_000)) return json({ error: 'Please wait a minute before retrying.' }, 429);
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({ error: 'JSON required.' }, 415);
    const key = request.headers.get('Idempotency-Key'); if (!key || !/^[a-zA-Z0-9_-]{16,80}$/.test(key)) return json({ error: 'Refresh and retry your bid.' }, 400);
    const draft = validateOutbidDraft(JSON.parse(new TextDecoder().decode(await readBounded(request, 8192))));
    if (draft.useCredit) return json({ error: 'Referral rewards are in-game funding and cannot pay for purchases.' }, 410);
    if (draft.logoAssetId) {
      const asset = this.outbid.asset(draft.logoAssetId);
      if (!asset || asset.bidder_id !== viewer.bidderId || asset.status === 'rejected') return json({ error: 'This logo is unavailable for your bid.' }, 400);
    }
    const fingerprint = await sha256(JSON.stringify(draft));
    let order = this.outbid.orderForRequest(viewer.bidderId, key);
    if (order && order.body_hash !== fingerprint) return json({ error: 'This request changed. Submit a new bid.' }, 409);
    if (order && Date.now() - order.created_at > 1_750_000) return json({ error: 'This Checkout expired. Submit a new bid.' }, 409);
    if (!order) {
      await moderateOutbidDraft(draft, this.env.TYPESAFE_API_KEY!);
      const now = Date.now(), context: OutbidOrderContext = { returnOrigin: origin, conversionId: crypto.randomUUID(),
        analytics: draft.analytics, ...(draft.analytics ? { analyticsServer: analyticsServerContext(request) } : {}) };
      // Referrals now award in-game funding only. New purchases must neither
      // require a referral identity nor accrue cash commissions. Stored legacy
      // order contexts still settle/refund through the recovery paths below.
      order = this.outbid.createOrder(randomHex(16), viewer.bidderId, key, fingerprint, draft, now, context);
    }
    const context = JSON.parse(order.context_json ?? '{}') as OutbidOrderContext;
    if (order.checkout_url) return json({ url: order.checkout_url, orderId: order.id });
    if (order.credit_cents > 0) {
      if (!context.referralBuyer) throw new Error('CREDIT_IDENTITY_REQUIRED');
      await reserveReferralCredit(this.env.DB, order.id, context.referralBuyer.accountId, order.amount_cents, order.credit_cents, Date.now());
    }
    const cashCents = order.amount_cents - order.credit_cents;
    if (context.referralBuyer) await freezeReferralOrder(this.env.DB, { orderId: order.id, product: 'outbid', buyer: context.referralBuyer, createdAt: order.created_at, cashCents });
    const stripe = createOutbidStripe(stripeSecretKey(this.env)!);
    const session = await stripe.checkout.sessions.create(outbidCheckoutParameters(order, origin), { idempotencyKey: `gtasf-outbid-${order.id}` });
    if (session.livemode || !session.url || session.amount_total !== cashCents || session.currency !== 'usd') throw new Error('CHECKOUT_MISMATCH');
    const checkout = new URL(session.url);
    if (checkout.protocol !== 'https:' || checkout.hostname !== 'checkout.stripe.com') throw new Error('CHECKOUT_MISMATCH');
    if (order.credit_cents > 0) await bindReferralCredit(this.env.DB, order.id, session.id);
    this.outbid.bindCheckout(order.id, session.id, session.url); return json({ url: session.url, orderId: order.id });
  }
  private creditQuote() {
    return json({ error: 'Referral rewards are in-game funding and cannot pay for purchases.' }, 410);
  }
  private async receipt(request: Request) {
    const viewer = await this.viewer(request); if (!viewer) return json({ error: 'Refresh the leaderboard first.' }, 401);
    const id = new URL(request.url).searchParams.get('orderId') ?? '';
    if (!/^[a-f0-9]{32}$/.test(id)) return json({ error: 'Not found.' }, 404);
    const order = this.outbid.order(id); if (!order || order.bidder_id !== viewer.bidderId) return json({ error: 'Not found.' }, 404);
    const receipt = this.outbid.receipt(id, viewer.bidderId);
    return receipt ? json({ receipt }) : json({ pending: order.status === 'pending' }, order.status === 'pending' ? 202 : 200);
  }
  private async upload(request: Request) {
    if (!sameOrigin(request, this.env)) return json({ error: 'Upload from the game.' }, 403);
    // The shared ad-review consumer, decoded normalizer and human review must be enabled first.
    if (!flags.moderation || !this.env.OPENROUTER_API_KEY) return json({ error: 'Logo uploads are not available yet. You can bid with text and a link.' }, 503);
    const viewer = await this.viewer(request); if (!viewer) return json({ error: 'Refresh the leaderboard first.' }, 401);
    if (!this.outbid.rateLimit(`logo:${viewer.bidderId}`, 5, 3_600_000)) return json({ error: 'Logo upload limit reached. Please try later.' }, 429);
    const bytes = await readBounded(request, 2_100_000);
    const form = await new Request(request.url, { method: 'POST', headers: { 'Content-Type': request.headers.get('Content-Type') ?? '' }, body: bytes }).formData();
    const file = form.get('file'); if (!file || typeof file === 'string') return json({ error: 'Choose one PNG, JPEG or WebP logo.' }, 400);
    const content = new Uint8Array(await file.arrayBuffer()), dimensions = inspectLogo(content), assetId = randomHex(16), key = `outbid/quarantine/${assetId}`;
    await this.env.ASSETS.put(key, content, { httpMetadata: { contentType: dimensions.mime }, customMetadata: { bidderId: viewer.bidderId, status: 'pending' } });
    this.outbid.addAsset({ id: assetId, bidder_id: viewer.bidderId, key, ...dimensions });
    await this.env.JOBS.send({ type: 'moderate-image', key, rentalId: `outbid:${assetId}` });
    return json({ assetId, status: 'pending' }, 202);
  }
  private async webhook(request: Request) {
    if (!checkoutConfigured(this.env)) return json({ error: 'Test webhook is not configured.' }, 503);
    const signature = request.headers.get('Stripe-Signature'); if (!signature) return json({ error: 'Invalid signature.' }, 400);
    const stripe = createOutbidStripe(stripeSecretKey(this.env)!);
    const raw = new TextDecoder().decode(await readBounded(request, 131_072));
    let event: Stripe.Event;
    try { event = await stripe.webhooks.constructEventAsync(raw, signature, stripeWebhookSecret(this.env)!, 300, Stripe.createSubtleCryptoProvider()); }
    catch { return json({ error: 'Invalid signature.' }, 400); }
    if (event.livemode) return json({ error: 'Only test payments are accepted.' }, 400);
    // Sponsored-angel checkouts settle against D1 (worker/src/sponsoredAngels/store.ts), not the outbid
    // order store, so they handle independently of the serialization below. A non-angel event returns
    // false and falls through to the outbid settlement.
    if (await settleSponsoredAngelSession(stripe, event, this.env.DB, Date.now())) return json({ received: true });
    // VC fund-drop sponsor checkouts settle against D1 (fund_drop_sponsor_orders → fund_drop_sponsors),
    // not the outbid order store, so they also handle independently of the serialization below.
    if (await settleFundDropSponsorSession(stripe, event, this.env.DB, Date.now())) return json({ received: true });
    // Serialize provider retrieval and settlement so overlapping webhooks cannot restore stale state.
    const task = this.settlement.then(async () => {
      if (this.outbid.eventSeen(event.id)) { if (this.outbid.pendingNotice() !== null || this.outbid.referralEffects().length) await this.ctx.storage.setAlarm(Date.now() + 1000); return json({ received: true }); }
      const payment = await confirmedOutbidPayment(stripe, event); if (!payment) return json({ received: true });
      const order = this.outbid.order(payment.orderId);
      if (!order) throw new Error('ORDER_NOT_FOUND');
      const context = JSON.parse(order.context_json ?? '{}') as OutbidOrderContext;
      if (order.credit_cents > 0) {
        if (!order.session_id) throw new Error('CREDIT_SESSION_MISMATCH');
        await settleReferralCredit(this.env.DB, order.id, order.session_id, payment.intentId, payment.amountCents, payment.refundedCents, payment.disputed, Date.now());
      }
      let referral: OutbidReferralEffect | undefined;
      if (context.referralBuyer) referral = { eventId: event.id,
        order: { orderId: order.id, product: 'outbid', buyer: context.referralBuyer, createdAt: order.created_at, cashCents: order.amount_cents - order.credit_cents },
        payment: { orderId: order.id, paymentId: payment.intentId, cashCents: payment.amountCents, refundedCents: payment.refundedCents,
          disputed: payment.disputed, paidAt: payment.paidAt!, observedAt: payment.observedAt!,
          emailHash: await referralFraudHash('email', payment.email), cardHash: await referralFraudHash('card', payment.cardFingerprint) } };
      // Schedule before the atomic write: committed notices survive process interruption.
      await this.ctx.storage.setAlarm(Date.now() + 1000);
      this.outbid.settle(event.id, payment, Date.now(), referral);
      return json({ received: true });
    });
    this.settlement = task.catch(() => {}); return task;
  }
  private async expireCreditOrders() {
    if (!checkoutConfigured(this.env)) return;
    const stripe = createOutbidStripe(stripeSecretKey(this.env)!);
    for (const order of this.outbid.expiredCreditOrders(Date.now())) {
      let session: Stripe.Checkout.Session | undefined;
      if (order.session_id) session = await stripe.checkout.sessions.retrieve(order.session_id);
      else {
        // Recover a crash after Stripe creation but before either DB stored its ID.
        // A bounded complete provider inventory is required before releasing an unknown session.
        let startingAfter: string | undefined, complete = false;
        for (let page = 0; page < 10; page++) {
          const batch = await stripe.checkout.sessions.list({ limit: 100,
            created: { gte: Math.floor(order.created_at / 1000) - 60, lte: Math.ceil(order.created_at / 1000) + 1800 },
            ...(startingAfter ? { starting_after: startingAfter } : {}) });
          session = batch.data.find(value => value.metadata?.gtasfProduct === 'outbid' && value.metadata.orderId === order.id);
          if (session || !batch.has_more) { complete = true; break; }
          startingAfter = batch.data.at(-1)?.id; if (!startingAfter) break;
        }
        if (!session) {
          if (complete && Date.now() > order.created_at + 2_100_000) {
            await releaseReferralCredit(this.env.DB, order.id, null, Date.now()); this.outbid.expireOrder(order.id);
          }
          continue;
        }
        if (session.livemode || session.metadata?.orderId !== order.id) throw new Error('CHECKOUT_MISMATCH');
        await bindReferralCredit(this.env.DB, order.id, session.id);
        this.outbid.bindRecoveredSession(order.id, session.id);
      }
      if (!session.livemode && session.status === 'expired' && session.payment_status !== 'paid') {
        await releaseReferralCredit(this.env.DB, order.id, session.id, Date.now()); this.outbid.expireOrder(order.id);
      }
      // Complete sessions await their verified webhook. Polling never grants a bid.
    }
  }
  override async alarm() {
    const task = this.settlement.then(() => this.flushEffects());
    this.settlement = task.catch(() => {}); await task;
  }
  private async flushEffects() {
    for (const effect of this.outbid.referralEffects()) {
      try {
        await freezeReferralOrder(this.env.DB, effect.order);
        await applyReferralPayment(this.env.DB, effect.eventId, effect.payment);
        this.outbid.acknowledgeReferral(effect.eventId);
      } catch { break; /* Retry in order; a D1 outage never undoes the confirmed bid. */ }
    }
    for (const effect of this.outbid.analyticsEffects()) {
      await captureConfirmedPurchase(this.env, effect.context, 'outbid_purchase', effect.receipt, effect.server);
      this.outbid.acknowledgeAnalytics(effect.orderId);
    }
    try { await this.expireCreditOrders(); } catch { /* Provider recovery retries without releasing an unverified hold. */ }
    const revision = this.outbid.pendingNotice();
    if (revision !== null) {
      try {
        // Zoned: fan the crown out to every cell so each zone broadcasts to its peers;
        // single world: just 'sf'. Idempotent per-zone (revision>current), so a partial
        // failure safely retries all on the next alarm (docs/engineering/zoned-world.md §8).
        const targets = worldBroadcastTargets(flags.zonedWorld);
        const responses = await Promise.all(targets.map(name =>
          this.env.WORLD.get(this.env.WORLD.idFromName(name)).fetch('https://world.internal/internal/outbid/changed', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision }), signal: AbortSignal.timeout(3000),
          })));
        if (responses.some(response => !response.ok)) throw new Error('WORLD_NOTICE_UNAVAILABLE');
        this.outbid.markNotified(revision);
      } catch { /* Durable retry; a world notification never undoes a confirmed payment. */ }
    }
    const expiry = this.outbid.nextCreditExpiry();
    if (this.outbid.pendingNotice() !== null || this.outbid.referralEffects().length || this.outbid.analyticsEffects().length || expiry !== null)
      await this.ctx.storage.setAlarm(expiry !== null ? Math.max(Date.now() + 15_000, Math.min(expiry, Date.now() + 60_000)) : Date.now() + 15_000);
  }
  /** Internal RPC for the existing moderated ad pipeline; never exposed through public HTTP. */
  async applyOutbidLogoReview(assetId: string, reviewId: string, approved: boolean, normalized?: { key: string; width: number; height: number }) {
    if (!flags.moderation || !flags.admin) throw new Error('REVIEW_NOT_ENABLED');
    if (approved && (!normalized || !await this.env.ASSETS.head(normalized.key))) throw new Error('NORMALIZED_ASSET_REQUIRED');
    await this.ctx.storage.setAlarm(Date.now() + 1000);
    return this.outbid.applyMediaReview(assetId, reviewId, approved, normalized);
  }
  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/api/outbid/webhook' && request.method === 'POST') return await this.webhook(request);
      if (!(flags.outbidBanner || flags.outbidCrown || flags.outbidPlane)) return json({ error: 'Outbid is not enabled.' }, 404);
      if (path === '/api/outbid' && request.method === 'GET') return await this.catalogue(request);
      if (path === '/api/outbid/credit-quote' && request.method === 'GET') return this.creditQuote();
      if (path === '/api/outbid/receipt' && request.method === 'GET') return await this.receipt(request);
      if (path === '/api/outbid/checkout' && request.method === 'POST') {
        const task = this.checkoutQueue.then(() => this.checkout(request)); this.checkoutQueue = task.catch(() => {}); return await task;
      }
      if (path === '/api/outbid/logo' && request.method === 'POST') return await this.upload(request);
      const media = /^\/api\/media\/approved\/([a-f0-9]{32})$/.exec(path);
      if (media && request.method === 'GET') {
        const asset = this.outbid.asset(media[1]!); if (!asset || asset.status !== 'approved') return json({ error: 'Not found.' }, 404);
        const object = await this.env.ASSETS.get(asset.key); if (!object) return json({ error: 'Not found.' }, 404);
        return new Response(object.body, { headers: { 'Content-Type': asset.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=300', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
      }
      return json({ error: 'Not found.' }, 404);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'CONTENT_NOT_APPROVED') return json({ error: 'Your text or link did not pass moderation. Please revise it before bidding.' }, 422);
      if (code === 'CREDIT_UNAVAILABLE') return json({ error: 'Your available credit changed. Refresh the credit quote and submit a new bid.' }, 409);
      if (/^(INVALID_|LINK_NOT_|LINK_UNREACHABLE|LINK_TOO_|LINK_REDIRECT_|LOGO_|ANIMATED_LOGO|BODY_TOO_LARGE)/.test(code)) return json({ error: 'Check your bid, public HTTPS link and optional logo, then retry.' }, 400);
      return json({ error: 'Checkout is temporarily unavailable. No bid has been credited.' }, 503);
    }
  }
}
