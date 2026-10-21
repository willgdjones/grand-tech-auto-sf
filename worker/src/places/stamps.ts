/**
 * Place stamps (flag placeStamps, living map item 7). Cosmetic collection of real SF places a device has visited.
 *   GET  /api/places/stamps            -> { stamps: string[], total }
 *   POST /api/places/stamps { placeId } -> { ok, placeId, count, total, fresh }
 * The place must exist in web/public/data/places.json (bundled ids). Idempotent per device and place; at most
 * STAMP_RATE_MAX new stamps per STAMP_RATE_WINDOW_MS. Proximity is checked by the client (HTTP carries no pose);
 * stamps pay nothing, so a spoofed claim only fills the claimant's own card.
 */
import { flags } from '@gtasf/shared/flags';
import places from '../../../web/public/data/places.json';
import type { Env } from '../env';
import { fundingDevice, fundingSameOrigin } from '../funding/identity';

export const PLACE_IDS: ReadonlySet<string> = new Set((places as { places: { id: string }[] }).places.map(p => p.id));
export const STAMP_RATE_MAX = 12, STAMP_RATE_WINDOW_MS = 60_000;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function listStamps(db: D1Database, deviceId: string): Promise<string[]> {
  const rows = await db.prepare('SELECT place_id FROM place_stamps WHERE device_id = ? ORDER BY stamped_at').bind(deviceId).all<{ place_id: string }>();
  return rows.results.map(r => r.place_id);
}

export type StampResult = { ok: true; placeId: string; count: number; total: number; fresh: boolean } | { ok: false; error: 'unknown-place' | 'rate' };

export async function stampPlace(db: D1Database, deviceId: string, placeId: string, now: number, known: ReadonlySet<string> = PLACE_IDS): Promise<StampResult> {
  if (!known.has(placeId)) return { ok: false, error: 'unknown-place' };
  const existing = await db.prepare('SELECT 1 AS hit FROM place_stamps WHERE device_id = ? AND place_id = ?').bind(deviceId, placeId).first<{ hit: number }>();
  if (!existing) {
    const recent = await db.prepare('SELECT COUNT(*) AS n FROM place_stamps WHERE device_id = ? AND stamped_at > ?').bind(deviceId, now - STAMP_RATE_WINDOW_MS).first<{ n: number }>();
    if ((recent?.n ?? 0) >= STAMP_RATE_MAX) return { ok: false, error: 'rate' };
    await db.prepare('INSERT OR IGNORE INTO place_stamps (device_id, place_id, stamped_at) VALUES (?, ?, ?)').bind(deviceId, placeId, now).run();
  }
  const count = await db.prepare('SELECT COUNT(*) AS n FROM place_stamps WHERE device_id = ?').bind(deviceId).first<{ n: number }>();
  return { ok: true, placeId, count: count?.n ?? 0, total: known.size, fresh: !existing };
}

export async function handlePlaceStampsRequest(request: Request, env: Env, now = Date.now()): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/places/stamps') return null;
  if (!flags.placeStamps) return json({ error: 'off' }, 404);
  if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'method' }, 405);
  if (request.method === 'POST' && !fundingSameOrigin(request)) return json({ error: 'origin' }, 403);
  const deviceId = await fundingDevice(request, env.DB);
  if (!deviceId) return json({ error: 'device' }, 401);
  if (request.method === 'GET') return json({ stamps: await listStamps(env.DB, deviceId), total: PLACE_IDS.size });
  const body = await request.json().catch(() => null) as { placeId?: unknown } | null;
  if (typeof body?.placeId !== 'string' || body.placeId.length > 80) return json({ error: 'place' }, 400);
  const result = await stampPlace(env.DB, deviceId, body.placeId, now);
  return json(result, result.ok ? 200 : result.error === 'rate' ? 429 : 404);
}
