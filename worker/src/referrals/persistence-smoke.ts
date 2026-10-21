/** One actual workerd/D1 smoke for attribution; uses no remote services. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { addReferralToUrl, REFERRAL_WINDOW_MS } from '@gtasf/shared/referrals';
import { ensureFundingDevice } from '../funding/identity';
import { referralIdentity, referralSameOrigin } from './identity';
import { activeReferral, ensureReferralAccount, recordReferralPlayer, recordReferralVisit, referralProfile, referralRateLimit } from './store';

const pool = new Miniflare(convertV4MiniflareOptions({ cf: false, telemetry: { enabled: false }, workers: [{
  name: 'gtasf-referral-smoke', modules: true, script: 'export default { fetch() { return new Response("ok") } }',
  compatibilityDate: '2026-09-28', d1Databases: ['DB'],
}] }));
try {
  await pool.ready;
  const db = await pool.getD1Database('DB') as unknown as D1Database;
  for (const file of ['0010_funding.sql', '0011_referrals.sql', '0012_referral_ledger.sql', '0016_referral_claims.sql']) {
    const migration = await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
    for (const statement of migration.split(';').filter(sql => sql.trim())) await db.prepare(statement).run();
  }
  const now = Date.parse('2026-10-05T16:10:00Z');
  const make = async () => {
    const identity = await ensureFundingDevice(new Request('https://gtasf.test/api/referrals/profile'), db, now);
    return { ...identity, account: await ensureReferralAccount(db, identity.deviceId, now) };
  };
  const first = await make(), second = await make(), buyer = await make();
  assert.equal((await ensureReferralAccount(db, first.deviceId, now + 1)).code, first.account.code);
  assert.equal(await referralIdentity(new Request('https://gtasf.test/api/referrals/profile?code=' + first.account.code), db), null);
  const authenticated = new Request('https://gtasf.test/api/referrals/profile', { headers: { cookie: first.cookie!.split(';')[0]! } });
  assert.equal((await referralIdentity(authenticated, db))?.account.id, first.account.id);
  const visit = crypto.randomUUID();
  const duplicates = await Promise.all([1, 2].map(() => recordReferralVisit(db, buyer.deviceId, first.account.code, visit, now + 1)));
  assert.equal(duplicates.filter(Boolean).length, 1);
  await recordReferralPlayer(db, buyer.deviceId, now + 2);
  await recordReferralPlayer(db, buyer.deviceId, now + 3);
  assert.equal((await referralProfile(db, first.account)).clicks, 1);
  assert.equal((await referralProfile(db, first.account)).players, 1);
  assert.equal(await recordReferralVisit(db, first.deviceId, first.account.code, crypto.randomUUID(), now + 4), false);
  assert.equal(await recordReferralVisit(db, buyer.deviceId, second.account.code, crypto.randomUUID(), now + 5), true);
  assert.equal((await activeReferral(db, buyer.deviceId, now + 6))?.referrerId, second.account.id);
  // Retried older visits must not overwrite a newer click.
  await recordReferralVisit(db, buyer.deviceId, first.account.code, visit, now + 7);
  assert.equal((await activeReferral(db, buyer.deviceId, now + 8))?.referrerId, second.account.id);
  assert.equal(await activeReferral(db, buyer.deviceId, now + REFERRAL_WINDOW_MS), null);
  await db.prepare('UPDATE referral_accounts SET email_hash=? WHERE id=?').bind('verified-same-email', buyer.account.id).run();
  // email_hash is unique by design: a verified second device maps to the existing account.
  await db.prepare('UPDATE referral_devices SET account_id=? WHERE device_id=?').bind(buyer.account.id, second.deviceId).run();
  assert.equal(await recordReferralVisit(db, second.deviceId, buyer.account.code, crypto.randomUUID(), now + 9), false);
  const limits = await Promise.all([1, 2, 3].map(() => referralRateLimit(db, 'test', 2, 1000, now)));
  assert.equal(limits.filter(Boolean).length, 2);
  assert.equal(await referralRateLimit(db, 'test', 2, 1000, now + 1000), true);
  const location = addReferralToUrl('/go/startup?at=37.8,-122.4&ref=old#map', first.account.code, 'https://gtasf.test');
  assert.equal(new URL(location).pathname, '/go/startup');
  assert.equal(new URL(location).searchParams.get('at'), '37.8,-122.4');
  assert.equal(new URL(location).hash, '#map');
  assert.equal(new URL(location).searchParams.get('ref'), first.account.code);
  assert.equal(addReferralToUrl('https://lu.ma/event', first.account.code, 'https://gtasf.test'), 'https://lu.ma/event');
  assert.equal(referralSameOrigin(new Request(authenticated.url, { method: 'POST' })), false);
  assert.equal(referralSameOrigin(new Request(authenticated.url, { method: 'POST', headers: { Origin: 'https://evil.test' } })), false);
  assert.equal(referralSameOrigin(new Request(authenticated.url, { method: 'POST', headers: { Origin: 'https://gtasf.test' } })), true);
  console.log('TEST_PASSED:ReferralAttribution D1 identity, duplicate clicks/players, last-click, expiry, self-device, rate limit and share URL');
} finally { await pool.dispose(); }
