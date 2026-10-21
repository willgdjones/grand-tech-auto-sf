import type { GeocodeMatch, GeocodeQuery, Geocoder } from './types';

/**
 * Keyless OpenStreetMap / Nominatim geocoder for community event submission (gtasf-event-submit-
 * geocoder-ret9). `geocodeEvent` injects this so a pasted venue lands at real coordinates instead
 * of the coarse SF-centre fallback. Results are constrained to the SF playable viewbox; anything
 * unparseable, empty or failed returns null and `geocodeEvent` then uses its coarse fallback.
 *
 * Nominatim's usage policy requires a valid identifying User-Agent, at most ~1 request/second and
 * no heavy bulk use. GTASF submission is low-volume (manual, and rate-limited per gtasf-9wf2) and
 * stays off in production until event submission is enabled, so this keyless default is acceptable
 * for the local playtest; swap to a keyed provider before any high-volume production use.
 */
const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
// SF playable bounding box as a Nominatim viewbox: west,south,east,north (lon/lat).
const SF_VIEWBOX = '-122.5160,37.7025,-122.3482,37.8120';
const TIMEOUT_MS = 5000;
const USER_AGENT = 'GTASF/1.0 (+https://gtasf.com; community event venue geocoding)';

interface NominatimResult { lat?: string; lon?: string; addresstype?: string; category?: string; class?: string; type?: string }

/** Only `address`/`venue` precision make geocodeEvent place an exact pin; coarser kinds fuzz. */
function precisionOf(result: NominatimResult): GeocodeMatch['precision'] {
  const addresstype = (result.addresstype ?? '').toLowerCase();
  if (['amenity', 'building', 'shop', 'office', 'leisure', 'tourism'].includes(addresstype)) return 'venue';
  if (['road', 'house', 'house_number', 'pedestrian', 'residential'].includes(addresstype)) return 'address';
  if (['suburb', 'neighbourhood', 'quarter', 'city_district', 'borough'].includes(addresstype)) return 'neighborhood';
  if (['city', 'town', 'village', 'municipality'].includes(addresstype)) return 'city';
  const category = (result.category ?? result.class ?? '').toLowerCase();
  if (['amenity', 'shop', 'office', 'leisure', 'tourism', 'building'].includes(category)) return 'venue';
  if (category === 'highway') return 'address';
  return 'neighborhood';
}

export interface NominatimOptions {
  /** Injectable for tests; defaults to the global fetch. */
  fetcher?: typeof fetch;
  endpoint?: string;
  userAgent?: string;
  timeoutMs?: number;
}

export function createNominatimGeocoder(options: NominatimOptions = {}): Geocoder {
  const fetcher = options.fetcher ?? fetch;
  const endpoint = options.endpoint ?? ENDPOINT;
  const userAgent = options.userAgent ?? USER_AGENT;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  return async (query: GeocodeQuery): Promise<GeocodeMatch | null> => {
    const place = query.address?.trim() || query.venue?.trim();
    if (!place) return null;
    const q = [place, 'San Francisco', 'California', 'USA'].join(', ');
    const url = new URL(endpoint);
    url.search = new URLSearchParams({
      format: 'jsonv2', limit: '1', addressdetails: '0', countrycodes: 'us', viewbox: SF_VIEWBOX, bounded: '1', q,
    }).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url.toString(), {
        headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: controller.signal,
      });
      if (!response.ok) return null;
      const data: unknown = await response.json();
      if (!Array.isArray(data) || data.length === 0) return null;
      const first = data[0] as NominatimResult;
      const lat = Number(first.lat), lon = Number(first.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon, precision: precisionOf(first) };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
