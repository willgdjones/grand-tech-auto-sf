import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dropSlotAt } from '@gtasf/shared/drops';

// The paid sponsor product is off by default (flags.fundDropSponsors stays false for launch), so the
// route only answers when the flag is on. Mock it on here while keeping every other flag as-is.
vi.mock('@gtasf/shared/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { flags: { ...actual.flags, fundDrops: true, fundDropSponsors: true } };
});

import { handleDropsRequest } from './drops';
import { getSponsorOrderByCheckoutId, insertPendingSponsorOrder, setDropSponsor } from './dropsStore';

const NOW = Date.UTC(2026, 9, 5, 18, 0, 0);
const CURRENT = dropSlotAt(NOW);
const FUTURE = CURRENT + 1;

function d1() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of ['0010_funding.sql', '0014_funding_bonus.sql', '0018_fund_drops.sql', '0027_fund_drop_sponsor_orders.sql'])
    sqlite.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
  return {
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
}

let DB: D1Database;
beforeEach(() => { DB = d1(); });

const configured = (db: D1Database) => ({ ENVIRONMENT: 'test', STRIPE_TEST_SECRET_KEY: 'sk_test_x', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_x', DB: db }) as never;
const req = (path: string, init?: RequestInit) => new Request(`https://gtasf.com${path}`, init);
const post = (path: string, body: unknown) => req(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('GET /api/drops/sponsor/offer', () => {
  it('lists the price and the upcoming purchasable slots', async () => {
    const checkout = vi.fn();
    const res = await handleDropsRequest(req('/api/drops/sponsor/offer'), configured(DB), { now: () => NOW, checkout });
    expect(res!.status).toBe(200);
    const body = await res!.json() as { priceUsdCents: string; checkoutAvailable: boolean; upcoming: { slot: number; sponsored: boolean }[] };
    expect(body.priceUsdCents).toBe('50000');
    expect(body.checkoutAvailable).toBe(true);
    expect(body.upcoming).toHaveLength(8);
    expect(body.upcoming[0]!.slot).toBe(FUTURE);
    expect(body.upcoming.every(s => s.sponsored === false)).toBe(true);
  });

  it('marks a slot already sold as sponsored in the offer', async () => {
    await setDropSponsor(DB, { slot: FUTURE, name: 'Beta Ventures', now: NOW });
    const res = await handleDropsRequest(req('/api/drops/sponsor/offer'), configured(DB), { now: () => NOW });
    const body = await res!.json() as { upcoming: { slot: number; sponsored: boolean; sponsorName?: string }[] };
    expect(body.upcoming[0]).toMatchObject({ slot: FUTURE, sponsored: true, sponsorName: 'Beta Ventures' });
    // No checkout dep ⇒ purchase cannot complete even though the feature is on.
    const offer = body as unknown as { checkoutAvailable: boolean };
    expect(offer.checkoutAvailable).toBe(false);
  });
});

describe('POST /api/drops/sponsor/checkout', () => {
  it('starts a checkout and records a pending order', async () => {
    const checkout = vi.fn().mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' });
    const res = await handleDropsRequest(post('/api/drops/sponsor/checkout', { slot: FUTURE, name: 'Acme Capital', url: 'https://acme.example' }), configured(DB), { now: () => NOW, checkout });
    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_1' });
    expect(checkout).toHaveBeenCalledWith({ draft: { slot: FUTURE, name: 'Acme Capital', url: 'https://acme.example' }, amountUsdCents: 50000n });
    const order = await getSponsorOrderByCheckoutId(DB, 'cs_1');
    expect(order).toMatchObject({ slot: FUTURE, name: 'Acme Capital', status: 'pending', amountCents: '50000' });
  });

  it('rejects a past slot with 400 and never starts checkout', async () => {
    const checkout = vi.fn();
    const res = await handleDropsRequest(post('/api/drops/sponsor/checkout', { slot: CURRENT, name: 'Acme' }), configured(DB), { now: () => NOW, checkout });
    expect(res!.status).toBe(400);
    expect(checkout).not.toHaveBeenCalled();
  });

  it('refuses a slot that is already sponsored (409)', async () => {
    await setDropSponsor(DB, { slot: FUTURE, name: 'Beta Ventures', now: NOW });
    const checkout = vi.fn();
    const res = await handleDropsRequest(post('/api/drops/sponsor/checkout', { slot: FUTURE, name: 'Acme' }), configured(DB), { now: () => NOW, checkout });
    expect(res!.status).toBe(409);
    expect(checkout).not.toHaveBeenCalled();
  });

  it('refuses a slot already held by a recent pending order (409)', async () => {
    await insertPendingSponsorOrder(DB, { checkoutId: 'cs_prev', slot: FUTURE, name: 'Someone Else', amountCents: 50000n, now: NOW });
    const checkout = vi.fn();
    const res = await handleDropsRequest(post('/api/drops/sponsor/checkout', { slot: FUTURE, name: 'Acme' }), configured(DB), { now: () => NOW, checkout });
    expect(res!.status).toBe(409);
    expect(checkout).not.toHaveBeenCalled();
  });

  it('returns 503 when checkout is not configured for the environment', async () => {
    const checkout = vi.fn();
    const env = { ENVIRONMENT: 'test', STRIPE_TEST_SECRET_KEY: 'sk_test_x', DB } as never; // no whsec_
    const res = await handleDropsRequest(post('/api/drops/sponsor/checkout', { slot: FUTURE, name: 'Acme' }), env, { now: () => NOW, checkout });
    expect(res!.status).toBe(503);
    expect(checkout).not.toHaveBeenCalled();
  });

  it('returns 503 when no checkout dependency is wired', async () => {
    const res = await handleDropsRequest(post('/api/drops/sponsor/checkout', { slot: FUTURE, name: 'Acme' }), configured(DB), { now: () => NOW });
    expect(res!.status).toBe(503);
  });
});
