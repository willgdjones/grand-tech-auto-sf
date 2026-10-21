import type Stripe from 'stripe';
/** Adapted BDTS tools/stripe-spike/src/parameters.ts manual-capture Checkout pattern. */
export interface RentalQuote { id: string; boardId: string; week: string; priceCents: number; email: string }
export function checkoutParameters(quote: RentalQuote, returnOrigin: string): Stripe.Checkout.SessionCreateParams {
  if (!Number.isSafeInteger(quote.priceCents) || quote.priceCents < 50) throw new RangeError('INVALID_QUOTE');
  const origin = new URL(returnOrigin);
  if (origin.protocol !== 'https:') throw new RangeError('CHECKOUT_ORIGIN');
  const metadata = { rentalId: quote.id, boardId: quote.boardId, week: quote.week };
  return {
    mode: 'payment', customer_email: quote.email,
    success_url: `${origin.origin}/?rental=${encodeURIComponent(quote.id)}`,
    cancel_url: `${origin.origin}/?board=${encodeURIComponent(quote.boardId)}`,
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: quote.priceCents, product_data: { name: `GTASF billboard · week ${quote.week}` } } }],
    payment_method_types: ['card'],
    payment_intent_data: { capture_method: 'manual', metadata, receipt_email: quote.email },
    metadata,
  };
}
