import { flags } from '@gtasf/shared/flags';
import type { Env } from '../env';
import { feedbackDigest, feedbackScreenshot, insertFeedback, recentCountForIp, type FeedbackInput, scrubOldIpHashes } from './store';
import { hashedIp } from '../referrals/ipLimiter';

const MAX_BODY = 400_000;         // Reject bodies larger than this before parsing (bytes-ish).
const MAX_TEXT = 4000;            // Player message characters.
const MAX_SCREENSHOT = 300_000;   // Data-URL characters; larger shots are dropped, not fatal.
const MAX_FIELD = 200;            // Short metadata strings.
const MAX_PATH = 512;
const RATE_WINDOW_MS = 60_000;    // Per-ip submission window.
const RATE_MAX = 6;               // Submissions allowed per window.

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Browser submissions and admin reads must originate from our own origin. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

/** Constant-time comparison so a bad token cannot be guessed byte by byte from timing. */
function tokenMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function isAdmin(request: Request, env: Env): boolean {
  const token = env.ADMIN_TOKEN?.trim();
  if (!token) return false;
  const match = /^Bearer\s+(.+)$/.exec(request.headers.get('authorization') ?? '');
  return match ? tokenMatches(match[1]!, token) : false;
}

/** Server-derived id for the connection, for the per-IP rate window only, never the raw IP. gtasf-6z5zi: secret +
 *  per-day salted (referrals/ipLimiter.ts) instead of a static public salt, and scrubbed from reports older than a day. */
async function ipHashOf(request: Request, env: Env, now: number): Promise<string> {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
  return hashedIp('gtasf-feedback', ip, now, env.IP_HASH_SECRET);
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function screenshotData(value: unknown): { ok: true; data: string | null } | { ok: false } {
  if (value == null) return { ok: true, data: null };
  if (typeof value !== 'string') return { ok: false };
  if (!value.startsWith('data:image/')) return { ok: false };
  if (value.length > MAX_SCREENSHOT) return { ok: true, data: null }; // Too big: keep the text, drop the shot.
  return { ok: true, data: value };
}

/** Decode a stored `data:` URL into a servable image Response, or null if unparseable. */
function imageResponse(dataUrl: string): Response | null {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const [, type, base64, payload] = match;
  try {
    const body = base64 ? Uint8Array.from(atob(payload!), c => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(payload!));
    return new Response(body, { headers: { 'Content-Type': type || 'image/jpeg', 'Cache-Control': 'no-store' } });
  } catch { return null; }
}

/**
 * PLAN-v2 decision 10: F-key feedback and the authenticated admin digest.
 * - POST /api/feedback                       { text, screenshot?, mode?, ... } → store, return theme.
 * - GET  /api/feedback/admin/digest          → themes grouped by keyword (admin only).
 * - GET  /api/feedback/admin/screenshot?id=  → one stored screenshot (admin only).
 *
 * The endpoint never trusts a client-supplied identity: it derives its own ip hash,
 * created_at and id. Player fields are recorded verbatim as content for the founder
 * to read; no bead or outbound message is ever created from feedback.
 */
export async function handleFeedbackRequest(request: Request, env: Env): Promise<Response | null> {
  const { pathname, searchParams } = new URL(request.url);

  if (pathname === '/api/feedback') {
    if (!flags.feedback) return json({ error: 'Feedback is disabled.' }, 503);
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!sameOrigin(request)) return json({ error: 'Same-origin request required' }, 403);

    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: 'Feedback is too large. Please shorten it.' }, 413);
    let body: Record<string, unknown>;
    try { body = (JSON.parse(raw) ?? {}) as Record<string, unknown>; } catch { return json({ error: 'Invalid request' }, 400); }

    const text = boundedString(body.text, MAX_TEXT);
    if (!text) return json({ error: 'Type a little feedback first.' }, 400);
    const shot = screenshotData(body.screenshot);
    if (!shot.ok) return json({ error: 'That screenshot could not be read.' }, 400);

    const ipHash = await ipHashOf(request, env, Date.now());
    const windowStart = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    try {
      if (await recentCountForIp(env.DB, ipHash, windowStart) >= RATE_MAX) {
        return json({ error: "You're sending feedback very fast — give it a moment." }, 429);
      }
      const input: FeedbackInput = {
        text,
        screenshot: shot.data,
        mode: boundedString(body.mode, MAX_FIELD),
        round: boundedString(body.round, MAX_FIELD),
        startup: boundedString(body.startup, MAX_FIELD),
        nick: boundedString(body.nick, MAX_FIELD),
        worldX: finiteNumber(body.worldX),
        worldZ: finiteNumber(body.worldZ),
        lat: finiteNumber(body.lat),
        lon: finiteNumber(body.lon),
        locationName: boundedString(body.locationName, MAX_FIELD),
        path: boundedString(body.path, MAX_PATH),
        // gtasf-367l: stamp the build/changelog version only while the flag is on. Left undefined
        // otherwise, so insertFeedback never names the build column before migration 0032 applies.
        build: flags.feedbackBuildTag ? boundedString(body.build, MAX_FIELD) : undefined,
      };
      const record = await insertFeedback(env.DB, input, {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ipHash,
        userAgent: boundedString(request.headers.get('user-agent'), MAX_FIELD),
      });
      await scrubOldIpHashes(env.DB, Date.now()).catch(() => {}); // gtasf-6z5zi: the rate window is a minute; keep no older ids
      return json({ ok: true, id: record.id, theme: record.theme, screenshotStored: Boolean(shot.data) }, 201);
    } catch {
      return json({ error: 'Could not save feedback right now. Please try again.' }, 503);
    }
  }

  if (pathname === '/api/feedback/admin/digest' || pathname === '/api/feedback/admin/screenshot') {
    // These endpoints exist only once an ADMIN_TOKEN secret is configured; otherwise they are invisible.
    if (!env.ADMIN_TOKEN?.trim()) return json({ error: 'Not found' }, 404);
    if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    try {
      if (pathname === '/api/feedback/admin/digest') {
        const limit = Number(searchParams.get('limit') ?? '500');
        return json(await feedbackDigest(env.DB, Number.isFinite(limit) ? limit : 500, flags.feedbackBuildTag));
      }
      const id = searchParams.get('id');
      if (!id) return json({ error: 'Missing id' }, 400);
      const shot = await feedbackScreenshot(env.DB, id);
      if (!shot) return json({ error: 'Not found' }, 404);
      return imageResponse(shot) ?? json({ error: 'Screenshot unreadable' }, 422);
    } catch {
      return json({ error: 'Admin action failed.' }, 503);
    }
  }

  return null;
}
