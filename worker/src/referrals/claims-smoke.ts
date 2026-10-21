/** Actual local D1; transactional email is an isolated in-memory delivery adapter. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { REFERRAL_WINDOW_MS } from '@gtasf/shared/referrals';
import { ensureFundingDevice } from '../funding/identity';
import { ensureReferralAccount, referralAccountForDevice, recordReferralVisit } from './store';
import { applyReferralPayment, freezeReferralOrder, referralBalances, referralBuyer } from './ledger';
import { quoteReferralCredit, reserveReferralCredit } from './credit';
import { requestReferralClaim, verifyReferralClaim, type ReferralMailEnv } from './claims';

const pool = new Miniflare(convertV4MiniflareOptions({ cf: false, telemetry: { enabled: false }, workers: [{
  name: 'gtasf-referral-claims-smoke', modules: true, script: 'export default { fetch() { return new Response("ok") } }', compatibilityDate: '2026-09-28', d1Databases: ['DB'],
}] }));
try {
  await pool.ready;
  const db = await pool.getD1Database('DB') as unknown as D1Database;
  for (const file of ['0010_funding.sql', '0011_referrals.sql', '0012_referral_ledger.sql', '0013_referral_credit.sql', '0015_referral_credit_refunds.sql', '0016_referral_claims.sql']) {
    for (const sql of (await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8')).split(';').filter(sql => sql.trim())) await db.prepare(sql).run();
  }
  const now = Date.parse('2026-10-05T16:10:00Z');
  const make = async (at = now) => {
    const identity = await ensureFundingDevice(new Request('https://gtasf.test/api/referrals/profile'), db, at);
    return { ...identity, account: await ensureReferralAccount(db, identity.deviceId, at) };
  };
  const owner = await make(), stranger = await make(), anonymous = await make(now + 10);
  let deliveredProof = '', deliveries = 0;
  const mailer: ReferralMailEnv = { REFERRAL_MAILER: { fetch: async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { text: string; to: string };
    assert.equal(body.to, 'owner@example.com'); assert.match(body.text, /same browser/);
    const match = /https:\/\/gtasf\.test\/#referral-claim=([a-f0-9.-]+)/.exec(body.text); assert.ok(match);
    deliveredProof = match[1]!; deliveries++; return new Response(null, { status: 202 });
  } } as unknown as Fetcher };
  await assert.rejects(requestReferralClaim(db, owner.deviceId, 'owner@example.com', 'https://gtasf.test', {}, now), /CLAIM_DELIVERY_UNAVAILABLE/);
  assert.equal(deliveries, 0);
  await requestReferralClaim(db, owner.deviceId, ' OWNER@example.com ', 'https://gtasf.test', mailer, now);
  const firstProof = deliveredProof;
  await assert.rejects(verifyReferralClaim(db, stranger.deviceId, firstProof, now + 1), /INVALID_CLAIM/);
  await assert.rejects(verifyReferralClaim(db, owner.deviceId, firstProof.slice(0, -1) + (firstProof.endsWith('0') ? '1' : '0'), now + 1), /INVALID_CLAIM/);
  const attempts = await Promise.allSettled([1, 2].map(() => verifyReferralClaim(db, owner.deviceId, firstProof, now + 2)));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await referralAccountForDevice(db, owner.deviceId))?.claimed_at, now + 2);
  await assert.rejects(verifyReferralClaim(db, owner.deviceId, firstProof, now + 3), /INVALID_CLAIM/);
  await assert.rejects(requestReferralClaim(db, owner.deviceId, 'changed@example.com', 'https://gtasf.test', mailer, now + 4), /CLAIM_ACCOUNT_UNAVAILABLE/);
  // Legitimate balances and existing debt must be grouped, never overwritten on recovery.
  await db.batch([
    db.prepare("INSERT INTO referral_ledger VALUES('old',NULL,?,1000,?,'fixture','old',?)").bind(owner.account.id, now, now),
    db.prepare("INSERT INTO referral_ledger VALUES('new',NULL,?,1500,?,'fixture','new',?)").bind(anonymous.account.id, now, now),
    db.prepare("INSERT INTO referral_ledger VALUES('debt',NULL,?,-500,?,'fixture','debt',?)").bind(owner.account.id, now, now),
  ]);
  await recordReferralVisit(db, anonymous.deviceId, owner.account.code, crypto.randomUUID(), now + 11);
  const order = { orderId: 'related-purchase', product: 'outbid' as const, buyer: await referralBuyer(db, anonymous.deviceId, now + 12), createdAt: now + 12, cashCents: 5000 };
  await freezeReferralOrder(db, order);
  await applyReferralPayment(db, 'evt_related', { orderId: order.orderId, paymentId: 'pi_related', cashCents: 5000, refundedCents: 0, disputed: false, paidAt: now + 13, observedAt: now + 14 });
  assert.equal((await referralBalances(db, owner.account.id, now + 15)).pendingCents, '1000');
  await requestReferralClaim(db, anonymous.deviceId, 'owner@example.com', 'https://gtasf.test', mailer, now + 16);
  await verifyReferralClaim(db, anonymous.deviceId, deliveredProof, now + 17);
  assert.equal((await referralAccountForDevice(db, anonymous.deviceId))?.id, owner.account.id);
  assert.deepEqual(await referralBalances(db, owner.account.id, now + 18), { availableCents: '2000', pendingCents: '0', debtCents: '0' });
  assert.equal((await referralBuyer(db, anonymous.deviceId, now + REFERRAL_WINDOW_MS + 1)).firstSeenAt, now);
  assert.equal(await recordReferralVisit(db, anonymous.deviceId, anonymous.account.code, crypto.randomUUID(), now + 19), false);
  const quote = await quoteReferralCredit(db, owner.account.id, 2000, now + 20); assert.equal(quote.creditCents, 2000);
  await reserveReferralCredit(db, 'merged-spend', owner.account.id, 2000, 2000, now + 20);
  assert.equal((await referralBalances(db, anonymous.account.id, now + 21)).availableCents, '0');
  // Expired proof never claims another account; failed cross-device clicks do not consume it.
  await requestReferralClaim(db, stranger.deviceId, 'owner@example.com', 'https://gtasf.test', mailer, now + 22);
  await assert.rejects(verifyReferralClaim(db, stranger.deviceId, deliveredProof, now + 1_800_023), /INVALID_CLAIM/);
  await assert.rejects(requestReferralClaim(db, stranger.deviceId, 'owner@example.com', 'https://gtasf.test', mailer, now + 23), /CLAIM_RATE_LIMIT/);
  console.log('TEST_PASSED:ReferralClaims real D1 unavailable delivery, token secrecy/binding/one-use/expiry, rate limits, canonical recovery, debt preservation and retroactive self-clawback');
} finally { await pool.dispose(); }
