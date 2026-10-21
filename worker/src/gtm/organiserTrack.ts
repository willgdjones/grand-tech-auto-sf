/**
 * Organiser link tracking (flag organiserLinks, gtasf-w0s8; docs/gtm/dm-template.md "Tracking").
 * POST /api/gtm/organiser-track {eventId, channel: 'dm'|'em'|'link', kind: 'view'|'play_start'|'share_click'}
 * bumps an aggregate no-PII counter. Bots are skipped; the per-connection limiter key is a hash that never
 * leaves referral_limits. Always answers 204 for well-formed requests so beacons stay cheap.
 */
import { flags } from '@gtasf/shared/flags';
import { isBotRequest } from '../funding/identity';
import { referralRateLimit } from '../referrals/store';
import { hashedIpKey } from '../referrals/ipLimiter';

export const ORGANISER_CHANNELS = ['dm', 'em', 'link'] as const;
export const ORGANISER_TRACK_KINDS = ['view', 'play_start', 'share_click'] as const;
const EVENT_ID = /^[A-Za-z0-9_.:-]{1,100}$/;
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|curl|wget|python|httpclient|okhttp|go-http/i;
const RATE_MAX = 30, RATE_WINDOW_MS = 60_000;
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

export function isBotTraffic(request: Request): boolean {
  const ua = request.headers.get('user-agent') ?? '';
  return !ua || BOT_UA.test(ua) || isBotRequest(request);
}

async function limiterKey(request: Request, now: number, secret?: string): Promise<string> { // gtasf-cnjpc: per-day salt (referrals/ipLimiter.ts)
  return hashedIpKey('otrack:', 'gtasf-organiser-track', request.headers.get('cf-connecting-ip') ?? 'unknown', now, secret);
}

export async function handleOrganiserTrackRequest(request: Request, env: { DB: D1Database; IP_HASH_SECRET?: string }): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/gtm/organiser-track') return null;
  if (!flags.organiserLinks) return json({ error: 'Not found' }, 404);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return json({ error: 'Same-origin required' }, 403);
  if (Number(request.headers.get('content-length') ?? 0) > 1024) return json({ error: 'Body too large' }, 413);
  let body: Record<string, unknown>;
  // sendBeacon posts text/plain, so parse the text regardless of content type.
  try { const text = await request.text(); if (text.length > 1024) return json({ error: 'Body too large' }, 413); body = JSON.parse(text) as Record<string, unknown>; }
  catch { return json({ error: 'Invalid JSON' }, 400); }
  const { eventId, channel, kind } = body ?? {};
  if (typeof eventId !== 'string' || !EVENT_ID.test(eventId)
    || !(ORGANISER_CHANNELS as readonly unknown[]).includes(channel)
    || !(ORGANISER_TRACK_KINDS as readonly unknown[]).includes(kind)) return json({ error: 'Invalid input' }, 400);
  if (isBotTraffic(request)) return noContent();
  try {
    const now = Date.now();
    if (!await referralRateLimit(env.DB, await limiterKey(request, now, env.IP_HASH_SECRET), RATE_MAX, RATE_WINDOW_MS, now)) return noContent();
    // Only real events get a row, so made-up ids can't grow the table or skew the outreach report. [gtasf-tdmh]
    await env.DB.prepare(`INSERT INTO organiser_link_counts(event_id,channel,kind,count)
      SELECT ?,?,?,1 WHERE EXISTS(SELECT 1 FROM events WHERE id=?)
      ON CONFLICT(event_id,channel,kind) DO UPDATE SET count=count+1`).bind(eventId, channel as string, kind as string, eventId).run();
  } catch { /* counting is best-effort */ }
  return noContent();
}
