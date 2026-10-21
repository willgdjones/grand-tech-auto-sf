import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import {
  createFundDropSponsorCheckout,
  fundDropSponsorCheckoutParameters,
  settleFundDropSponsorSession,
} from './fundDropSponsorCheckout';
import { dropSponsorOverrides, getSponsorOrderByCheckoutId, insertPendingSponsorOrder, setDropSponsor } from '../funding/dropsStore';
import type { Env } from '../env';
import type { FundDropSponsorDraft } from '@gtasf/shared/drops';

const draft: FundDropSponsorDraft = { slot: 5000, name: 'Acme Capital', url: 'https://acme.example' };
const env = { ENVIRONMENT: 'test', STRIPE_TEST_SECRET_KEY: 'sk_test_x' } as unknown as Env;

function d1() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of ['0010_funding.sql', '0014_funding_bonus.sql', '0018_fund_drops.sql', '0027_fund_drop_sponsor_orders.sql'])
    sqlite.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
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

describe('fundDropSponsorCheckoutParameters', () => {
  it('builds a USD manual-capture session with product metadata and game return URLs', () => {
    const p = fundDropSponsorCheckoutParameters({ draft, amountUsdCents: 50000n, returnOrigin: 'https://gtasf.com' });
    expect(p.mode).toBe('payment');
    expect(p.line_items?.[0]?.price_data?.currency).toBe('usd');
    expect(p.line_items?.[0]?.price_data?.unit_amount).toBe(50000);
    expect(p.payment_intent_data?.capture_method).toBe('manual');
    expect(p.metadata).toMatchObject({ gtasfProduct: 'fund-drop-sponsor', slot: '5000' });
    expect(p.payment_intent_data?.metadata).toMatchObject({ gtasfProduct: 'fund-drop-sponsor' });
    expect(p.success_url).toBe('https://gtasf.com/?drop=sponsored');
    expect(p.cancel_url).toBe('https://gtasf.com/?drop=cancelled');
  });

  it('allows http only on localhost, never an arbitrary http origin', () => {
    expect(() => fundDropSponsorCheckoutParameters({ draft, amountUsdCents: 50000n, returnOrigin: 'http://127.0.0.1:5173' })).not.toThrow();
    expect(() => fundDropSponsorCheckoutParameters({ draft, amountUsdCents: 50000n, returnOrigin: 'http://evil.example' })).toThrow('CHECKOUT_ORIGIN');
  });

  it('refuses an amount below the Stripe card minimum', () => {
    expect(() => fundDropSponsorCheckoutParameters({ draft, amountUsdCents: 25n, returnOrigin: 'https://gtasf.com' })).toThrow();
  });
});

describe('createFundDropSponsorCheckout', () => {
  it('creates a USD session and returns {id,url}', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1', currency: 'usd', amount_total: 50000 });
    const stripe = { checkout: { sessions: { create } } } as unknown as Stripe;
    const session = await createFundDropSponsorCheckout(env, 'https://gtasf.com', stripe)({ draft, amountUsdCents: 50000n });
    expect(session).toEqual({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    const params = create.mock.calls[0]![0] as Stripe.Checkout.SessionCreateParams;
    expect(params.line_items?.[0]?.price_data?.currency).toBe('usd');
  });

  it('rejects a session whose URL host is not Stripe Checkout', async () => {
    const stripe = { checkout: { sessions: { create: vi.fn().mockResolvedValue({ id: 'cs', url: 'https://evil.example/x', currency: 'usd', amount_total: 50000 }) } } } as unknown as Stripe;
    await expect(createFundDropSponsorCheckout(env, 'https://gtasf.com', stripe)({ draft, amountUsdCents: 50000n })).rejects.toThrow('CHECKOUT_MISMATCH');
  });

  it('rejects a session whose amount does not match the quote', async () => {
    const stripe = { checkout: { sessions: { create: vi.fn().mockResolvedValue({ id: 'cs', url: 'https://checkout.stripe.com/c/pay/cs', currency: 'usd', amount_total: 500 }) } } } as unknown as Stripe;
    await expect(createFundDropSponsorCheckout(env, 'https://gtasf.com', stripe)({ draft, amountUsdCents: 50000n })).rejects.toThrow('CHECKOUT_MISMATCH');
  });
});

describe('settleFundDropSponsorSession', () => {
  const event = (metadata: Record<string, string>, type = 'checkout.session.completed', id = 'cs_test_1') =>
    ({ type, data: { object: { id, metadata } } }) as unknown as Stripe.Event;
  const session = (over: Record<string, unknown> = {}) =>
    ({ id: 'cs_test_1', metadata: { gtasfProduct: 'fund-drop-sponsor' }, mode: 'payment', currency: 'usd', amount_total: 50000, payment_intent: 'pi_1', ...over });

  it('ignores non-sponsor events and non-completed event types', async () => {
    const { db } = d1();
    const stripe = {} as unknown as Stripe;
    expect(await settleFundDropSponsorSession(stripe, event({ gtasfProduct: 'outbid' }), db, 1)).toBe(false);
    expect(await settleFundDropSponsorSession(stripe, event({ gtasfProduct: 'fund-drop-sponsor' }, 'payment_intent.succeeded'), db, 1)).toBe(false);
  });

  it('captures the manual charge and applies the sponsor to the slot', async () => {
    const { db, now } = d1();
    await insertPendingSponsorOrder(db, { checkoutId: 'cs_test_1', slot: 5000, name: 'Acme Capital', url: 'https://acme.example', amountCents: 50000n, now });
    const capture = vi.fn().mockResolvedValue({ status: 'succeeded' });
    const stripe = {
      checkout: { sessions: { retrieve: vi.fn().mockResolvedValue(session()) } },
      paymentIntents: { retrieve: vi.fn().mockResolvedValue({ status: 'requires_capture' }), capture },
    } as unknown as Stripe;
    expect(await settleFundDropSponsorSession(stripe, event({ gtasfProduct: 'fund-drop-sponsor' }), db, now + 5)).toBe(true);
    expect(capture).toHaveBeenCalledWith('pi_1');
    expect(await dropSponsorOverrides(db)).toContainEqual({ slot: 5000, sponsor: { name: 'Acme Capital', url: 'https://acme.example' } });
    expect((await getSponsorOrderByCheckoutId(db, 'cs_test_1'))?.status).toBe('settled');
  });

  it('refunds the captured charge when a different sponsor already holds the slot', async () => {
    const { db, now } = d1();
    await setDropSponsor(db, { slot: 5000, name: 'Beta Ventures', now });
    await insertPendingSponsorOrder(db, { checkoutId: 'cs_test_1', slot: 5000, name: 'Acme Capital', amountCents: 50000n, now });
    const capture = vi.fn().mockResolvedValue({ status: 'succeeded' });
    const refund = vi.fn().mockResolvedValue({ id: 're_1' });
    const stripe = {
      checkout: { sessions: { retrieve: vi.fn().mockResolvedValue(session()) } },
      paymentIntents: { retrieve: vi.fn().mockResolvedValue({ status: 'requires_capture' }), capture },
      refunds: { create: refund },
    } as unknown as Stripe;
    expect(await settleFundDropSponsorSession(stripe, event({ gtasfProduct: 'fund-drop-sponsor' }), db, now + 5)).toBe(true);
    expect(refund).toHaveBeenCalledWith({ payment_intent: 'pi_1' });
    expect((await getSponsorOrderByCheckoutId(db, 'cs_test_1'))?.status).toBe('refunded');
    // The incumbent sponsor is untouched.
    expect((await dropSponsorOverrides(db))[0]?.sponsor.name).toBe('Beta Ventures');
  });

  it('is idempotent on webhook replay (already settled, no re-capture)', async () => {
    const { db, now } = d1();
    await insertPendingSponsorOrder(db, { checkoutId: 'cs_test_1', slot: 5000, name: 'Acme Capital', amountCents: 50000n, now });
    const capture = vi.fn().mockResolvedValue({ status: 'succeeded' });
    const retrievePI = vi.fn().mockResolvedValue({ status: 'requires_capture' });
    const stripe = {
      checkout: { sessions: { retrieve: vi.fn().mockResolvedValue(session()) } },
      paymentIntents: { retrieve: retrievePI, capture },
    } as unknown as Stripe;
    await settleFundDropSponsorSession(stripe, event({ gtasfProduct: 'fund-drop-sponsor' }), db, now + 5);
    // Second delivery of the same event: the order is settled, so nothing re-captures.
    expect(await settleFundDropSponsorSession(stripe, event({ gtasfProduct: 'fund-drop-sponsor' }), db, now + 9)).toBe(true);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('acknowledges but does nothing for an unknown checkout session', async () => {
    const { db } = d1();
    const captureRetrieve = vi.fn();
    const stripe = {
      checkout: { sessions: { retrieve: vi.fn().mockResolvedValue(session({ id: 'cs_test_unknown' })) } },
      paymentIntents: { retrieve: captureRetrieve, capture: vi.fn() },
    } as unknown as Stripe;
    expect(await settleFundDropSponsorSession(stripe, event({ gtasfProduct: 'fund-drop-sponsor' }, 'checkout.session.completed', 'cs_test_unknown'), db, 1)).toBe(true);
    expect(captureRetrieve).not.toHaveBeenCalled();
  });

  it('rejects a tampered session (wrong currency)', async () => {
    const { db, now } = d1();
    await insertPendingSponsorOrder(db, { checkoutId: 'cs_test_1', slot: 5000, name: 'Acme Capital', amountCents: 50000n, now });
    const stripe = { checkout: { sessions: { retrieve: vi.fn().mockResolvedValue(session({ currency: 'gbp' })) } } } as unknown as Stripe;
    await expect(settleFundDropSponsorSession(stripe, event({ gtasfProduct: 'fund-drop-sponsor' }), db, now)).rejects.toThrow('SPONSOR_AMOUNT_MISMATCH');
  });
});
