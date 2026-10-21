import { createHash } from 'node:crypto';
import type { EventSnapshot } from '../../worker/src/events/feed';
import { normalizeEvent } from '../../worker/src/events/normalize';
import { inSanFrancisco } from '../../worker/src/events/neighborhoods';
import type { TechWeekEvent } from '../../worker/src/events/types';

const quote = (value: string | number | null): string => {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid numeric event value');
    return String(value);
  }
  if (value.includes('\0')) throw new Error('Event text contains a null byte');
  return `'${value.replaceAll("'", "''")}'`;
};

/** Offline only. Both local and deployed seeds use the same canonical public snapshot. */
export function renderEventSeed(source: string) {
  const snapshot = JSON.parse(source) as EventSnapshot;
  if (snapshot.complete !== true || snapshot.source !== 'https://www.tech-week.com/api/mcp' ||
      !Number.isFinite(Date.parse(snapshot.capturedAt)) || !Number.isSafeInteger(snapshot.sourceTotal) ||
      !Array.isArray(snapshot.events) || !snapshot.events.length || snapshot.events.length > 5000 ||
      snapshot.sourceTotal < snapshot.events.length) throw new Error('Incomplete or invalid canonical event snapshot');
  const ids = new Set<string>();
  const events: TechWeekEvent[] = snapshot.events.map(event => {
    const normalized = normalizeEvent({ ...event, host: event.host ?? undefined, end: event.end ?? undefined,
      venue: event.venue ?? undefined, address: event.address ?? undefined, lat: event.lat ?? undefined, lon: event.lon ?? undefined });
    if (!normalized || event.id !== normalized.id || event.source !== normalized.source || ids.has(event.id) ||
        typeof event.approx !== 'boolean' || (event.lat === null) !== (event.lon === null) ||
        (event.lat !== null && !inSanFrancisco({ lat: event.lat, lon: event.lon! }))) throw new Error('Invalid canonical event row');
    ids.add(event.id);
    return { ...normalized, approx: event.approx || normalized.lat === null };
  });
  const sourceSha256 = createHash('sha256').update(source).digest('hex');
  const statements = events.map(event => `INSERT INTO events
  (id,title,host,starts_at,ends_at,venue,address,url,lat,lon,approximate,source,tags_json,updated_at)
  VALUES (${[event.id, event.title, event.host, event.start, event.end, event.venue, event.address, event.url,
    event.lat, event.lon, Number(event.approx), event.source, JSON.stringify(event.tags), snapshot.capturedAt].map(quote).join(',')})
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,host=excluded.host,starts_at=excluded.starts_at,
    ends_at=excluded.ends_at,venue=excluded.venue,address=excluded.address,url=excluded.url,lat=excluded.lat,lon=excluded.lon,
    approximate=excluded.approximate,source=excluded.source,tags_json=excluded.tags_json,updated_at=excluded.updated_at
  WHERE excluded.updated_at >= events.updated_at;`);
  const sql = `-- GTASF public Tech Week snapshot; idempotent upsert, no deletion.\n-- Source SHA-256: ${sourceSha256}\n${statements.join('\n')}\n`;
  const manifest = {
    source: snapshot.source,
    capturedAt: snapshot.capturedAt,
    sourceTotal: snapshot.sourceTotal,
    rows: events.length,
    locatedRows: events.filter(event => event.lat !== null).length,
    approximateRows: events.filter(event => event.approx).length,
    firstStart: events.reduce((value, event) => event.start < value ? event.start : value, events[0]!.start),
    lastStart: events.reduce((value, event) => event.start > value ? event.start : value, events[0]!.start),
    sourceSha256,
    sqlSha256: createHash('sha256').update(sql).digest('hex'),
    sqlBytes: Buffer.byteLength(sql),
    requiredSchema: ['0001_initial.sql', '0002_events.sql'],
    method: 'upsert-by-id-preserve-newer-no-delete',
  };
  return { sql, manifest };
}
