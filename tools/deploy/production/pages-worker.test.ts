import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error — plain-JS Pages worker (copied to dist-production/_worker.js by build-web.mjs)
import worker, { serveAsset } from './pages-worker.js';

const NOW = 1_800_000_000_000;
const js = (body = 'export {}') => new Response(body, { status: 200, headers: { 'content-type': 'application/javascript' } });
const spaFallback = () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const env = (assets: (r: Request) => Response, extra: Record<string, string> = {}) => ({ ASSETS: { fetch: vi.fn(async (r: Request) => assets(r)) }, API: { fetch: vi.fn(async () => new Response('api')) }, ...extra });

describe('Pages worker: stale /assets/* chunks never come back as index.html', () => {
  it('serves a present asset untouched', async () => {
    const res = await serveAsset(new Request('https://gtasf.pages.dev/assets/game-abc.js'), env(() => js('ok')), vi.fn(), NOW);
    expect(res.status).toBe(200); expect(await res.text()).toBe('ok');
  });
  it('passes a 304 revalidation (and other non-miss statuses) through untouched', async () => {
    const previous = vi.fn();
    for (const status of [304, 206, 412]) {
      const res = await serveAsset(new Request('https://gtasf.pages.dev/assets/game-abc.js', { headers: { 'If-None-Match': '"x"' } }), env(() => new Response(null, { status, headers: { etag: '"x"' } })), previous, NOW);
      expect(res.status).toBe(status);
    }
    expect(previous).not.toHaveBeenCalled();
  });
  it('a missing chunk (SPA fallback html) is a real 404, not 200 text/html', async () => {
    const res = await serveAsset(new Request('https://gtasf.pages.dev/assets/game-OLD.js'), env(spaFallback), vi.fn(), NOW);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).not.toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('a missing chunk is served from the previous deployment while it is fresh', async () => {
    const previous = vi.fn(async (_url: URL, _init?: RequestInit) => js('old chunk'));
    const e = env(spaFallback, { PREVIOUS_DEPLOYMENT_ORIGIN: 'https://prev123.gtasf.pages.dev', PREVIOUS_DEPLOYMENT_UNTIL: String(NOW + 1000) });
    const res = await serveAsset(new Request('https://gtasf.pages.dev/assets/game-OLD.js?v=1'), e, previous, NOW);
    expect(res.status).toBe(200); expect(await res.text()).toBe('old chunk');
    expect(String(previous.mock.calls[0]![0])).toBe('https://prev123.gtasf.pages.dev/assets/game-OLD.js?v=1');
  });
  it('after 24 h, or when the previous deployment also lacks it, it is a 404', async () => {
    const e = env(spaFallback, { PREVIOUS_DEPLOYMENT_ORIGIN: 'https://prev123.gtasf.pages.dev', PREVIOUS_DEPLOYMENT_UNTIL: String(NOW - 1) });
    const expired = vi.fn(async () => js());
    expect((await serveAsset(new Request('https://gtasf.pages.dev/assets/x.js'), e, expired, NOW)).status).toBe(404);
    expect(expired).not.toHaveBeenCalled();
    const fresh = env(spaFallback, { PREVIOUS_DEPLOYMENT_ORIGIN: 'https://prev123.gtasf.pages.dev', PREVIOUS_DEPLOYMENT_UNTIL: String(NOW + 1000) });
    expect((await serveAsset(new Request('https://gtasf.pages.dev/assets/x.js'), fresh, vi.fn(async () => spaFallback()), NOW)).status).toBe(404);
    expect((await serveAsset(new Request('https://gtasf.pages.dev/assets/x.js'), fresh, vi.fn(async () => { throw new Error('down'); }), NOW)).status).toBe(404);
  });
  it('non-asset paths keep the SPA fallback; /api and /map go to the game Worker', async () => {
    const e = env(spaFallback);
    expect((await serveAsset(new Request('https://gtasf.pages.dev/go/lombard'), e, vi.fn(), NOW)).headers.get('content-type')).toContain('text/html');
    await worker.fetch(new Request('https://gtasf.pages.dev/api/health'), e);
    expect(e.API.fetch).toHaveBeenCalledOnce();
  });
});
