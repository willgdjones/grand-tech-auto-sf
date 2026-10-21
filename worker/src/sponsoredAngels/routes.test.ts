import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { handleSponsoredAngelsRequest, type SponsoredAngelDeps } from './routes';
import { getAngel, publishAngel } from './store';
import type { Env } from '../env';

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0022_sponsored_angels.sql', import.meta.url), 'utf8'));
  const db = {
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
  // Non-production WITH genuine test credentials ⇒ checkoutConfigured() is true, so the submit path
  // can exercise checkout end-to-end (prod stays false regardless — asserted in its own test below).
  const env = { DB: db, ENVIRONMENT: 'test', STRIPE_TEST_SECRET_KEY: 'sk_test_dummy', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_dummy' } as unknown as Env;
  const deps: SponsoredAngelDeps = {
    identify: async () => ({ deviceId: 'dev-1' }),
    review: async () => ({ ok: true, reason: null }),
    checkout: async () => ({ id: 'cs_test_1', url: 'https://checkout.test/cs_test_1' }),
    now: () => Date.UTC(2026, 9, 5, 18, 0, 0),
    newId: () => 'ang-1',
  };
  return { sqlite, env, deps };
}

const post = (body: unknown) => new Request('https://x/api/angels/submit', { method: 'POST', body: JSON.stringify(body) });
const goodBody = { displayName: 'Lane Capital', line: 'Backing the bold.', avatarColor: '#4f7cff', spotId: 'fidi-jackson-alley' };

describe('become-an-angel routes', () => {
  it('ignores non-matching paths', async () => {
    const { env, deps } = setup();
    expect(await handleSponsoredAngelsRequest(new Request('https://x/api/funding/profile'), env, deps)).toBeNull();
  });

  it('GET /spots returns open spots and the USD price', async () => {
    const { env, deps } = setup();
    const res = await handleSponsoredAngelsRequest(new Request('https://x/api/angels/spots'), env, deps);
    expect(res?.status).toBe(200);
    const data = await res!.json() as { spots: { id: string }[]; priceUsdCents: string };
    expect(data.spots.length).toBeGreaterThan(0);
    expect(data.priceUsdCents).toBe('10000');
  });

  it('POST /submit validates, moderates, checks out, and persists a pending angel', async () => {
    const { env, deps } = setup();
    const res = await handleSponsoredAngelsRequest(post(goodBody), env, deps);
    expect(res?.status).toBe(200);
    expect(await res!.json()).toEqual({ checkoutUrl: 'https://checkout.test/cs_test_1' });
    const saved = await getAngel(env.DB, 'ang-1');
    expect(saved?.status).toBe('pending');
    expect(saved?.displayName).toBe('Lane Capital');
    expect(saved?.spotId).toBe('fidi-jackson-alley');
  });

  it('POST /submit never starts a charge in production — 503 even with checkout wired (Stripe live-key safety)', async () => {
    const { env, deps } = setup();
    // Belt-and-braces: even if becomeAnAngel leaked on in prod and pane 7 wired a real checkout,
    // checkoutConfigured() is false in production, so the route must 503 before touching checkout
    // and persist nothing — no live charge is ever started.
    const prodEnv = { ...env, ENVIRONMENT: 'production', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' } as unknown as Env;
    const res = await handleSponsoredAngelsRequest(post(goodBody), prodEnv, deps);
    expect(res?.status).toBe(503);
    expect(await getAngel(env.DB, 'ang-1')).toBeNull();
  });

  it('POST /submit rejects an unknown spot with 400', async () => {
    const { env, deps } = setup();
    const res = await handleSponsoredAngelsRequest(post({ ...goodBody, spotId: 'not-a-spot' }), env, deps);
    expect(res?.status).toBe(400);
  });

  it('POST /submit returns 422 when Jev rejects the copy', async () => {
    const { env, deps } = setup();
    const res = await handleSponsoredAngelsRequest(post(goodBody), env, { ...deps, review: async () => ({ ok: false, reason: 'no' }) });
    expect(res?.status).toBe(422);
    expect(await getAngel(env.DB, 'ang-1')).toBeNull();
  });

  it('POST /submit returns 503 when checkout is not configured', async () => {
    const { env, deps } = setup();
    const res = await handleSponsoredAngelsRequest(post(goodBody), env, { ...deps, checkout: undefined });
    expect(res?.status).toBe(503);
    expect(await getAngel(env.DB, 'ang-1')).toBeNull();
  });

  it('GET /mine lists the caller\'s angels', async () => {
    const { env, deps } = setup();
    await handleSponsoredAngelsRequest(post(goodBody), env, deps);
    const res = await handleSponsoredAngelsRequest(new Request('https://x/api/angels/mine'), env, deps);
    expect(res?.status).toBe(200);
    const data = await res!.json() as { angels: { id: string; status: string }[] };
    expect(data.angels).toHaveLength(1);
    expect(data.angels[0]!.id).toBe('ang-1');
  });

  const remove = (id: unknown) => new Request('https://x/api/angels/remove', { method: 'POST', body: JSON.stringify({ id }) });

  it('POST /remove lets the owner remove their angel', async () => {
    const { env, deps } = setup();
    await handleSponsoredAngelsRequest(post(goodBody), env, deps);
    const res = await handleSponsoredAngelsRequest(remove('ang-1'), env, deps);
    expect(res?.status).toBe(200);
    expect((await getAngel(env.DB, 'ang-1'))?.status).toBe('removed');
  });

  it('POST /remove rejects a non-owner with 403 and keeps the angel', async () => {
    const { env, deps } = setup();
    await handleSponsoredAngelsRequest(post(goodBody), env, deps);
    const res = await handleSponsoredAngelsRequest(remove('ang-1'), env, { ...deps, identify: async () => ({ deviceId: 'dev-2' }) });
    expect(res?.status).toBe(403);
    expect((await getAngel(env.DB, 'ang-1'))?.status).toBe('pending');
  });

  it('POST /remove is 404 for an unknown id and 400 for a missing id', async () => {
    const { env, deps } = setup();
    expect((await handleSponsoredAngelsRequest(remove('nope'), env, deps))?.status).toBe(404);
    expect((await handleSponsoredAngelsRequest(remove(undefined), env, deps))?.status).toBe(400);
  });

  const adminReq = (path: string, token?: string, init: RequestInit = {}) =>
    new Request(`https://x${path}`, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...(token ? { authorization: `Bearer ${token}` } : {}) } });

  it('admin endpoints are invisible (404) without ADMIN_TOKEN', async () => {
    const { env, deps } = setup();
    expect((await handleSponsoredAngelsRequest(adminReq('/api/angels/admin'), env, deps))?.status).toBe(404);
  });

  it('admin endpoints require a valid Bearer token', async () => {
    const { env, deps } = setup();
    const admEnv = { ...env, ADMIN_TOKEN: 'sekret' } as unknown as Env;
    expect((await handleSponsoredAngelsRequest(adminReq('/api/angels/admin'), admEnv, deps))?.status).toBe(401);
    expect((await handleSponsoredAngelsRequest(adminReq('/api/angels/admin', 'wrong'), admEnv, deps))?.status).toBe(401);
  });

  it('admin can list live angels and remove one', async () => {
    const { env, deps } = setup();
    const admEnv = { ...env, ADMIN_TOKEN: 'sekret' } as unknown as Env;
    await handleSponsoredAngelsRequest(post(goodBody), env, deps);
    await publishAngel(env.DB, 'ang-1', Date.UTC(2026, 9, 5, 18, 0, 0));
    const list = await handleSponsoredAngelsRequest(adminReq('/api/angels/admin', 'sekret'), admEnv, deps);
    expect(list?.status).toBe(200);
    const data = await list!.json() as { angels: { id: string; sponsorDeviceId: string }[] };
    expect(data.angels.map(a => a.id)).toContain('ang-1');
    expect(data.angels[0]!.sponsorDeviceId).toBe('dev-1');
    const rm = await handleSponsoredAngelsRequest(adminReq('/api/angels/admin/remove', 'sekret', { method: 'POST', body: JSON.stringify({ id: 'ang-1' }) }), admEnv, deps);
    expect(rm?.status).toBe(200);
    expect((await getAngel(env.DB, 'ang-1'))?.status).toBe('removed');
  });
});
