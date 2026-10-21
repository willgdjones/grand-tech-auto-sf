/** One disposable actual D1 + SQLite financial smoke. No remote payment calls. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { REFERRAL_PENDING_MS, REFERRAL_WINDOW_MS } from '@gtasf/shared/referrals';
import { ensureFundingDevice } from '../funding/identity';
import { OutbidStore } from '../outbid/store';
import { ensureReferralAccount, recordReferralVisit } from './store';
import { applyReferralPayment, freezeReferralOrder, referralBalances, referralBuyer, referralFraudHash, recordReferralVerifiedEmail, type ReferralPayment } from './ledger';

const pool = new Miniflare(convertV4MiniflareOptions({ cf: false, telemetry: { enabled: false }, workers: [{
  name: 'gtasf-referral-ledger-smoke', modules: true, script: 'export default { fetch() { return new Response("ok") } }',
  compatibilityDate: '2026-09-28', d1Databases: ['DB'],
}] }));
const sqlite = new DatabaseSync(':memory:');
const storage = {
  sql: { exec(query: string, ...values: (string | number | null)[]) {
    if (!values.length && query.includes(';')) { sqlite.exec(query); return { toArray: () => [] }; }
    const statement = sqlite.prepare(query), rows = statement.columns().length ? statement.all(...values) : (statement.run(...values), []);
    return { toArray: () => rows, one: () => { assert.equal(rows.length, 1); return rows[0]; } };
  } },
  transactionSync<T>(callback: () => T): T {
    sqlite.exec('BEGIN'); try { const result = callback(); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
} as unknown as Pick<DurableObjectStorage, 'sql' | 'transactionSync'>;
try {
  await pool.ready;
  const db = await pool.getD1Database('DB') as unknown as D1Database;
  for (const file of ['0010_funding.sql', '0011_referrals.sql', '0012_referral_ledger.sql', '0016_referral_claims.sql']) {
    for (const sql of (await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8')).split(';').filter(sql => sql.trim())) await db.prepare(sql).run();
  }
  const now = Date.parse('2026-10-05T16:10:00Z');
  const make = async () => {
    const identity = await ensureFundingDevice(new Request('https://gtasf.test/api/referrals/profile'), db, now);
    return { ...identity, account: await ensureReferralAccount(db, identity.deviceId, now) };
  };
  const referrer = await make(), buyer = await make(), later = await make();
  await recordReferralVisit(db, buyer.deviceId, referrer.account.code, crypto.randomUUID(), now);
  const frozen = { orderId: 'first-order', product: 'outbid' as const, buyer: await referralBuyer(db, buyer.deviceId, now), createdAt: now, cashCents: 10_000 };
  await freezeReferralOrder(db, frozen);
  await recordReferralVisit(db, buyer.deviceId, later.account.code, crypto.randomUUID(), now + 10);
  await freezeReferralOrder(db, frozen); // Original order retains its original referrer.
  const payment: ReferralPayment = { orderId: frozen.orderId, paymentId: 'pi_first', cashCents: 10_000, refundedCents: 0,
    disputed: false, paidAt: now + 1000, observedAt: now + 1001,
    emailHash: await referralFraudHash('email', ' Buyer@Example.com '), cardHash: await referralFraudHash('card', 'card-one') };
  const bids = new OutbidStore(storage);
  bids.createBidder('buyer', 'fixture-hash', now);
  bids.createOrder(frozen.orderId, 'buyer', 'request-one', 'body-one', { name: 'Buyer', message: 'Hello SF', url: 'https://example.com/', amountCents: frozen.cashCents }, now, { referralBuyer: frozen.buyer });
  const settled = { orderId: frozen.orderId, intentId: payment.paymentId, amountCents: payment.cashCents, refundedCents: 0, disputed: false };
  bids.settle('evt_first', settled, now + 1002, { eventId: 'evt_first', order: frozen, payment });
  assert.equal(bids.authenticate('buyer', 'fixture-hash')?.totalCents, '10000');
  const restarted = new OutbidStore(storage); // A crash after bid commit retains the work.
  assert.equal(restarted.referralEffects().length, 1);
  await Promise.all([1, 2].map(() => applyReferralPayment(db, 'evt_first', payment)));
  // A crash after D1 but before acknowledgement may redeliver without double-credit.
  await applyReferralPayment(db, 'evt_first', restarted.referralEffects()[0]!.payment);
  restarted.acknowledgeReferral('evt_first');
  assert.equal(restarted.referralEffects().length, 0);
  assert.deepEqual(await referralBalances(db, referrer.account.id, now + 2000), { pendingCents: '2000', availableCents: '0', debtCents: '0' });
  assert.equal((await referralBalances(db, later.account.id, now + 2000)).pendingCents, '0');
  const mature = payment.paidAt + REFERRAL_PENDING_MS;
  assert.equal((await referralBalances(db, referrer.account.id, mature - 1)).availableCents, '0');
  assert.equal((await referralBalances(db, referrer.account.id, mature)).availableCents, '2000');
  await applyReferralPayment(db, 'evt_partial', { ...payment, refundedCents: 2500, observedAt: mature + 1 });
  assert.equal((await referralBalances(db, referrer.account.id, mature + 2)).availableCents, '1500');
  await applyReferralPayment(db, 'evt_old', { ...payment, observedAt: now + 1002 });
  assert.equal((await referralBalances(db, referrer.account.id, mature + 3)).availableCents, '1500');
  await applyReferralPayment(db, 'evt_dispute', { ...payment, refundedCents: 2500, disputed: true, observedAt: mature + 4 });
  assert.equal((await referralBalances(db, referrer.account.id, mature + 5)).availableCents, '0');
  await applyReferralPayment(db, 'evt_won', { ...payment, refundedCents: 2500, observedAt: mature + 6 });
  assert.equal((await referralBalances(db, referrer.account.id, mature + 7)).availableCents, '1500');
  // Fixture models previously spent credit; RF03 supplies the atomic public checkout hold.
  await db.prepare("INSERT INTO referral_ledger VALUES('spent',NULL,?,-1500,?,'redemption','test-order',?)").bind(referrer.account.id, mature, mature).run();
  await applyReferralPayment(db, 'evt_full', { ...payment, refundedCents: 10_000, observedAt: mature + 8 });
  assert.deepEqual(await referralBalances(db, referrer.account.id, mature + 9), { pendingCents: '0', availableCents: '0', debtCents: '1500' });
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM referral_ledger WHERE kind='commission'").first<{ count: number }>())?.count, 5);
  // Payment at/beyond first-visit +30d earns no commission, even for an older order.
  const expired = { ...frozen, orderId: 'expired' };
  await freezeReferralOrder(db, expired);
  await applyReferralPayment(db, 'evt_expired', { ...payment, orderId: expired.orderId, paymentId: 'pi_expired', paidAt: now + REFERRAL_WINDOW_MS, observedAt: now + REFERRAL_WINDOW_MS });
  assert.equal((await referralBalances(db, referrer.account.id, now + REFERRAL_WINDOW_MS)).debtCents, '1500');
  // A referrer's later purchase reveals a shared card and claws back the earlier award.
  const second = { ...frozen, orderId: 'fraud-order' };
  await freezeReferralOrder(db, second);
  await applyReferralPayment(db, 'evt_second', { ...payment, orderId: second.orderId, paymentId: 'pi_second', paidAt: mature + 10, observedAt: mature + 11 });
  assert.equal((await referralBalances(db, referrer.account.id, mature + 12)).pendingCents, '2000');
  const referrerPurchase = { ...frozen, orderId: 'referrer-own', buyer: await referralBuyer(db, referrer.deviceId, now) };
  await freezeReferralOrder(db, referrerPurchase);
  await applyReferralPayment(db, 'evt_own', { ...payment, orderId: referrerPurchase.orderId, paymentId: 'pi_own', paidAt: mature + 20, observedAt: mature + 21, emailHash: await referralFraudHash('email', 'another@example.com') });
  assert.equal((await referralBalances(db, referrer.account.id, mature + 22)).pendingCents, '0');
  // A verified email discovered later is also a self-referral identity.
  const emailFriend = await make(), emailReferrer = await make();
  await recordReferralVisit(db, emailFriend.deviceId, emailReferrer.account.code, crypto.randomUUID(), now);
  const emailOrder = { ...frozen, orderId: 'email-order', buyer: await referralBuyer(db, emailFriend.deviceId, now) };
  await freezeReferralOrder(db, emailOrder);
  await applyReferralPayment(db, 'evt_email', { ...payment, orderId: emailOrder.orderId, paymentId: 'pi_email' });
  await recordReferralVerifiedEmail(db, emailReferrer.account.id, payment.emailHash!, now + 3000);
  assert.equal((await referralBalances(db, emailReferrer.account.id, now + 4000)).pendingCents, '0');
  console.log('TEST_PASSED:ReferralLedger real D1+SQLite outbox replay, frozen attribution, 20%, 7d, refunds/dispute/win, debt, 30d, retroactive card/email self-block');
} finally { sqlite.close(); await pool.dispose(); }
