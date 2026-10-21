import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { timeTrialDay } from '@gtasf/shared/founder/timeTrials';
import { handleTimeTrialRequest, ttRankOf } from './timeTrialRoutes';

/** Minimal D1 over node:sqlite (prepare → bind → all/first/run), with the real time_trials + is_bot columns. */
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE time_trials (route_id TEXT NOT NULL, day TEXT NOT NULL, device_id TEXT NOT NULL, name TEXT NOT NULL,
    ms INTEGER NOT NULL, updated_at INTEGER NOT NULL, ghost TEXT, PRIMARY KEY (route_id, day, device_id));
    CREATE TABLE funding_profiles (device_id TEXT PRIMARY KEY, is_bot INTEGER);`);
  const prepare = (sql: string) => ({
    bind: (...args: unknown[]) => ({
      all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
      first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
      run: async () => db.prepare(sql).run(...(args as never[])),
    }),
  });
  return { db, d1: { prepare } as unknown as D1Database };
}

const NOW = Date.parse('2026-10-14T20:00:00Z');
const ROUTE = 'telegraph-hill-climb';

describe('time-trial board excludes automated-test (is_bot) devices', () => {
  const seed = () => {
    const { db, d1: D1 } = d1(), day = timeTrialDay(NOW);
    const row = db.prepare('INSERT INTO time_trials (route_id, day, device_id, name, ms, updated_at, ghost) VALUES (?, ?, ?, ?, ?, ?, ?)');
    row.run(ROUTE, day, 'bot', 'Smoke Bot', 70_000, NOW, '{"who":"bot"}');
    row.run(ROUTE, day, 'real', 'Real Founder', 80_000, NOW, '{"who":"real"}');
    row.run(ROUTE, day, 'legacy', 'No Profile', 90_000, NOW, null);
    db.prepare('INSERT INTO funding_profiles (device_id, is_bot) VALUES (?, ?)').run('bot', 1);
    db.prepare('INSERT INTO funding_profiles (device_id, is_bot) VALUES (?, ?)').run('real', 0);
    return { D1, day };
  };
  it('the board lists real players only, and the champion ghost is the fastest REAL run', async () => {
    const { D1 } = seed();
    const res = await handleTimeTrialRequest(new Request(`https://x.test/api/time-trials/board?route=${ROUTE}`), { DB: D1 } as never, NOW);
    const body = await res!.json() as { records: { name: string }[]; championGhost: { who: string } | null };
    expect(body.records.map(r => r.name)).toEqual(['Real Founder', 'No Profile']);
    expect(body.championGhost).toEqual({ who: 'real' });
  });
  it('a real player\'s rank does not count bot runs', async () => {
    const { D1, day } = seed();
    expect(await ttRankOf(D1, ROUTE, day, 80_000)).toBe(1);
    expect(await ttRankOf(D1, ROUTE, day, 85_000)).toBe(2);
  });
});
