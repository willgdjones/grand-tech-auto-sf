import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { feedbackDigest, feedbackScreenshot, insertFeedback, recentCountForIp, scrubOldIpHashes } from './store';

/** Real SQLite behind the D1 interface, with the actual feedback migration applied.
 *  `withBuildColumn` also applies 0032 (the gtasf-367l build column) so both schema states are testable. */
function memoryDb(withBuildColumn = false): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0019_feedback.sql', import.meta.url), 'utf8'));
  if (withBuildColumn) sqlite.exec(readFileSync(new URL('../../migrations/0032_feedback_build.sql', import.meta.url), 'utf8'));
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

const META = (id: string, ipHash: string, createdAt: string) => ({ id, ipHash, createdAt, userAgent: 'test-agent' });

describe('feedback store (real SQLite, migration 0019)', () => {
  it('scrubs ip_hash from reports older than a day (gtasf-6z5zi) and keeps the recent rate window working', async () => {
    const db = memoryDb(), now = Date.parse('2026-10-17T04:00:00.000Z');
    await insertFeedback(db, { text: 'old report' }, META('old', 'h1', '2026-10-15T20:00:00.000Z'));
    await insertFeedback(db, { text: 'recent report' }, META('new', 'h1', '2026-10-17T03:59:30.000Z'));
    await scrubOldIpHashes(db, now);
    expect(await recentCountForIp(db, 'h1', '2026-10-17T03:59:00.000Z')).toBe(1);
    expect(await recentCountForIp(db, 'h1', '2026-10-01T00:00:00.000Z')).toBe(1); // the old row no longer carries the id
  });

  it('insert → digest round-trips the SQL columns and groups by theme', async () => {
    const db = memoryDb();
    await insertFeedback(db, { text: 'braking feels twitchy when I drive fast', mode: 'driving', round: 'Seed',
      startup: 'Acme', nick: 'ace', worldX: 12.5, worldZ: -3.25, lat: 37.7955, lon: -122.3937,
      locationName: 'The Embarcadero', screenshot: 'data:image/jpeg;base64,AAAA', path: '/?x=1' },
      META('a', 'ip1', '2026-10-03T20:05:00.000Z'));
    await insertFeedback(db, { text: 'the camera zoom is weird' }, META('b', 'ip2', '2026-10-03T20:06:00.000Z'));
    await insertFeedback(db, { text: 'steering drifts too much' }, META('c', 'ip1', '2026-10-03T20:07:00.000Z'));

    const digest = await feedbackDigest(db);
    expect(digest.total).toBe(3);
    expect(digest.themes.map(t => t.theme)).toEqual(['driving-and-controls', 'camera']);
    const driving = digest.themes[0]!;
    expect(driving.count).toBe(2);
    // Newest first within a group.
    expect(driving.items[0]!.id).toBe('c');
    const withShot = driving.items.find(i => i.id === 'a')!;
    expect(withShot.hasScreenshot).toBe(true);
    expect(withShot.jump).toBe('/?at=37.795500,-122.393700');
    expect(withShot.locationName).toBe('The Embarcadero');
    expect(withShot.startup).toBe('Acme');
  });

  it('recentCountForIp counts only the same ip within the window', async () => {
    const db = memoryDb();
    await insertFeedback(db, { text: 'one' }, META('a', 'ipA', '2026-10-03T20:00:00.000Z'));
    await insertFeedback(db, { text: 'two' }, META('b', 'ipA', '2026-10-03T20:00:30.000Z'));
    await insertFeedback(db, { text: 'other' }, META('c', 'ipB', '2026-10-03T20:00:30.000Z'));
    expect(await recentCountForIp(db, 'ipA', '2026-10-03T20:00:00.000Z')).toBe(2);
    expect(await recentCountForIp(db, 'ipA', '2026-10-03T20:00:15.000Z')).toBe(1); // window excludes the first
    expect(await recentCountForIp(db, 'ipB', '2026-10-03T20:00:00.000Z')).toBe(1);
  });

  it('feedbackScreenshot returns the stored data URL or null', async () => {
    const db = memoryDb();
    await insertFeedback(db, { text: 'shot', screenshot: 'data:image/jpeg;base64,ZZZZ' }, META('a', 'ip1', '2026-10-03T20:00:00.000Z'));
    await insertFeedback(db, { text: 'noshot' }, META('b', 'ip1', '2026-10-03T20:00:01.000Z'));
    expect(await feedbackScreenshot(db, 'a')).toBe('data:image/jpeg;base64,ZZZZ');
    expect(await feedbackScreenshot(db, 'b')).toBeNull();
    expect(await feedbackScreenshot(db, 'missing')).toBeNull();
  });
});

describe('feedback build tag (gtasf-367l, migration 0032)', () => {
  it('stores and reads back the build when supplied and the column exists', async () => {
    const db = memoryDb(true);
    await insertFeedback(db, { text: 'the lawns look wrong near Folsom', build: '2026.10.4-#6+ab12cd' },
      META('a', 'ip1', '2026-10-04T15:00:00.000Z'));
    const digest = await feedbackDigest(db, 500, true);
    expect(digest.themes[0]!.items[0]!.build).toBe('2026.10.4-#6+ab12cd');
  });

  it('omits the build column when no build is supplied, so inserts work on the pre-0032 schema', async () => {
    const db = memoryDb(); // 0019 only — the build column does NOT exist (flag-off / pre-migration state)
    await expect(
      insertFeedback(db, { text: 'the camera zoom is weird' }, META('b', 'ip2', '2026-10-04T15:01:00.000Z')),
    ).resolves.toMatchObject({ id: 'b' });
    const digest = await feedbackDigest(db, 500, false); // includeBuild off → SELECT never names build
    expect(digest.total).toBe(1);
    expect(digest.themes[0]!.items[0]!.build).toBeNull();
  });

  it('leaves build null for rows written without it even when the column exists', async () => {
    const db = memoryDb(true);
    await insertFeedback(db, { text: 'steering drifts too much' }, META('c', 'ip3', '2026-10-04T15:02:00.000Z'));
    const digest = await feedbackDigest(db, 500, true);
    expect(digest.themes[0]!.items[0]!.build).toBeNull();
  });
});
