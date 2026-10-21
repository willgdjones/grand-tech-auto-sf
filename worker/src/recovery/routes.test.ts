import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';

vi.mock('@gtasf/shared/flags', () => ({ flags: { accountRecovery: true, fundingLoop: true } }));

import { handleRecoveryRequest } from './routes';
import { createFundingProfile, saveFundingNames } from '../funding/store';
import type { Env } from '../env';

const ORIGIN = 'https://game.local';
const TOKEN_A = 'a'.repeat(64); // valid gtasf_device token shape (/^[a-f0-9]{64}$/)

async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function db(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of ['0010_funding.sql', '0011_referrals.sql', '0014_funding_bonus.sql',
    '0018_fund_drops.sql', '0020_funding_credits.sql', '0023_account_recovery.sql'])
    sqlite.exec(readFileSync(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8'));
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
const env = (database: D1Database): Env => ({ DB: database, ENVIRONMENT: 'local' } as unknown as Env);

function post(path: string, body: unknown, cookie?: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}
function get(path: string, cookie?: string): Request {
  return new Request(`${ORIGIN}${path}`, { headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } });
}

async function seedNamedProfile(database: D1Database) {
  await createFundingProfile(database, 'dev-A', await sha256Hex(TOKEN_A), 1000);
  await saveFundingNames(database, 'dev-A', 'Acme Rockets', 'Ada', 1000);
}

test('create → restore round-trip rebinds a new device to the saved profile', async () => {
  const database = db();
  await seedNamedProfile(database);

  // Device A saves a recovery code.
  const created = await handleRecoveryRequest(post('/api/recovery/create', {}, `gtasf_device=${TOKEN_A}`), env(database));
  expect(created!.status).toBe(200);
  const code = (await created!.json() as { code: string }).code;
  expect(code).toMatch(/^GTASF-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  // Status for device A now reports a saved code.
  const status = await handleRecoveryRequest(get('/api/recovery/status', `gtasf_device=${TOKEN_A}`), env(database));
  expect((await status!.json() as { hasCode: boolean }).hasCode).toBe(true);

  // A brand-new device restores with the code: gets device A's profile and a fresh cookie.
  const restored = await handleRecoveryRequest(post('/api/recovery/restore', { code }), env(database));
  expect(restored!.status).toBe(200);
  const result = await restored!.json() as { profile: { deviceId: string; startupName: string } };
  expect(result.profile.deviceId).toBe('dev-A');
  expect(result.profile.startupName).toBe('Acme Rockets');
  expect(restored!.headers.get('set-cookie')).toMatch(/gtasf_device=[a-f0-9]{64}/); // fresh token bound to dev-A
});

test('restore rejects an unknown code (404) and malformed input (400)', async () => {
  const database = db();
  await seedNamedProfile(database);
  await handleRecoveryRequest(post('/api/recovery/create', {}, `gtasf_device=${TOKEN_A}`), env(database));

  const unknown = await handleRecoveryRequest(post('/api/recovery/restore', { code: 'GTASF-ZZZZ-ZZZZ' }), env(database));
  expect(unknown!.status).toBe(404);
  // Genuinely malformed: too short, and contains U (excluded from Crockford base32) -> cannot normalize.
  expect((await handleRecoveryRequest(post('/api/recovery/restore', { code: 'xx' }), env(database)))!.status).toBe(400);
  expect((await handleRecoveryRequest(post('/api/recovery/restore', { code: 'GTASF-ABCU-2345' }), env(database)))!.status).toBe(400);
});

test('restore is rate-limited after 6 attempts per IP', async () => {
  const database = db();
  await seedNamedProfile(database);
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await handleRecoveryRequest(post('/api/recovery/restore', { code: 'GTASF-ZZZZ-ZZZZ' }), env(database));
    expect(response!.status).toBe(404); // within the limit: validated and not found
  }
  const blocked = await handleRecoveryRequest(post('/api/recovery/restore', { code: 'GTASF-ZZZZ-ZZZZ' }), env(database));
  expect(blocked!.status).toBe(429); // 7th attempt is locked out
});

test('regenerate invalidates the previous code', async () => {
  const database = db();
  await seedNamedProfile(database);
  const first = (await (await handleRecoveryRequest(post('/api/recovery/create', {}, `gtasf_device=${TOKEN_A}`), env(database)))!.json() as { code: string }).code;
  const second = (await (await handleRecoveryRequest(post('/api/recovery/create', {}, `gtasf_device=${TOKEN_A}`), env(database)))!.json() as { code: string }).code;
  expect(second).not.toBe(first);
  expect((await handleRecoveryRequest(post('/api/recovery/restore', { code: first }), env(database)))!.status).toBe(404);
  expect((await handleRecoveryRequest(post('/api/recovery/restore', { code: second }), env(database)))!.status).toBe(200);
});
