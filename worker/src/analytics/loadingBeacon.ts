/**
 * POST /api/loading/beacon {kind: 'start'|'ready'|'abandon', stage, elapsedMs, mobile} (flag loadingBeacon).
 * Bumps an aggregate counter per (UTC day, kind, stage, elapsed bucket, device class). sendBeacon posts
 * text/plain. Bots are skipped; one limiter key per hashed IP. Always 204 for well-formed requests.
 */
import { flags } from '@gtasf/shared/flags';
import { isBotTraffic } from '../gtm/organiserTrack';
import { referralRateLimit } from '../referrals/store';
import { beaconLimiterKey, pruneBeaconLimits, PRUNE_SHARE } from './beaconLimiter';

export const LOADING_KINDS = ['start', 'ready', 'abandon'] as const;
export const LOADING_STAGES = ['boot', 'download', 'paving', 'parking', 'joining', 'ready'] as const;
const STAGE = new Set<string>(LOADING_STAGES);
export function elapsedBucket(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  for (const [limit, label] of [[3_000, '0-3s'], [6_000, '3-6s'], [10_000, '6-10s'], [20_000, '10-20s'], [40_000, '20-40s'], [90_000, '40-90s']] as const)
    if (ms < limit) return label;
  return '90s+';
}
// loadingBeaconClass (reviewer 13:3x / critic 13:4x): a coarse client class per counter so link-preview renderers and app WebViews
// stop hiding inside 'mobile'. isBotTraffic already drops *bot / facebookexternalhit / preview UAs; these are the unfurlers it
// misses (messaging fetchers) and the in-app browsers that are real users. Only the class is stored, never the user agent.
const PREVIEW_UA = /whatsapp|applebot|google-pagerenderer|google-inspectiontool|skypeuripreview|bitlybot|vkshare|redditbot|iframely|outbrain|pinterest\/0\./i;
const INAPP_UA = /fban|fbav|fb_iab|instagram|linkedinapp|\bline\/|snapchat|musical_ly|bytedancewebview|tiktok|twitter for|\bgsa\/|micromessenger|wv\)/i;
export type LoadingUaClass = 'browser' | 'inapp' | 'preview';
export function loadingUaClass(ua: string): LoadingUaClass { return PREVIEW_UA.test(ua) ? 'preview' : INAPP_UA.test(ua) ? 'inapp' : 'browser'; }
const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });


export async function handleLoadingBeacon(request: Request, env: { DB: D1Database; IP_HASH_SECRET?: string }, now = Date.now(), random: () => number = Math.random): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/loading/beacon') return null;
  if (!flags.loadingBeacon) return bad('Not found', 404);
  if (request.method !== 'POST') return bad('Method not allowed', 405);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return bad('Same-origin required', 403);
  let body: Record<string, unknown>;
  try { const text = await request.text(); if (text.length > 512) return bad('Body too large', 413); body = JSON.parse(text) as Record<string, unknown>; }
  catch { return bad('Invalid JSON'); }
  const { kind, stage, elapsedMs, mobile, seen } = body ?? {};
  if (!(LOADING_KINDS as readonly unknown[]).includes(kind) || typeof stage !== 'string' || !STAGE.has(stage)
    || typeof elapsedMs !== 'number' || typeof mobile !== 'boolean') return bad('Invalid input');
  if (isBotTraffic(request)) return noContent();
  try {
    // 3 beacons per page load; 60/min per IP leaves room for shared NATs without letting one client flood.
    if (!await referralRateLimit(env.DB, await beaconLimiterKey('lbeacon:', 'gtasf-loading-beacon', request, now, env.IP_HASH_SECRET), 60, 60_000, now)) return noContent();
    if (random() < PRUNE_SHARE) await pruneBeaconLimits(env.DB, now); // gtasf-6mve9: no per-IP rows kept past a day
    await env.DB.prepare(`INSERT INTO loading_beacon_counts(day,kind,stage,bucket,device,count) VALUES(?,?,?,?,?,1)
      ON CONFLICT(day,kind,stage,bucket,device) DO UPDATE SET count=count+1`)
      .bind(new Date(now).toISOString().slice(0, 10), kind as string, stage, elapsedBucket(elapsedMs), mobile ? 'mobile' : 'desktop').run();
    if (flags.loadingBeaconClass) // migration 0053; an old client without 'seen' counts as seen (it was the default before)
      await env.DB.prepare(`INSERT INTO loading_beacon_class_counts(day,kind,stage,bucket,device,ua,seen,count) VALUES(?,?,?,?,?,?,?,1)
        ON CONFLICT(day,kind,stage,bucket,device,ua,seen) DO UPDATE SET count=count+1`)
        .bind(new Date(now).toISOString().slice(0, 10), kind as string, stage, elapsedBucket(elapsedMs), mobile ? 'mobile' : 'desktop',
          loadingUaClass(request.headers.get('user-agent') ?? ''), seen === false ? 0 : 1).run();
  } catch { /* best-effort */ }
  return noContent();
}
