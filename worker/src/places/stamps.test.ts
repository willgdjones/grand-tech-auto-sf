import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { listStamps, PLACE_IDS, STAMP_RATE_MAX, stampPlace } from './stamps';

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0041_place_stamps.sql', import.meta.url), 'utf8'));
  const prepare = (sql: string) => {
    const statement = sqlite.prepare(sql); let bindings: (string | number | null)[] = [];
    const wrapper = { bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
      async first<T>() { return (statement.get(...bindings) ?? null) as T; },
      async all<T>() { return { results: statement.all(...bindings) as T[], success: true }; },
      async run() { const meta = statement.run(...bindings); return { meta: { changes: Number(meta.changes) }, success: true }; } };
    return wrapper;
  };
  return { prepare } as unknown as D1Database;
}
const known = new Set(Array.from({ length: 30 }, (_, i) => `p${i}`));

describe('place stamps', () => {
  it('bundles the real place ids', () => { expect(PLACE_IDS.has('openai')).toBe(true); });
  it('stamps once per device and place (idempotent) and counts per device', async () => {
    const db = freshDb();
    expect(await stampPlace(db, 'dev-a', 'p1', 1000, known)).toEqual({ ok: true, placeId: 'p1', count: 1, total: 30, fresh: true });
    expect(await stampPlace(db, 'dev-a', 'p1', 2000, known)).toEqual({ ok: true, placeId: 'p1', count: 1, total: 30, fresh: false });
    expect(await stampPlace(db, 'dev-b', 'p1', 2000, known)).toMatchObject({ ok: true, count: 1, fresh: true });
    await stampPlace(db, 'dev-a', 'p2', 3000, known);
    expect(await listStamps(db, 'dev-a')).toEqual(['p1', 'p2']);
  });
  it('rejects unknown places', async () => {
    expect(await stampPlace(freshDb(), 'dev-a', 'nope', 1000, known)).toEqual({ ok: false, error: 'unknown-place' });
  });
  it('rate-limits new stamps per minute but still answers repeats', async () => {
    const db = freshDb();
    for (let i = 0; i < STAMP_RATE_MAX; i++) expect((await stampPlace(db, 'dev-a', `p${i}`, 10_000 + i, known)).ok).toBe(true);
    expect(await stampPlace(db, 'dev-a', 'p29', 10_100, known)).toEqual({ ok: false, error: 'rate' });
    expect(await stampPlace(db, 'dev-a', 'p0', 10_100, known)).toMatchObject({ ok: true, fresh: false });
    expect(await stampPlace(db, 'dev-a', 'p29', 80_000, known)).toMatchObject({ ok: true, fresh: true });
  });
});
