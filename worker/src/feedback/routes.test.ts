import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { handleFeedbackRequest } from './routes';
import type { Env } from '../env';

function memoryDb(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0019_feedback.sql', '0032_feedback_build.sql'])
    sqlite.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
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
function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('handleFeedbackRequest — submit', () => {
  it('stores a valid submission and returns the derived theme', async () => {
    const env = makeEnv();
    const res = await handleFeedbackRequest(post({ text: 'the driving feels great', mode: 'driving' }), env);
    expect(res!.status).toBe(201);
    const data = await res!.json() as { ok: boolean; theme: string; screenshotStored: boolean };
    expect(data.ok).toBe(true);
    expect(data.theme).toBe('driving-and-controls');
    expect(data.screenshotStored).toBe(false);
  });

  it('rejects empty text (400) and oversized bodies (413)', async () => {
    const env = makeEnv();
    expect((await handleFeedbackRequest(post({ text: '   ' }), env))!.status).toBe(400);
    const huge = JSON.stringify({ text: 'x'.repeat(500_000) });
    expect((await handleFeedbackRequest(post(huge), env))!.status).toBe(413);
  });

  it('requires same-origin', async () => {
    const env = makeEnv();
    const res = await handleFeedbackRequest(post({ text: 'hi there founders' }, { origin: 'https://evil.example' }), env);
    expect(res!.status).toBe(403);
  });

  it('drops an oversized screenshot but keeps the text', async () => {
    const env = makeEnv();
    // Over the 300 KB screenshot cap but under the 400 KB whole-body cap: the shot is dropped, text kept.
    const res = await handleFeedbackRequest(post({ text: 'nice city', screenshot: 'data:image/jpeg;base64,' + 'A'.repeat(320_000) }), env);
    expect(res!.status).toBe(201);
    expect((await res!.json() as { screenshotStored: boolean }).screenshotStored).toBe(false);
  });

  it('rate-limits a burst from one ip (429 after the allowance)', async () => {
    const env = makeEnv();
    for (let i = 0; i < 6; i++) {
      expect((await handleFeedbackRequest(post({ text: 'spam ' + i }), env))!.status).toBe(201);
    }
    expect((await handleFeedbackRequest(post({ text: 'one too many' }), env))!.status).toBe(429);
  });

  it('ignores unrelated paths (returns null to fall through)', async () => {
    expect(await handleFeedbackRequest(new Request(`${ORIGIN}/api/other`), makeEnv())).toBeNull();
  });
});

describe('handleFeedbackRequest — admin digest', () => {
  function adminGet(path: string, token?: string): Request {
    return new Request(`${ORIGIN}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  }

  it('is invisible (404) when no ADMIN_TOKEN is configured', async () => {
    const res = await handleFeedbackRequest(adminGet('/api/feedback/admin/digest'), makeEnv());
    expect(res!.status).toBe(404);
  });

  it('rejects a missing or wrong token (401) and does not trust the client', async () => {
    const env = makeEnv({ ADMIN_TOKEN: 'sekret' });
    expect((await handleFeedbackRequest(adminGet('/api/feedback/admin/digest'), env))!.status).toBe(401);
    expect((await handleFeedbackRequest(adminGet('/api/feedback/admin/digest', 'wrong'), env))!.status).toBe(401);
  });

  it('returns the grouped digest with the correct token', async () => {
    const env = makeEnv({ ADMIN_TOKEN: 'sekret' });
    await handleFeedbackRequest(post({ text: 'camera zoom is odd' }), env);
    const res = await handleFeedbackRequest(adminGet('/api/feedback/admin/digest', 'sekret'), env);
    expect(res!.status).toBe(200);
    const digest = await res!.json() as { total: number; themes: { theme: string }[] };
    expect(digest.total).toBe(1);
    expect(digest.themes[0]!.theme).toBe('camera');
  });
});
