import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { OutbidStore } from '../outbid/store';
import { sha256 } from '../outbid/linkcheck';
import { LedgerDO } from './LedgerDO';

// Exercise the real HTTP checkout and SQLite order store; only the Worker base
// class and external moderation/payment transports are replaced.
vi.mock('cloudflare:workers', () => ({ DurableObject: class {
  constructor(protected ctx: DurableObjectState, protected env: Env) {}
} }));
vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { flags: { ...actual.flags, outbidBanner: true, outbidCheckout: true, referrals: true,
    referralCredit: true } }; // Even a stale cash flag cannot revive retired purchases.
});
vi.mock('../outbid/moderation', async importOriginal => ({
  ...await importOriginal<typeof import('../outbid/moderation')>(),
  moderateOutbidDraft: vi.fn(async () => {}),
}));
const external = vi.hoisted(() => ({ createSession: vi.fn() }));
vi.mock('../outbid/stripe', async importOriginal => ({
  ...await importOriginal<typeof import('../outbid/stripe')>(),
  createOutbidStripe: () => ({ checkout: { sessions: { create: external.createSession } } }),
}));

it('creates cash-only orders without referral identity or commission context and retires credit entry points', async () => {
  const db = new DatabaseSync(':memory:');
  const d1Access = vi.fn(() => { throw new Error('Cash checkout must not read referral D1'); });
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
    setAlarm: vi.fn(async () => {}),
  } as unknown as DurableObjectStorage;
  const env = { ENVIRONMENT: 'local', STRIPE_TEST_SECRET_KEY: 'sk_test_fixture',
    STRIPE_TEST_WEBHOOK_SECRET: 'whsec_fixture', TYPESAFE_API_KEY: 'fixture',
    DB: { prepare: d1Access, batch: d1Access } } as unknown as Env;
  const ctx = { storage, blockConcurrencyWhile: (callback: () => Promise<unknown>) => callback() } as unknown as DurableObjectState;
  external.createSession.mockReset().mockResolvedValue({ id: 'cs_fixture', livemode: false,
    url: 'https://checkout.stripe.com/c/pay/cs_fixture', amount_total: 1000, currency: 'usd' });
  try {
    const ledger = new LedgerDO(ctx, env), store = new OutbidStore(storage);
    const bidder = 'a'.repeat(32), token = 'b'.repeat(64);
    store.createBidder(bidder, await sha256(token));
    const draft = { name: 'SF Builders', message: 'Build useful things', url: 'https://example.com', amountCents: 1000 };
    const request = (body: object, key: string) => new Request('http://localhost/api/outbid/checkout', {
      method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json',
        Cookie: `gtasf_outbid=${bidder}.${token}`, 'Idempotency-Key': key }, body: JSON.stringify(body),
    });
    const response = await ledger.fetch(request(draft, 'cash-order-request-1'));
    expect(response.status).toBe(200);
    const result = await response.json() as { orderId: string; url: string };
    expect(result.url).toBe('https://checkout.stripe.com/c/pay/cs_fixture');
    const order = store.order(result.orderId)!;
    expect(order.credit_cents).toBe(0);
    expect(JSON.parse(order.context_json!)).not.toHaveProperty('referralBuyer');
    expect(external.createSession).toHaveBeenCalledTimes(1);
    const replay = await ledger.fetch(request(draft, 'cash-order-request-1'));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(result);
    expect(external.createSession).toHaveBeenCalledTimes(1);

    const credit = await ledger.fetch(request({ ...draft, useCredit: true, expectedCreditCents: 500 }, 'credit-order-request-1'));
    expect(credit.status).toBe(410);
    expect(store.orderForRequest(bidder, 'credit-order-request-1')).toBeNull();
    const quote = await ledger.fetch(new Request('http://localhost/api/outbid/credit-quote?amountCents=1000'));
    expect(quote.status).toBe(410);
    expect(external.createSession).toHaveBeenCalledTimes(1);
    expect(d1Access).not.toHaveBeenCalled();
    expect(store.referralEffects()).toEqual([]);
  } finally { db.close(); }
});
