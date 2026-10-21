import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';

// gtasf-j7wvv (LIVE socket drops): the world tick is a bare setInterval callback and combat handlers run inside
// webSocketMessage; an uncaught throw there can reset the Durable Object (every socket drops). guarded() contains it.
vi.mock('cloudflare:workers', () => ({ DurableObject: class { ctx: unknown; env: unknown; constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; } } }));
vi.mock('@gtasf/shared/flags', async orig => {
  const actual = await orig<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, multiplayer: true, combat: true, wanted: true, vitalsPickups: true,
    fundingLoop: false, chat: false, zonedWorld: false, worldCapacity: false, posthogAnalytics: false, xAdsPixel: false,
    referrals: false, proximityVoice: false, fundDrops: false, outbidBanner: false, outbidCrown: false, missions: false, timeTrials: false } };
});

import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { WorldDO } from './WorldDO';

/** node:sqlite shim for the DO storage.sql API (eager exec + toArray/one + transactionSync). */
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
  const storage = mockStorage();
  const ctx = { storage: { sql: storage.sql, transactionSync: storage.transactionSync, setAlarm: () => {}, deleteAlarm: async () => {}, getAlarm: async () => null }, blockConcurrencyWhile: (fn: () => unknown) => fn(), waitUntil: () => {}, acceptWebSocket: () => {}, getWebSockets: () => [], id: { toString: () => 'test' } };
  const env = { ASSETS: { fetch: async () => new Response(null, { status: 404 }) } };
  // Construct with mocks (stubbed DurableObject base + partial ctx/env); cast to any to reach private test seams.
  return new WorldDO(ctx as never, env as never) as unknown as {
    connections: Map<unknown, unknown>;
    guarded(step: string, fn: () => void): void;
    combatStash: Map<string, { state: { heat: number; lastCrimeMs: number }; health: number; expiresAt: number }>;
    pickupTakenUntil: number[];
    webSocketMessage(s: unknown, d: ArrayBuffer): Promise<void>;
  };
}

describe('guarded world steps (gtasf-j7wvv)', () => {
  it('a throwing step is contained and logged at most once per 10 s; the next step still runs', () => {
    const wd = build();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let ran = 0;
    expect(() => wd.guarded('boom', () => { throw new RangeError('i32 must be an integer'); })).not.toThrow();
    wd.guarded('boom', () => { throw new RangeError('again'); });
    wd.guarded('fine', () => { ran++; });
    expect(ran).toBe(1);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.join(' '))).toContain('boom');
    errors.mockRestore();
  });
});
