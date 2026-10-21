import { flags } from '@gtasf/shared/flags';
import type { BuyState } from './buyFlow.types';
/** BDTS buy flow adapted to a single board/week quote. Track E wires upload and webhook polling. */
export function createBuyFlow() {
  let state: BuyState = { phase: 'idle' };
  return {
    get state() { return state; },
    select(boardId: string, week: string) { if (!flags.rentals) throw new Error('Rentals disabled'); state = { phase: 'draft', boardId, week }; },
    async checkout() {
      if (!flags.stripe || state.phase !== 'draft') throw new Error('Checkout unavailable');
      const response = await fetch('/api/rentals/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state) });
      if (!response.ok) throw new Error(`Checkout HTTP ${response.status}`);
      const data = await response.json() as { rentalId: string; url: string };
      if (typeof data.rentalId !== 'string' || typeof data.url !== 'string' || new URL(data.url).origin !== 'https://checkout.stripe.com') throw new Error('Invalid checkout response');
      state = { phase: 'checkout', rentalId: data.rentalId, url: data.url };
      return data.url;
    },
    cancel() { state = { phase: 'idle' }; },
  };
}
