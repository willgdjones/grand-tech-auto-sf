import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';

// gtasf-j7wvv (lane E): LobbyDO awaits WorldDO reserve inside its mutex. Un-timed, one stalled world queued every admission
// until Cloudflare's 524 (prod 07:40, READY 136 s). The world call now carries AbortSignal.timeout, and a timed-out reserve
// answers 'queued' (the client polls) instead of hanging the lobby.
vi.mock('cloudflare:workers', () => ({ DurableObject: class { ctx: unknown; env: unknown; constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; } } }));

import { LobbyDO, WORLD_ADMISSION_TIMEOUT_MS } from './LobbyDO';

function mockStorage() {
  const db = new DatabaseSync(':memory:');
  const sql = (strOrTemplate: string, ...params: (string | number | null)[]) => {
    const statements = strOrTemplate.split(';').map(s => s.trim()).filter(Boolean);
    if (statements.length > 1) { for (const s of statements) db.exec(s); return { toArray: () => [], one: () => undefined, [Symbol.iterator]: () => [][Symbol.iterator]() }; }
    const stmt = db.prepare(strOrTemplate);
    const read = /^\s*(SELECT|PRAGMA|WITH)/i.test(strOrTemplate) || /\breturning\b/i.test(strOrTemplate);
    const rows = read ? stmt.all(...params) : (stmt.run(...params), []);
    return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => (rows as unknown[])[Symbol.iterator]() };
  };
  return { sql: Object.assign(sql, { exec: sql }), setAlarm: async () => {}, getAlarm: async () => null };
}

function build(worldFetch: (url: string, init: RequestInit) => Promise<Response>) {
  const ctx = { storage: mockStorage(), waitUntil: () => {}, blockConcurrencyWhile: (fn: () => unknown) => fn() };
  const env = { WORLD: { idFromName: () => 'sf', get: () => ({ fetch: worldFetch }) } };
  return new LobbyDO(ctx as never, env as never);
}

const enter = () => new Request('https://gtasf.test/api/admission/enter', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '2' }, body: '{}' });

describe('LobbyDO → WorldDO admission timeout (gtasf-j7wvv)', () => {
  it('passes an AbortSignal to the world reserve call', async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const lobby = build(async (_url, init) => { seen.push(init.signal); return Response.json({ status: 'reserved', grant: 'g'.repeat(43), expiresAt: Date.now() + 60_000, population: 1, capacity: 100 }); });
    const res = await lobby.fetch(enter());
    expect(res.status).toBe(200);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(WORLD_ADMISSION_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });
  it('a timed-out (aborted) world reserve answers queued instead of hanging the lobby', async () => {
    const lobby = build(async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); });
    const res = await lobby.fetch(enter());
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('queued');
  });
});
