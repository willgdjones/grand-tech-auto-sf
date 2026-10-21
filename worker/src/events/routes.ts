import { flags } from '@gtasf/shared/flags';
import type { Env } from '../env';
import { createHaikuExtractor } from './extract/haiku';
import { createJevEventReviewer } from './jev';
import { ingestSubmittedLink } from './submit';
import { createNominatimGeocoder } from './geocodeNominatim';
import { listCommunityEvents, removeCommunityEvent, storeCommunityEvent } from './store';
// This worker has no KV binding, so the atomic D1 limiter (the generic key/window/count rate_limits
// table, historically named referral_limits) is the per-IP + global counter for public submissions.
import { referralRateLimit as rateLimit } from '../referrals/store';
import { hashedIpKey } from '../referrals/ipLimiter';

/** Public submission abuse caps (PLAN-v2 decision 9, review H6). Generous for real founders, firm on spam. */
const SUBMIT_WINDOW_MS = 10 * 60_000;
const SUBMIT_PER_IP_MAX = 5;
const SUBMIT_GLOBAL_MAX = 120;

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Browser submissions and admin writes must originate from our own origin. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

/** Length-independent comparison so neither a bad token's bytes nor its length leak from timing. */
function tokenMatches(provided: string, expected: string): boolean {
  let diff = provided.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= (i < provided.length ? provided.charCodeAt(i) : 0) ^ expected.charCodeAt(i);
  return diff === 0;
}

function isAdmin(request: Request, env: Env): boolean {
  const token = env.ADMIN_TOKEN?.trim();
  if (!token) return false;
  const match = /^Bearer\s+(.+)$/.exec(request.headers.get('authorization') ?? '');
  return match ? tokenMatches(match[1]!, token) : false;
}

async function readUrl(request: Request): Promise<string | null> {
  try {
    const body = await request.json();
    const url = (body as { url?: unknown } | null)?.url;
    return typeof url === 'string' && url.trim() && url.length <= 2048 ? url.trim() : null;
  } catch { return null; }
}

/**
 * PLAN-v2 decision 9: community event submission and admin removal.
 * - POST /api/events/submit        { url }  → extract, geocode, Jev-check, store flagged community.
 * - GET  /api/events/admin/community         → list community events (admin only).
 * - POST /api/events/admin/remove  { id }    → delete a community event (admin only).
 */
export async function handleEventSubmissionRequest(request: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(request.url);

  if (pathname === '/api/events/submit') {
    if (!flags.eventSubmission) return json({ error: 'Event submission is disabled.' }, 503);
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    // A public, state-changing endpoint, so require an explicit matching Origin. (The shared helper
    // tolerates a missing Origin for same-origin GETs; that is not accepted for this write path.)
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin) return json({ error: 'Same-origin request required' }, 403);
    // Rate limit per source IP and globally before spending any crawl/extraction/LLM budget (review H6).
    const now = Date.now();
    const ip = request.headers.get('cf-connecting-ip')?.trim() || 'unknown';
    if (!await rateLimit(env.DB, await hashedIpKey('submit-ip:', 'gtasf-event-submit', ip, now, env.IP_HASH_SECRET), SUBMIT_PER_IP_MAX, SUBMIT_WINDOW_MS, now) // gtasf-6z5zi: no raw IP
      || !await rateLimit(env.DB, 'submit:global', SUBMIT_GLOBAL_MAX, SUBMIT_WINDOW_MS, now))
      return json({ error: 'Too many submissions right now; please try again in a few minutes.' }, 429);
    const link = await readUrl(request);
    if (!link) return json({ error: 'Paste a public lu.ma, Partiful or Eventbrite event link.' }, 400);
    // Fail safe: require a legitimacy review everywhere except explicit local/test, so an unset or
    // misconfigured ENVIRONMENT never auto-publishes unvetted events.
    const reviewRequired = env.ENVIRONMENT !== 'local' && env.ENVIRONMENT !== 'test';
    const canReview = Boolean(env.TYPESAFE_API_KEY?.trim());
    // Reject before spending any crawl/extraction/LLM budget when we would reject for want of a reviewer.
    if (reviewRequired && !canReview) return json({ error: 'Community submissions are not open yet.' }, 503);
    let result;
    try {
      result = await ingestSubmittedLink(link, {
        geocode: createNominatimGeocoder(),
        extractEvent: env.OPENROUTER_API_KEY?.trim() ? createHaikuExtractor({ apiKey: env.OPENROUTER_API_KEY }) : undefined,
        review: canReview ? createJevEventReviewer(env.TYPESAFE_API_KEY!) : undefined,
        reviewRequired,
      });
    } catch {
      return json({ error: 'Event submission is temporarily unavailable.' }, 503);
    }
    if (result.status === 'rejected') return json({ error: result.reason ?? 'Could not add that event.' }, 422);
    try {
      const stored = await storeCommunityEvent(env.DB, result.event!, new Date().toISOString());
      if (stored === 'exists-official') return json({ error: 'That event is already on the map.' }, 409);
      return json({ ok: true, status: stored, event: result.event }, 201);
    } catch (error) {
      // storeCommunityEvent throws for a non-SF or invalid-time event: a content error (422), not a 503.
      return json({ error: error instanceof Error ? error.message : 'That event could not be stored.' }, 422);
    }
  }

  if (pathname === '/api/events/admin/community' || pathname === '/api/events/admin/remove') {
    // Admin moderation is part of the submission feature, so its flag gates these entry points too.
    if (!flags.eventSubmission) return json({ error: 'Not found' }, 404);
    // The endpoints exist only once an ADMIN_TOKEN secret is configured; otherwise they are invisible.
    if (!env.ADMIN_TOKEN?.trim()) return json({ error: 'Not found' }, 404);
    if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);
    try {
      if (pathname === '/api/events/admin/community') {
        if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
        return json({ events: await listCommunityEvents(env.DB) });
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      if (!sameOrigin(request)) return json({ error: 'Same-origin request required' }, 403);
      let id: string | null = null;
      try {
        const body = await request.json();
        const value = (body as { id?: unknown } | null)?.id;
        if (typeof value === 'string' && value.trim()) id = value.trim();
      } catch { /* handled below */ }
      if (!id) return json({ error: 'Missing event id' }, 400);
      const removed = await removeCommunityEvent(env.DB, id);
      return json({ ok: removed, removed });
    } catch {
      return json({ error: 'Admin action failed.' }, 503);
    }
  }

  return null;
}
