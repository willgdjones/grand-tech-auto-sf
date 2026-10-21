import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { crawlTechWeek } from './crawler';
import { createPoliteFetcher, retryAfterMs } from './fetch';
import type { FetchOptions } from './fetch';
import { cachedGeocoder, geocodeEvent } from './geocode';
import { dedupeEvents, normalizeEvent } from './normalize';
import { fuzzCentroid, NEIGHBORHOODS } from './neighborhoods';
import { discoverEventLinks, parseEventPage } from './parse';
import { parseRobots, robotsAllows } from './robots';
import { toInstant } from './time';
import type { EventCandidate, GeocodeMatch, TechWeekEvent } from './types';
import { canonicalUrl, SF_CALENDAR, sourceOf } from './urls';

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
interface Reply { body?: string; status?: number; headers?: Record<string, string> }
function harness(routes: Record<string, Reply | Reply[]>, extra: FetchOptions = {}) {
  let clock = 0;
  const calls: { url: string; at: number; init: RequestInit }[] = [];
  const sleep = vi.fn(async (ms: number) => { clock += ms; });
  const transport = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, at: clock, init });
    const route = routes[url];
    if (!route) throw new Error(`Unexpected request (live network is forbidden): ${url}`);
    const reply = Array.isArray(route) ? (route.length > 1 ? route.shift()! : route[0]!) : route;
    return new Response(reply.body ?? '', { status: reply.status ?? 200, headers: { 'content-type': url.endsWith('/robots.txt') ? 'text/plain' : 'text/html', ...reply.headers } });
  });
  return { calls, sleep, transport, options: { now: () => clock, sleep, fetch: transport, maxRetries: 1, ...extra } satisfies FetchOptions };
}
const lumaRobots = 'https://luma.com/robots.txt';
const candidate = (extra: Partial<EventCandidate> = {}): EventCandidate => ({
  title: 'Builders & Bagels', host: 'GTASF Community', start: '2026-10-05T08:00:00-07:00',
  url: 'https://luma.com/builders', source: 'luma', ...extra,
});
const event = (extra: Partial<TechWeekEvent> = {}): TechWeekEvent => ({ ...normalizeEvent(candidate())!, ...extra });

describe('public page fixtures', () => {
  it('extracts Luma Event JSON-LD from @graph, retaining only the event fields', () => {
    const parsed = parseEventPage(fixture('luma.html'), 'https://luma.com/builders');
    const e = normalizeEvent(parsed.events[0]!);
    expect(e).toMatchObject({ title: 'Builders & Bagels #SFTechWeek', host: 'GTASF Community', start: '2026-10-05T15:00:00.000Z', end: '2026-10-05T17:00:00.000Z', address: '625 2nd Street, San Francisco, CA, 94107, US', source: 'luma', tags: ['ai', 'networking'] });
    expect(parsed.links).toEqual([]); // Do not crawl a provider's unrelated recommendations.
    expect(e).not.toHaveProperty('description');
  });

  it('parses Partiful OG attributes in either order/quote style and hydrates missing fields', () => {
    const og = parseEventPage(fixture('partiful-og.html'), 'https://partiful.com/e/bagels');
    expect(normalizeEvent(og.events[0]!)).toMatchObject({ title: 'Builders & Bagels #SFTechWeek', start: '2026-10-05T15:00:00.000Z', end: '2026-10-05T17:00:00.000Z' });
    const hydrated = parseEventPage(fixture('partiful-hydrated.html'), 'https://partiful.com/e/workshop');
    expect(normalizeEvent(hydrated.events[0]!)).toMatchObject({ title: 'Public Workshop', host: 'GTASF', venue: 'Community Hall', start: '2026-10-06T22:00:00.000Z' });
    expect(JSON.stringify(hydrated.events)).not.toContain('Do not collect');
  });

  it('does not guess time from a title or description when OG has no timestamps', () => {
    const p = parseEventPage(fixture('partiful-og-only.html'), 'https://partiful.com/e/og-only');
    expect(p.events[0]?.title).toBe('Workshop');
    expect(normalizeEvent(p.events[0]!)).toBeNull();
    const broken = parseEventPage(fixture('missing-date.html'), 'https://luma.com/missing-date');
    expect(broken.problems).toContain('Malformed JSON-LD');
    expect(normalizeEvent(broken.events[0]!)).toBeNull();
  });

  it('follows only supported public SF links and associates row neighborhoods', () => {
    const links = discoverEventLinks(fixture('calendar.html'), SF_CALENDAR);
    expect(links.find(l => l.url.includes('/hidden'))?.neighborhood).toBe('north beach');
    expect(links.filter(l => l.url.includes('/builders'))).toHaveLength(1);
    expect(links.some(l => l.url.endsWith('?page=2'))).toBe(true);
    expect(links.every(l => sourceOf(l.url))).toBe(true);
    expect(links.some(l => /example\.com|evil|password|calendar\/la|\/u\//.test(l.url))).toBe(false);
    expect(canonicalUrl('https://lu.ma/builders?utm_campaign=x#fragment')).toBe('https://luma.com/builders');
  });

  it('suppresses private/password-protected Partiful pages', () => {
    const privateHtml = fixture('partiful-hydrated.html').replace('"passwordRequired":false', '"passwordRequired":true');
    expect(parseEventPage(privateHtml, 'https://partiful.com/e/workshop').events).toEqual([]);
  });

  it('does not resurrect a cancelled JSON-LD event from OG fallback metadata', () => {
    const html = fixture('partiful-og.html').replace('</head>', '<script type="application/ld+json">{"@type":"Event","name":"Cancelled breakfast","eventStatus":"https://schema.org/EventCancelled"}</script></head>');
    expect(parseEventPage(html, 'https://partiful.com/e/bagels')).toMatchObject({ events: [], problems: ['Event is cancelled'] });
    const hydrated = html + fixture('partiful-hydrated.html');
    expect(parseEventPage(hydrated, 'https://partiful.com/e/workshop').events).toEqual([]);
  });
});

describe('normalization and public geocoding', () => {
  it('handles SF offsets, midnight and milliseconds independently of machine timezone', () => {
    expect(toInstant('2026-10-05T08:00:00')).toBe('2026-10-05T15:00:00.000Z');
    expect(toInstant('2026-10-05T00:00:00.123')).toBe('2026-10-05T07:00:00.123Z');
    expect(toInstant('2026-10-05T15:00:00Z')).toBe('2026-10-05T15:00:00.000Z');
    expect(toInstant('2026-12-05T08:00:00')).toBe('2026-12-05T16:00:00.000Z');
  });

  it.each(['2026-10-05', '2026-02-30T12:00:00Z', '2026-10-05T25:00:00Z', '2026-03-08T02:30:00', '2026-11-01T01:30:00', 'not a date'])('rejects incomplete/invalid/ambiguous dates: %s', input => {
    expect(toInstant(input)).toBeNull();
  });

  it('validates start/end and leaves absent end/coordinates null', () => {
    expect(normalizeEvent(candidate({ end: '2026-10-05T07:00:00-07:00' }))).toBeNull();
    expect(normalizeEvent(candidate({ timeZone: 'invalid/timezone', start: '2026-10-05T08:00:00' }))).toBeNull();
    expect(normalizeEvent(candidate())).toMatchObject({ end: null, lat: null, lon: null, approx: true });
  });

  it('never geocodes hidden addresses; deterministic fuzz uses the public neighborhood', async () => {
    const raw = parseEventPage(fixture('hidden.html'), 'https://luma.com/hidden').events[0]!;
    expect(raw).toMatchObject({ hidden: true, address: undefined, lat: undefined, lon: undefined });
    const lookup = vi.fn(async () => ({ lat: 37.8, lon: -122.4, precision: 'address' as const }));
    const resolved = await geocodeEvent(normalizeEvent(raw)!, { ...raw, neighborhood: 'North Beach' }, lookup);
    expect(lookup).not.toHaveBeenCalled();
    expect(resolved).toMatchObject({ address: null, venue: 'North Beach', approx: true });
    expect(resolved).toMatchObject(fuzzCentroid(NEIGHBORHOODS['north beach']!, resolved.id));
    expect(JSON.stringify(resolved)).not.toMatch(/Private Building|Never Publish/);
    const center = NEIGHBORHOODS['north beach']!;
    const distance = Math.hypot((resolved.lat! - center.lat) * 111_320, (resolved.lon! - center.lon) * 111_320 * Math.cos(center.lat * Math.PI / 180));
    expect(distance).toBeGreaterThanOrEqual(80);
    expect(distance).toBeLessThanOrEqual(180);
  });

  it('caches public lookups and never substitutes a city point for a precise venue', async () => {
    const lookup = vi.fn(async () => ({ lat: 37.7749, lon: -122.4194, precision: 'city' as const }));
    const cached = cachedGeocoder(lookup);
    const venue = event({ venue: 'Community Hall' });
    const a = await geocodeEvent(venue, {}, cached);
    await geocodeEvent({ ...venue, id: 'other' }, {}, cached);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(a.approx).toBe(true);
    expect(a.lat).not.toBe(37.7749);
  });

  it('recognizes city-only source coordinates as approximate without a provider lookup', async () => {
    const lookup = vi.fn();
    const located = await geocodeEvent(event({ venue: 'San Francisco', address: 'San Francisco, CA, USA', lat: 37.7749, lon: -122.4194, approx: false }), {}, lookup);
    expect(located.approx).toBe(true);
    expect(located.lat).not.toBe(37.7749);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('reports failed/out-of-city geocoding and gives virtual events no physical marker', async () => {
    const warn = vi.fn();
    const fail = await geocodeEvent(event({ venue: 'Hall' }), { neighborhood: 'SOMA' }, async () => { throw new Error('offline'); }, warn);
    expect(fail.approx).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('offline'));
    const outside = await geocodeEvent(event({ venue: 'Menlo Park venue' }), {}, async () => ({ lat: 37.45, lon: -122.18, precision: 'venue' }), warn);
    expect(outside).toMatchObject({ lat: null, lon: null, approx: true });
    const lookup = vi.fn();
    expect(await geocodeEvent(event(), { virtual: true }, lookup)).toMatchObject({ lat: null, lon: null });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('dedupes provider mirrors deterministically, preserving distinct dates/addresses', () => {
    const a = event({ venue: 'Demo Loft', address: '625 2nd Street', tags: ['ai'] });
    const b = { ...a, id: 'partiful:e/bagels', source: 'partiful' as const, url: 'https://partiful.com/e/bagels', title: 'Builders & Bagels #SFTechWeek', tags: ['networking'] };
    const nextDay = { ...a, id: 'luma:next', url: 'https://luma.com/next', start: '2026-10-06T15:00:00.000Z' };
    const elsewhere = { ...b, id: 'partiful:e/other', url: 'https://partiful.com/e/other', address: '100 Another Street' };
    const result = dedupeEvents([a, b, nextDay, elsewhere]);
    expect(result).toHaveLength(3);
    expect(result).toEqual(dedupeEvents([elsewhere, nextDay, b, a]));
    expect(result.find(e => e.id === a.id)?.tags).toEqual(['ai', 'networking']);
    expect(a.tags).toEqual(['ai']);
  });
});

describe('robots and polite transport', () => {
  it.each(['https://eventbrite.com', 'https://www.eventbrite.com'])('fetches supported Eventbrite pages after checking robots at %s', async origin => {
    const url = `${origin}/e/sf-founders-tickets-1234567890`;
    const rig = harness({ [`${origin}/robots.txt`]: { body: 'User-agent: *\nAllow: /e/' }, [url]: { body: '<h1>SF founders</h1>' } });
    await expect(createPoliteFetcher(rig.options).get(url)).resolves.toMatchObject({ url, body: '<h1>SF founders</h1>' });
    expect(rig.calls.map(call => call.url)).toEqual([`${origin}/robots.txt`, url]);
    expect(rig.calls[1]!.at - rig.calls[0]!.at).toBeGreaterThanOrEqual(1000);
  });

  it('follows Eventbrite bare-host to www redirects for robots and public event pages', async () => {
    const url = 'https://eventbrite.com/e/1234567890', destination = 'https://www.eventbrite.com/e/1234567890';
    const rig = harness({
      'https://eventbrite.com/robots.txt': { status: 301, headers: { location: 'https://www.eventbrite.com/robots.txt' } },
      'https://www.eventbrite.com/robots.txt': { body: 'User-agent: *\nAllow: /e/' },
      [url]: { status: 301, headers: { location: destination } },
      [destination]: { body: '<h1>Public event</h1>' },
    });
    await expect(createPoliteFetcher(rig.options).get(url)).resolves.toMatchObject({ url: destination });
    expect(rig.calls.at(-1)?.url).toBe(destination);
  });

  it('still refuses Eventbrite pages disallowed by robots without fetching them', async () => {
    const robots = 'https://www.eventbrite.com/robots.txt';
    const rig = harness({ [robots]: { body: 'User-agent: *\nDisallow: /e/' } });
    await expect(createPoliteFetcher(rig.options).get('https://www.eventbrite.com/e/1234567890')).rejects.toThrow('disallows');
    expect(rig.calls.map(call => call.url)).toEqual([robots]);
  });

  it('refuses an Eventbrite robots redirect to an unapproved host before requesting it', async () => {
    const robots = 'https://eventbrite.com/robots.txt';
    const rig = harness({ [robots]: { status: 302, headers: { location: 'https://eventbrite.com.evil.example/robots.txt' } } });
    await expect(createPoliteFetcher(rig.options).get('https://eventbrite.com/e/1234567890')).rejects.toThrow('Unsafe robots.txt redirect');
    expect(rig.calls.map(call => call.url)).toEqual([robots]);
  });

  it('selects the most specific agent, merges groups, and uses longest rules with Allow ties', () => {
    const p = parseRobots('User-agent: *\nDisallow: /\nUser-agent: GTASF\nDisallow: /private\nAllow: /private/public\nCrawl-delay: 3\nUser-agent: GTASF\nDisallow: /*?secret=*\nAllow: /same$\nDisallow: /same$', 'GTASFEvents');
    expect(p.crawlDelayMs).toBe(3000);
    expect(robotsAllows(p, 'https://luma.com/builders')).toBe(true);
    expect(robotsAllows(p, 'https://luma.com/private')).toBe(false);
    expect(robotsAllows(p, 'https://luma.com/private/public')).toBe(true);
    expect(robotsAllows(p, 'https://luma.com/x?secret=yes')).toBe(false);
    expect(robotsAllows(p, 'https://luma.com/same')).toBe(true);
    expect(robotsAllows(parseRobots(fixture('robots-luma.txt')), 'https://luma.com/builders')).toBe(true);
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow: /a%62\nDisallow: /café'), 'https://luma.com/ab')).toBe(false);
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow: /café'), 'https://luma.com/caf%C3%A9')).toBe(false);
  });

  it('serializes concurrent calls, honors crawl-delay, and caches pages and robots', async () => {
    const rig = harness({ [lumaRobots]: { body: 'User-agent: *\nCrawl-delay: 2' }, 'https://luma.com/one': { body: '<h1>One</h1>' }, 'https://luma.com/two': { body: '<h1>Two</h1>' } });
    const client = createPoliteFetcher(rig.options);
    await Promise.all([client.get('https://luma.com/one'), client.get('https://luma.com/two')]);
    await client.get('https://luma.com/one');
    expect(rig.calls.map(c => c.at)).toEqual([0, 2000, 4000]);
    expect(rig.calls.every(c => c.init.redirect === 'manual' && c.init.credentials === 'omit')).toBe(true);
    expect(new Headers(rig.calls[0]?.init.headers).get('user-agent')).toContain('GTASFEvents');
  });

  it('checks the destination robots policy before following a cross-origin redirect', async () => {
    const rig = harness({ [lumaRobots]: { body: 'User-agent: *\nAllow: /' }, 'https://luma.com/one': { status: 302, headers: { location: 'https://partiful.com/e/robots-blocked' } }, 'https://partiful.com/robots.txt': { body: fixture('robots-partiful.txt') } });
    await expect(createPoliteFetcher(rig.options).get('https://luma.com/one')).rejects.toThrow('disallows');
    expect(rig.calls.map(c => c.url)).not.toContain('https://partiful.com/e/robots-blocked');
  });

  it.each([403, 429, 503])('fails closed when robots is unavailable (%s)', async status => {
    const rig = harness({ [lumaRobots]: { status } }, { maxRetries: 0 });
    await expect(createPoliteFetcher(rig.options).get('https://luma.com/one')).rejects.toThrow('robots.txt unavailable');
    expect(rig.calls).toHaveLength(1);
  });

  it('treats a missing robots file as no rules and retries 429 only after Retry-After', async () => {
    const rig = harness({ [lumaRobots]: { status: 404 }, 'https://luma.com/one': [{ status: 429, headers: { 'retry-after': '5' } }, { body: '<h1>One</h1>' }] });
    await createPoliteFetcher(rig.options).get('https://luma.com/one');
    expect(rig.calls.map(c => c.at)).toEqual([0, 1000, 6000]);
    expect(retryAfterMs('Thu, 01 Jan 1970 00:00:05 GMT', 1000)).toBe(4000);
  });

  it('does not cap a long Retry-After and hit the server early', async () => {
    const rig = harness({ [lumaRobots]: { body: '' }, 'https://luma.com/one': { status: 429, headers: { 'retry-after': '3600' } } });
    const client = createPoliteFetcher(rig.options);
    await expect(client.get('https://luma.com/one')).rejects.toThrow('HTTP 429');
    await expect(client.get('https://luma.com/one')).rejects.toThrow('cooling down');
    expect(rig.calls).toHaveLength(2);
  });

  it('rejects out-of-scope redirects and oversized streamed responses', async () => {
    const rig = harness({ [lumaRobots]: { body: '' }, 'https://luma.com/one': { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }, 'https://luma.com/big': { body: 'a'.repeat(101) } }, { maxBytes: 100 });
    const client = createPoliteFetcher(rig.options);
    await expect(client.get('https://luma.com/one')).rejects.toThrow('outside public event sources');
    await expect(client.get('https://luma.com/big')).rejects.toThrow('byte limit');
    expect(rig.calls.some(c => c.url.includes('169.254'))).toBe(false);
  });
});

function crawlHarness() {
  const rig = harness({
    'https://www.tech-week.com/robots.txt': { body: fixture('robots-tech-week.txt') },
    'https://lu.ma/robots.txt': { status: 302, headers: { location: lumaRobots } },
    [lumaRobots]: { body: fixture('robots-luma.txt') },
    'https://partiful.com/robots.txt': { body: fixture('robots-partiful.txt') },
    [SF_CALENDAR]: { body: fixture('calendar.html') },
    [`${SF_CALENDAR}?page=2`]: { body: fixture('calendar-page-2.html') },
    'https://lu.ma/builders?utm_source=techweek': { status: 302, headers: { location: 'https://luma.com/builders' } },
    'https://luma.com/builders': { body: fixture('luma.html') },
    'https://luma.com/hidden': { body: fixture('hidden.html') },
    'https://www.tech-week.com/go/event/public-bagels': { status: 302, headers: { location: 'https://partiful.com/e/bagels' } },
    'https://partiful.com/e/bagels': { body: fixture('partiful-og.html') },
    'https://www.tech-week.com/calendar/sf/events/og-workshop-79a58346-8a61-45f8-84ce-cb86b877a7eb': { body: fixture('official-detail.html') },
    'https://partiful.com/e/og-only': { body: fixture('partiful-og-only.html') },
    'https://luma.com/missing-date': { body: fixture('missing-date.html') },
  });
  const points = JSON.parse(fixture('geocodes.json')) as Record<string, GeocodeMatch>;
  const geocode = vi.fn(async ({ address }: { address: string | null }) => address ? points[address] ?? null : null);
  return { ...rig, geocode };
}

describe('fixture-only crawl integration', () => {
  it('preserves inherited location restrictions across provider metadata and extraction', async () => {
    const officialUrl = 'https://www.tech-week.com/calendar/sf/events/og-workshop-79a58346-8a61-45f8-84ce-cb86b877a7eb';
    const providerUrl = 'https://partiful.com/e/restricted';
    for (const mode of ['hidden', 'hidden-extracted', 'virtual']) {
      const needsExtraction = mode === 'hidden-extracted';
      const schema = {
        '@type': 'Event', name: 'Restricted workshop', url: officialUrl,
        startDate: needsExtraction ? undefined : '2026-10-06T15:00:00-07:00',
        organizer: { name: 'GTASF' },
        location: { '@type': 'Place', name: mode === 'virtual' ? 'Online' : 'North Beach' },
      };
      const rig = harness({
        'https://www.tech-week.com/robots.txt': { body: 'User-agent: *\nAllow: /' },
        'https://partiful.com/robots.txt': { body: 'User-agent: *\nAllow: /' },
        [SF_CALENDAR]: { body: `<a href="${officialUrl}">Workshop</a>` },
        [officialUrl]: { body: `<script type="application/ld+json">${JSON.stringify(schema)}</script><p>${mode === 'virtual' ? 'Online event' : 'Register to see location'}</p><a href="${providerUrl}">RSVP</a>` },
        [providerUrl]: { body: '<meta property="og:title" content="Restricted workshop"><meta property="event:location" content="Private Building"><meta property="event:address" content="Never Publish Street">' },
      });
      const geocode = vi.fn(async () => ({ lat: 37.8, lon: -122.4, precision: 'address' as const }));
      const extractEvent = vi.fn(async (_input: { hidden: boolean }) => ({
        url: providerUrl, source: 'partiful' as const, title: 'Restricted workshop', start: '2026-10-06T15:00:00-07:00',
        address: 'Never Publish Street', hidden: false,
      }));
      const result = await crawlTechWeek({ enabled: true, fetchOptions: rig.options, geocode, extractEvent });
      expect(result.events.length).toBeGreaterThan(0);
      expect(geocode).not.toHaveBeenCalled();
      expect(result.events.every(event => event.address === null && event.approx)).toBe(true);
      if (mode === 'virtual') expect(result.events.every(event => event.lat === null && event.lon === null)).toBe(true);
      else expect(JSON.stringify(result.events)).not.toMatch(/Private Building|Never Publish/);
      if (needsExtraction) expect(extractEvent).toHaveBeenCalledWith(expect.objectContaining({ hidden: true }));
      else expect(extractEvent).not.toHaveBeenCalled();
    }
  });

  it('follows calendar pagination/redirects, geocodes, fuzzes, dedupes, and injects tagging', async () => {
    const rig = crawlHarness();
    const tag = vi.fn(async () => ({ spam: false, tags: ['community'] }));
    const result = await crawlTechWeek({ enabled: true, fetchOptions: rig.options, geocode: rig.geocode, tagEvent: tag });
    expect(result.events).toHaveLength(3);
    expect(result.truncated).toBe(false);
    expect(result.events.map(e => e.title)).toEqual(['Builders & Bagels #SFTechWeek', 'Founders Dinner', 'Workshop']);
    expect(result.events[0]).toMatchObject({ start: '2026-10-05T15:00:00.000Z', lat: 37.7818, lon: -122.3939, approx: false, tags: ['ai', 'community', 'networking'] });
    expect(result.events[1]).toMatchObject({ approx: true, address: null, venue: 'north beach' });
    expect(result.events[2]).toMatchObject({ host: 'GTASF', start: '2026-10-06T22:00:00.000Z', lat: 37.7767, approx: false });
    expect(rig.geocode).toHaveBeenCalledTimes(2);
    expect(tag).toHaveBeenCalledTimes(3);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: 'https://partiful.com/e/robots-blocked', stage: 'fetch', message: expect.stringContaining('disallows') }),
      expect.objectContaining({ url: 'https://luma.com/missing-date', stage: 'parse' }),
    ]));
    expect(rig.calls.some(c => /unrelated|evil|robots-blocked/.test(c.url))).toBe(false);
  });

  it('stays off with the shared flag and reports bounded/partial crawls', async () => {
    const rig = crawlHarness();
    expect((await crawlTechWeek({ fetchOptions: rig.options, geocode: rig.geocode })).enabled).toBe(false);
    expect(rig.calls).toHaveLength(0);
    const limited = await crawlTechWeek({ enabled: true, maxPages: 1, fetchOptions: rig.options, geocode: rig.geocode });
    expect(limited.truncated).toBe(true);
    expect(limited.pagesFetched).toBe(1);
  });

  it('drops spam and quarantines classification failures without losing other events', async () => {
    const rig = crawlHarness();
    const result = await crawlTechWeek({ enabled: true, fetchOptions: rig.options, geocode: rig.geocode, tagEvent: async e => {
      if (e.title === 'Workshop') throw new Error('Jev unavailable');
      return { spam: e.title === 'Founders Dinner', tags: ['approved'] };
    } });
    expect(result.events).toHaveLength(1);
    expect(result.issues).toContainEqual(expect.objectContaining({ stage: 'tag', message: 'Jev unavailable' }));
  });
});
