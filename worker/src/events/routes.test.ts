import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { handleEventSubmissionRequest } from './routes';
import type { Env } from '../env';

// A minimal `events` table with the migration-0017 `community` flag + `updated_at` (the admin list
// orders by it). This is enough for the admin list/remove queries. The submit-gate tests return
// before any DB access, and the ADMIN_TOKEN gate is checked before the rate limiter, so no rate-limit
// table is needed here. Mirrors the in-memory-D1 harness in feedback/routes.test.ts.
function memoryDb(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE events (id TEXT PRIMARY KEY, community INTEGER NOT NULL DEFAULT 0, updated_at TEXT)');
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let bindings: (string | number | null)[] = [];
      const wrapper = {
        bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
        async all() { return { results: statement.all(...bindings), success: true }; },
        async first() { return statement.get(...bindings) ?? null; },
        async run() { return { meta: statement.run(...bindings), success: true }; },
      };
      return wrapper;
    },
  } as unknown as D1Database;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return { ENVIRONMENT: 'test', DB: memoryDb(), ...overrides } as unknown as Env;
}

const ORIGIN = 'https://gtasf.example';

describe('handleEventSubmissionRequest — submit gates (PLAN-v2 decision 9)', () => {
  it('rejects a non-POST to /submit (405)', async () => {
    const res = await handleEventSubmissionRequest(new Request(`${ORIGIN}/api/events/submit`), makeEnv());
    expect(res!.status).toBe(405);
  });

  it('requires a matching Origin on the public write path (403)', async () => {
    const req = new Request(`${ORIGIN}/api/events/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ url: 'https://lu.ma/x' }),
    });
    expect((await handleEventSubmissionRequest(req, makeEnv()))!.status).toBe(403);
  });

  it('ignores unrelated paths (returns null to fall through)', async () => {
    expect(await handleEventSubmissionRequest(new Request(`${ORIGIN}/api/other`), makeEnv())).toBeNull();
  });
});

describe('handleEventSubmissionRequest — admin moderation (ADMIN_TOKEN gate, gtasf-...-angf)', () => {
  const list = (token?: string) =>
    new Request(`${ORIGIN}/api/events/admin/community`, token ? { headers: { authorization: `Bearer ${token}` } } : {});
  const remove = (id: unknown, token?: string) =>
    new Request(`${ORIGIN}/api/events/admin/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: ORIGIN, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ id }),
    });

  it('is invisible (404) until an ADMIN_TOKEN is configured', async () => {
    expect((await handleEventSubmissionRequest(list(), makeEnv()))!.status).toBe(404);
    expect((await handleEventSubmissionRequest(remove('x'), makeEnv()))!.status).toBe(404);
  });

  it('rejects a missing or wrong bearer token (401), and does not trust the client', async () => {
    const env = makeEnv({ ADMIN_TOKEN: 'sekret' });
    expect((await handleEventSubmissionRequest(list(), env))!.status).toBe(401);
    expect((await handleEventSubmissionRequest(list('wrong'), env))!.status).toBe(401);
  });

  it('lists community events with the right token (200, empty by default)', async () => {
    const env = makeEnv({ ADMIN_TOKEN: 'sekret' });
    const res = await handleEventSubmissionRequest(list('sekret'), env);
    expect(res!.status).toBe(200);
    expect((await res!.json() as { events: unknown[] }).events).toEqual([]);
  });

  it('requires an event id (400) and reports a no-op removal as removed:false', async () => {
    const env = makeEnv({ ADMIN_TOKEN: 'sekret' });
    expect((await handleEventSubmissionRequest(remove('', 'sekret'), env))!.status).toBe(400);
    const res = await handleEventSubmissionRequest(remove('does-not-exist', 'sekret'), env);
    expect(res!.status).toBe(200);
    expect((await res!.json() as { removed: boolean }).removed).toBe(false);
  });

  it('removes a community row with the right token (removed:true, then idempotent false)', async () => {
    const env = makeEnv({ ADMIN_TOKEN: 'sekret' });
    await env.DB.prepare('INSERT INTO events (id, community, updated_at) VALUES (?, 1, ?)').bind('evt-1', '2026-10-04T00:00:00Z').run();
    const first = await handleEventSubmissionRequest(remove('evt-1', 'sekret'), env);
    expect((await first!.json() as { removed: boolean }).removed).toBe(true);
    const second = await handleEventSubmissionRequest(remove('evt-1', 'sekret'), env);
    expect((await second!.json() as { removed: boolean }).removed).toBe(false);
  });
});
