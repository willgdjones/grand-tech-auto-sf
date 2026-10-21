import { fuzzCentroid, inferNeighborhood, inSanFrancisco, NEIGHBORHOODS, SF_CENTER } from './neighborhoods';
import type { Coordinates, EventCandidate, Geocoder, GeocodeMatch, TechWeekEvent } from './types';

export function cachedGeocoder(geocode: Geocoder): Geocoder {
  const cache = new Map<string, Promise<GeocodeMatch | null>>();
  return query => {
    const key = JSON.stringify([query.address?.trim().toLowerCase(), query.venue?.trim().toLowerCase(), query.city]);
    const found = cache.get(key);
    if (found) return found;
    const result = Promise.resolve().then(() => geocode(query));
    cache.set(key, result);
    void result.catch(() => cache.delete(key));
    return result;
  };
}

/** Never submits hidden locations to a geocoder, even if structured data leaked coordinates. */
export async function geocodeEvent(
  event: TechWeekEvent,
  context: Pick<EventCandidate, 'hidden' | 'virtual' | 'neighborhood'>,
  geocode: Geocoder,
  warn: (message: string) => void = () => {},
): Promise<TechWeekEvent> {
  if (context.virtual) return { ...event, lat: null, lon: null, address: null, approx: true };
  const neighborhood = inferNeighborhood(context.neighborhood ?? '') ?? inferNeighborhood(event.venue ?? '');
  const fallback = (center: Coordinates = (neighborhood ? NEIGHBORHOODS[neighborhood] : undefined) ?? SF_CENTER): TechWeekEvent => ({
    ...event, ...fuzzCentroid(center, event.id), approx: true,
    address: context.hidden ? null : event.address,
    venue: context.hidden ? context.neighborhood ?? neighborhood ?? 'San Francisco (approximate)' : event.venue,
  });
  if (context.hidden) return fallback();
  const coarseLabel = (label: string | null): boolean => {
    if (!label) return true;
    const normalized = label.toLowerCase().replace(/\s*\(sf\)$/, '').trim();
    return Object.hasOwn(NEIGHBORHOODS, normalized) || /^(?:san francisco(?:,?\s*(?:ca|california))?(?:,?\s*(?:usa|us|united states))?|tba|tbd|unknown)$/.test(normalized);
  };
  const coarse = Boolean(event.venue || event.address) && coarseLabel(event.venue) && coarseLabel(event.address);
  if (coarse) return fallback();
  if (event.lat !== null && event.lon !== null) {
    if (inSanFrancisco({ lat: event.lat, lon: event.lon })) return { ...event, approx: false };
    warn('Source coordinates are outside the SF playable bounds');
    return { ...event, lat: null, lon: null, approx: true };
  }
  if (!event.venue && !event.address) { warn('No public venue; using a coarse SF location'); return fallback(); }
  try {
    const match = await geocode({ venue: event.venue, address: event.address, city: 'San Francisco' });
    if (match && !inSanFrancisco(match)) {
      warn('Geocoder result is outside the SF playable bounds');
      return { ...event, lat: null, lon: null, approx: true };
    }
    if (match?.precision === 'address' || match?.precision === 'venue') return { ...event, lat: match.lat, lon: match.lon, approx: false };
    if (match) return fallback(match);
    warn('Venue not found; using a coarse SF location');
  } catch (error) { warn(`Geocoder failed: ${error instanceof Error ? error.message : String(error)}`); }
  return fallback();
}
