import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { eventsResponse } from './api';
import { listEvents, storeEvents } from './store';
import snapshot from './data/sf-tech-week.json';
import type { TechWeekEvent } from './types';

vi.mock('@gtasf/shared/flags', () => ({ flags: { events: false, localEventSnapshot: true } }));

it('smoke: real snapshot survives idempotent SQL ingestion and reaches the local API only', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../../migrations/0002_events.sql', import.meta.url), 'utf8'));
  // 0017 adds the community column that EVENT_UPSERT (community=0) and listEvents now reference.
  sqlite.exec(readFileSync(new URL('../../migrations/0017_community_events.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let bindings: (string | number | null)[] = [];
      const wrapper = {
        bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
        async all() { return { results: statement.all(...bindings), success: true }; },
        async run() { return { meta: statement.run(...bindings), success: true }; },
      };
      return wrapper;
    },
    async batch(statements: { run(): Promise<unknown> }[]) { return Promise.all(statements.map(s => s.run())); },
  } as unknown as D1Database;
  try {
    const input = snapshot.events.slice(0, 3) as TechWeekEvent[];
    await storeEvents(db, input, snapshot.capturedAt);
    await storeEvents(db, input, snapshot.capturedAt);
    expect(await listEvents(db)).toEqual(input);
    const response = await eventsResponse({ ENVIRONMENT: 'local', DB: db });
    expect(await response.json()).toMatchObject({ events: input, enabled: true, dataSource: 'd1' });
    expect(await (await eventsResponse({ ENVIRONMENT: 'production', DB: db })).json()).toEqual({ events: [], enabled: false });
    const newer = input.map(e => ({ ...e, title: 'Updated public title' }));
    await storeEvents(db, newer, '2026-10-04T00:00:00Z');
    await storeEvents(db, input, snapshot.capturedAt);
    expect((await listEvents(db)).map(e => e.title)).toEqual(newer.map(e => e.title));
    const missing = { prepare() { throw new Error('Uninitialized local D1'); } } as unknown as D1Database;
    expect(await (await eventsResponse({ ENVIRONMENT: 'local', DB: missing })).json()).toMatchObject({ enabled: true, dataSource: 'local-snapshot', events: snapshot.events });
  } finally { sqlite.close(); }
});
