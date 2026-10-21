import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('@gtasf/shared/flags', () => ({ flags: { emailCapture: true } }));

import { handleEmailRequest } from './routes';
import { fakeSendEmailBinding } from './provider';
import { cloudflareEmailProvider } from './provider';
import { EMAIL_VERIFY_BONUS_CENTS } from '@gtasf/shared/email/contract';
import { getFundingProfile, fundingLeaderboard, fundingSummariesByNickname } from '../funding/store';
import { getCapTable } from '../funding/credits';
import { grantEmailReward } from './reward';
import { getCapture, startCapture, hashCode, hashEmail, hashLinkToken, verifyLinkToken, bumpAttempts } from './store';
import type { Env } from '../env';

const ORIGIN = 'https://game.local';
const databases: DatabaseSync[] = [];
afterEach(() => { vi.restoreAllMocks(); while (databases.length) databases.pop()!.close(); });

function db(afterRead?: (sql: string) => void | Promise<void>): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  databases.push(sqlite);
  for (const m of ['0010_funding.sql', '0011_referrals.sql', '0014_funding_bonus.sql', '0018_fund_drops.sql',
    '0020_funding_credits.sql', '0028_economy_v3.sql', '0029_email_capture.sql', '0033_funding_profile_bot.sql'])
    sqlite.exec(readFileSync(new URL(`../../migrations/${m}`, import.meta.url), 'utf8'));
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let bindings: (string | number | null)[] = [];
      const wrapper = {
        bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
        async first() { const row = statement.get(...bindings) ?? null; await afterRead?.(sql); return row; },
        async all() { return { results: statement.all(...bindings), success: true }; },
        async run() { return { meta: statement.run(...bindings), success: true }; },
        execute() { return { meta: statement.run(...bindings), success: true }; },
      };
      return wrapper;
    },
    async batch(statements: { execute(): unknown }[]) {
      sqlite.exec('BEGIN');
      try { const result = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as D1Database;
}
const env = (database: D1Database): Env => ({ DB: database, ENVIRONMENT: 'local' } as unknown as Env);
const cookieToken = (res: Response) => res.headers.get('set-cookie')?.match(/gtasf_device=([a-f0-9]{64})/)?.[1];

const get = (path: string, cookie?: string) =>
  new Request(`${ORIGIN}${path}`, { headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } });
const post = (path: string, body: unknown, cookie?: string) =>
  new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

const codeFrom = (subject: string) => subject.match(/(\d{6})/)![1]!;
const tokenFrom = (text: string) => text.match(/token=([0-9a-f]+)/)![1]!;

test('returns null for unrelated paths', async () => {
  expect(await handleEmailRequest(get('/api/other'), env(db()), cloudflareEmailProvider(fakeSendEmailBinding()))).toBeNull();
});

test('self-gates OFF (available:false) when no send provider is configured', async () => {
  const database = db();
  const status = (await handleEmailRequest(get('/api/email/status'), env(database)))!; // no provider, no env.EMAIL
  expect(status.status).toBe(200);
  expect((await status.json() as { available: boolean }).available).toBe(false);
  // start must refuse when unavailable
  const start = (await handleEmailRequest(post('/api/email/start', { email: 'a@b.com' }), env(database)))!;
  expect(start.status).toBe(503);
});

test('status -> start sends a code+link -> verify grants the reward', async () => {
  const database = db();
  const fake = fakeSendEmailBinding();
  const provider = cloudflareEmailProvider(fake);

  const fresh = (await handleEmailRequest(get('/api/email/status'), env(database), provider))!;
  const cookie = `gtasf_device=${cookieToken(fresh)}`;
  expect(await fresh.json()).toMatchObject({ available: true, pending: false, verified: false, rewarded: false });

  const start = (await handleEmailRequest(post('/api/email/start', { email: 'Founder@Example.com' }, cookie), env(database), provider))!;
  expect(start.status).toBe(200);
  expect(await start.json()).toMatchObject({ sent: true });
  expect(fake.sent).toHaveLength(1);
  expect(fake.sent[0]!.to).toBe('founder@example.com'); // lowercased

  const code = codeFrom(fake.sent[0]!.subject);
  const capture = await database.prepare('SELECT device_id FROM email_captures WHERE email=?').bind('founder@example.com').first<{ device_id: string }>();
  const deviceId = capture!.device_id;
  expect(await grantEmailReward(database, deviceId, Date.now())).toEqual({ verifiedFounder: false, bonusCents: 0 });
  expect((await getFundingProfile(database, deviceId, Date.now())).totalCents).toBe('0');
  const verify = (await handleEmailRequest(post('/api/email/verify', { code }, cookie), env(database), provider))!;
  expect(verify.status).toBe(200);
  expect(await verify.json()).toMatchObject({ verified: true, reward: { verifiedFounder: true, bonusCents: EMAIL_VERIFY_BONUS_CENTS } });

  const after = (await handleEmailRequest(get('/api/email/status', cookie), env(database), provider))!;
  expect(await after.json()).toMatchObject({ verified: true, rewarded: true });
  await database.prepare('UPDATE funding_profiles SET nickname=?,startup_name=? WHERE device_id=?').bind('Verified Fixture', 'Test startup', deviceId).run();
  const profile = await getFundingProfile(database, deviceId, Date.now());
  expect(profile).toMatchObject({ totalCents: String(EMAIL_VERIFY_BONUS_CENTS), verifiedFounder: true });
  const summaries = await fundingSummariesByNickname(database, ['Verified Fixture'], Date.now());
  const leaderboard = await fundingLeaderboard(database, deviceId, Date.now(), new Set([deviceId]));
  expect(summaries[0]?.verifiedFounder).toBe(true);
  expect(leaderboard.week[0]?.verifiedFounder).toBe(true);
  expect(leaderboard.you.verifiedFounder).toBe(true);
  const capTable = await getCapTable(database, deviceId, Date.now());
  expect(capTable.groups[0]?.entries[0]).toMatchObject({ label: 'Verified Founder bonus', amountCents: String(EMAIL_VERIFY_BONUS_CENTS) });
  for (const payload of [profile, summaries, leaderboard, capTable]) {
    const publicJson = JSON.stringify(payload);
    expect(publicJson).not.toContain('founder@example.com');
    expect(publicJson).not.toMatch(/email_hash|code_hash|link_hash/);
  }
  const replay = (await handleEmailRequest(post('/api/email/verify', { code }, cookie), env(database), provider))!;
  expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({ verified: true, reward: { bonusCents: 0 } });
  expect((await getFundingProfile(database, deviceId, Date.now())).totalCents).toBe(String(EMAIL_VERIFY_BONUS_CENTS));
  // The reward belongs to the profile, not to each future season.
  await database.prepare('UPDATE funding_credits SET season=? WHERE device_id=?').bind('prior-season', deviceId).run();
  expect(await grantEmailReward(database, deviceId, Date.now())).toEqual({ verifiedFounder: true, bonusCents: 0 });
  expect(await database.prepare('SELECT COUNT(*) n FROM funding_credits WHERE device_id=?').bind(deviceId).first()).toMatchObject({ n: 1 });
  // A progress reset removes funding but keeps the cosmetic identity and claim.
  await database.prepare('DELETE FROM funding_credits WHERE device_id=?').bind(deviceId).run();
  expect(await grantEmailReward(database, deviceId, Date.now())).toEqual({ verifiedFounder: true, bonusCents: 0 });
  expect(await database.prepare('SELECT COUNT(*) n FROM funding_credits WHERE device_id=?').bind(deviceId).first()).toMatchObject({ n: 0 });
  expect((await getFundingProfile(database, deviceId, Date.now())).verifiedFounder).toBe(true);
});

test('a wrong code is rejected with attempts left; a valid code still works after', async () => {
  const database = db();
  const fake = fakeSendEmailBinding();
  const provider = cloudflareEmailProvider(fake);
  const fresh = (await handleEmailRequest(get('/api/email/status'), env(database), provider))!;
  const cookie = `gtasf_device=${cookieToken(fresh)}`;
  await handleEmailRequest(post('/api/email/start', { email: 'x@y.com' }, cookie), env(database), provider);

  const wrong = (await handleEmailRequest(post('/api/email/verify', { code: '000000' }, cookie), env(database), provider))!;
  expect(wrong.status).toBe(400);
  const wrongBody = await wrong.json() as { verified: boolean; attemptsLeft: number };
  expect(wrongBody.verified).toBe(false);
  expect(wrongBody.attemptsLeft).toBe(4);

  const code = codeFrom(fake.sent[0]!.subject);
  const ok = (await handleEmailRequest(post('/api/email/verify', { code }, cookie), env(database), provider))!;
  expect((await ok.json() as { verified: boolean }).verified).toBe(true);
});

test('the magic link (GET ?token=) verifies the originating device', async () => {
  const database = db();
  const fake = fakeSendEmailBinding();
  const provider = cloudflareEmailProvider(fake);
  const fresh = (await handleEmailRequest(get('/api/email/status'), env(database), provider))!;
  const cookie = `gtasf_device=${cookieToken(fresh)}`;
  await handleEmailRequest(post('/api/email/start', { email: 'link@y.com' }, cookie), env(database), provider);

  const token = tokenFrom(fake.sent[0]!.text);
  const link = (await handleEmailRequest(get(`/api/email/verify?token=${token}`), env(database), provider))!;
  expect(link.status).toBe(200);
  expect(link.headers.get('content-type')).toContain('text/html');

  const after = (await handleEmailRequest(get('/api/email/status', cookie), env(database), provider))!;
  expect(await after.json()).toMatchObject({ verified: true, rewarded: true });
  expect(await database.prepare('SELECT COUNT(*) n,SUM(amount_cents) amount FROM funding_credits').first())
    .toMatchObject({ n: 1, amount: EMAIL_VERIFY_BONUS_CENTS });
});

test('resend within the throttle window does not send a second email', async () => {
  const database = db();
  const fake = fakeSendEmailBinding();
  const provider = cloudflareEmailProvider(fake);
  const fresh = (await handleEmailRequest(get('/api/email/status'), env(database), provider))!;
  const cookie = `gtasf_device=${cookieToken(fresh)}`;
  await handleEmailRequest(post('/api/email/start', { email: 'z@y.com' }, cookie), env(database), provider);
  await handleEmailRequest(post('/api/email/start', { email: 'z@y.com' }, cookie), env(database), provider);
  expect(fake.sent).toHaveLength(1); // throttled
});

test('the cheque is one-per-address: a second device gets the tick but no bonus', async () => {
  const database = db();
  const fake = fakeSendEmailBinding();
  const provider = cloudflareEmailProvider(fake);
  // device A verifies shared@x.com
  const a = (await handleEmailRequest(get('/api/email/status'), env(database), provider))!;
  const cookieA = `gtasf_device=${cookieToken(a)}`;
  await handleEmailRequest(post('/api/email/start', { email: 'shared@x.com' }, cookieA), env(database), provider);
  await handleEmailRequest(post('/api/email/verify', { code: codeFrom(fake.sent[0]!.subject) }, cookieA), env(database), provider);
  // device B verifies the SAME address
  const b = (await handleEmailRequest(get('/api/email/status'), env(database), provider))!;
  const cookieB = `gtasf_device=${cookieToken(b)}`;
  await handleEmailRequest(post('/api/email/start', { email: 'shared@x.com' }, cookieB), env(database), provider);
  const verifyB = (await handleEmailRequest(post('/api/email/verify', { code: codeFrom(fake.sent[1]!.subject) }, cookieB), env(database), provider))!;
  expect(await verifyB.json()).toMatchObject({ verified: true, reward: { verifiedFounder: true, bonusCents: 0 } });
  expect(await database.prepare('SELECT COUNT(*) n,SUM(amount_cents) amount FROM funding_credits').first())
    .toMatchObject({ n: 1, amount: EMAIL_VERIFY_BONUS_CENTS });
});

test('concurrent same-address verification pays once and status retries an interrupted ledger write', async () => {
  const database = db(), fake = fakeSendEmailBinding(), provider = cloudflareEmailProvider(fake);
  const cookies: string[] = [];
  for (let i = 0; i < 2; i++) {
    const fresh = (await handleEmailRequest(get('/api/email/status'), env(database), provider))!;
    const cookie = `gtasf_device=${cookieToken(fresh)}`; cookies.push(cookie);
    await handleEmailRequest(post('/api/email/start', { email: 'race@example.com' }, cookie), env(database), provider);
  }
  const responses = await Promise.all(cookies.map((cookie, i) => handleEmailRequest(
    post('/api/email/verify', { code: codeFrom(fake.sent[i]!.subject) }, cookie), env(database), provider)));
  const rewards = await Promise.all(responses.map(response => response!.json() as Promise<{ reward: { bonusCents: number } }>));
  expect(rewards.map(result => result.reward.bonusCents).sort((a, b) => a - b)).toEqual([0, EMAIL_VERIFY_BONUS_CENTS]);
  expect(await database.prepare('SELECT COUNT(*) n FROM funding_credits').first()).toMatchObject({ n: 1 });

  const fresh = (await handleEmailRequest(get('/api/email/status'), env(database), provider))!;
  const cookie = `gtasf_device=${cookieToken(fresh)}`;
  await handleEmailRequest(post('/api/email/start', { email: 'retry@example.com' }, cookie), env(database), provider);
  const batch = vi.spyOn(database, 'batch').mockRejectedValueOnce(new Error('Transient D1 failure'));
  const failed = (await handleEmailRequest(post('/api/email/verify', { code: codeFrom(fake.sent[2]!.subject) }, cookie), env(database), provider))!;
  expect(failed.status).toBe(503); batch.mockRestore();
  const pending = await database.prepare('SELECT verified_at,rewarded_at FROM email_captures WHERE email=?').bind('retry@example.com').first<{ verified_at: number | null; rewarded_at: number | null }>();
  expect(pending?.verified_at).not.toBeNull(); expect(pending?.rewarded_at).toBeNull();
  const recovered = (await handleEmailRequest(get('/api/email/status', cookie), env(database), provider))!;
  expect(await recovered.json()).toMatchObject({ verified: true, rewarded: true });
  const again = (await handleEmailRequest(get('/api/email/status', cookie), env(database), provider))!;
  expect(again.status).toBe(200);
  expect(await database.prepare('SELECT COUNT(*) n,SUM(amount_cents) amount FROM funding_credits').first())
    .toMatchObject({ n: 2, amount: EMAIL_VERIFY_BONUS_CENTS * 2 });
});

test('rejects an invalid email address', async () => {
  const database = db();
  const provider = cloudflareEmailProvider(fakeSendEmailBinding());
  const fresh = (await handleEmailRequest(get('/api/email/status'), env(database), provider))!;
  const cookie = `gtasf_device=${cookieToken(fresh)}`;
  const bad = (await handleEmailRequest(post('/api/email/start', { email: 'not-an-email' }, cookie), env(database), provider))!;
  expect(bad.status).toBe(400);
});

test('concurrent starts send one challenge and cannot replace a verified address', async () => {
  const database = db(), fake = fakeSendEmailBinding(), provider = cloudflareEmailProvider(fake);
  const fresh = (await handleEmailRequest(get('/api/email/status'), env(database), provider))!;
  const cookie = `gtasf_device=${cookieToken(fresh)}`;
  const responses = await Promise.all(['one@example.com', 'two@example.com'].map(email =>
    handleEmailRequest(post('/api/email/start', { email }, cookie), env(database), provider)));
  expect(responses.every(response => response?.status === 200)).toBe(true);
  expect(fake.sent).toHaveLength(1);
  const capture = await database.prepare('SELECT * FROM email_captures').first<{ device_id: string; email: string }>();
  expect(capture?.email).toBe(fake.sent[0]!.to);
  const verified = (await handleEmailRequest(post('/api/email/verify', { code: codeFrom(fake.sent[0]!.subject) }, cookie), env(database), provider))!;
  expect(verified.status).toBe(200);
  // A request already past the route's preliminary read still cannot replace it.
  expect(await startCapture(database, { deviceId: capture!.device_id, email: 'late@example.com',
    emailHash: await hashEmail('late@example.com'), codeHash: 'late-code', linkHash: 'late-link',
    expiresAt: Date.now() + 120_000, now: Date.now() + 61_000 })).toBe(false);
  expect((await getCapture(database, capture!.device_id))?.email).toBe(fake.sent[0]!.to);
});

test('a resend between code lookup and verification cannot verify the replacement address', async () => {
  let replaceOnRead = false;
  let replacement: Parameters<typeof startCapture>[1];
  const database = db(async sql => {
    if (!replaceOnRead || sql !== 'SELECT * FROM email_captures WHERE device_id = ?') return;
    replaceOnRead = false;
    expect(await startCapture(database, replacement)).toBe(true);
  });
  const fake = fakeSendEmailBinding(), provider = cloudflareEmailProvider(fake);
  const fresh = (await handleEmailRequest(get('/api/email/status'), env(database), provider))!;
  const cookie = `gtasf_device=${cookieToken(fresh)}`;
  await handleEmailRequest(post('/api/email/start', { email: 'old@example.com' }, cookie), env(database), provider);
  const capture = await database.prepare('SELECT device_id FROM email_captures').first<{ device_id: string }>();
  const deviceId = capture!.device_id;
  const oldChallenge = (await getCapture(database, deviceId))!;
  const nextNow = Date.now() + 61_000;
  vi.spyOn(Date, 'now').mockReturnValue(nextNow);
  const nextCode = '432198', nextToken = 'replacement-token';
  replacement = { deviceId, email: 'replacement@example.com', emailHash: await hashEmail('replacement@example.com'),
    codeHash: await hashCode(deviceId, nextCode), linkHash: await hashLinkToken(nextToken), now: nextNow,
    expiresAt: nextNow + 1_800_000 };
  replaceOnRead = true;
  const stale = (await handleEmailRequest(post('/api/email/verify', { code: codeFrom(fake.sent[0]!.subject) }, cookie), env(database), provider))!;
  expect(stale.status).toBe(400);
  expect(await getCapture(database, deviceId)).toMatchObject({ email: 'replacement@example.com', verified_at: null, attempts: 0 });
  // Old links and in-flight failed guesses also cannot consume the replacement.
  expect(await verifyLinkToken(database, oldChallenge.link_hash!, nextNow)).toBeNull();
  await bumpAttempts(database, deviceId, oldChallenge, nextNow);
  expect((await getCapture(database, deviceId))?.attempts).toBe(0);
  expect(await database.prepare('SELECT COUNT(*) n FROM funding_credits').first()).toMatchObject({ n: 0 });
  const current = (await handleEmailRequest(get(`/api/email/verify?token=${nextToken}`), env(database), provider))!;
  expect(await current.text()).toContain('Email verified');
  expect((await getCapture(database, deviceId))?.verified_at).toBe(nextNow);
  expect(await database.prepare('SELECT COUNT(*) n FROM funding_credits').first()).toMatchObject({ n: 1 });
  expect(await verifyLinkToken(database, replacement.linkHash, nextNow)).toBeNull();
});
