import type { EventSource } from './types';

export const SF_CALENDAR = 'https://www.tech-week.com/calendar/sf';
const RESERVED_LUMA = new Set(['signin', 'sign-in', 'login', 'register', 'discover', 'pricing', 'create', 'home', 'settings', 'api', 'sftw']);

/** Exact host/path allowlist also applies to every HTTP redirect. */
export function sourceOf(url: string): EventSource | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (u.hostname === 'tech-week.com' || u.hostname === 'www.tech-week.com') {
    return /^\/calendar\/sf(?:\/?|\/events\/[^/]+\/?|\/tracks\/[^/]+\/?)$/.test(u.pathname)
      || /^\/go\/event\/[^/]+\/?$/.test(u.pathname) ? 'tech-week' : null;
  }
  if (u.hostname === 'lu.ma' || u.hostname === 'luma.com' || u.hostname === 'www.luma.com') {
    const slug = u.pathname.replace(/^\//, '').replace(/\/$/, '');
    return /^[a-zA-Z0-9_-]+$/.test(slug) && !RESERVED_LUMA.has(slug.toLowerCase()) ? 'luma' : null;
  }
  if (u.hostname === 'partiful.com' || u.hostname === 'www.partiful.com') {
    return /^\/e\/[a-zA-Z0-9_-]+\/?$/.test(u.pathname) ? 'partiful' : null;
  }
  if (u.hostname === 'eventbrite.com' || u.hostname === 'www.eventbrite.com') {
    // Eventbrite event pages: /e/<title-slug>-<numericId> or /e/<numericId>. The trailing id is stable.
    return /^\/e\/(?:[a-zA-Z0-9-]+-)?\d{6,}\/?$/.test(u.pathname) ? 'eventbrite' : null;
  }
  return null;
}

export function publicEventUrl(value: string, base = SF_CALENDAR): string | null {
  try {
    const u = new URL(value, base);
    if (!sourceOf(u.href)) return null;
    u.hash = '';
    return u.href;
  } catch { return null; }
}

/** Keeps calendar pagination, but strips provider tracking and invitation tokens. */
export function canonicalUrl(value: string): string {
  const u = new URL(value);
  if (u.hostname === 'lu.ma' || u.hostname === 'www.luma.com') u.hostname = 'luma.com';
  if (u.hostname === 'tech-week.com') u.hostname = 'www.tech-week.com';
  if (u.hostname === 'www.partiful.com') u.hostname = 'partiful.com';
  if (u.hostname === 'www.eventbrite.com') u.hostname = 'eventbrite.com';
  u.hash = '';
  if (u.pathname === '/calendar/sf' || u.pathname === '/calendar/sf/') {
    const keep = new URLSearchParams();
    for (const key of ['page', 'cursor', 'date']) {
      const v = u.searchParams.get(key);
      if (v) keep.set(key, v);
    }
    u.search = keep.toString();
  } else u.search = '';
  u.pathname = u.pathname.replace(/\/$/, '');
  return u.href;
}

export function eventId(url: string): string {
  const canonical = canonicalUrl(url);
  const u = new URL(canonical);
  const source = sourceOf(canonical);
  // Eventbrite's stable id is the trailing numeric, independent of the (changeable) title slug.
  if (source === 'eventbrite') return `eventbrite:${u.pathname.match(/(\d{6,})\/?$/)?.[1] ?? u.pathname.replace(/^\//, '')}`;
  const uuid = u.pathname.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i)?.[0];
  return `${source}:${uuid ?? u.pathname.replace(/^\//, '')}`;
}
