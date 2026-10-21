/** Cloudflare Pages advanced mode: same-origin API/map traffic uses the game Worker service. */

/** /assets/* are content-hashed build chunks. Pages' SPA fallback answers a missing one with index.html (200 text/html),
 *  so a tab still holding the previous release's HTML/module graph dies on "Failed to load module script ... MIME type
 *  text/html" and hangs on the loading card. A miss is served from the previous deployment while it is fresh (deploy.mjs
 *  sets PREVIOUS_DEPLOYMENT_ORIGIN + PREVIOUS_DEPLOYMENT_UNTIL, 24 h), otherwise a real 404 (the client reloads once). */
export async function serveAsset(request, env, fetchPrevious = fetch, now = Date.now()) {
  const url = new URL(request.url);
  const response = await env.ASSETS.fetch(request);
  if (!url.pathname.startsWith('/assets/')) return response;
  const isHtml = res => (res.headers.get('content-type') ?? '').includes('text/html');
  // Only a real miss falls through: 404, or the SPA fallback (200 text/html). Everything else passes untouched —
  // notably 304 Not Modified, the browser's revalidation of a cached chunk (not 'ok', and it has no body).
  const miss = response.status === 404 || (response.ok && isHtml(response));
  if (!miss) return response;
  const origin = env.PREVIOUS_DEPLOYMENT_ORIGIN, until = Number(env.PREVIOUS_DEPLOYMENT_UNTIL ?? 0);
  if (origin && now < until && request.method === 'GET') {
    try {
      const previous = await fetchPrevious(new URL(url.pathname + url.search, origin), { signal: AbortSignal.timeout(5000) });
      if (previous.ok && !isHtml(previous)) return new Response(previous.body, { status: 200, headers: previous.headers });
    } catch { /* previous deployment unreachable: fall through to the 404 */ }
  }
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/') || path.startsWith('/map/')) return env.API.fetch(request);
    return serveAsset(request, env);
  },
};
