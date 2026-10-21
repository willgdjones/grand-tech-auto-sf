import { expect, it } from 'vitest';
import { checkoutParameters } from './checkout';
it('authorizes only the quoted weekly amount with rental metadata and manual capture', () => {
  const quote = { id: 'rent-1', boardId: 'market-1', week: '2026-10-05', priceCents: 2500, email: 'buyer@example.com' };
  const params = checkoutParameters(quote, 'https://gtasf.com');
  expect(params.payment_intent_data?.capture_method).toBe('manual');
  expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(2500);
  expect(params.payment_intent_data?.metadata).toEqual({ rentalId: 'rent-1', boardId: 'market-1', week: '2026-10-05' });
  expect(() => checkoutParameters({ ...quote, priceCents: 1.5 }, 'https://gtasf.com')).toThrow();
});
