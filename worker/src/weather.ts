import { flags } from '@gtasf/shared/flags';
import { fallbackWeather, isCityWeather, WEATHER_FRESH_MS, WEATHER_STALE_MS, type CityWeather } from '@gtasf/shared/weather';

const POINT = 'https://api.weather.gov/points/37.7842,-122.4078';
const OBSERVATION = 'https://api.weather.gov/stations/KSFO/observations/latest';
const headers = { Accept: 'application/geo+json', 'User-Agent': 'GTASF/0.1 (https://gtasf.com)' };
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value !== null && typeof value === 'object' ? value as Json : {};
const timestamp = (value: unknown) => typeof value === 'string' ? Date.parse(value) : NaN;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
function description(value: unknown): string { return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').slice(0, 160) : ''; }
function textWeather(text: string) {
  const cloud = /overcast|cloudy|rain|fog|drizzle|snow/i.test(text) ? /partly|mostly sunny/i.test(text) ? .45 : /mostly cloudy/i.test(text) ? .8 : 1 : /partly/i.test(text) ? .4 : /clear|sunny/i.test(text) ? .05 : .35;
  const fog = /fog/i.test(text) ? .8 : /mist/i.test(text) ? .5 : /haze/i.test(text) ? .28 : /drizzle/i.test(text) ? .18 : /rain/i.test(text) ? .1 : 0;
  // Precipitation intensity, checked heavy -> light -> generic so "light rain" doesn't read as full rain.
  const rain = /thunder|heavy rain|downpour/i.test(text) ? .9 : /light rain|drizzle/i.test(text) ? .3 : /\brain\b|showers|sleet/i.test(text) ? .6 : 0;
  return { cloud, fog, rain };
}

/** Measurements stay in metres; cloud/fog values are explicitly art-directed render inputs. */
export function weatherFromSources(now: number, forecast: unknown, observation: unknown, forecastUrl: string | null): CityWeather | null {
  const fp = object(object(forecast).properties), op = object(object(observation).properties);
  const periods = Array.isArray(fp.periods) ? fp.periods : [];
  const generated = timestamp(fp.updateTime ?? fp.generatedAt);
  const period = periods.map(object).find(p => timestamp(p.startTime) <= now && timestamp(p.endTime) > now);
  const forecastAt = period && Number.isFinite(generated) && now - generated <= 6 * 60 * 60_000 && generated <= now + 300_000 ? timestamp(period.startTime) : null;
  const observed = timestamp(op.timestamp);
  const observedAt = Number.isFinite(observed) && observed <= now + 300_000 && now - observed <= WEATHER_STALE_MS ? observed : null;
  if (forecastAt === null && observedAt === null) return null;
  const forecastText = forecastAt !== null ? description(period?.shortForecast) : '';
  const observedText = observedAt !== null ? description(op.textDescription) : '';
  const predicted = textWeather(forecastText), measured = textWeather(observedText);
  const visibility = object(op.visibility);
  const visibilityM = observedAt !== null && visibility.unitCode === 'wmoUnit:m' && typeof visibility.value === 'number' && Number.isFinite(visibility.value)
    && visibility.value >= 0 && visibility.value <= 200_000 ? visibility.value : null;
  const layers = observedAt !== null && Array.isArray(op.cloudLayers) ? op.cloudLayers.map(object) : [];
  const cloudAmount: Record<string, number> = { CLR: 0, SKC: 0, NSC: 0, FEW: .18, SCT: .4, BKN: .8, OVC: 1, VV: 1 };
  const layerClouds = layers.map(layer => typeof layer.amount === 'string' ? cloudAmount[layer.amount] : undefined).filter((value): value is number => value !== undefined);
  const observedClouds = layerClouds.length ? Math.max(...layerClouds) : measured.cloud;
  const cloudCover = forecastAt !== null && observedAt !== null ? predicted.cloud * .6 + observedClouds * .4 : forecastAt !== null ? predicted.cloud : observedClouds;
  const visibilityFog = visibilityM === null ? 0 : clamp(1 - visibilityM / 8_000);
  const fog = Math.max(forecastAt !== null ? predicted.fog * .7 : 0, observedAt !== null ? Math.max(measured.fog, visibilityFog) : 0);
  // Observed precipitation leads; the forecast fills in when there is no fresh observation.
  const rain = Math.max(forecastAt !== null ? predicted.rain * .8 : 0, observedAt !== null ? measured.rain : 0);
  return { version: 1, status: 'live', fetchedAt: now, expiresAt: now + WEATHER_STALE_MS,
    observedAt, forecastAt, description: (forecastText || observedText || 'SF weather').slice(0, 180),
    cloudCover: clamp(cloudCover), fog: clamp(fog), rain: clamp(rain), visibilityM,
    sources: { forecast: forecastAt !== null ? forecastUrl : null, observation: observedAt !== null ? OBSERVATION : null } };
}

type WeatherCache = Pick<Cache, 'match' | 'put'>;
type Context = Pick<ExecutionContext, 'waitUntil'>;
/** One refresh per isolate, shared public cache, and a one-minute failure backoff. */
export function createWeatherService(options: { fetcher?: typeof fetch; now?: () => number; cache?: () => WeatherCache } = {}) {
  const fetcher = options.fetcher ?? fetch, clock = options.now ?? Date.now;
  const cache = options.cache ?? (() => (caches as CacheStorage & { default: WeatherCache }).default);
  let remembered: CityWeather | undefined, pending: Promise<CityWeather> | undefined, retryAt = 0;
  async function json(url: string, signal: AbortSignal): Promise<unknown> {
    const response = await fetcher(url, { headers, signal });
    if (!response.ok) throw new Error(`NWS HTTP ${response.status}`);
    if (Number(response.headers.get('Content-Length')) > 350_000) throw new Error('NWS response exceeds budget');
    if (!response.body) throw new Error('Empty NWS response');
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 350_000) { await reader.cancel(); throw new Error('NWS response exceeds budget'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  }
  function refresh(key: Request): Promise<CityWeather> {
    if (pending) return pending;
    pending = (async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 6_000);
      try {
        const [point, observation] = await Promise.allSettled([json(POINT, controller.signal), json(OBSERVATION, controller.signal)]);
        const forecastPath = point.status === 'fulfilled' ? object(object(point.value).properties).forecastHourly : undefined;
        const forecastUrl = typeof forecastPath === 'string' && /^https:\/\/api\.weather\.gov\/gridpoints\/[A-Z]{3}\/\d+,\d+\/forecast\/hourly$/.test(forecastPath) ? forecastPath : null;
        let forecast: unknown;
        if (forecastUrl) try { forecast = await json(forecastUrl, controller.signal); } catch { /* A fresh observation can still drive the scene. */ }
        const now = clock(), result = weatherFromSources(now, forecast, observation.status === 'fulfilled' ? observation.value : undefined, forecastUrl);
        if (!result) throw new Error('No fresh NWS weather source');
        remembered = result; retryAt = 0;
        try { await cache().put(key, Response.json(result, { headers: { 'Cache-Control': `public, max-age=${WEATHER_STALE_MS / 1000}` } })); } catch { /* Memory cache remains useful if edge cache is unavailable. */ }
        return result;
      } catch {
        const now = clock(); retryAt = now + 60_000;
        return remembered && now < remembered.expiresAt ? { ...remembered, status: 'stale' } : fallbackWeather(now);
      } finally { clearTimeout(timer); pending = undefined; }
    })();
    return pending;
  }
  return {
    async get(request: Request, context: Context): Promise<Response> {
      const key = new Request(new URL('/api/weather-cache-v2', request.url)); // v2: added rain field
      if (!remembered) try {
        const cached = await cache().match(key), value: unknown = cached ? await cached.json() : undefined;
        if (isCityWeather(value)) remembered = value;
      } catch { /* Cold source refresh follows. */ }
      const now = clock();
      const current = remembered;
      const valid = current && now < current.expiresAt && current.fetchedAt <= now + 300_000;
      let value: CityWeather;
      if (valid && current && now - current.fetchedAt < WEATHER_FRESH_MS) value = current;
      else if (valid && current) {
        value = { ...current, status: 'stale' };
        if (now >= retryAt) context.waitUntil(refresh(key));
      } else if (now < retryAt) value = fallbackWeather(now);
      else value = await refresh(key);
      return Response.json(value, { headers: { 'Cache-Control': 'public, max-age=60' } });
    },
  };
}
const service = createWeatherService();
export async function handleWeatherRequest(request: Request, context: Context): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/weather' || !flags.weather) return null;
  if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } });
  return service.get(request, context);
}
