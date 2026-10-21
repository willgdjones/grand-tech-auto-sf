import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import {
  createSponsoredAngelCheckout,
  settleSponsoredAngelSession,
  sponsoredAngelCheckoutParameters,
} from './sponsoredAngelCheckout';
import { getAngel, insertPendingAngel, publishAngel } from '../sponsoredAngels/store';
import type { Env } from '../env';
import type { SponsoredAngelDraft } from '@gtasf/shared/sponsoredAngels';

const draft: SponsoredAngelDraft = { displayName: 'Lane Capital', line: 'Backing the bold.', avatarColor: '#4f7cff', spotId: 'fidi-jackson-alley' };
const env = { ENVIRONMENT: 'test', STRIPE_TEST_SECRET_KEY: 'sk_test_x' } as unknown as Env;

function d1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0022_sponsored_angels.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let bindings: (string | number | null)[] = [];
      const wrapper = {
        bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
        async first() { return statement.get(...bindings) ?? null; },
        async all() { return { results: statement.all(...bindings), success: true }; },
        async run() { return { meta: statement.run(...bindings), success: true }; },
      };
      return wrapper;
    },
  } as unknown as D1Database;
  return { db, now: Date.UTC(2026, 9, 5, 18, 0, 0) };
}

describe('sponsoredAngelCheckoutParameters', () => {
  it('builds a USD manual-capture session with product metadata and game return URLs', () => {
    const p = sponsoredAngelCheckoutParameters({ deviceId: 'dev-1', draft, amountUsdCents: 10000n, returnOrigin: 'https://gtasf.com' });
    expect(p.mode).toBe('payment');
    expect(p.line_items?.[0]?.price_data?.currency).toBe('usd');
    expect(p.line_items?.[0]?.price_data?.unit_amount).toBe(10000);
    expect(p.payment_intent_data?.capture_method).toBe('manual');
    expect(p.metadata).toMatchObject({ gtasfProduct: 'sponsored-angel', deviceId: 'dev-1', spotId: 'fidi-jackson-alley' });
    expect(p.payment_intent_data?.metadata).toMatchObject({ gtasfProduct: 'sponsored-angel' });
    expect(p.success_url).toBe('https://gtasf.com/?angel=returned');
    expect(p.cancel_url).toBe('https://gtasf.com/?angel=cancelled');
  });

  it('allows http only on localhost, never an arbitrary http origin', () => {
    expect(() => sponsoredAngelCheckoutParameters({ deviceId: 'd', draft, amountUsdCents: 10000n, returnOrigin: 'http://127.0.0.1:5173' })).not.toThrow();
    expect(() => sponsoredAngelCheckoutParameters({ deviceId: 'd', draft, amountUsdCents: 10000n, returnOrigin: 'http://evil.example' })).toThrow('CHECKOUT_ORIGIN');
  });

  it('refuses an amount below the Stripe card minimum', () => {
    expect(() => sponsoredAngelCheckoutParameters({ deviceId: 'd', draft, amountUsdCents: 25n, returnOrigin: 'https://gtasf.com' })).toThrow();
  });
});

describe('createSponsoredAngelCheckout', () => {
  it('creates a USD session and returns {id,url}', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1', currency: 'usd', amount_total: 10000 });
    const stripe = { checkout: { sessions: { create } } } as unknown as Stripe;
    const session = await createSponsoredAngelCheckout(env, 'https://gtasf.com', stripe)({ env, deviceId: 'dev-1', draft, amountUsdCents: 10000n });
    expect(session).toEqual({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    const params = create.mock.calls[0]![0] as Stripe.Checkout.SessionCreateParams;
    expect(params.line_items?.[0]?.price_data?.currency).toBe('usd');
  });

  it('rejects a session whose URL host is not Stripe Checkout', async () => {
    const stripe = { checkout: { sessions: { create: vi.fn().mockResolvedValue({ id: 'cs', url: 'https://evil.example/x', currency: 'usd', amount_total: 10000 }) } } } as unknown as Stripe;
    await expect(createSponsoredAngelCheckout(env, 'https://gtasf.com', stripe)({ env, deviceId: 'd', draft, amountUsdCents: 10000n })).rejects.toThrow('CHECKOUT_MISMATCH');
  });

  it('rejects a session whose amount does not match the quote', async () => {
    const stripe = { checkout: { sessions: { create: vi.fn().mockResolvedValue({ id: 'cs', url: 'https://checkout.stripe.com/c/pay/cs', currency: 'usd', amount_total: 500 }) } } } as unknown as Stripe;
    await expect(createSponsoredAngelCheckout(env, 'https://gtasf.com', stripe)({ env, deviceId: 'd', draft, amountUsdCents: 10000n })).rejects.toThrow('CHECKOUT_MISMATCH');
  });
});

describe('settleSponsoredAngelSession', () => {
  const event = (metadata: Record<string, string>, type = 'checkout.session.completed', id = 'cs_test_1') =>
    ({ type, data: { object: { id, metadata } } }) as unknown as Stripe.Event;

  it('ignores non-angel events and non-completed event types', async () => {
    const { db } = d1();
    const stripe = {} as unknown as Stripe;
    expect(await settleSponsoredAngelSession(stripe, event({ gtasfProduct: 'outbid' }), db, 1)).toBe(false);
    expect(await settleSponsoredAngelSession(stripe, event({ gtasfProduct: 'sponsored-angel' }, 'payment_intent.succeeded'), db, 1)).toBe(false);
  });

  it('captures the manual charge and publishes the pending angel', async () => {
    const { db, now } = d1();
    await insertPendingAngel(db, { id: 'a1', sponsorDeviceId: 'dev-1', draft, checkoutId: 'cs_test_1', now });
    const capture = vi.fn().mockResolvedValue({ status: 'succeeded' });
    const stripe = {
      checkout: { sessions: { retrieve: vi.fn().mockResolvedValue({ id: 'cs_test_1', metadata: { gtasfProduct: 'sponsored-angel' }, mode: 'payment', currency: 'usd', amount_total: 10000, payment_intent: 'pi_1' }) } },
      paymentIntents: { retrieve: vi.fn().mockResolvedValue({ status: 'requires_capture' }), capture },
    } as unknown as Stripe;
    expect(await settleSponsoredAngelSession(stripe, event({ gtasfProduct: 'sponsored-angel' }), db, now + 5)).toBe(true);
    expect(capture).toHaveBeenCalledWith('pi_1');
    expect((await getAngel(db, 'a1'))?.status).toBe('live');
  });

  it('refunds the captured charge when the spot was taken in the race', async () => {
    const { db, now } = d1();
    // A different sponsor already holds this spot live.
    await insertPendingAngel(db, { id: 'taker', sponsorDeviceId: 'dev-x', draft, checkoutId: 'cs_other', now });
    await publishAngel(db, 'taker', now);
    // Our buyer's pending angel wants the same (now-taken) spot.
    await insertPendingAngel(db, { id: 'a1', sponsorDeviceId: 'dev-1', draft, checkoutId: 'cs_test_1', now });
    const capture = vi.fn().mockResolvedValue({ status: 'succeeded' });
    const refund = vi.fn().mockResolvedValue({ id: 're_1' });
    const stripe = {
      checkout: { sessions: { retrieve: vi.fn().mockResolvedValue({ id: 'cs_test_1', metadata: { gtasfProduct: 'sponsored-angel' }, mode: 'payment', currency: 'usd', amount_total: 10000, payment_intent: 'pi_1' }) } },
      paymentIntents: { retrieve: vi.fn().mockResolvedValue({ status: 'requires_capture' }), capture },
      refunds: { create: refund },
    } as unknown as Stripe;
    expect(await settleSponsoredAngelSession(stripe, event({ gtasfProduct: 'sponsored-angel' }), db, now + 5)).toBe(true);
    expect(capture).toHaveBeenCalledWith('pi_1');
    expect(refund).toHaveBeenCalledWith({ payment_intent: 'pi_1' });
    expect((await getAngel(db, 'a1'))?.status).toBe('pending'); // never went live
  });

  it('is idempotent on webhook replay (already-live angel, no re-capture)', async () => {
    const { db, now } = d1();
    await insertPendingAngel(db, { id: 'a1', sponsorDeviceId: 'dev-1', draft, checkoutId: 'cs_test_1', now });
    await publishAngel(db, 'a1', now);
    const capture = vi.fn();
    const stripe = {
      checkout: { sessions: { retrieve: vi.fn().mockResolvedValue({ id: 'cs_test_1', metadata: { gtasfProduct: 'sponsored-angel' }, mode: 'payment', currency: 'usd', amount_total: 10000, payment_intent: 'pi_1' }) } },
      paymentIntents: { retrieve: vi.fn(), capture },
    } as unknown as Stripe;
    expect(await settleSponsoredAngelSession(stripe, event({ gtasfProduct: 'sponsored-angel' }), db, now + 9)).toBe(true);
    expect(capture).not.toHaveBeenCalled();
    expect((await getAngel(db, 'a1'))?.status).toBe('live');
  });

  it('acknowledges but does nothing for an unknown checkout session', async () => {
    const { db } = d1();
    const retrieve = vi.fn().mockResolvedValue({ id: 'cs_test_unknown', metadata: { gtasfProduct: 'sponsored-angel' }, mode: 'payment', currency: 'usd', amount_total: 10000, payment_intent: 'pi_x' });
    const captureRetrieve = vi.fn();
    const stripe = { checkout: { sessions: { retrieve } }, paymentIntents: { retrieve: captureRetrieve, capture: vi.fn() } } as unknown as Stripe;
    expect(await settleSponsoredAngelSession(stripe, event({ gtasfProduct: 'sponsored-angel' }, 'checkout.session.completed', 'cs_test_unknown'), db, 1)).toBe(true);
    expect(captureRetrieve).not.toHaveBeenCalled();
  });

  it('rejects a tampered session (wrong currency)', async () => {
    const { db, now } = d1();
    await insertPendingAngel(db, { id: 'a1', sponsorDeviceId: 'dev-1', draft, checkoutId: 'cs_test_1', now });
    const stripe = { checkout: { sessions: { retrieve: vi.fn().mockResolvedValue({ id: 'cs_test_1', metadata: { gtasfProduct: 'sponsored-angel' }, mode: 'payment', currency: 'gbp', amount_total: 10000, payment_intent: 'pi_1' }) } } } as unknown as Stripe;
    await expect(settleSponsoredAngelSession(stripe, event({ gtasfProduct: 'sponsored-angel' }), db, now)).rejects.toThrow('ANGEL_AMOUNT_MISMATCH');
  });
});
