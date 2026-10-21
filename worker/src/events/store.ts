import { normalizeEvent, dedupeEvents } from './normalize';
import { inSanFrancisco } from './neighborhoods';
import { toInstant } from './time';
import type { TechWeekEvent } from './types';

// Official feed import. When it overwrites a colliding row it also sets community=0, so an official
// event reclaims an id a community submission used first — symmetric with storeCommunityEvent, which
// refuses to overwrite an official row. Official always wins; a row is never left mislabeled community.
export const EVENT_UPSERT = `INSERT INTO events
  (id,title,host,starts_at,ends_at,venue,address,url,lat,lon,approximate,source,tags_json,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,host=excluded.host,starts_at=excluded.starts_at,
    ends_at=excluded.ends_at,venue=excluded.venue,address=excluded.address,url=excluded.url,
    lat=excluded.lat,lon=excluded.lon,approximate=excluded.approximate,source=excluded.source,
    tags_json=excluded.tags_json,updated_at=excluded.updated_at,community=0
  WHERE excluded.updated_at >= events.updated_at`;

/** Bounded upserts; a partial refresh never deletes previous events. */
export async function storeEvents(db: D1Database, events: readonly TechWeekEvent[], capturedAt: string): Promise<number> {
  const time = toInstant(capturedAt);
  if (!time || events.length > 5000) throw new Error('Invalid event import');
  const clean = events.map(event => {
    const normalized = normalizeEvent({ ...event, host: event.host ?? undefined, end: event.end ?? undefined,
      venue: event.venue ?? undefined, address: event.address ?? undefined, lat: event.lat ?? undefined, lon: event.lon ?? undefined });
    if (!normalized || event.id !== normalized.id || event.source !== normalized.source || typeof event.approx !== 'boolean'
      || (event.lat === null) !== (event.lon === null)
      || (event.lat !== null && !inSanFrancisco({ lat: event.lat, lon: event.lon! }))) throw new Error('Invalid normalized event');
    return { ...normalized, approx: event.approx || normalized.lat === null };
  });
  const unique = dedupeEvents(clean);
  for (let i = 0; i < unique.length; i += 50) {
    await db.batch(unique.slice(i, i + 50).map(e => db.prepare(EVENT_UPSERT).bind(
      e.id, e.title, e.host, e.start, e.end, e.venue, e.address, e.url, e.lat, e.lon,
      Number(e.approx), e.source, JSON.stringify(e.tags), time,
    )));
  }
  return unique.length;
}

interface EventRow {
  id: string; title: string; host: string | null; starts_at: string; ends_at: string | null;
  venue: string | null; address: string | null; url: string; lat: number | null; lon: number | null;
  approximate: number; source: TechWeekEvent['source']; tags_json: string; community?: number | null;
}

function rowToEvent(row: EventRow): TechWeekEvent | null {
  let tags: unknown;
  try { tags = JSON.parse(row.tags_json); } catch { return null; }
  if (!Array.isArray(tags) || !tags.every(t => typeof t === 'string')) return null;
  const event = normalizeEvent({ title: row.title, host: row.host ?? undefined, start: row.starts_at,
    end: row.ends_at ?? undefined, venue: row.venue ?? undefined, address: row.address ?? undefined,
    url: row.url, lat: row.lat ?? undefined, lon: row.lon ?? undefined, source: row.source, tags });
  if (!event || event.id !== row.id || (event.lat !== null && !inSanFrancisco({ lat: event.lat, lon: event.lon! }))) return null;
  // `community` is omitted (not false) for official events so the public payload stays minimal.
  return { ...event, approx: row.approximate !== 0 || event.lat === null, ...(row.community ? { community: true } : {}) };
}

export async function listEvents(db: D1Database): Promise<TechWeekEvent[]> {
  const rows = await db.prepare('SELECT * FROM events ORDER BY starts_at, id LIMIT 5000').all<EventRow>();
  return rows.results.flatMap(row => { const event = rowToEvent(row); return event ? [event] : []; });
}

const COMMUNITY_UPSERT = `INSERT INTO events
  (id,title,host,starts_at,ends_at,venue,address,url,lat,lon,approximate,source,tags_json,community,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,host=excluded.host,starts_at=excluded.starts_at,
    ends_at=excluded.ends_at,venue=excluded.venue,address=excluded.address,url=excluded.url,
    lat=excluded.lat,lon=excluded.lon,approximate=excluded.approximate,source=excluded.source,
    tags_json=excluded.tags_json,updated_at=excluded.updated_at
  WHERE events.community = 1 AND excluded.updated_at >= events.updated_at`;

export type CommunityStoreResult = 'stored' | 'updated' | 'unchanged' | 'exists-official';

/** Persists one community-submitted event. Never converts or overwrites an official (non-community) row. */
export async function storeCommunityEvent(db: D1Database, event: TechWeekEvent, capturedAt: string): Promise<CommunityStoreResult> {
  const time = toInstant(capturedAt);
  if (!time) throw new Error('Invalid submission time');
  if (event.lat === null || event.lon === null || !inSanFrancisco({ lat: event.lat, lon: event.lon })) throw new Error('Event is outside San Francisco');
  const existing = await db.prepare('SELECT community FROM events WHERE id = ?').bind(event.id).first<{ community: number | null }>();
  if (existing && !existing.community) return 'exists-official';
  const result = await db.prepare(COMMUNITY_UPSERT).bind(
    event.id, event.title, event.host, event.start, event.end, event.venue, event.address, event.url,
    event.lat, event.lon, Number(event.approx), event.source, JSON.stringify(event.tags), time,
  ).run();
  // Derive the outcome from the write, not the pre-SELECT: the guarded upsert can make no change (a
  // stale resubmit older than the stored row, or a row that raced in) even when `existing` suggested one.
  const changed = Number(result.meta?.changes ?? 0) > 0;
  return changed ? (existing ? 'updated' : 'stored') : 'unchanged';
}

/** Admin view: every community-submitted event, newest first, for removal review. */
export async function listCommunityEvents(db: D1Database): Promise<TechWeekEvent[]> {
  const rows = await db.prepare('SELECT * FROM events WHERE community = 1 ORDER BY updated_at DESC, id LIMIT 1000').all<EventRow>();
  return rows.results.flatMap(row => { const event = rowToEvent(row); return event ? [event] : []; });
}

/** Admin removal, limited to community rows so an official feed event can never be deleted here. */
export async function removeCommunityEvent(db: D1Database, id: string): Promise<boolean> {
  const existing = await db.prepare('SELECT community FROM events WHERE id = ?').bind(id).first<{ community: number | null }>();
  if (!existing || !existing.community) return false;
  await db.prepare('DELETE FROM events WHERE id = ? AND community = 1').bind(id).run();
  return true;
}
