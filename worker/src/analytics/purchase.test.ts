import { DatabaseSync } from 'node:sqlite';
import { expect, test, vi } from 'vitest';
import { OutbidStore } from '../outbid/store';
import { captureConfirmedPurchase } from './xConversions';
vi.mock('@gtasf/shared/flags', () => ({ flags: { posthogAnalytics: true, xAdsPixel: true } }));

test('immutable paid receipt and durable effect share UUID/cash value; pending and replay never fabricate revenue', async () => {
  const db = new DatabaseSync(':memory:');
  const storage = {
    sql: { exec(query: string, ...values: (string | number | null)[]) {
      if (!values.length && query.includes(';')) { db.exec(query); return { toArray: () => [] }; }
      const statement = db.prepare(query);
      const rows = statement.columns().length ? statement.all(...values) : (statement.run(...values), []);
      return { toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error('Expected one row'); return rows[0]; } };
    } },
    transactionSync<T>(fn: () => T): T { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } },
  } as unknown as Pick<DurableObjectStorage, 'sql' | 'transactionSync'>;
  try {
    const store = new OutbidStore(storage), conversionId = crypto.randomUUID();
    store.createBidder('alice', 'fixture-hash');
    const draft = { name: 'SF builders', message: 'Hello city', url: 'https://example.com/', amountCents: 1000, useCredit: true, expectedCreditCents: 350 };
    const context = { conversionId, analytics: { permitted: true as const, distinctId: crypto.randomUUID(), attribution: { twclid: 'click_123' } }, analyticsServer: { ipAddress: '192.0.2.1', userAgent: 'Receipt smoke' } };
    const order = store.createOrder('a'.repeat(32), 'alice', 'checkout-1', 'same-body', draft, Date.now(), context);
    const retry = store.createOrder('b'.repeat(32), 'alice', 'checkout-1', 'same-body', draft, Date.now(), { ...context, conversionId: crypto.randomUUID() });
    expect(retry.id).toBe(order.id); expect(JSON.parse(retry.context_json!).conversionId).toBe(conversionId);
    expect(store.receipt(order.id, 'alice')).toBeNull(); expect(store.analyticsEffects()).toEqual([]);
    const confirmed = { orderId: order.id, intentId: 'pi_confirmed_fixture', amountCents: 650, refundedCents: 0, disputed: false, email: ' TEST@X.COM ' };
    expect(store.settle('evt_verified', confirmed).credited).toBe(true);
    expect(store.settle('evt_verified', confirmed).credited).toBe(false);
    expect(store.settle('evt_duplicate_provider', confirmed).credited).toBe(false);
    const restarted = new OutbidStore(storage);
    expect(restarted.receipt(order.id, 'bob')).toBeNull();
    expect(restarted.receipt(order.id, 'alice')).toEqual({ conversionId, amountCents: 650 });
    expect(restarted.analyticsEffects()).toHaveLength(1);
    const effect = restarted.analyticsEffects()[0]!;
    const send = vi.fn(async () => new Response(null, { status: 200 }));
    await captureConfirmedPurchase({ ENVIRONMENT: 'test', X_PIXEL_ID: 'rgc75', X_PIXEL_TOKEN: 'offline-fixture', X_EVENT_OUTBID_PURCHASE: 'tw-rgc75-rgc7h' }, effect.context, 'outbid_purchase', effect.receipt, effect.server, send);
    expect(send).toHaveBeenCalledTimes(1);
    const options = (send.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(options.body))).toMatchObject({ conversions: [{ conversion_id: conversionId, value: '6.50', price_currency: 'USD', identifiers: [
      { twclid: 'click_123' },
    ] }] });
    expect(String(options.body)).not.toMatch(/TEST@|hashed_email|ip_address|user_agent/);
    restarted.acknowledgeAnalytics(order.id); expect(restarted.analyticsEffects()).toEqual([]);
  } finally { db.close(); }
});
