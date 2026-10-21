import { plainText } from './html';
import { toInstant } from './time';
import type { EventCandidate, TechWeekEvent } from './types';
import { canonicalUrl, eventId, publicEventUrl, sourceOf } from './urls';

const text = (value: string | undefined): string | null => value ? plainText(value).slice(0, 1000) || null : null;
export function normalizeTags(values: readonly string[] = []): string[] {
  return [...new Set(values.map(v => plainText(v).trim().toLowerCase().slice(0, 80)).filter(Boolean))].sort().slice(0, 32);
}

export function normalizeEvent(candidate: EventCandidate): TechWeekEvent | null {
  const title = text(candidate.title);
  const start = toInstant(candidate.start, candidate.timeZone);
  const end = candidate.end ? toInstant(candidate.end, candidate.timeZone) : null;
  const url = publicEventUrl(candidate.url);
  if (!title || !start || !url || (candidate.end && !end) || (end && end < start)) return null;
  const hidden = candidate.hidden === true || candidate.virtual === true;
  const lat = !hidden && Number.isFinite(candidate.lat) && Number.isFinite(candidate.lon) ? candidate.lat! : null;
  const lon = lat !== null ? candidate.lon! : null;
  return {
    id: eventId(url), title, host: text(candidate.host), start, end,
    venue: text(candidate.venue), address: hidden ? null : text(candidate.address),
    lat, lon, approx: hidden || lat === null, url: canonicalUrl(url), source: sourceOf(url)!,
    tags: normalizeTags(candidate.tags),
  };
}

function titleKey(title: string): string {
  return title.toLowerCase().replace(/#?sf\s*tech\s*week(?:\s*2026)?/g, '').replace(/[^\p{L}\p{N}]/gu, '');
}
const key = (value: string | null): string => (value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function sameEvent(a: TechWeekEvent, b: TechWeekEvent): boolean {
  if (a.url === b.url || a.id === b.id) return true;
  if (!titleKey(a.title) || titleKey(a.title) !== titleKey(b.title) || a.start !== b.start) return false;
  if (a.address && b.address && key(a.address) !== key(b.address)) return false;
  if (!a.approx && !b.approx && a.lat !== null && b.lat !== null && a.lon !== null && b.lon !== null
    && Math.hypot(a.lat - b.lat, (a.lon - b.lon) * 0.79) > 0.003) return false;
  return Boolean((a.host && b.host && key(a.host) === key(b.host))
    || (a.address && b.address && key(a.address) === key(b.address))
    || (a.venue && b.venue && key(a.venue) === key(b.venue)));
}

/** Stable regardless of discovery order; repeated titles on different dates/venues survive. */
export function dedupeEvents(events: readonly TechWeekEvent[]): TechWeekEvent[] {
  const quality = (e: TechWeekEvent): number => Number(!e.approx) * 16 + Number(Boolean(e.address)) * 8
    + Number(Boolean(e.end)) * 4 + Number(Boolean(e.host)) * 2 + Number(e.source !== 'tech-week');
  const ordered = [...events].sort((a, b) => quality(b) - quality(a) || a.id.localeCompare(b.id) || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const out: TechWeekEvent[] = [];
  for (const e of ordered) {
    const old = out.find(v => sameEvent(v, e));
    if (!old) { out.push({ ...e, tags: [...e.tags] }); continue; }
    old.host ??= e.host;
    old.end ??= e.end;
    old.venue ??= e.venue;
    old.address ??= e.address;
    old.tags = normalizeTags([...old.tags, ...e.tags]);
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}
