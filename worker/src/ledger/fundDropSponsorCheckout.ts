import Stripe from 'stripe';
import { sponsorForSlot, type FundDropSponsorDraft } from '@gtasf/shared/drops';
import type { Env } from '../env';
import { stripeSecretKey } from '../outbid/stripeEnv';
import {
  dropSponsorOverrides, getSponsorOrderByCheckoutId, markSponsorOrderRefunded, markSponsorOrderSettled, setDropSponsor,
} from '../funding/dropsStore';
import type { CheckoutSession, FundDropSponsorCheckout } from '../funding/drops';

/**
 * VC fund-drop sponsor paid path (PLAN-v2 decision 3; bead gtasf-v2-drop-sponsor-checkout-c41g).
 * A real VC/startup pays to rename a future drop. Mirrors the "become an angel" Checkout
 * (worker/src/ledger/sponsoredAngelCheckout.ts): a **USD** session (the account default is GBP) with
 * `gtasfProduct` metadata so {@link settleFundDropSponsorSession} recognises our events, and **manual
 * capture** so the charge is only taken once the webhook confirms the slot is still free and applies
 * the sponsor. The full name/url live in the pending order row (fund_drop_sponsor_orders), keyed by the
 * session id, because they exceed Stripe's 500-character metadata value limit.
 *
 * Production stays safe without a special case: the route guards on `checkoutConfigured(env)`, which is
 * always false in production until the founder approves a live charge, so this code never runs a live charge.
 */
export interface FundDropSponsorCheckoutInput {
  draft: FundDropSponsorDraft;
  amountUsdCents: bigint;
  returnOrigin: string;
}

/** Only https, or http on localhost for the native local dev server. Mirrors the angel/outbid gate. */
function checkoutOrigin(returnOrigin: string): URL {
  const origin = new URL(returnOrigin);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))
    throw new Error('CHECKOUT_ORIGIN');
  return origin;
}

export function fundDropSponsorCheckoutParameters(input: FundDropSponsorCheckoutInput): Stripe.Checkout.SessionCreateParams {
  const origin = checkoutOrigin(input.returnOrigin);
  const amount = Number(input.amountUsdCents);
  // Stripe's card minimum is $0.50; also refuse a non-integer/overflowing cent amount.
  if (!Number.isSafeInteger(amount) || amount < 50) throw new RangeError('INVALID_SPONSOR_AMOUNT');
  const metadata = { gtasfProduct: 'fund-drop-sponsor', slot: String(input.draft.slot) };
  return {
    mode: 'payment', payment_method_types: ['card'],
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amount,
      product_data: { name: 'GTASF · Sponsor a VC fund drop',
        description: `Rename an upcoming "come pitch!" drop as "${input.draft.name}" for its window.` } } }],
    payment_intent_data: { capture_method: 'manual', metadata },
    metadata,
    success_url: `${origin.origin}/?drop=sponsored`,
    cancel_url: `${origin.origin}/?drop=cancelled`,
    allow_promotion_codes: false,
  };
}

/** Workers-compatible Stripe client (fetch transport). Key selection is the caller's (test vs live). */
export function createFundDropSponsorStripe(secret: string): Stripe {
  return new Stripe(secret, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 1, timeout: 10_000 });
}

/**
 * Build the injected checkout for one request. `returnOrigin` is captured at the worker entry (index.ts)
 * from the browser Origin. Returns {id,url}; the route stores the id with the pending order so
 * {@link settleFundDropSponsorSession} matches on it at the webhook.
 */
export function createFundDropSponsorCheckout(env: Env, returnOrigin: string, injected?: Stripe): FundDropSponsorCheckout {
  return async ({ draft, amountUsdCents }): Promise<CheckoutSession> => {
    let stripe = injected;
    if (!stripe) {
      const secret = stripeSecretKey(env);
      if (!secret) throw new Error('STRIPE_SECRET_MISSING');
      stripe = createFundDropSponsorStripe(secret);
    }
    const params = fundDropSponsorCheckoutParameters({ draft, amountUsdCents, returnOrigin });
    const session = await stripe.checkout.sessions.create(params);
    // Integrity: the session must match what we asked for and hand back the canonical Stripe URL.
    if (!session.url || session.currency !== 'usd' || session.amount_total !== Number(amountUsdCents)) throw new Error('CHECKOUT_MISMATCH');
    const url = new URL(session.url);
    if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new Error('CHECKOUT_MISMATCH');
    return { id: session.id, url: session.url };
  };
}

/**
 * Settle a sponsor-slot Checkout at the Stripe webhook: capture the manual-capture charge, then apply the
 * sponsor to fund_drop_sponsors (setDropSponsor). Returns true when the event was a fund-drop-sponsor
 * checkout (handled or already settled), false for any other event so the caller falls through to its own
 * (outbid) handling. Idempotent — a replayed webhook re-captures nothing (the PI is already succeeded) and
 * the already-settled order short-circuits. If the slot was sponsored by a different buyer between purchase
 * and capture, this buyer can never get the slot, so the charge is refunded rather than kept for nothing.
 *
 * The caller (LedgerDO.webhook) has already verified the signature and rejected livemode events.
 */
export async function settleFundDropSponsorSession(stripe: Stripe, event: Stripe.Event, db: D1Database, now: number): Promise<boolean> {
  if (event.type !== 'checkout.session.completed') return false;
  const object = event.data.object as Stripe.Checkout.Session;
  if (object.metadata?.gtasfProduct !== 'fund-drop-sponsor') return false;

  // Re-fetch the authoritative session rather than trusting the delivered payload.
  const session = await stripe.checkout.sessions.retrieve(object.id);
  if (session.metadata?.gtasfProduct !== 'fund-drop-sponsor' || session.mode !== 'payment') throw new Error('SPONSOR_SESSION_MISMATCH');
  if (session.currency !== 'usd' || session.amount_total === null || session.amount_total < 50) throw new Error('SPONSOR_AMOUNT_MISMATCH');

  const order = await getSponsorOrderByCheckoutId(db, session.id);
  // Unknown or already-settled/refunded order: acknowledge so Stripe stops retrying; nothing to apply.
  if (!order || order.status !== 'pending') return true;

  // Manual capture: take the authorised charge now that checkout completed. Tolerate an already-captured
  // intent (webhook replay) and refuse to apply a sponsor whose charge never reached a capturable state.
  const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
  if (!intentId) throw new Error('SPONSOR_PAYMENT_MISSING');
  const intent = await stripe.paymentIntents.retrieve(intentId);
  if (intent.status === 'requires_capture') await stripe.paymentIntents.capture(intentId);
  else if (intent.status !== 'succeeded') throw new Error('SPONSOR_PAYMENT_NOT_CAPTURABLE');

  // First paid buyer wins the slot. If a *different* sponsor already holds it, refund this buyer rather
  // than overwrite the slot they cannot have. A replay of this same order (same name) falls through to the
  // idempotent upsert below, so a genuine winner is never refunded.
  const existing = sponsorForSlot(await dropSponsorOverrides(db), order.slot);
  if (existing && existing.name !== order.name) {
    try { await stripe.refunds.create({ payment_intent: intentId }); }
    catch { /* best-effort: a failed refund is reconciled manually and must never block the webhook ack */ }
    await markSponsorOrderRefunded(db, session.id, now);
    return true;
  }

  await setDropSponsor(db, { slot: order.slot, name: order.name, url: order.url, logoUrl: order.logoUrl, now });
  await markSponsorOrderSettled(db, session.id, now);
  return true;
}
