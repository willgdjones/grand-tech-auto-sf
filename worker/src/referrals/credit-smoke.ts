/** Actual disposable D1/SQLite, with Stripe transport fixtures only. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type Stripe from 'stripe';
import { ensureFundingDevice } from '../funding/identity';
import { ensureReferralAccount } from './store';
import { referralBalances } from './ledger';
import { bindReferralCredit, quoteReferralCredit, referralCreditHold, releaseReferralCredit, reserveReferralCredit, settleReferralCredit } from './credit';
import { OutbidStore } from '../outbid/store';
import { confirmedOutbidPayment, outbidCheckoutParameters } from '../outbid/stripe';

const pool = new Miniflare(convertV4MiniflareOptions({ cf: false, telemetry: { enabled: false }, workers: [{
  name: 'gtasf-referral-credit-smoke', modules: true, script: 'export default { fetch() { return new Response("ok") } }', compatibilityDate: '2026-09-28', d1Databases: ['DB'],
}] }));
const sqlite = new DatabaseSync(':memory:');
const storage = {
  sql: { exec(query: string, ...values: (string | number | null)[]) {
    if (!values.length && query.includes(';')) { sqlite.exec(query); return { toArray: () => [] }; }
    const statement = sqlite.prepare(query), rows = statement.columns().length ? statement.all(...values) : (statement.run(...values), []);
    return { toArray: () => rows, one: () => { assert.equal(rows.length, 1); return rows[0]; } };
  } },
  transactionSync<T>(callback: () => T): T {
    sqlite.exec('BEGIN'); try { const result = callback(); sqlite.exec('COMMIT'); return result; } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
} as unknown as Pick<DurableObjectStorage, 'sql' | 'transactionSync'>;
try {
  await pool.ready;
  const db = await pool.getD1Database('DB') as unknown as D1Database;
  for (const file of ['0010_funding.sql', '0011_referrals.sql', '0012_referral_ledger.sql', '0013_referral_credit.sql', '0015_referral_credit_refunds.sql', '0016_referral_claims.sql']) {
    for (const sql of (await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8')).split(';').filter(sql => sql.trim())) await db.prepare(sql).run();
  }
  const now = Date.parse('2026-10-05T16:10:00Z');
  const device = await ensureFundingDevice(new Request('https://gtasf.test/api/referrals/profile'), db, now);
  const owner = await ensureReferralAccount(db, device.deviceId, now);
  await db.prepare("INSERT INTO referral_ledger VALUES('earned',NULL,?,1000,?,'fixture','isolated-smoke',?)").bind(owner.id, now, now).run();
  assert.equal((await quoteReferralCredit(db, owner.id, 1000, now)).creditCents, 0); // Email ownership required.
  await assert.rejects(reserveReferralCredit(db, 'unclaimed', owner.id, 1000, 1000, now), /CREDIT_UNAVAILABLE/);
  await db.prepare('UPDATE referral_accounts SET claimed_at=? WHERE id=?').bind(now, owner.id).run();
  assert.deepEqual(await quoteReferralCredit(db, owner.id, 1025, now), { grossCents: 1025, creditCents: 975, cashCents: 50, availableCents: '1000', claimed: true });
  const concurrent = await Promise.allSettled(['a', 'b'].map(id => reserveReferralCredit(db, id, owner.id, 1000, 600, now)));
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  const winner = concurrent[0]!.status === 'fulfilled' ? 'a' : 'b';
  assert.equal((await referralBalances(db, owner.id, now)).availableCents, '400');
  await reserveReferralCredit(db, winner, owner.id, 1000, 600, now);
  await bindReferralCredit(db, winner, 'cs_expired');
  // Wrong session, cancel redirect, or clock expiry alone cannot release the hold.
  await releaseReferralCredit(db, winner, 'cs_wrong', now + 1_800_001);
  assert.equal((await referralBalances(db, owner.id, now + 1_800_001)).availableCents, '400');
  await Promise.all([1, 2].map(() => releaseReferralCredit(db, winner, 'cs_expired', now + 1_800_002)));
  assert.equal((await referralBalances(db, owner.id, now + 1_800_003)).availableCents, '1000');
  await assert.rejects(settleReferralCredit(db, winner, 'cs_expired', 'pi_too_late', 400, 0, false, now + 1_800_004), /CREDIT_PAYMENT_MISMATCH/);
  const current = now + 2_000_000;
  await reserveReferralCredit(db, 'mixed', owner.id, 500, 400, current);
  await bindReferralCredit(db, 'mixed', 'cs_mixed');
  assert.equal(await settleReferralCredit(db, 'mixed', 'cs_mixed', 'pi_mixed', 100, 0, false, current), 400);
  assert.equal(await settleReferralCredit(db, 'mixed', 'cs_mixed', 'pi_mixed', 100, 50, false, current + 1), 200);
  assert.equal((await referralBalances(db, owner.id, current + 2)).availableCents, '800');
  assert.equal(await settleReferralCredit(db, 'mixed', 'cs_mixed', 'pi_mixed', 100, 0, false, current + 2), 200);
  await settleReferralCredit(db, 'mixed', 'cs_mixed', 'pi_mixed', 100, 50, true, current + 3);
  await reserveReferralCredit(db, 'spent-while-disputed', owner.id, 1000, 1000, current + 4);
  await bindReferralCredit(db, 'spent-while-disputed', 'cs_other');
  await settleReferralCredit(db, 'mixed', 'cs_mixed', 'pi_mixed', 100, 50, false, current + 5);
  assert.equal((await referralBalances(db, owner.id, current + 6)).debtCents, '200');
  await releaseReferralCredit(db, 'spent-while-disputed', 'cs_other', current + 7);
  await settleReferralCredit(db, 'mixed', 'cs_mixed', 'pi_mixed', 100, 100, false, current + 8);
  assert.equal((await referralBalances(db, owner.id, current + 9)).availableCents, '1000');

  const bids = new OutbidStore(storage), conversionId = crypto.randomUUID();
  bids.createBidder('bidder', 'fixture-secret-hash', current);
  const draft = { name: 'Startup', message: 'Hello SF', url: 'https://example.com/', amountCents: 1000, useCredit: true, expectedCreditCents: 1000 };
  const order = bids.createOrder('free', 'bidder', 'request-free', 'body-free', draft, current,
    { conversionId, analytics: { distinctId: crypto.randomUUID(), permitted: true, attribution: {} } });
  const params = outbidCheckoutParameters(order, 'https://gtasf.test');
  assert.equal(params.line_items?.[0]?.price_data?.unit_amount, 0);
  assert.equal(params.payment_intent_data, undefined);
  await reserveReferralCredit(db, order.id, owner.id, 1000, 1000, current + 10);
  await bindReferralCredit(db, order.id, 'cs_free');
  bids.bindCheckout(order.id, 'cs_free', 'https://checkout.stripe.com/c/pay/cs_free');
  const session = { id: 'cs_free', status: 'complete', mode: 'payment', livemode: false, currency: 'usd', amount_total: 0, payment_intent: null,
    payment_status: 'no_payment_required', metadata: { gtasfProduct: 'outbid', orderId: order.id }, line_items: { data: [{ quantity: 1, amount_total: 0 }], has_more: false } };
  const stripe = { checkout: { sessions: { retrieve: async () => session } } } as unknown as Stripe;
  const event = { id: 'evt_free', created: Math.floor(current / 1000), livemode: false, type: 'checkout.session.completed', data: { object: { id: 'cs_free' } } } as Stripe.Event;
  const payment = await confirmedOutbidPayment(stripe, event); assert.ok(payment);
  assert.equal(bids.receipt(order.id, 'bidder'), null);
  await settleReferralCredit(db, order.id, 'cs_free', payment.intentId, 0, 0, false, current + 11);
  bids.settle(event.id, payment, current + 12);
  bids.settle(event.id, payment, current + 13);
  assert.equal(bids.authenticate('bidder', 'fixture-secret-hash')?.totalCents, '1000');
  assert.equal(bids.receipt(order.id, 'foreign-bidder'), null);
  assert.deepEqual(bids.receipt(order.id, 'bidder'), { conversionId, amountCents: 0 });
  assert.equal(bids.analyticsEffects().length, 1);
  assert.deepEqual(bids.analyticsEffects()[0]?.receipt, { conversionId, amountCents: 0 });
  assert.equal((await referralCreditHold(db, order.id))?.state, 'consumed');
  assert.equal((await referralBalances(db, owner.id, current + 13)).availableCents, '0');
  session.status = 'open'; await assert.rejects(confirmedOutbidPayment(stripe, event), /PAYMENT_NOT_CAPTURED/);
  console.log('TEST_PASSED:ReferralCredit real D1 concurrency, claimed ownership, retry/expiry, proportional refund/dispute/debt, verified free Checkout, immutable receipt and one analytics outbox');
} finally { sqlite.close(); await pool.dispose(); }
