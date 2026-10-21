/** Small public rendering feed; source measurements remain separate from art-directed fog. */
export interface CityWeather {
  version: 1;
  status: 'live' | 'stale' | 'fallback';
  fetchedAt: number;
  expiresAt: number;
  observedAt: number | null;
  forecastAt: number | null;
  description: string;
  cloudCover: number;
  fog: number;
  /** Art-directed precipitation intensity 0..1 (derived from NWS text), separate from the fog scalar. */
  rain: number;
  visibilityM: number | null;
  sources: { forecast: string | null; observation: string | null };
}
export const WEATHER_FRESH_MS = 15 * 60_000;
export const WEATHER_STALE_MS = 2 * 60 * 60_000;
export function fallbackWeather(now: number): CityWeather {
  return { version: 1, status: 'fallback', fetchedAt: now, expiresAt: now + 60_000,
    observedAt: null, forecastAt: null, description: 'Time-of-day atmosphere', cloudCover: .35, fog: 0,
    rain: 0, visibilityM: null, sources: { forecast: null, observation: null } };
}
export function isCityWeather(value: unknown): value is CityWeather {
  const data = value as CityWeather;
  return Boolean(data && data.version === 1 && ['live', 'stale', 'fallback'].includes(data.status)
    && Number.isFinite(data.fetchedAt) && Number.isFinite(data.expiresAt) && data.expiresAt >= data.fetchedAt
    && (data.observedAt === null || Number.isFinite(data.observedAt)) && (data.forecastAt === null || Number.isFinite(data.forecastAt))
    && typeof data.description === 'string' && data.description.length <= 180
    && Number.isFinite(data.cloudCover) && data.cloudCover >= 0 && data.cloudCover <= 1
    && Number.isFinite(data.fog) && data.fog >= 0 && data.fog <= 1
    && Number.isFinite(data.rain) && data.rain >= 0 && data.rain <= 1
    && (data.visibilityM === null || Number.isFinite(data.visibilityM) && data.visibilityM >= 0 && data.visibilityM <= 200_000)
    && data.sources && [data.sources.forecast, data.sources.observation].every(url => url === null || typeof url === 'string' && /^https:\/\/api\.weather\.gov\//.test(url)));
}
