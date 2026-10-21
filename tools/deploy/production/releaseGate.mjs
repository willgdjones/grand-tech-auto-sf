/** Post-deploy release gate (deploy.mjs): the live index.html must reference THIS release's hashed chunks and every one
 *  of them must be servable (200) — not once, but on every check for a full `stableMs` window (default 60 s, >= 12
 *  consecutive passes) across every origin players load from, each request on a FRESH connection (no keep-alive) with
 *  both the plain URL and a cache-busting query. Catches the deploy window where new HTML is live before its own chunks
 *  are ('Loading the waterfront…' hang), including the #6.22 case where a single 200 at 9 s was followed by 404s on
 *  other edges ~30 s later. Pure apart from the injected fetch/sleep/now, so it is unit-tested. */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/** The hashed /assets/*.js|css an HTML page references (deduped, in order). */
export function releaseChunks(html) {
  return [...new Set([...String(html).matchAll(/\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)/g)].map(m => m[0]))];
}

/** GET on a brand-new TCP/TLS connection (agent: false + Connection: close), like a fresh browser — Node's global fetch
 *  pools keep-alive sockets, so every check would otherwise ride the first connection's edge. */
export function freshFetch(url, { timeoutMs = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = (target.protocol === 'http:' ? httpRequest : httpsRequest)(target, {
      agent: false,
      headers: { connection: 'close', 'cache-control': 'no-cache', pragma: 'no-cache', 'user-agent': 'gtasf-release-gate' },
    }, response => {
      const parts = [];
      response.on('data', part => parts.push(part));
      response.on('end', () => {
        const body = Buffer.concat(parts).toString('utf8');
        resolve({ status: response.statusCode ?? 0, text: async () => body });
      });
      response.on('error', reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`timed out after ${timeoutMs} ms`)));
    request.on('error', reject);
    request.end();
  });
}

export async function waitForReleaseChunks({ origin, origins = [origin], expectedHtml, timeoutMs = 300_000, intervalMs = 5_000,
  stableMs = 60_000, minPasses = 12, fetchImpl = freshFetch, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now,
  log = () => {} }) {
  const expected = releaseChunks(expectedHtml);
  if (!expected.length) throw new Error('Release gate: the built index.html references no /assets chunks');
  const sites = origins.filter(Boolean);
  if (!sites.length) throw new Error('Release gate: no origin to check');
  const started = now();
  let last = 'no attempt yet', streak = 0, streakStart = 0, round = 0;
  /** One check of one origin: null when the new HTML is live and every chunk serves 200 (plain + cache-busted), else why not. */
  async function check(site) {
    const html = await (await fetchImpl(`${site}/?release-gate=${now()}-${round}`)).text();
    const missing = expected.filter(c => !releaseChunks(html).includes(c));
    if (missing.length) return `${site}: live index.html is not this release yet (missing ${missing.join(', ')})`;
    const urls = expected.flatMap(c => [site + c, `${site}${c}?release-gate=${now()}-${round}`]);
    const statuses = await Promise.all(urls.map(async url => [url.slice(site.length), (await fetchImpl(url)).status]));
    const bad = statuses.filter(([, status]) => status !== 200);
    return bad.length ? `${site}: chunks not servable: ${bad.map(([c, s]) => `${c} → ${s}`).join(', ')}` : null;
  }
  for (;;) {
    round++;
    let failure = null;
    try {
      for (const site of sites) { failure = await check(site); if (failure) break; }
    } catch (error) { failure = `fetch failed: ${error instanceof Error ? error.message : error}`; }
    if (failure) {
      if (streak) log(`Release gate: streak of ${streak} reset — ${failure}`);
      streak = 0; last = failure;
    } else {
      if (!streak) streakStart = now();
      streak++;
      const held = now() - streakStart;
      if (streak >= minPasses && held >= stableMs) {
        log(`Release gate: ${expected.length} chunks of the new index.html served 200 on ${sites.join(' + ')} for ${streak} consecutive fresh-connection checks over ${Math.round(held / 1000)} s (${Math.round((now() - started) / 1000)} s after deploy)`);
        return { chunks: expected, ms: now() - started, passes: streak };
      }
      last = `stable for ${streak} checks / ${Math.round(held / 1000)} s (need ${minPasses} / ${Math.round(stableMs / 1000)} s)`;
    }
    if (now() - started >= timeoutMs) throw new Error(`Release gate FAILED after ${Math.round(timeoutMs / 1000)} s — ${last}. Players loading now may hang on 'Loading the waterfront'; consider rolling back.`);
    log(`Release gate: waiting (${last})`);
    await sleep(intervalMs);
  }
}
