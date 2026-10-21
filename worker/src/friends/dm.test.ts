import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { insertDm, dmThread } from './dm';

function db(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0025_friends.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../../migrations/0026_friend_dms.sql', import.meta.url), 'utf8'));
  sqlite.exec("INSERT INTO friendships(a,b,created_at) VALUES('dev-A','dev-B',0),('dev-A','dev-C',0)");
  return {
    prepare(sql: string) {
      const st = sqlite.prepare(sql);
      let b: (string | number | null)[] = [];
      const w = {
        bind(...v: (string | number | null)[]) { b = v; return w; },
        async first() { return st.get(...b) ?? null; },
        async all() { return { results: st.all(...b), success: true }; },
        async run() { return { meta: st.run(...b), success: true }; },
      };
      return w;
    },
  } as unknown as D1Database;
}

test('stores a DM thread read the same from either side, ascending', async () => {
  const d = db();
  expect(await insertDm(d, 'dev-A', 'dev-B', 'hi', 100)).toBe(true);
  await insertDm(d, 'dev-B', 'dev-A', 'yo', 200);
  const fromA = await dmThread(d, 'dev-A', 'dev-B');
  expect(fromA.map(m => [m.sender, m.text])).toEqual([['dev-A', 'hi'], ['dev-B', 'yo']]);
  // Same thread regardless of argument order (ordered pair).
  expect(await dmThread(d, 'dev-B', 'dev-A')).toEqual(fromA);
});

test('does not store a first message without a current friendship', async () => {
  const d = db();
  expect(await insertDm(d, 'dev-A', 'dev-D', 'not allowed', 100)).toBe(false);
  expect(await dmThread(d, 'dev-A', 'dev-D')).toEqual([]);
});

test('refuses a moderated message if friendship was removed after the request began', async () => {
  const d = db();
  expect(await insertDm(d, 'dev-A', 'dev-B', 'before removal', 100)).toBe(true);
  await d.prepare('DELETE FROM friendships WHERE a=? AND b=?').bind('dev-A', 'dev-B').run();
  expect(await insertDm(d, 'dev-B', 'dev-A', 'moderation completed late', 200)).toBe(false);
  expect((await dmThread(d, 'dev-A', 'dev-B')).map(message => message.text)).toEqual(['before removal']);
});

test('since filter returns only messages strictly after the timestamp', async () => {
  const d = db();
  await insertDm(d, 'dev-A', 'dev-B', 'first', 100);
  await insertDm(d, 'dev-A', 'dev-B', 'second', 200);
  expect((await dmThread(d, 'dev-A', 'dev-B', 100)).map(m => m.text)).toEqual(['second']);
  expect((await dmThread(d, 'dev-A', 'dev-B', 200)).map(m => m.text)).toEqual([]);
});

test('threads are isolated per friend pair', async () => {
  const d = db();
  await insertDm(d, 'dev-A', 'dev-B', 'ab', 100);
  await insertDm(d, 'dev-A', 'dev-C', 'ac', 100);
  expect((await dmThread(d, 'dev-A', 'dev-B')).map(m => m.text)).toEqual(['ab']);
  expect((await dmThread(d, 'dev-A', 'dev-C')).map(m => m.text)).toEqual(['ac']);
});

test('a delayed moderation result remains visible after a newer message has been polled', async () => {
  const d = db();
  await insertDm(d, 'dev-A', 'dev-B', 'reviewed quickly', 200);
  const seen = await dmThread(d, 'dev-B', 'dev-A');
  const since = seen.at(-1)!.created_at;
  // This request started earlier but passed moderation after the first poll.
  await insertDm(d, 'dev-B', 'dev-A', 'reviewed slowly', 100);
  const next = await dmThread(d, 'dev-A', 'dev-B', since);
  expect(next.map(message => message.text)).toEqual(['reviewed slowly']);
  expect(next[0]!.created_at).toBeGreaterThan(since);
});

test('same-millisecond inserts have distinct cursors and survive paginated polling', async () => {
  const d = db();
  await Promise.all(Array.from({ length: 6 }, (_, i) => insertDm(d,
    i % 2 ? 'dev-B' : 'dev-A', i % 2 ? 'dev-A' : 'dev-B', `message ${i}`, 100)));
  const received: string[] = [];
  let since = 0;
  for (let page = 0; page < 3; page++) {
    const messages = await dmThread(d, 'dev-A', 'dev-B', since, 2);
    expect(messages).toHaveLength(2);
    expect(messages[1]!.created_at).toBeGreaterThan(messages[0]!.created_at);
    received.push(...messages.map(message => message.text));
    since = messages.at(-1)!.created_at;
  }
  expect(new Set(received).size).toBe(6);
  expect(await dmThread(d, 'dev-A', 'dev-B', since)).toEqual([]);
  await insertDm(d, 'dev-A', 'dev-C', 'different thread', 100);
  expect((await dmThread(d, 'dev-A', 'dev-C'))[0]!.created_at).toBe(100);
});
