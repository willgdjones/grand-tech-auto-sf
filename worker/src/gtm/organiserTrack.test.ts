import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@gtasf/shared/flags', () => ({ flags: { organiserLinks: true } }));
import { handleOrganiserTrackRequest } from './organiserTrack';

let sqlite: DatabaseSync;
let env: { DB: D1Database };
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  for (const file of ['0011_referrals.sql', '0036_organiser_link_counts.sql'])
    sqlite.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
  sqlite.exec("CREATE TABLE events(id TEXT PRIMARY KEY); INSERT INTO events(id) VALUES('tech-week:a1'),('e1');");
  env = { DB: {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let bindings: (string | number | null)[] = [];
      const wrapper = {
        bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
        async first() { return statement.get(...bindings) ?? null; },
        async run() { return { meta: statement.run(...bindings), success: true }; },
      };
      return wrapper;
    },
  } as unknown as D1Database };
});

const ORIGIN = 'https://gtasf.com';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1';
function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/gtm/organiser-track`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'text/plain', 'user-agent': UA, 'cf-connecting-ip': '203.0.113.9', ...headers } });
}
const counts = () => sqlite.prepare('SELECT event_id,channel,kind,count FROM organiser_link_counts ORDER BY kind').all();

describe('organiser link tracking counter', () => {
  it('ignores ids that are not real events (no row, still 204)', async () => {
    expect((await handleOrganiserTrackRequest(post({ eventId: 'tech-week:made-up', channel: 'dm', kind: 'view' }), env))!.status).toBe(204);
    expect(counts()).toEqual([]);
  });
  it('increments one aggregate row per (event, channel, kind)', async () => {
    for (let i = 0; i < 3; i++) expect((await handleOrganiserTrackRequest(post({ eventId: 'tech-week:a1', channel: 'dm', kind: 'view' }), env))!.status).toBe(204);
    await handleOrganiserTrackRequest(post({ eventId: 'tech-week:a1', channel: 'dm', kind: 'share_click' }), env);
    expect(counts()).toEqual([
      { event_id: 'tech-week:a1', channel: 'dm', kind: 'share_click', count: 1 },
      { event_id: 'tech-week:a1', channel: 'dm', kind: 'view', count: 3 },
    ]);
  });

  it('validates channel, kind and eventId', async () => {
    for (const body of [{ eventId: 'x', channel: 'sms', kind: 'view' }, { eventId: 'x', channel: 'dm', kind: 'purchase' },
      { eventId: 'x'.repeat(101), channel: 'dm', kind: 'view' }, { eventId: 'a b', channel: 'em', kind: 'view' }, 'not json'])
      expect((await handleOrganiserTrackRequest(post(body), env))!.status).toBe(400);
    expect(counts()).toEqual([]);
  });

  it('skips bots (UA and gtasf_bot cookie) without counting', async () => {
    const body = { eventId: 'e1', channel: 'em', kind: 'view' };
    expect((await handleOrganiserTrackRequest(post(body, { 'user-agent': 'Twitterbot/1.0' }), env))!.status).toBe(204);
    expect((await handleOrganiserTrackRequest(post(body, { cookie: 'gtasf_bot=1' }), env))!.status).toBe(204);
    expect(counts()).toEqual([]);
  });

  it('rejects cross-origin posts', async () => {
    expect((await handleOrganiserTrackRequest(post({ eventId: 'e1', channel: 'link', kind: 'view' }, { origin: 'https://evil.example' }), env))!.status).toBe(403);
  });

  it('stores no PII: only event, channel, kind and count columns', () => {
    const cols = (sqlite.prepare('PRAGMA table_info(organiser_link_counts)').all() as { name: string }[]).map(c => c.name);
    expect(cols).toEqual(['event_id', 'channel', 'kind', 'count']);
  });

  it('ignores other paths', async () => {
    expect(await handleOrganiserTrackRequest(new Request(`${ORIGIN}/api/gtm/catalogue`), env)).toBeNull();
  });
});
