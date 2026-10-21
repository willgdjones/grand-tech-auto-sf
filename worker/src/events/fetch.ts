import { parseRobots, robotsAllows } from './robots';
import type { RobotsPolicy } from './robots';
import { sourceOf } from './urls';

export interface FetchedPage { url: string; body: string; contentType: string }
export interface PageFetcher { get(url: string): Promise<FetchedPage> }
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export interface FetchOptions {
  fetch?: Fetch;
  userAgent?: string;
  minDelayMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRequests?: number;
  maxRetries?: number;
  maxRedirects?: number;
  maxWaitMs?: number;
  cacheTtlMs?: number;
}

export class CrawlFetchError extends Error {
  constructor(message: string, readonly url: string, readonly status?: number) { super(message); this.name = 'CrawlFetchError'; }
}

const ORIGINS = new Set(['https://www.tech-week.com', 'https://tech-week.com', 'https://lu.ma', 'https://luma.com', 'https://www.luma.com', 'https://partiful.com', 'https://www.partiful.com', 'https://eventbrite.com', 'https://www.eventbrite.com']);
const REDIRECT = new Set([301, 302, 303, 307, 308]);
const ALLOW: RobotsPolicy = { rules: [], crawlDelayMs: 0 };

export function retryAfterMs(value: string | null, now: number): number | null {
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

async function boundedText(response: Response, maxBytes: number, url: string): Promise<string> {
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
    await response.body?.cancel();
    throw new CrawlFetchError('Response exceeds byte limit', url);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new CrawlFetchError('Response exceeds byte limit', url); }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally { reader.releaseLock(); }
}

/** Serial, cookie-free public fetches. Redirects are checked BEFORE fetching their destination. */
export function createPoliteFetcher(options: FetchOptions = {}): PageFetcher {
  const fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
  const userAgent = options.userAgent ?? 'GTASFEvents/0.1 (+https://gtasf.com)';
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const delay = Math.max(1000, options.minDelayMs ?? 1000);
  const maxWait = options.maxWaitMs ?? 60_000;
  const maxBytes = options.maxBytes ?? 2_000_000;
  const maxRedirects = options.maxRedirects ?? 5;
  const maxRetries = options.maxRetries ?? 2;
  const ttl = options.cacheTtlMs ?? 900_000;
  const nextAllowed = new Map<string, number>();
  const policies = new Map<string, { policy?: RobotsPolicy; error?: CrawlFetchError; expires: number }>();
  const cache = new Map<string, { page: FetchedPage; expires: number }>();
  let requests = 0;
  let chain: Promise<unknown> = Promise.resolve();

  async function waitForOrigin(url: string, robotsDelay: number): Promise<void> {
    const origin = new URL(url).origin;
    const wait = Math.max(0, (nextAllowed.get(origin) ?? 0) - now());
    if (wait > maxWait) throw new CrawlFetchError(`Origin is cooling down; retry in ${Math.ceil(wait / 1000)}s`, url);
    if (wait > 0) await sleep(wait);
    nextAllowed.set(origin, now() + Math.max(delay, robotsDelay));
  }

  async function raw(url: string, robotsDelay: number, bytes = maxBytes): Promise<{ status: number; headers: Headers; body: string }> {
    for (let attempt = 0; ; attempt++) {
      await waitForOrigin(url, robotsDelay);
      if (++requests > (options.maxRequests ?? 1500)) throw new CrawlFetchError('Crawl request budget exhausted', url);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
      let status: number;
      let headers: Headers;
      try {
        const response = await fetchImpl(url, {
          method: 'GET', redirect: 'manual', credentials: 'omit', signal: controller.signal,
          headers: { 'User-Agent': userAgent, Accept: 'text/html, application/ld+json, text/plain;q=0.9' },
        });
        if (response.redirected) {
          await response.body?.cancel();
          throw new CrawlFetchError('Transport followed a redirect without policy checks', url);
        }
        status = response.status;
        headers = response.headers;
        if (response.ok) return { status, headers, body: await boundedText(response, bytes, url) };
        await response.body?.cancel();
      } finally { clearTimeout(timer); }
      if (status === 429 || status >= 500) {
        const backoff = retryAfterMs(headers.get('retry-after'), now()) ?? 1000 * 2 ** attempt;
        const origin = new URL(url).origin;
        nextAllowed.set(origin, Math.max(nextAllowed.get(origin) ?? 0, now() + backoff));
        if (attempt < maxRetries && backoff <= maxWait) continue;
      }
      return { status, headers, body: '' };
    }
  }

  async function policyFor(origin: string): Promise<RobotsPolicy> {
    const old = policies.get(origin);
    if (old && old.expires > now()) {
      if (old.error) throw old.error;
      return old.policy!;
    }
    let url = `${origin}/robots.txt`;
    const visited = new Set<string>();
    try {
      for (let count = 0; count <= maxRedirects; count++) {
        if (visited.has(url)) throw new CrawlFetchError('robots.txt redirect loop', url);
        visited.add(url);
        const u = new URL(url);
        if (!ORIGINS.has(u.origin) || u.pathname !== '/robots.txt' || u.username || u.password || u.search) {
          throw new CrawlFetchError('Unsafe robots.txt redirect', url);
        }
        const result = await raw(url, 0, Math.min(maxBytes, 512_000));
        if (REDIRECT.has(result.status)) {
          const location = result.headers.get('location');
          if (!location) throw new CrawlFetchError('robots.txt redirect has no Location', url, result.status);
          url = new URL(location, url).href;
          continue;
        }
        const isMissing = result.status === 404 || result.status === 410;
        if (result.status !== 200 && !isMissing) throw new CrawlFetchError('robots.txt unavailable; crawl deferred', url, result.status);
        const policy = isMissing ? ALLOW : parseRobots(result.body, userAgent.split(/[\s/]/)[0]);
        if (!isMissing && /<html\b|<!doctype\s+html/i.test(result.body)) throw new CrawlFetchError('robots.txt returned HTML; crawl deferred', url);
        policies.set(origin, { policy, expires: now() + ttl });
        // Crawl-delay also separates the robots request from the first page request.
        nextAllowed.set(origin, Math.max(nextAllowed.get(origin) ?? 0, now() + policy.crawlDelayMs));
        return policy;
      }
      throw new CrawlFetchError('Too many robots.txt redirects', url);
    } catch (error) {
      const failure = error instanceof CrawlFetchError ? error : new CrawlFetchError(`robots.txt fetch failed: ${String(error)}`, url);
      policies.set(origin, { error: failure, expires: Math.max(now() + 60_000, nextAllowed.get(origin) ?? 0) });
      throw failure;
    }
  }

  async function get(requestedUrl: string): Promise<FetchedPage> {
    let url = requestedUrl;
    const visited = new Set<string>();
    for (let count = 0; count <= maxRedirects; count++) {
      if (!sourceOf(url)) throw new CrawlFetchError('URL is outside public event sources', url);
      if (visited.has(url)) throw new CrawlFetchError('Event redirect loop', url);
      visited.add(url);
      const policy = await policyFor(new URL(url).origin);
      if (!robotsAllows(policy, url)) throw new CrawlFetchError('robots.txt disallows this URL', url);
      const old = cache.get(url);
      if (old && old.expires > now()) return old.page;
      const response = await raw(url, policy.crawlDelayMs);
      if (REDIRECT.has(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new CrawlFetchError('Event redirect has no Location', url, response.status);
        url = new URL(location, url).href;
        continue;
      }
      if (response.status !== 200) throw new CrawlFetchError(`HTTP ${response.status}`, url, response.status);
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new CrawlFetchError('Expected public event HTML', url);
      const page = { url, body: response.body, contentType };
      // Bounded cache: public page text only, never cookies or registration data.
      if (cache.size >= 500) cache.delete(cache.keys().next().value!);
      cache.set(url, { page, expires: now() + ttl });
      return page;
    }
    throw new CrawlFetchError('Too many event redirects', url);
  }

  return {
    get(url) {
      // Serialize robots + requests + retries, including concurrent callers.
      const result = chain.then(() => get(url));
      chain = result.catch(() => {});
      return result;
    },
  };
}
