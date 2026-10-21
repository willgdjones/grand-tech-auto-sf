import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import Stripe from 'stripe';
import { isOutbidSnapshot } from '@gtasf/shared/outbid';
import { OutbidStore, type ConfirmedPayment } from './store';
import { confirmedOutbidPayment, createOutbidStripe, outbidCheckoutParameters } from './stripe';
import { moderateOutbidDraft, validateOutbidDraft } from './moderation';
import { checkOutbidLink } from './linkcheck';

/** Actual SQLite, provider transports mocked; no payment fixtures in the running app. */
it('smokes moderated checkout, authenticated cumulative credit, replay, refund and dispute recovery', async () => {
  const db = new DatabaseSync(':memory:');
  const storage = {
    sql: { exec(query: string, ...values: (string | number | null)[]) {
      if (!values.length && query.includes(';')) { db.exec(query); return { toArray: () => [] }; }
      const statement = db.prepare(query);
      const rows = statement.columns().length ? statement.all(...values) : (statement.run(...values), []);
      return { toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error('Expected one row'); return rows[0]; } };
    } },
    transactionSync<T>(callback: () => T): T {
      db.exec('BEGIN'); try { const result = callback(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  } as unknown as Pick<DurableObjectStorage, 'sql' | 'transactionSync'>;
  try {
    const store = new OutbidStore(storage);
    store.createBidder('alice', 'alice-secret-hash', 1); store.createBidder('bob', 'bob-secret-hash', 1);
    expect(store.authenticate('alice', 'wrong')).toBeNull();
    expect(store.authenticate('alice', 'alice-secret-hash')?.totalCents).toBe('0');
    const draft = validateOutbidDraft({ name: 'SF Builders', message: 'Build something useful', url: 'https://example.com', amountCents: 100 });
    expect(() => validateOutbidDraft({ ...draft, amountCents: 99 })).toThrow('INVALID_BID');
    let probability = 1, blockedDns = false, moderationRequests = 0;
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://cloudflare-dns.com/')) return Response.json({ Status: 0, Answer: [{ type: 1, data: blockedDns ? '127.0.0.1' : '93.184.216.34' }] });
      if (url.startsWith('https://api.typesafe.ai/')) { moderationRequests++; return Response.json({ answers: { acceptable: { noul: probability } } }); }
      return new Response('<title>SF Builders</title>Public startup tools', { headers: { 'Content-Type': 'text/html' } });
    }) as typeof fetch;
    await moderateOutbidDraft(draft, 'test-fixture-only', fetcher);
    probability = .5; await expect(moderateOutbidDraft(draft, 'test-fixture-only', fetcher)).rejects.toThrow('CONTENT_NOT_APPROVED');
    blockedDns = true; await expect(checkOutbidLink(draft.url, fetcher)).rejects.toThrow('LINK_NOT_PUBLIC');
    expect(moderationRequests).toBe(2);

    const first = store.createOrder('a1', 'alice', 'request1', 'hash1', draft, 1000);
    expect(store.createOrder('ignored', 'alice', 'request1', 'hash1', draft, 1001).id).toBe('a1');
    expect(() => store.createOrder('conflict', 'alice', 'request1', 'different', draft)).toThrow('IDEMPOTENCY_CONFLICT');
    expect(store.snapshot(false).entries).toEqual([]);
    const params = outbidCheckoutParameters(first, 'http://127.0.0.1:5173');
    expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(100);
    expect(params.payment_intent_data?.metadata?.orderId).toBe('a1');
    expect(() => createOutbidStripe('sk_live_fixture')).toThrow('TEST_STRIPE_REQUIRED');

    const payment: ConfirmedPayment = { orderId: 'a1', intentId: 'pi_a1', amountCents: 100, refundedCents: 0, disputed: false };
    const charge = { id: 'ch_a1', created: 1791216600, billing_details: { email: 'buyer@example.com' }, payment_method_details: { card: { fingerprint: 'fixture-only-card' } }, livemode: false, paid: true, captured: true, currency: 'usd', amount: 100, payment_intent: 'pi_a1', amount_refunded: 0, disputed: false };
    const intent = { id: 'pi_a1', livemode: false, status: 'succeeded', metadata: { gtasfProduct: 'outbid', orderId: 'a1' }, currency: 'usd', amount: 100, amount_received: 100, latest_charge: charge };
    const session = { id: 'cs_a1', livemode: false, metadata: intent.metadata, payment_status: 'paid', mode: 'payment', currency: 'usd', amount_total: 100, payment_intent: 'pi_a1', line_items: { data: [{ quantity: 1, amount_total: 100 }], has_more: false } };
    const provider = { checkout: { sessions: { retrieve: async () => session } }, paymentIntents: { retrieve: async () => intent }, disputes: { list: async () => ({ data: [{ status: 'needs_response' }], has_more: false }) } } as unknown as Stripe;
    const event = { id: 'evt_a1', livemode: false, type: 'checkout.session.completed', data: { object: { id: 'cs_a1' } } } as Stripe.Event;
    session.payment_status = 'unpaid'; expect(await confirmedOutbidPayment(provider, event)).toBeNull(); session.payment_status = 'paid';
    intent.currency = 'eur'; await expect(confirmedOutbidPayment(provider, event)).rejects.toThrow('PAYMENT_AMOUNT_MISMATCH'); intent.currency = 'usd';
    expect(await confirmedOutbidPayment(provider, event)).toMatchObject({ ...payment, paidAt: 1791216600000, email: 'buyer@example.com', cardFingerprint: 'fixture-only-card' });
    const stripe = createOutbidStripe('sk_test_fixture_only'), raw = JSON.stringify(event), secret = 'whsec_fixture_only';
    const signature = stripe.webhooks.generateTestHeaderString({ payload: raw, secret });
    expect((await stripe.webhooks.constructEventAsync(raw, signature, secret, 300, Stripe.createSubtleCryptoProvider())).id).toBe(event.id);
    await expect(stripe.webhooks.constructEventAsync(`${raw}x`, signature, secret, 300, Stripe.createSubtleCryptoProvider())).rejects.toThrow();

    store.settle(event.id, payment, 2000); store.settle(event.id, payment, 2001); store.settle('duplicate-provider-event', payment, 2002);
    expect(store.authenticate('alice', 'alice-secret-hash')?.totalCents).toBe('100');
    expect(store.revision).toBe(1); expect(store.pendingNotice()).toBe(1); store.markNotified(1); expect(store.pendingNotice()).toBeNull();
    store.createOrder('b1', 'bob', 'request-b', 'hash-b', { ...draft, name: 'Bob' }, 1500);
    store.settle('evt_b1', { ...payment, orderId: 'b1', intentId: 'pi_b1' }, 3000);
    expect(store.snapshot(false).entries.map(row => row.bidderId)).toEqual(['alice', 'bob']);
    store.createOrder('a2', 'alice', 'request2', 'hash2', { ...draft, message: 'New approved message', amountCents: 250 }, 4000);
    const second = { ...payment, orderId: 'a2', intentId: 'pi_a2', amountCents: 250 };
    expect(() => store.settle('bad-amount', { ...second, amountCents: 251 })).toThrow('PAYMENT_AMOUNT_MISMATCH');
    expect(store.eventSeen('bad-amount')).toBe(false);
    store.settle('evt_a2', second, 5000); expect(store.snapshot(false).entries[0]?.totalCents).toBe('350');
    store.settle('refund-a2', { ...second, refundedCents: 200 }, 6000);
    store.settle('old-a2', second, 6001); expect(store.snapshot(false).entries[0]?.totalCents).toBe('150');
    store.settle('dispute-a2', { ...second, refundedCents: 200, disputed: true }, 7000);
    expect(store.snapshot(false).entries.map(row => row.bidderId)).toEqual(['bob', 'alice']);
    store.settle('won-a2', { ...second, refundedCents: 200 }, 8000); expect(store.snapshot(false).entries[0]?.totalCents).toBe('150');
    expect(store.snapshot(false).entries[0]?.message).toBe('New approved message');
    expect(isOutbidSnapshot(store.snapshot(false))).toBe(true);
    charge.disputed = true; expect((await confirmedOutbidPayment(provider, event))?.disputed).toBe(true);
    expect(() => store.settle('wrong-identity', { ...second, intentId: 'pi_a1' })).toThrow('PAYMENT_ID_MISMATCH');
    const assetId = 'a'.repeat(32);
    store.addAsset({ id: assetId, bidder_id: 'alice', key: `outbid/quarantine/${assetId}`, mime: 'image/png', width: 32, height: 32 });
    expect(() => store.applyMediaReview(assetId, 'review1', true)).toThrow('NORMALIZED_ASSET_REQUIRED');
    expect(store.asset(assetId)?.status).toBe('pending');
  } finally { db.close(); }
});
