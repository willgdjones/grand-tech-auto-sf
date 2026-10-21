import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';

// gtasf-27jen: an EMPTY world must not arm session/reservation expiry alarms (each woke an evicted DO only to reload the
// 23 MB road graph); a world with peers or pending sockets still does. Same construct-with-mocks harness as
// worldDoResume.test.ts.
vi.mock('cloudflare:workers', () => ({ DurableObject: class { ctx: unknown; env: unknown; constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; } } }));
vi.mock('@gtasf/shared/flags', async orig => {
  const actual = await orig<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, multiplayer: true, fundingLoop: false, chat: false, zonedWorld: false, worldCapacity: false,
    posthogAnalytics: false, xAdsPixel: false, referrals: false, proximityVoice: false, fundDrops: false, combat: false,
    outbidBanner: false, outbidCrown: false } };
});

import { WorldDO } from './WorldDO';

function mockStorage() {
  const db = new DatabaseSync(':memory:');
  const sql = (strOrTemplate: string, ...params: (string | number | null)[]) => {
    const stmt = db.prepare(strOrTemplate);
    const read = /^\s*(SELECT|PRAGMA|WITH)/i.test(strOrTemplate) || /\breturning\b/i.test(strOrTemplate);
    const rows = read ? stmt.all(...params) : (stmt.run(...params), []);
    return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => (rows as unknown[])[Symbol.iterator]() };
  };
  return {
    sql: Object.assign(sql, { exec: sql }),
    transactionSync<T>(fn: () => T): T { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
  };
}

function build() {
  const storage = mockStorage(), alarms: number[] = [], deletes: number[] = [];
  const ctx = { storage: { sql: storage.sql, transactionSync: storage.transactionSync, setAlarm: async (at: number) => { alarms.push(at); }, deleteAlarm: async () => { deletes.push(Date.now()); }, getAlarm: async () => null },
    blockConcurrencyWhile: (fn: () => unknown) => fn(), waitUntil: () => {}, acceptWebSocket: () => {}, getWebSockets: () => [], id: { toString: () => 'test' } };
  const env = { ASSETS: { fetch: async () => new Response(null, { status: 404 }) } };
  const wd = new WorldDO(ctx as never, env as never) as unknown as {
    sessions: { admit(name: string, token: string | undefined, now: number): { id: number; generation: number; token: string } };
    connections: Map<unknown, unknown>; armedAt: number; arm(): void;
  };
  return { wd, alarms, deletes };
}

describe('WorldDO.arm (gtasf-27jen)', () => {
  it('an empty world with a session awaiting expiry arms NO alarm', () => {
    const { wd, alarms } = build();
    wd.sessions.admit('Gone', undefined, Date.now()); // a departed player's resumable session
    alarms.length = 0; wd.armedAt = Infinity;
    wd.arm();
    expect(alarms).toEqual([]);
  });
  it('a world with a pending socket still arms for the earliest expiry', () => {
    const { wd, alarms } = build();
    const now = Date.now();
    wd.sessions.admit('Here', undefined, now);
    wd.connections.set({}, { expiresAt: now + 60_000, credit: 60, budgetAt: now });
    alarms.length = 0; wd.armedAt = Infinity;
    wd.arm();
    expect(alarms).toHaveLength(1);
    expect(alarms[0]!).toBeGreaterThan(now);
    expect(alarms[0]!).toBeLessThanOrEqual(now + 60_000);
  });
  it('going empty deletes the alarm a session armed (once per empty spell); becoming active re-arms', () => {
    const { wd, alarms, deletes } = build();
    const now = Date.now(), socket = {};
    wd.sessions.admit('Leaving', undefined, now);
    wd.connections.set(socket, { expiresAt: now + 60_000, credit: 60, budgetAt: now });
    alarms.length = 0; deletes.length = 0; wd.armedAt = Infinity;
    wd.arm();
    expect(alarms).toHaveLength(1); expect(deletes).toHaveLength(0);
    wd.connections.delete(socket); // the last player leaves
    wd.arm();
    expect(deletes).toHaveLength(1);
    wd.arm(); // still empty: no repeated delete
    expect(deletes).toHaveLength(1);
    wd.connections.set(socket, { expiresAt: now + 30_000, credit: 60, budgetAt: now }); // someone joins again
    wd.arm();
    expect(alarms).toHaveLength(2);
  });
});
