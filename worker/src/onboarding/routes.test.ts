import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';

vi.mock('@gtasf/shared/flags', () => ({ flags: { onboarding: true } }));

import { handleOnboardingRequest } from './routes';
import { createFundingProfile } from '../funding/store';
import { ensureFundingDevice } from '../funding/identity';
import type { Env } from '../env';

const ORIGIN = 'https://game.local';

async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function db(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  for (const m of ['0010_funding.sql', '0024_onboarding.sql'])
    sqlite.exec(readFileSync(new URL(`../../migrations/${m}`, import.meta.url), 'utf8'));
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
const cookieToken = (res: Response) => res.headers.get('set-cookie')?.match(/gtasf_device=([a-f0-9]{64})/)?.[1];
const get = (cookie?: string) => new Request(`${ORIGIN}/api/onboarding/state`, { headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } });
const post = (body: unknown, cookie?: string) => new Request(`${ORIGIN}/api/onboarding/state`,
  { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

test('a new device gets a fresh onboarding and a device cookie', async () => {
  const res = (await handleOnboardingRequest(get(), env(db())))!;
  expect(res.status).toBe(200);
  expect(cookieToken(res)).toMatch(/^[a-f0-9]{64}$/);
  expect((await res.json() as { state: { step: string; completed: boolean } }).state).toMatchObject({ step: 'intro', completed: false });
});

test('funding/referrals minting the device before onboarding still shows intro and preserves progress', async () => {
  const database = db();
  const identity = await ensureFundingDevice(new Request(`${ORIGIN}/api/referrals/profile`), database, 1000);
  const cookie = identity.cookie!.split(';')[0]!;
  const first = (await handleOnboardingRequest(get(cookie), env(database)))!;
  expect(first.headers.get('set-cookie')).toBeNull();
  expect((await first.json() as { state: { step: string; completed: boolean } }).state)
    .toMatchObject({ step: 'intro', completed: false });
  await handleOnboardingRequest(post({ state: { step: 'walk', hints: [], completed: false, skipped: false } }, cookie), env(database));
  const returning = await ensureFundingDevice(new Request(`${ORIGIN}/api/funding/profile`, { headers: { cookie } }), database, 2000);
  expect(returning).toEqual({ deviceId: identity.deviceId });
  const saved = (await handleOnboardingRequest(get(cookie), env(database)))!;
  expect((await saved.json() as { state: { step: string } }).state.step).toBe('walk');
});

test('persists and reloads the client state for the same device', async () => {
  const database = db();
  const fresh = (await handleOnboardingRequest(get(), env(database)))!;
  const cookie = `gtasf_device=${cookieToken(fresh)}`;
  const saved = (await handleOnboardingRequest(post({ state: { step: 'gps', hints: ['firstDrop'], completed: false, skipped: false } }, cookie), env(database)))!;
  expect((await saved.json() as { state: { step: string } }).state.step).toBe('gps');
  const reload = (await handleOnboardingRequest(get(cookie), env(database)))!;
  expect((await reload.json() as { state: { step: string; hints: string[] } }).state).toMatchObject({ step: 'gps', hints: ['firstDrop'] });
});

test('accepts a bare state object body (older client) without a 400 — prod console-error regression', async () => {
  const database = db();
  const fresh = (await handleOnboardingRequest(get(), env(database)))!;
  const cookie = `gtasf_device=${cookieToken(fresh)}`;
  // The #5.3 client POSTed the serialized state directly, not wrapped in { state: ... }, which 400'd on
  // prod (https://gtasf.com/api/onboarding/state). The route now tolerates both shapes.
  const saved = (await handleOnboardingRequest(post({ step: 'walk', hints: [], completed: false, skipped: false }, cookie), env(database)))!;
  expect(saved.status).toBe(200);
  expect((await saved.json() as { state: { step: string } }).state.step).toBe('walk');
  const reload = (await handleOnboardingRequest(get(cookie), env(database)))!;
  expect((await reload.json() as { state: { step: string } }).state.step).toBe('walk');
});

test('an existing device with no saved onboarding is treated as returning', async () => {
  const database = db();
  const token = 'a'.repeat(64);
  await createFundingProfile(database, 'dev-R', await sha256Hex(token), 1000);
  const res = (await handleOnboardingRequest(get(`gtasf_device=${token}`), env(database)))!;
  expect(res.headers.get('set-cookie')).toBeNull(); // existing device, no new cookie
  expect((await res.json() as { state: { step: string; completed: boolean } }).state).toMatchObject({ step: 'done', completed: true });
});

test('rejects a cross-origin request and a POST with no state', async () => {
  const database = db();
  const cross = new Request(`${ORIGIN}/api/onboarding/state`, { headers: { origin: 'https://evil.example' } });
  expect((await handleOnboardingRequest(cross, env(database)))!.status).toBe(403);
  const fresh = (await handleOnboardingRequest(get(), env(database)))!;
  const cookie = `gtasf_device=${cookieToken(fresh)}`;
  expect((await handleOnboardingRequest(post({ nope: 1 }, cookie), env(database)))!.status).toBe(400);
});

test('returns null for unrelated paths', async () => {
  expect(await handleOnboardingRequest(new Request(`${ORIGIN}/api/other`, { headers: { origin: ORIGIN } }), env(db()))).toBeNull();
});
