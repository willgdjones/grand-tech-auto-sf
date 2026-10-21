import Stripe from 'stripe';
import type { Env } from '../env';
import { stripeSecretKey } from '../outbid/stripeEnv';
import { getAngelByCheckoutId, publishAngel } from '../sponsoredAngels/store';
import type { CheckoutSession, SponsoredAngelCheckout } from '../sponsoredAngels/routes';
import type { SponsoredAngelDraft } from '@gtasf/shared/sponsoredAngels';

/**
 * "Become an angel" paid path (bead gtasf-sponsored-angel-checkout-9zy2; docs/engineering/become-an-angel.md §5).
 * The route (worker/src/sponsoredAngels/routes.ts) injects {@link createSponsoredAngelCheckout}; the moderated
 * draft is already Jev-approved before we ever reach Stripe. Mirrors the outbid Checkout pattern
 * (worker/src/outbid/stripe.ts): a **USD** session (the account default is GBP) with `gtasfProduct`
 * metadata so {@link settleSponsoredAngelSession} can recognise our events, and **manual capture** so the
 * charge is only taken once the webhook confirms completion and publishes the angel.
 *
 * Production stays safe without a special case here: the route guards on `checkoutConfigured(env)`, which is
 * always false in production until the founder approves a live charge, so this code never runs a live charge.
 */
export interface SponsoredAngelCheckoutInput {
  deviceId: string;
  draft: SponsoredAngelDraft;
  amountUsdCents: bigint;
  returnOrigin: string;
}

/** Only https, or http on localhost for the native local dev server. Mirrors outbidCheckoutParameters. */
function checkoutOrigin(returnOrigin: string): URL {
  const origin = new URL(returnOrigin);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))
    throw new Error('CHECKOUT_ORIGIN');
  return origin;
}

export function sponsoredAngelCheckoutParameters(input: SponsoredAngelCheckoutInput): Stripe.Checkout.SessionCreateParams {
  const origin = checkoutOrigin(input.returnOrigin);
  const amount = Number(input.amountUsdCents);
  // Stripe's card minimum is $0.50; also refuse a non-integer/overflowing cent amount.
  if (!Number.isSafeInteger(amount) || amount < 50) throw new RangeError('INVALID_ANGEL_AMOUNT');
  const metadata = { gtasfProduct: 'sponsored-angel', deviceId: input.deviceId, spotId: input.draft.spotId };
  return {
    mode: 'payment', payment_method_types: ['card'],
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amount,
      product_data: { name: 'GTASF · Become an angel',
        description: `Your parody angel investor "${input.draft.displayName}" appears in the city until you remove it.` } } }],
    payment_intent_data: { capture_method: 'manual', metadata },
    metadata,
    success_url: `${origin.origin}/?angel=returned`,
    cancel_url: `${origin.origin}/?angel=cancelled`,
    allow_promotion_codes: false,
  };
}

/** Workers-compatible Stripe client (fetch transport). Key selection is the caller's (test vs live). */
export function createSponsoredAngelStripe(secret: string): Stripe {
  return new Stripe(secret, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 1, timeout: 10_000 });
}

/**
 * Build the injected checkout for one request. `returnOrigin` is captured at the worker entry (index.ts)
 * from the browser Origin so the Stripe return lands back on the game. Returns {id,url}; the route stores
 * the id as the angel's `checkout_id` and {@link settleSponsoredAngelSession} matches on it at the webhook.
 */
export function createSponsoredAngelCheckout(env: Env, returnOrigin: string, injected?: Stripe): SponsoredAngelCheckout {
  return async ({ draft, deviceId, amountUsdCents }): Promise<CheckoutSession> => {
    let stripe = injected;
    if (!stripe) {
      const secret = stripeSecretKey(env);
      if (!secret) throw new Error('STRIPE_SECRET_MISSING');
      stripe = createSponsoredAngelStripe(secret);
    }
    const params = sponsoredAngelCheckoutParameters({ draft, deviceId, amountUsdCents, returnOrigin });
    const session = await stripe.checkout.sessions.create(params);
    // Integrity: the session must match what we asked for and hand back the canonical Stripe URL.
    if (!session.url || session.currency !== 'usd' || session.amount_total !== Number(amountUsdCents)) throw new Error('CHECKOUT_MISMATCH');
    const url = new URL(session.url);
    if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new Error('CHECKOUT_MISMATCH');
    return { id: session.id, url: session.url };
  };
}

/**
 * Settle a sponsored-angel Checkout at the Stripe webhook: capture the manual-capture charge, then make the
 * pending angel live. Returns true when the event was a sponsored-angel checkout (handled or already settled),
 * false for any other event so the caller falls through to its own (outbid) handling. Idempotent — a replayed
 * webhook re-captures nothing (the PI is already succeeded) and {@link publishAngel} no-ops a non-pending angel.
 *
 * The caller (LedgerDO.webhook) has already verified the signature and rejected livemode events.
 */
export async function settleSponsoredAngelSession(stripe: Stripe, event: Stripe.Event, db: D1Database, now: number): Promise<boolean> {
  if (event.type !== 'checkout.session.completed') return false;
  const object = event.data.object as Stripe.Checkout.Session;
  if (object.metadata?.gtasfProduct !== 'sponsored-angel') return false;

  // Re-fetch the authoritative session rather than trusting the delivered payload.
  const session = await stripe.checkout.sessions.retrieve(object.id);
  if (session.metadata?.gtasfProduct !== 'sponsored-angel' || session.mode !== 'payment') throw new Error('ANGEL_SESSION_MISMATCH');
  if (session.currency !== 'usd' || session.amount_total === null || session.amount_total < 50) throw new Error('ANGEL_AMOUNT_MISMATCH');

  const angel = await getAngelByCheckoutId(db, session.id);
  // Unknown or already-settled session: acknowledge so Stripe stops retrying; nothing to publish.
  if (!angel || angel.status !== 'pending') return true;

  // Manual capture: take the authorised charge now that checkout completed. Tolerate an already-captured
  // intent (webhook replay) and refuse to publish an angel whose charge never reached a capturable state.
  const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
  if (!intentId) throw new Error('ANGEL_PAYMENT_MISSING');
  const intent = await stripe.paymentIntents.retrieve(intentId);
  if (intent.status === 'requires_capture') await stripe.paymentIntents.capture(intentId);
  else if (intent.status !== 'succeeded') throw new Error('ANGEL_PAYMENT_NOT_CAPTURABLE');

  const published = await publishAngel(db, angel.id, now);
  // Integrity: if the spot was taken between purchase and capture, this buyer can never get their angel,
  // so refund the charge rather than keep money for nothing. A concurrent webhook that already published
  // this angel returns 'not-pending' (not 'spot-taken'), so a genuinely live angel is never refunded.
  if (published === 'spot-taken') {
    try { await stripe.refunds.create({ payment_intent: intentId }); }
    catch { /* best-effort: a failed refund is reconciled manually and must never block the webhook ack */ }
  }
  return true;
}
