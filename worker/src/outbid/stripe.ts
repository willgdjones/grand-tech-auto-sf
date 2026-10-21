import Stripe from 'stripe';
import type { OutbidOrder, ConfirmedPayment } from './store';

export function createOutbidStripe(secret: string): Stripe {
  if (!secret.startsWith('sk_test_')) throw new Error('TEST_STRIPE_REQUIRED');
  return new Stripe(secret, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 1, timeout: 10_000 });
}
/** Adapted BDTS Checkout metadata/idempotency pattern; text is moderated BEFORE capture. */
export function outbidCheckoutParameters(order: OutbidOrder, returnOrigin: string): Stripe.Checkout.SessionCreateParams {
  const origin = new URL(returnOrigin);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost','127.0.0.1'].includes(origin.hostname))) throw new Error('CHECKOUT_ORIGIN');
  const cashCents = order.amount_cents - order.credit_cents;
  const metadata = { gtasfProduct: 'outbid', orderId: order.id, bidderId: order.bidder_id,
    grossCents: String(order.amount_cents), creditCents: String(order.credit_cents) };
  return {
    mode: 'payment', payment_method_types: ['card'], client_reference_id: order.id,
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cashCents,
      product_data: { name: 'GTASF Outbid · cumulative city ranking', description: `Bid $${(order.amount_cents / 100).toFixed(2)}; referral credit $${(order.credit_cents / 100).toFixed(2)}. Rank can change when another player bids.` } } }],
    ...(cashCents ? { payment_intent_data: { capture_method: 'automatic' as const, metadata } } : {}), metadata,
    success_url: `${origin.origin}/?outbid=returned`, cancel_url: `${origin.origin}/?outbid=cancelled`,
    allow_promotion_codes: false, expires_at: Math.floor(order.created_at / 1000) + 1800,
    custom_text: { submit: { message: 'Minimum bid $1. Confirmed payments accumulate. This purchase does not guarantee a rank or duration at #1.' } },
  };
}
function id(value: string | { id: string } | null | undefined): string | null { return typeof value === 'string' ? value : value?.id ?? null; }

/** Retrieve the present payment state; never credit a redirect, unpaid session or live event. */
export async function confirmedOutbidPayment(stripe: Stripe, event: Stripe.Event): Promise<ConfirmedPayment | null> {
  if (event.livemode) throw new Error('TEST_STRIPE_REQUIRED');
  let intentId: string | null = null, orderId: string | null = null;
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = await stripe.checkout.sessions.retrieve(event.data.object.id, { expand: ['line_items'] });
    if (session.livemode || session.metadata?.gtasfProduct !== 'outbid') return null;
    if (session.mode !== 'payment' || !['paid','no_payment_required'].includes(session.payment_status)) return null;
    if (session.currency !== 'usd' || session.amount_total === null || (session.amount_total !== 0 && session.amount_total < 50)) throw new Error('PAYMENT_AMOUNT_MISMATCH');
    const lines = session.line_items?.data;
    if (!lines || lines.length !== 1 || session.line_items?.has_more || lines[0]?.quantity !== 1 || lines[0].amount_total !== session.amount_total) throw new Error('CHECKOUT_LINE_MISMATCH');
    orderId = session.metadata.orderId ?? null; intentId = id(session.payment_intent);
    if (session.amount_total === 0) {
      if (!orderId || intentId || session.status !== 'complete' || session.payment_status !== 'no_payment_required') throw new Error('PAYMENT_NOT_CAPTURED');
      return { orderId, intentId: session.id, sessionId: session.id, amountCents: 0, refundedCents: 0, disputed: false,
        paidAt: event.created * 1000, observedAt: Date.now(), email: session.customer_details?.email };
    }
  } else if (event.type === 'payment_intent.succeeded') intentId = event.data.object.id;
  else if (event.type === 'charge.refunded' || event.type === 'charge.succeeded') intentId = id(event.data.object.payment_intent);
  else if (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.updated' || event.type === 'charge.dispute.closed') intentId = id(event.data.object.payment_intent);
  else return null;
  if (!intentId) return null;
  const intent = await stripe.paymentIntents.retrieve(intentId, { expand: ['latest_charge'] });
  if (intent.livemode || intent.metadata.gtasfProduct !== 'outbid') return null;
  if (intent.status !== 'succeeded') return null;
  if (intent.currency !== 'usd' || intent.amount_received !== intent.amount || intent.amount < 50) throw new Error('PAYMENT_AMOUNT_MISMATCH');
  if (orderId && intent.metadata.orderId !== orderId) throw new Error('PAYMENT_ID_MISMATCH');
  orderId = intent.metadata.orderId ?? null; if (!orderId) throw new Error('ORDER_NOT_FOUND');
  const charge = typeof intent.latest_charge === 'string' ? await stripe.charges.retrieve(intent.latest_charge) : intent.latest_charge;
  if (!charge || charge.livemode || !charge.paid || !charge.captured || charge.currency !== 'usd'
    || charge.amount !== intent.amount_received || id(charge.payment_intent) !== intent.id) throw new Error('PAYMENT_NOT_CAPTURED');
  let disputed = charge.disputed;
  if (disputed) {
    const disputes = await stripe.disputes.list({ payment_intent: intent.id, limit: 100 });
    // Ambiguous or unfinished disputes withhold rank; a resolved win may restore it.
    disputed = disputes.has_more || !disputes.data.length || disputes.data.some(item => !['won','warning_closed'].includes(item.status));
  }
  return { orderId, intentId: intent.id, amountCents: intent.amount_received, refundedCents: charge.amount_refunded, disputed,
    paidAt: charge.created * 1000, observedAt: Date.now(), email: charge.billing_details.email,
    cardFingerprint: charge.payment_method_details?.card?.fingerprint };
}
