import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFriendsClient } from './client';

function mockFetch(responder: (url: string, init?: RequestInit) => { status?: number; body?: unknown } | 'throw') {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const out = responder(url, init);
    if (out === 'throw') throw new Error('network down');
    const status = out.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => out.body } as Response;
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('friends client', () => {
  it('reads me() and unwraps presence()', async () => {
    mockFetch(url => {
      if (url.endsWith('/me')) return { body: { username: 'ada', friends: ['bob'], incoming: [], outgoing: ['cy'] } };
      if (url.endsWith('/presence')) return { body: { friends: [{ username: 'bob', online: true, x: 1, z: 2, stage: 3 }] } };
      return { status: 404 };
    });
    const c = createFriendsClient();
    expect((await c.me()).friends).toEqual(['bob']);
    const presence = await c.presence();
    expect(presence).toHaveLength(1);
    expect(presence[0]).toMatchObject({ username: 'bob', online: true, stage: 3 });
  });

  it('search maps found; claim/request/respond parse their bodies', async () => {
    mockFetch(url => {
      if (url.includes('/search')) return { body: { found: true, username: 'Taken' } };
      if (url.endsWith('/username')) return { body: { ok: false, error: 'taken', suggestions: ['taken2'] } };
      if (url.endsWith('/request')) return { body: { status: 'requested' } };
      if (url.endsWith('/respond')) return { body: { status: 'friends' } };
      if (url.endsWith('/remove')) return { body: { ok: true } };
      return { status: 404 };
    });
    const c = createFriendsClient();
    expect((await c.search('Taken')).found).toBe(true);
    const claim = await c.claim('Taken');
    expect(claim).toMatchObject({ ok: false, error: 'taken' });
    expect(await c.request('bob', 'referral')).toBe('requested');
    expect(await c.respond('bob', true)).toBe('friends');
    expect(await c.remove('bob')).toBe(true);
  });

  it('DM send/fetch parse their bodies and fail soft', async () => {
    mockFetch((url, init) => {
      if (url.endsWith('/dm') && init?.method === 'POST') return { body: { ok: true } };
      if (url.includes('/dm?with=')) return { body: { messages: [{ from: 'bob', to: 'ada', text: 'gm', ts: 5 }] } };
      if (url.includes('/dm?since=')) return { body: { messages: [{ from: 'bob', to: 'ada', text: 'gm', ts: 5 }, { from: 'cy', to: 'ada', text: 'yo', ts: 6 }] } };
      return { status: 404 };
    });
    let c = createFriendsClient();
    expect(await c.sendDm('bob', 'hi')).toEqual({ ok: true });
    const thread = await c.fetchDms('bob', 3);
    expect(thread).toHaveLength(1);
    expect(thread[0]).toMatchObject({ from: 'bob', text: 'gm' });
    expect(await c.allDms(0)).toHaveLength(2); // discovery: all threads in one poll

    mockFetch(() => 'throw');
    c = createFriendsClient();
    expect(await c.sendDm('bob', 'hi')).toEqual({ ok: false, error: 'offline' });
    expect(await c.fetchDms('bob')).toEqual([]);
    expect(await c.allDms()).toEqual([]);
  });

  it('fails soft when the flag is off (404/503) or the network throws', async () => {
    mockFetch(() => ({ status: 503 }));
    let c = createFriendsClient();
    expect(await c.me()).toEqual({ username: null, friends: [], incoming: [], outgoing: [] });
    expect(await c.presence()).toEqual([]);
    expect((await c.search('x')).found).toBe(false); // soft = "available", never blocks onboarding
    expect(await c.request('bob')).toBe('unavailable');
    expect(await c.remove('bob')).toBe(false);

    mockFetch(() => 'throw');
    c = createFriendsClient();
    expect((await c.me()).friends).toEqual([]);
    expect(await c.respond('bob', true)).toBe('none');
  });
});
