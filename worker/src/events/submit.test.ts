import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PageFetcher } from './fetch';
import { CrawlFetchError } from './fetch';
import { ingestSubmittedLink } from './submit';
import { listCommunityEvents, listEvents, removeCommunityEvent, storeCommunityEvent, storeEvents } from './store';
import type { TechWeekEvent } from './types';

/** Public JSON-LD Event page, as lu.ma / Partiful expose. */
function lumaPage(opts: { url: string; title?: string; location?: string }): string {
  const location = opts.location ?? JSON.stringify({ '@type': 'Place', name: 'Blue Bottle Coffee',
    address: '66 Mint St, San Francisco, CA 94103', geo: { '@type': 'GeoCoordinates', latitude: 37.782, longitude: -122.407 } });
  const ld = {
    '@context': 'https://schema.org', '@type': 'Event', name: opts.title ?? 'Founders Coffee Meetup',
    startDate: '2026-10-06T17:00:00-07:00', endDate: '2026-10-06T19:00:00-07:00', url: opts.url,
    organizer: { '@type': 'Organization', name: 'SF Founders' }, location: JSON.parse(location),
  };
  return `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>${opts.title ?? 'Founders Coffee Meetup'}</body></html>`;
}

function fetcherFor(pages: Record<string, string>): PageFetcher {
  return { async get(url) {
    const body = pages[url];
    if (body === undefined) throw new CrawlFetchError('HTTP 404', url, 404);
    return { url, body, contentType: 'text/html' };
  } };
}

function memoryDb(): { sqlite: DatabaseSync; db: D1Database } {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of ['0001_initial', '0002_events', '0017_community_events'])
    sqlite.exec(readFileSync(new URL(`../../migrations/${name}.sql`, import.meta.url), 'utf8'));
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let bindings: (string | number | null)[] = [];
      const wrapper = {
        bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
        async all() { return { results: statement.all(...bindings), success: true }; },
        async first() { return statement.get(...bindings) ?? null; },
        async run() { return { meta: statement.run(...bindings), success: true }; },
      };
      return wrapper;
    },
    async batch(statements: { run(): Promise<unknown> }[]) { return Promise.all(statements.map(s => s.run())); },
  } as unknown as D1Database;
  return { sqlite, db };
}

describe('community event submission', () => {
  it('rejects links that are not a supported public provider', async () => {
    expect((await ingestSubmittedLink('https://example.com/party')).reason).toMatch(/lu\.ma, Partiful or Eventbrite/);
    const techWeek = await ingestSubmittedLink('https://www.tech-week.com/calendar/sf/events/x-a9e9ca45-9197-4d27-908f-26a41791dbee');
    expect(techWeek).toMatchObject({ status: 'rejected' });
    expect(techWeek.reason).toMatch(/already on the map/);
  });

  it('extracts, geocodes to SF and flags a pasted lu.ma event as community', async () => {
    const url = 'https://luma.com/foundercoffee';
    const result = await ingestSubmittedLink(url, { fetcher: fetcherFor({ [url]: lumaPage({ url }) }) });
    expect(result.status).toBe('accepted');
    expect(result.event).toMatchObject({ id: 'luma:foundercoffee', source: 'luma', community: true, approx: false });
    expect(result.event!.tags).toContain('community');
    expect(result.event!.lat).toBeCloseTo(37.782, 3);
  });

  it('accepts a pasted Eventbrite event as community (JSON-LD, stable numeric id)', async () => {
    // lumaPage emits provider-agnostic schema.org Event JSON-LD, as Eventbrite exposes.
    const url = 'https://www.eventbrite.com/e/sf-founders-brunch-tickets-9876543210';
    const result = await ingestSubmittedLink(url, { fetcher: fetcherFor({ [url]: lumaPage({ url }) }) });
    expect(result.status).toBe('accepted');
    expect(result.event).toMatchObject({ id: 'eventbrite:9876543210', source: 'eventbrite', community: true, approx: false });
    expect(result.event!.tags).toContain('community');
  });

  it('rejects virtual or out-of-SF events', async () => {
    const url = 'https://luma.com/onlinestandup';
    const page = lumaPage({ url, location: JSON.stringify({ '@type': 'VirtualLocation', url }) });
    const result = await ingestSubmittedLink(url, { fetcher: fetcherFor({ [url]: page }) });
    expect(result.status).toBe('rejected');
    expect(result.reason).toMatch(/virtual|San Francisco/);
  });

  it('surfaces fetch failures with a readable reason', async () => {
    const result = await ingestSubmittedLink('https://luma.com/missing', { fetcher: fetcherFor({}) });
    expect(result.status).toBe('rejected');
    expect(result.reason).toMatch(/Could not open that link/);
  });

  it('honours the Jev review gate', async () => {
    const url = 'https://luma.com/foundercoffee';
    const fetcher = fetcherFor({ [url]: lumaPage({ url }) });
    const blocked = await ingestSubmittedLink(url, { fetcher, review: async () => ({ ok: false, reason: 'flagged as spam' }) });
    expect(blocked).toMatchObject({ status: 'rejected', reason: 'flagged as spam' });
    const passed = await ingestSubmittedLink(url, { fetcher, review: async () => ({ ok: true, reason: null }) });
    expect(passed.status).toBe('accepted');
  });

  it('withholds a submission when review is required but unavailable', async () => {
    const url = 'https://luma.com/foundercoffee';
    const result = await ingestSubmittedLink(url, { fetcher: fetcherFor({ [url]: lumaPage({ url }) }), reviewRequired: true });
    expect(result.status).toBe('rejected');
    expect(result.reason).toMatch(/temporarily unavailable/);
  });

  it('stores, lists and removes a community event without touching official rows', async () => {
    const { sqlite, db } = memoryDb();
    try {
      const url = 'https://luma.com/foundercoffee';
      const result = await ingestSubmittedLink(url, { fetcher: fetcherFor({ [url]: lumaPage({ url }) }) });
      const event = result.event!;

      expect(await storeCommunityEvent(db, event, '2026-10-03T12:00:00Z')).toBe('stored');
      expect(await storeCommunityEvent(db, event, '2026-10-03T13:00:00Z')).toBe('updated');

      const listed = await listEvents(db);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ id: 'luma:foundercoffee', community: true });
      expect(await listCommunityEvents(db)).toHaveLength(1);

      expect(await removeCommunityEvent(db, event.id)).toBe(true);
      expect(await removeCommunityEvent(db, event.id)).toBe(false);
      expect(await listEvents(db)).toHaveLength(0);
    } finally { sqlite.close(); }
  });

  it('reports unchanged when a stale resubmit loses the updated_at guard (derives from meta.changes)', async () => {
    const { sqlite, db } = memoryDb();
    try {
      const url = 'https://luma.com/foundercoffee';
      const event = (await ingestSubmittedLink(url, { fetcher: fetcherFor({ [url]: lumaPage({ url }) }) })).event!;
      expect(await storeCommunityEvent(db, event, '2026-10-03T13:00:00Z')).toBe('stored');
      // An older capture cannot overwrite the newer stored row: the guarded upsert changes nothing.
      expect(await storeCommunityEvent(db, event, '2026-10-03T12:00:00Z')).toBe('unchanged');
      // A newer capture still updates.
      expect(await storeCommunityEvent(db, event, '2026-10-03T14:00:00Z')).toBe('updated');
      expect(await listCommunityEvents(db)).toHaveLength(1);
    } finally { sqlite.close(); }
  });

  it('never overwrites an existing official event with a community submission', async () => {
    const { sqlite, db } = memoryDb();
    try {
      const official: TechWeekEvent = { id: 'luma:foundercoffee', title: 'Official listing', host: 'SF Founders',
        start: '2026-10-06T23:00:00.000Z', end: '2026-10-07T01:00:00.000Z', venue: 'Blue Bottle Coffee',
        address: '66 Mint St, San Francisco, CA 94103', lat: 37.782, lon: -122.407, approx: false,
        url: 'https://luma.com/foundercoffee', source: 'luma', tags: ['networking'] };
      await storeEvents(db, [official], '2026-10-03T12:00:00Z');
      const community: TechWeekEvent = { ...official, title: 'Community override', community: true, tags: ['community'] };
      expect(await storeCommunityEvent(db, community, '2026-10-03T14:00:00Z')).toBe('exists-official');
      expect((await listEvents(db))[0]!.title).toBe('Official listing');
    } finally { sqlite.close(); }
  });
});
