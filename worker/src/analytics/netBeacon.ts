/**
 * POST /api/net/beacon {kind: 'session'|'drop'|'rejoin', code?, ms, mobile} (flag netBeacon, gtasf-j7wvv).
 * Bumps an aggregate counter per (UTC day, kind, close code, time bucket, device class): 'session' = a world session
 * started (the denominator), 'drop' = a live session closed unexpectedly (code = WebSocket close code, ms = how long it
 * had been up), 'rejoin' = back in after a drop (ms = the gap). Same shape and guards as the loading beacon: no
 * identifiers stored, bots skipped, one limiter key per hashed IP, always 204 for well-formed requests.
 */
import { flags } from '@gtasf/shared/flags';
import { isBotTraffic } from '../gtm/organiserTrack';
import { referralRateLimit } from '../referrals/store';
import { beaconLimiterKey, pruneBeaconLimits, PRUNE_SHARE } from './beaconLimiter';

export const NET_KINDS = ['session', 'drop', 'rejoin'] as const;
type NetKind = typeof NET_KINDS[number];

/** Close codes are stored as text; anything outside the WebSocket range collapses to 'other' (bounded cardinality). */
export function closeCodeLabel(code: unknown): string {
  return typeof code === 'number' && Number.isInteger(code) && code >= 1000 && code <= 4999 ? String(code) : 'other';
}
const bucket = (ms: number, edges: readonly (readonly [number, string])[], last: string) => {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  for (const [limit, label] of edges) if (ms < limit) return label;
  return last;
};
/** How long the session had been up when it dropped. */
export function upBucket(ms: number): string {
  return bucket(ms, [[60_000, '0-1m'], [300_000, '1-5m'], [900_000, '5-15m'], [1_800_000, '15-30m'], [3_600_000, '30-60m']], '60m+');
}
/** Drop-to-rejoin gap. */
export function gapBucket(ms: number): string {
  return bucket(ms, [[1_000, '0-1s'], [2_000, '1-2s'], [5_000, '2-5s'], [10_000, '5-10s'], [30_000, '10-30s']], '30s+');
}

const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });


export async function handleNetBeacon(request: Request, env: { DB: D1Database; IP_HASH_SECRET?: string }, now = Date.now(), random: () => number = Math.random): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/net/beacon') return null;
  if (!flags.netBeacon) return bad('Not found', 404);
  if (request.method !== 'POST') return bad('Method not allowed', 405);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return bad('Same-origin required', 403);
  let body: Record<string, unknown>;
  try { const text = await request.text(); if (text.length > 512) return bad('Body too large', 413); body = JSON.parse(text) as Record<string, unknown>; }
  catch { return bad('Invalid JSON'); }
  const { kind, code, ms, mobile } = body ?? {};
  if (!(NET_KINDS as readonly unknown[]).includes(kind) || typeof ms !== 'number' || typeof mobile !== 'boolean') return bad('Invalid input');
  if (isBotTraffic(request)) return noContent();
  const k = kind as NetKind;
  try {
    // A flapping connection could send many drops; 60/min per IP still counts real flaps without letting one client flood.
    if (!await referralRateLimit(env.DB, await beaconLimiterKey('nbeacon:', 'gtasf-net-beacon', request, now, env.IP_HASH_SECRET), 60, 60_000, now)) return noContent();
    if (random() < PRUNE_SHARE) await pruneBeaconLimits(env.DB, now); // gtasf-6mve9: no per-IP rows kept past a day
    await env.DB.prepare(`INSERT INTO net_beacon_counts(day,kind,code,bucket,device,count) VALUES(?,?,?,?,?,1)
      ON CONFLICT(day,kind,code,bucket,device) DO UPDATE SET count=count+1`)
      .bind(new Date(now).toISOString().slice(0, 10), k, k === 'drop' ? closeCodeLabel(code) : '-',
        k === 'drop' ? upBucket(ms) : k === 'rejoin' ? gapBucket(ms) : '-', mobile ? 'mobile' : 'desktop').run();
  } catch { /* best-effort */ }
  return noContent();
}
