import { decodeEntities, jsonValue, number, object, plainText, string, tags } from './html';
import { inferNeighborhood } from './neighborhoods';
import type { EventCandidate } from './types';
import { canonicalUrl, publicEventUrl, sourceOf } from './urls';

export interface EventLink { url: string; neighborhood?: string }
export interface ParsedPage {
  events: EventCandidate[]; links: EventLink[]; problems: string[];
  /** Only public provider detail pages may reach the optional text extractor. */
  fallback?: { text: string; hidden: boolean };
}
const HIDDEN = /(?:register|rsvp|sign in|log in) to (?:see|view|reveal) (?:the )?(?:exact )?(?:address|location)|(?:address|location) (?:is )?(?:hidden|private|revealed after|shared (?:after|with approved))|(?:venue|location) (?:tba|tbd)|secret (?:venue|location)/i;
const VIRTUAL = /^(?:virtual(?: \(sf\))?|online|zoom|google meet|remote)$/i;

function names(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.map(names).filter(Boolean).join(', ') || undefined;
  return string(value) ?? string(object(value).name);
}

function postal(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const a = object(value);
  return [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, names(a.addressCountry)]
    .filter(v => typeof v === 'string' && v.trim()).join(', ') || undefined;
}

function schemaEvents(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 16 || value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(v => schemaEvents(v, depth + 1));
  const o = object(value);
  const types = Array.isArray(o['@type']) ? o['@type'] : [o['@type']];
  if (types.some(t => typeof t === 'string' && /Event$/.test(t))) return [o];
  return ['@graph', 'itemListElement', 'item', 'mainEntity', 'subEvent'].flatMap(k => schemaEvents(o[k], depth + 1));
}

function fromSchema(o: Record<string, unknown>, pageUrl: string): EventCandidate {
  const loc = object(Array.isArray(o.location) ? o.location[0] : o.location);
  const geo = object(loc.geo);
  const url = publicEventUrl(string(o.url) ?? string(o['@id']) ?? pageUrl, pageUrl) ?? pageUrl;
  const venue = names(o.location);
  const address = postal(loc.address);
  return {
    url: canonicalUrl(url), source: sourceOf(url)!, title: string(o.name), host: names(o.organizer),
    start: string(o.startDate), end: string(o.endDate), timeZone: string(o.timeZone) ?? string(o.timezone),
    venue, address, lat: number(geo.latitude), lon: number(geo.longitude),
    neighborhood: string(loc.neighborhood) ?? inferNeighborhood([venue, address].filter(Boolean).join(' ')),
    virtual: /OnlineEventAttendanceMode$/.test(string(o.eventAttendanceMode) ?? '') || /VirtualLocation$/.test(string(loc['@type']) ?? '') || VIRTUAL.test(venue ?? ''),
    hidden: HIDDEN.test([venue, address].filter(Boolean).join(' ')),
    tags: Array.isArray(o.keywords) ? o.keywords.filter((v): v is string => typeof v === 'string') : string(o.keywords)?.split(/[,;]/),
  };
}

export function discoverEventLinks(html: string, pageUrl: string): EventLink[] {
  const links = new Map<string, EventLink>();
  const contexts = new Map<string, string>();
  for (const row of html.matchAll(/<(tr|article|li)\b[^>]*>([^]*?)<\/\1\s*>/gi)) {
    const neighborhood = inferNeighborhood(plainText(row[2]!));
    if (!neighborhood) continue;
    for (const tag of tags(row[2]!)) {
      const url = tag.attrs.href && publicEventUrl(tag.attrs.href, pageUrl);
      if (url) contexts.set(canonicalUrl(url), neighborhood);
    }
  }
  const add = (value: string): void => {
    const url = publicEventUrl(value, pageUrl);
    if (!url) return;
    const canonical = canonicalUrl(url);
    if (!links.has(canonical)) links.set(canonical, { url, neighborhood: contexts.get(canonical) });
  };
  for (const tag of tags(html)) {
    if ((tag.name === 'a' || (tag.name === 'link' && tag.attrs.rel === 'next')) && tag.attrs.href) add(tag.attrs.href);
    if (tag.name === 'script' && tag.attrs.type?.toLowerCase() === 'application/ld+json') {
      for (const event of schemaEvents(jsonValue(tag.body))) {
        if (typeof event.url === 'string') add(event.url);
        for (const m of (string(event.description) ?? '').matchAll(/https:\/\/(?:lu\.ma|luma\.com|partiful\.com)\/[^\s<>"\\]+/g)) add(m[0].replace(/[.,;)]+$/, ''));
      }
    }
  }
  // Tech Week descriptions sometimes contain a plain-text Luma URL, not an anchor.
  for (const m of plainText(html).matchAll(/https:\/\/(?:lu\.ma|luma\.com|partiful\.com)\/[^\s<>"\\]+/g)) add(m[0].replace(/[.,;)]+$/, ''));
  return [...links.values()];
}

export function parseEventPage(html: string, pageUrl: string): ParsedPage {
  const source = sourceOf(pageUrl);
  if (!source) return { events: [], links: [], problems: ['Unsupported public event URL'] };
  const nodes = tags(html);
  const meta = new Map<string, string>();
  for (const tag of nodes) {
    if (tag.name === 'meta' && tag.attrs.content) {
      const name = tag.attrs.property ?? tag.attrs.name ?? tag.attrs.itemprop;
      if (name) meta.set(name.toLowerCase(), tag.attrs.content);
    }
    if (tag.name === 'time' && tag.attrs.datetime && tag.attrs.itemprop) meta.set(tag.attrs.itemprop.toLowerCase(), tag.attrs.datetime);
  }
  const visible = plainText(html);
  const hidden = HIDDEN.test(visible);
  const isIndex = source === 'tech-week' && !new URL(pageUrl).pathname.includes('/events/');
  const problems: string[] = [];
  const events: EventCandidate[] = [];
  let cancelled = false;
  for (const tag of nodes) {
    if (tag.name !== 'script') continue;
    if (tag.attrs.type?.toLowerCase() === 'application/ld+json') {
      const data = jsonValue(tag.body);
      if (!data) { problems.push('Malformed JSON-LD'); continue; }
      for (const event of schemaEvents(data)) {
        if (/EventCancelled$/.test(string(event.eventStatus) ?? '')) { cancelled = true; continue; }
        events.push(fromSchema(event, pageUrl));
      }
    }
    if (source === 'partiful' && tag.attrs.id === '__NEXT_DATA__') {
      const props = object(object(object(jsonValue(tag.body)).props).pageProps);
      if (props.passwordRequired === true) return { events: [], links: [], problems: ['Event requires a password'] };
      const e = object(props.event);
      if (e.isPublic === false || e.visibility === 'private') return { events: [], links: [], problems: ['Event is not public'] };
      if (/cancelled|canceled|deleted/i.test(string(e.status) ?? '')) return { events: [], links: [], problems: ['Event is cancelled or deleted'] };
      if (!e.title) continue;
      const info = object(e.locationInfo);
      events.push({
        url: canonicalUrl(pageUrl), source, title: string(e.title),
        start: string(e.startDate), end: string(e.endDate), timeZone: string(e.timezone),
        venue: string(e.location), address: string(info.address),
        neighborhood: string(e.neighborhood), host: names(props.hosts),
        hidden: info.type === 'hidden' || e.hideLocationUntilRsvp === true,
        virtual: info.type === 'virtual' || VIRTUAL.test(string(e.location) ?? ''),
      });
    }
  }
  if (!isIndex && cancelled) return { events: [], links: [], problems: ['Event is cancelled'] };
  if (!isIndex && events.length === 0 && meta.get('og:title')) {
    const venue = meta.get('event:location') ?? meta.get('og:location') ?? meta.get('location');
    events.push({
      url: canonicalUrl(pageUrl), source, title: meta.get('og:title')?.replace(/\s*[|·]\s*(?:Partiful|Luma)\s*$/i, ''),
      host: meta.get('event:organizer') ?? meta.get('author'),
      start: meta.get('event:start_time') ?? meta.get('og:start_time') ?? meta.get('startdate'),
      end: meta.get('event:end_time') ?? meta.get('og:end_time') ?? meta.get('enddate'),
      timeZone: meta.get('event:timezone'), venue, address: meta.get('event:address'),
      lat: number(meta.get('place:location:latitude')), lon: number(meta.get('place:location:longitude')),
      neighborhood: meta.get('event:neighborhood'),
      hidden: HIDDEN.test(meta.get('og:description') ?? '') || hidden,
      virtual: VIRTUAL.test(venue ?? ''),
    });
  }
  // A visible registration gate overrides even an accidentally exposed structured address.
  for (const event of events) {
    event.title = event.title && decodeEntities(event.title);
    if (!isIndex && hidden) event.hidden = true;
    if (event.hidden) { event.address = undefined; event.lat = undefined; event.lon = undefined; }
  }
  return {
    events, links: source === 'tech-week' ? discoverEventLinks(html, pageUrl) : [], problems,
    ...(source !== 'tech-week' ? { fallback: {
      text: [meta.get('og:title'), meta.get('og:description'), visible].filter(Boolean).join('\n').slice(0, 16_000),
      hidden: hidden || events.some(e => e.hidden === true),
    } } : {}),
  };
}
