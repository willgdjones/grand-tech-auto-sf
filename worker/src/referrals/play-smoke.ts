/** Real D1 + SQLite, deterministic server-clock boundary. Not a wall-time/device gate. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { WorldReferralPlay } from './play';
import { ensureFundingDevice } from '../funding/identity';
import { getFundingProfile } from '../funding/store';
import { ensureReferralAccount, recordReferralVisit } from './store';
const pool = new Miniflare(convertV4MiniflareOptions({ cf: false, telemetry: { enabled: false }, workers: [{
  name: 'gtasf-referral-play-smoke', modules: true, script: 'export default { fetch() { return new Response("ok") } }', compatibilityDate: '2026-09-28', d1Databases: ['DB'],
}] }));
const sqlite = new DatabaseSync(':memory:');
const storage = { sql: { exec(query: string, ...values: (string | number | null)[]) {
  const statement = sqlite.prepare(query), rows = statement.columns().length ? statement.all(...values) : (statement.run(...values), []);
  return { toArray: () => rows };
} } } as unknown as Pick<DurableObjectStorage, 'sql'>;
try {
  await pool.ready;
  const db = await pool.getD1Database('DB') as unknown as D1Database;
  for (const file of ['0010_funding.sql', '0011_referrals.sql', '0012_referral_ledger.sql', '0014_funding_bonus.sql',
    '0016_referral_claims.sql', '0018_fund_drops.sql', '0020_funding_credits.sql', '0021_referral_reward_amount.sql']) {
    for (const sql of (await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8')).split(';').filter(sql => sql.trim())) await db.prepare(sql).run();
  }
  let now = Date.parse('2026-10-05T16:10:00Z');
  const make = async () => {
    const identity = await ensureFundingDevice(new Request('https://gtasf.test/api/referrals/profile'), db, now);
    return { ...identity, account: await ensureReferralAccount(db, identity.deviceId, now) };
  };
  const referrer = await make(), buyer = await make();
  await recordReferralVisit(db, buyer.deviceId, referrer.account.code, crypto.randomUUID(), now);
  let fail = false;
  const resilient = { prepare(sql: string) {
    if (fail && sql.startsWith('UPDATE referral_players SET played_ms=')) throw new Error('D1 unavailable');
    return db.prepare(sql);
  }, batch: db.batch.bind(db) } as D1Database;
  let work: Promise<unknown>[] = [];
  const retain = (promise: Promise<unknown>) => { work.push(promise); };
  const drain = async () => { while (work.length) { const tasks = work; work = []; await Promise.all(tasks); } };
  let play = new WorldReferralPlay(storage, resilient, retain, () => {}, true);
  play.observe(now, [buyer.deviceId, buyer.deviceId]); await drain();
  async function elapsed(duration: number, devices = [buyer.deviceId, buyer.deviceId]) {
    while (duration > 0) { const delta = Math.min(1000, duration); now += delta; duration -= delta; play.observe(now, devices); if (now % 10_000 === 0) await drain(); }
    await drain();
  }
  await elapsed(100_000); play.observe(now, []); await play.flush(now); await drain();
  const progress = () => db.prepare('SELECT played_ms FROM referral_players WHERE buyer_device_id=?').bind(buyer.deviceId).first<{ played_ms: number }>();
  assert.equal((await progress())?.played_ms, 100_000, 'Two tabs count once');
  now += 600_000; // Disconnected gap + process re-instantiation cannot earn play.
  play = new WorldReferralPlay(storage, resilient, retain, () => {}, true);
  play.observe(now, [buyer.deviceId]); await drain();
  await elapsed(199_999); await play.flush(now); await drain();
  assert.equal((await getFundingProfile(db, referrer.deviceId, now)).totalCents, '0');
  assert.ok((await progress())!.played_ms < 300_000);
  fail = true; await elapsed(1); await play.flush(now); await drain();
  assert.equal((await getFundingProfile(db, referrer.deviceId, now)).totalCents, '0');
  play.observe(now, []); await drain();
  // Restart retries the durable absolute counter even with no connected players.
  fail = false; play = new WorldReferralPlay(storage, resilient, retain, () => {}, true);
  assert.notEqual(play.nextFlushAt, Infinity); await play.flush(now + 10_000);
  assert.equal((await progress())?.played_ms, 300_000);
  assert.equal((await getFundingProfile(db, referrer.deviceId, now)).totalCents, '500000000'); // $5M warm intro
  assert.equal((await db.prepare('SELECT count(*) n FROM funding_bonuses').first<{ n: number }>())!.n, 1);
  sqlite.prepare('UPDATE world_referral_play SET synced_ms=0,complete=0').run(); // Crash before acknowledgement.
  await play.flush(now + 20_000);
  assert.equal((await getFundingProfile(db, referrer.deviceId, now)).totalCents, '500000000'); // $5M warm intro
  assert.equal((await db.prepare('SELECT count(*) n FROM referral_ledger').first<{ n: number }>())!.n, 0, 'No USD commission or credit');
  const self = await make(); await recordReferralVisit(db, self.deviceId, referrer.account.code, crypto.randomUUID(), now);
  play.observe(now, [self.deviceId]); await drain();
  await db.prepare('UPDATE referral_accounts SET owner_id=? WHERE id=?').bind(referrer.account.id, self.account.id).run();
  await elapsed(300_000, [self.deviceId]); await play.flush(now); await drain();
  assert.equal((await db.prepare('SELECT count(*) n FROM funding_bonuses').first<{ n: number }>())!.n, 1, 'Merged self account cannot earn a bonus');
  console.log('TEST_PASSED:ReferralPlay real D1+SQLite five-minute boundary, duplicate tabs, reconnect gap, outage/restart replay, canonical self-block and funding-only award');
} finally { await pool.dispose(); sqlite.close(); }
