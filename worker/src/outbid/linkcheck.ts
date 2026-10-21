import { safeOutbidLink } from '@gtasf/shared/outbid';
import { isReservedIp } from './reservedIp';

/** Adapted from BDTS linkcheck/net.ts: hard body cap, manual redirects, no credentials. */
export async function readBounded(response: Response | Request, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = response.body?.getReader(); if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength; if (length > maximum) throw new Error('BODY_TOO_LARGE');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** DNS screening follows BDTS. Workers cannot pin the checked IP at connection time. */
async function publicHost(host: string, fetcher: typeof fetch, signal: AbortSignal) {
  const replies = await Promise.all(['A', 'AAAA'].map(async type => {
    const result = await fetcher(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { Accept: 'application/dns-json' }, signal,
    });
    if (!result.ok) throw new Error('LINK_CHECK_UNAVAILABLE');
    const data = JSON.parse(new TextDecoder().decode(await readBounded(result, 16_384))) as { Status?: unknown; Answer?: { type?: number; data?: string }[] };
    if (data.Status !== 0 || !Array.isArray(data.Answer)) return [];
    return data.Answer.filter(answer => answer.type === 1 || answer.type === 28).map(answer => answer.data ?? '');
  }));
  const addresses = replies.flat();
  if (!addresses.length || addresses.some(isReservedIp)) throw new Error('LINK_NOT_PUBLIC');
}
export async function checkOutbidLink(input: string, fetcher: typeof fetch = fetch): Promise<{ url: string; destination: string; pageText: string }> {
  const original = safeOutbidLink(input); if (!original) throw new Error('INVALID_LINK');
  let current = original;
  const signal = AbortSignal.timeout(8000), seen = new Set<string>();
  for (let hop = 0; hop < 4; hop++) {
    if (seen.has(current)) throw new Error('LINK_REDIRECT_LOOP'); seen.add(current);
    const parsed = new URL(current); await publicHost(parsed.hostname, fetcher, signal);
    const response = await fetcher(current, { redirect: 'manual', signal,
      headers: { Accept: 'text/html,text/plain;q=0.8', 'User-Agent': 'GTASF-LinkCheck/1.0 (+https://gtasf.com)' } });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('Location'); await response.body?.cancel();
      const next = location && safeOutbidLink(new URL(location, current).href);
      if (!next) throw new Error('INVALID_LINK_REDIRECT'); current = next; continue;
    }
    // Public social pages commonly prohibit automated views; Jev still checks the public URL.
    if ([403,429].includes(response.status) && ['x.com','www.x.com','linkedin.com','www.linkedin.com'].includes(parsed.hostname)) {
      await response.body?.cancel(); return { url: original, destination: current, pageText: '[Public social profile; automated page view unavailable]' };
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error('LINK_UNREACHABLE'); }
    if (!/text\/(html|plain)/i.test(response.headers.get('Content-Type') ?? '')) { await response.body?.cancel(); throw new Error('LINK_NOT_WEBPAGE'); }
    // Read a short prefix and cancel rather than ingesting arbitrary pages into moderation.
    const reader = response.body?.getReader(); let text = '', size = 0;
    if (reader) try {
      while (size < 32_768) {
        const { value, done } = await reader.read(); if (done) break;
        const part = value.subarray(0, 32_768 - size); size += part.byteLength; text += new TextDecoder().decode(part);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return { url: original, destination: current, pageText: text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 4000) };
  }
  throw new Error('LINK_TOO_MANY_REDIRECTS');
}
