import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  claimUsername, usernameForDevice, deviceForUsernameKey, suggestUsernames,
  sendRequest, respondRequest, removeFriend, listFriends, areFriends, friendsRateLimit,
} from './store';

function db(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0025_friends.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let bindings: (string | number | null)[] = [];
      const wrapper = {
        bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
        async first() { return statement.get(...bindings) ?? null; },
        async all() { return { results: statement.all(...bindings), success: true }; },
        async run() { return { meta: statement.run(...bindings), success: true }; },
      };
      return wrapper;
    },
  } as unknown as D1Database;
}

test('claims a username once per device, case-insensitively unique', async () => {
  const d = db();
  expect(await claimUsername(d, 'dev-A', 'Karl', 'karl', 100)).toEqual({ ok: true, username: 'Karl' });
  expect(await usernameForDevice(d, 'dev-A')).toEqual({ display: 'Karl', key: 'karl' });
  expect(await deviceForUsernameKey(d, 'karl')).toBe('dev-A');
  // same device, same key: idempotent ok
  expect(await claimUsername(d, 'dev-A', 'Karl', 'karl', 200)).toEqual({ ok: true, username: 'Karl' });
  // same device, different key: already claimed (claimed once)
  expect(await claimUsername(d, 'dev-A', 'Karl2', 'karl2', 300)).toEqual({ ok: false, reason: 'already-claimed', current: 'Karl' });
  // another device, same key (any casing): taken
  expect(await claimUsername(d, 'dev-B', 'KARL', 'karl', 400)).toEqual({ ok: false, reason: 'taken' });
});

test('suggests available usernames around a taken base', async () => {
  const d = db();
  await claimUsername(d, 'dev-A', 'Karl', 'karl', 100);
  const suggestions = await suggestUsernames(d, 'Karl', 3);
  expect(suggestions).not.toContain('Karl');
  expect(suggestions).toHaveLength(3);
});

test('mutual opt-in: a reverse request becomes a friendship', async () => {
  const d = db();
  expect(await sendRequest(d, 'dev-A', 'dev-A', 'search', 100)).toBe('self');
  expect(await sendRequest(d, 'dev-A', 'dev-B', 'search', 100)).toBe('requested');
  expect(await sendRequest(d, 'dev-A', 'dev-B', 'search', 110)).toBe('exists'); // dup
  expect(await areFriends(d, 'dev-A', 'dev-B')).toBe(false);
  expect(await sendRequest(d, 'dev-B', 'dev-A', 'search', 120)).toBe('friends'); // reverse → mutual
  expect(await areFriends(d, 'dev-A', 'dev-B')).toBe(true);
  expect(await sendRequest(d, 'dev-A', 'dev-B', 'search', 130)).toBe('already-friends');
  // request rows cleared on befriend
  expect((await listFriends(d, 'dev-A'))).toEqual({ friends: ['dev-B'], incoming: [], outgoing: [] });
});

test('accept / decline an incoming request', async () => {
  const d = db();
  await sendRequest(d, 'dev-A', 'dev-B', 'search', 100);
  expect(await respondRequest(d, 'dev-B', 'dev-A', false, 110)).toBe('declined');
  expect(await areFriends(d, 'dev-A', 'dev-B')).toBe(false);
  expect(await respondRequest(d, 'dev-B', 'dev-A', true, 120)).toBe('none'); // already removed
  await sendRequest(d, 'dev-A', 'dev-B', 'search', 130);
  expect(await respondRequest(d, 'dev-B', 'dev-A', true, 140)).toBe('friends');
  expect(await areFriends(d, 'dev-A', 'dev-B')).toBe(true);
});

test('lists incoming/outgoing and removes a friend symmetrically', async () => {
  const d = db();
  await sendRequest(d, 'dev-A', 'dev-B', 'search', 100); // A -> B pending
  await sendRequest(d, 'dev-C', 'dev-A', 'search', 100); // C -> A pending
  expect(await listFriends(d, 'dev-A')).toEqual({ friends: [], incoming: ['dev-C'], outgoing: ['dev-B'] });
  await sendRequest(d, 'dev-B', 'dev-A', 'search', 110); // mutual A<->B
  await removeFriend(d, 'dev-A', 'dev-B', 120);
  expect(await areFriends(d, 'dev-A', 'dev-B')).toBe(false);
});

test('rate limit allows up to the max within a window, then resets', async () => {
  const d = db();
  expect(await friendsRateLimit(d, 'k', 2, 1000, 5000)).toBe(true);
  expect(await friendsRateLimit(d, 'k', 2, 1000, 5100)).toBe(true);
  expect(await friendsRateLimit(d, 'k', 2, 1000, 5200)).toBe(false); // 3rd in window
  expect(await friendsRateLimit(d, 'k', 2, 1000, 6300)).toBe(true);  // window elapsed
});
