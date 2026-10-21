import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';

vi.mock('@gtasf/shared/flags', () => ({ flags: { friends: true } }));

import { handleFriendsRequest, type FriendsDeps } from './routes';
import { claimUsername } from './store';
import type { Env } from '../env';

const ORIGIN = 'https://game.local';
const APPROVE: FriendsDeps = { reviewer: async () => true };

function db(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  for (const m of ['0010_funding.sql', '0025_friends.sql', '0026_friend_dms.sql'])
    sqlite.exec(readFileSync(new URL(`../../migrations/${m}`, import.meta.url), 'utf8'));
  function prepare(sql: string) {
    const st = sqlite.prepare(sql);
    let b: (string | number | null)[] = [];
    const w = {
      bind(...v: (string | number | null)[]) { b = v; return w; },
      async first() { return st.get(...b) ?? null; },
      async all() { return { results: st.all(...b), success: true }; },
      async run() { return { meta: st.run(...b), success: true }; },
      __run() { return { meta: st.run(...b), success: true }; }, // sync executor for batch()
    };
    return w;
  }
  return {
    prepare,
    async batch(stmts: { __run(): unknown }[]) { return stmts.map(s => s.__run()); },
  } as unknown as D1Database;
}
const env = (database: D1Database, world?: unknown): Env => ({ DB: database, ENVIRONMENT: 'local', ...(world ? { WORLD: world } : {}) } as unknown as Env);
// Stub WORLD binding whose /internal/friends/presence echoes a fixed presence for every requested id.
function worldWith(present: boolean) {
  return { idFromName: (n: string) => n, get: () => ({ fetch: async (_url: string, init: { body: string }) => {
    const ids = (JSON.parse(init.body) as { deviceIds: string[] }).deviceIds;
    const presence: Record<string, { x: number; z: number; stage: number }> = {};
    if (present) for (const id of ids) presence[id] = { x: 100, z: 200, stage: 3 };
    return new Response(JSON.stringify({ presence }), { status: 200, headers: { 'content-type': 'application/json' } });
  } }) };
}
const cookieOf = (res: Response) => res.headers.get('set-cookie')?.match(/gtasf_device=[a-f0-9]{64}/)?.[0];

async function call(database: D1Database, path: string, opts: { method?: string; body?: unknown; cookie?: string; deps?: FriendsDeps } = {}) {
  const init: RequestInit = { method: opts.method ?? 'GET', headers: { origin: ORIGIN, ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}) } };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = (await handleFriendsRequest(new Request(`${ORIGIN}${path}`, init), env(database), opts.deps ?? APPROVE))!;
  return { res, cookie: cookieOf(res), body: await res.json() as Record<string, unknown> };
}

// Claim a username on a fresh device; returns its persistent cookie.
async function device(database: D1Database, username: string) {
  const { res, cookie, body } = await call(database, '/api/friends/username', { method: 'POST', body: { username } });
  expect(res.status).toBe(200); expect(body).toMatchObject({ ok: true, username });
  return cookie!;
}

test('claims a username and reports it on /me', async () => {
  const d = db();
  const cookie = await device(d, 'Karl');
  const me = await call(d, '/api/friends/me', { cookie });
  expect(me.body).toEqual({ username: 'Karl', friends: [], incoming: [], outgoing: [] });
});

test('rejects a taken username with suggestions, and a moderated-out one', async () => {
  const d = db();
  await device(d, 'Karl');
  const taken = await call(d, '/api/friends/username', { method: 'POST', body: { username: 'Karl' } }); // new device, same name
  expect(taken.body.error).toBe('taken');
  expect((taken.body.suggestions as string[]).length).toBeGreaterThan(0);
  const rejected = await call(d, '/api/friends/username', { method: 'POST', body: { username: 'Slur' }, deps: { reviewer: async () => false } });
  expect(rejected.body.error).toBe('rejected');
  expect(await call(d, '/api/friends/username', { method: 'POST', body: { username: 'no' } })).toMatchObject({ res: { status: 400 } });
});

test('mutual opt-in: reverse request becomes a friendship, visible on both /me', async () => {
  const d = db();
  const a = await device(d, 'Ada');
  const b = await device(d, 'Boz');
  expect((await call(d, '/api/friends/request', { method: 'POST', body: { username: 'Boz' }, cookie: a })).body.status).toBe('requested');
  expect((await call(d, '/api/friends/me', { cookie: b })).body.incoming).toEqual(['Ada']);
  expect((await call(d, '/api/friends/request', { method: 'POST', body: { username: 'Ada' }, cookie: b })).body.status).toBe('friends');
  expect((await call(d, '/api/friends/me', { cookie: a })).body).toMatchObject({ friends: ['Boz'], incoming: [], outgoing: [] });
});

test('search finds others by username but not yourself', async () => {
  const d = db();
  const a = await device(d, 'Ada');
  await device(d, 'Boz');
  expect((await call(d, '/api/friends/search?u=boz', { cookie: a })).body).toEqual({ found: true, username: 'Boz' });
  expect((await call(d, '/api/friends/search?u=Ada', { cookie: a })).body).toEqual({ found: false });
});

test('a request before claiming a username is refused', async () => {
  const d = db();
  await device(d, 'Boz');
  const res = await call(d, '/api/friends/request', { method: 'POST', body: { username: 'Boz' } }); // caller has no username
  expect(res.res.status).toBe(409);
  expect(res.body.error).toBe('no-username');
});

test('presence reports online friends with location + stage, offline otherwise', async () => {
  const d = db();
  const a = await device(d, 'Ada');
  const b = await device(d, 'Boz');
  await call(d, '/api/friends/request', { method: 'POST', body: { username: 'Boz' }, cookie: a });
  await call(d, '/api/friends/request', { method: 'POST', body: { username: 'Ada' }, cookie: b }); // mutual
  const online = (await handleFriendsRequest(new Request(`${ORIGIN}/api/friends/presence`, { headers: { origin: ORIGIN, cookie: a! } }), env(d, worldWith(true)), APPROVE))!;
  expect(await online.json()).toEqual({ friends: [{ username: 'Boz', online: true, x: 100, z: 200, stage: 3 }] });
  const offline = (await handleFriendsRequest(new Request(`${ORIGIN}/api/friends/presence`, { headers: { origin: ORIGIN, cookie: a! } }), env(d, worldWith(false)), APPROVE))!;
  expect(await offline.json()).toEqual({ friends: [{ username: 'Boz', online: false }] });
});

test('referrer endpoint surfaces the referral-link referrer username for prefill (null otherwise)', async () => {
  const d = db();
  const a = await device(d, 'Ada'); // the caller (has a device cookie + username)
  await claimUsername(d, 'dev-ref', 'RefStar', 'refstar', 1000); // the referrer claimed a username
  const withRef = (r: string | null): FriendsDeps => ({ reviewer: async () => true, resolveReferrer: async () => r });

  // Attributed to a referrer who has a username -> surfaced for prefill.
  expect((await call(d, '/api/friends/referrer', { cookie: a, deps: withRef('dev-ref') })).body).toEqual({ referrer: 'RefStar' });
  // No referral attribution -> null.
  expect((await call(d, '/api/friends/referrer', { cookie: a, deps: withRef(null) })).body).toEqual({ referrer: null });
  // Attributed to a referrer who hasn't claimed a username -> null (nothing to prefill).
  expect((await call(d, '/api/friends/referrer', { cookie: a, deps: withRef('dev-nouser') })).body).toEqual({ referrer: null });
});

test('DMs: send to a friend then read the thread from both sides', async () => {
  const d = db();
  const a = await device(d, 'Ada');
  const b = await device(d, 'Boz');
  await call(d, '/api/friends/request', { method: 'POST', body: { username: 'Boz' }, cookie: a });
  await call(d, '/api/friends/request', { method: 'POST', body: { username: 'Ada' }, cookie: b }); // mutual
  expect((await call(d, '/api/friends/dm', { method: 'POST', body: { to: 'Boz', text: 'hey neighbour' }, cookie: a })).body).toEqual({ ok: true });
  const bThread = (await call(d, '/api/friends/dm?with=Ada', { cookie: b })).body as { messages: { from: string; to: string; text: string }[] };
  expect(bThread.messages.map(m => [m.from, m.to, m.text])).toEqual([['Ada', 'Boz', 'hey neighbour']]);
  const aThread = (await call(d, '/api/friends/dm?with=Boz', { cookie: a })).body as { messages: { text: string }[] };
  expect(aThread.messages.map(m => m.text)).toEqual(['hey neighbour']);
});

test('DMs: rejects non-friends, callers without a username, and empty text', async () => {
  const d = db();
  const a = await device(d, 'Ada');
  await device(d, 'Cyrus'); // exists but not a friend of Ada
  expect((await call(d, '/api/friends/dm', { method: 'POST', body: { to: 'Cyrus', text: 'hi' }, cookie: a })).body).toEqual({ error: 'not-friends' });
  // a fresh device with no username
  expect((await call(d, '/api/friends/dm', { method: 'POST', body: { to: 'Ada', text: 'hi' } })).body).toEqual({ error: 'no-username' });
  // empty text fails moderation (locallyApproved rejects blank)
  const b = await device(d, 'Boz');
  await call(d, '/api/friends/request', { method: 'POST', body: { username: 'Boz' }, cookie: a });
  await call(d, '/api/friends/request', { method: 'POST', body: { username: 'Ada' }, cookie: b });
  expect((await call(d, '/api/friends/dm', { method: 'POST', body: { to: 'Boz', text: '' }, cookie: a })).body).toEqual({ error: 'rejected' });
});

test('rejects cross-origin', async () => {
  const d = db();
  const res = (await handleFriendsRequest(new Request(`${ORIGIN}/api/friends/me`, { headers: { origin: 'https://evil.example' } }), env(d), APPROVE))!;
  expect(res.status).toBe(403);
});
