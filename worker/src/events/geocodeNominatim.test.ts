import { describe, expect, it } from 'vitest';
import { createNominatimGeocoder } from './geocodeNominatim';

function fakeFetch(body: unknown, init: { ok?: boolean } = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetcher = (async (url: string | URL, options?: RequestInit) => {
    calls.push({ url: String(url), headers: (options?.headers as Record<string, string>) ?? {} });
    return { ok: init.ok ?? true, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const query = (venue: string | null, address: string | null = null) => ({ venue, address, city: 'San Francisco' as const });

describe('createNominatimGeocoder', () => {
  it('geocodes a venue to SF coordinates with venue precision and a bounded SF query', async () => {
    const { fetcher, calls } = fakeFetch([{ lat: '37.7955', lon: '-122.3937', addresstype: 'amenity', category: 'tourism' }]);
    const match = await createNominatimGeocoder({ fetcher })(query('Ferry Building'));
    expect(match).toEqual({ lat: 37.7955, lon: -122.3937, precision: 'venue' });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get('bounded')).toBe('1');
    expect(url.searchParams.get('viewbox')).toContain('-122.5160');
    expect(url.searchParams.get('q')).toContain('Ferry Building');
    expect(url.searchParams.get('q')).toContain('San Francisco');
    expect(calls[0]!.headers['User-Agent']).toContain('GTASF');
  });

  it('prefers address over venue in the query and maps a road to address precision', async () => {
    const { fetcher, calls } = fakeFetch([{ lat: '37.78', lon: '-122.41', addresstype: 'road' }]);
    const match = await createNominatimGeocoder({ fetcher })(query('Somewhere', '1 Market St'));
    expect(match?.precision).toBe('address');
    expect(new URL(calls[0]!.url).searchParams.get('q')).toContain('1 Market St');
  });

  it('maps a suburb result to coarse neighborhood precision', async () => {
    const { fetcher } = fakeFetch([{ lat: '37.76', lon: '-122.43', addresstype: 'suburb' }]);
    expect((await createNominatimGeocoder({ fetcher })(query('Castro')))?.precision).toBe('neighborhood');
  });

  it('returns null (and makes no request) when there is no venue or address', async () => {
    const { fetcher, calls } = fakeFetch([{ lat: '1', lon: '2' }]);
    expect(await createNominatimGeocoder({ fetcher })(query(null, null))).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('returns null on an empty result set', async () => {
    const { fetcher } = fakeFetch([]);
    expect(await createNominatimGeocoder({ fetcher })(query('Nowhere'))).toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    const { fetcher } = fakeFetch([{ lat: '37.7', lon: '-122.4' }], { ok: false });
    expect(await createNominatimGeocoder({ fetcher })(query('Blocked'))).toBeNull();
  });

  it('returns null on unparseable coordinates', async () => {
    const { fetcher } = fakeFetch([{ lat: 'x', lon: 'y', addresstype: 'amenity' }]);
    expect(await createNominatimGeocoder({ fetcher })(query('Bad coords'))).toBeNull();
  });

  it('returns null when the fetch throws', async () => {
    const fetcher = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
    expect(await createNominatimGeocoder({ fetcher })(query('Offline'))).toBeNull();
  });
});
