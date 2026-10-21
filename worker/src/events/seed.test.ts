import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { renderEventSeed } from '../../../tools/events/seed';
import { eventsResponse } from './api';

vi.mock('@gtasf/shared/flags', () => ({ flags: { eventsApi: true, events: false, localEventSnapshot: false } }));

test('canonical production seed imports twice, preserves newer rows and serves the real API contract', async () => {
  const source = readFileSync(new URL('./data/sf-tech-week.json', import.meta.url), 'utf8');
  const { sql, manifest } = renderEventSeed(source);
  const sqlite = new DatabaseSync(':memory:');
  for (const name of ['0001_initial.sql', '0002_events.sql']) {
    sqlite.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
  }
  try {
    sqlite.exec(sql); sqlite.exec(sql);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM events').get()!.n).toBe(manifest.rows);
    expect(manifest.rows).toBe(JSON.parse(source).events.length);
    const db = { prepare(query: string) { return { async all() { return { results: sqlite.prepare(query).all(), success: true }; } }; } } as unknown as D1Database;
    const response = await eventsResponse({ ENVIRONMENT: 'production', DB: db });
    const payload = await response.json() as { events: { id: string; start: string; approx: boolean; lat: number | null; title: string }[]; enabled: boolean; dataSource: string };
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ enabled: true, dataSource: 'd1' });
    expect(payload.events).toHaveLength(manifest.rows);
    expect(payload.events.filter(event => event.lat !== null)).toHaveLength(manifest.locatedRows);
    expect(payload.events.every(event => typeof event.start === 'string' && typeof event.approx === 'boolean')).toBe(true);
    const id = payload.events[0]!.id;
    sqlite.prepare('UPDATE events SET title=?, updated_at=? WHERE id=?').run('Newer public source correction', '2026-10-04T00:00:00.000Z', id);
    sqlite.exec(sql);
    expect(sqlite.prepare('SELECT title FROM events WHERE id=?').get(id)!.title).toBe('Newer public source correction');
    expect(renderEventSeed(source).sql).toBe(sql);
  } finally { sqlite.close(); }
});
