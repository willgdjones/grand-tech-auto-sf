import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWeatherService, weatherFromSources } from './weather';
import { isCityWeather, WEATHER_FRESH_MS, WEATHER_STALE_MS } from '@gtasf/shared/weather';

const epoch = Date.parse('2026-10-03T09:00:00Z');
const forecastUrl = 'https://api.weather.gov/gridpoints/MTR/85,105/forecast/hourly';
const forecast = { properties: { updateTime: new Date(epoch).toISOString(), periods: [{ startTime: new Date(epoch).toISOString(), endTime: new Date(epoch + 3_600_000).toISOString(), shortForecast: 'Fog' }] } };
const observation = { properties: { timestamp: new Date(epoch - 60_000).toISOString(), textDescription: 'Mist', visibility: { unitCode: 'wmoUnit:m', value: 800 }, cloudLayers: [{ amount: 'BKN' }] } };
async function body(response: Response) {
  const value: unknown = await response.json();
  if (!isCityWeather(value)) throw new Error('Invalid weather response');
  return value;
}
function setup() {
  let now = epoch, failed = false;
  const fetcher = vi.fn<typeof fetch>(async input => {
    if (failed) throw new Error('source unavailable');
    const url = String(input);
    return Response.json(url.includes('/points/') ? { properties: { forecastHourly: forecastUrl } } : url.includes('/stations/') ? observation : forecast);
  });
  let cached: Response | undefined;
  const cache = { match: vi.fn(async () => cached?.clone()), put: vi.fn(async (_key: Request, value: Response) => { cached = value.clone(); }) };
  const tasks: Promise<unknown>[] = [];
  const context = { waitUntil(task: Promise<unknown>) { tasks.push(task); } };
  const service = createWeatherService({ fetcher, now: () => now, cache: () => cache });
  const request = new Request('https://gtasf.com/api/weather');
  return { service, request, context, cache, fetcher, tasks, setTime: (time: number) => { now = time; }, fail: () => { failed = true; } };
}
afterEach(() => vi.useRealTimers());
describe('public SF weather feed', () => {
  it('combines real source units and rejects observations and forecasts that have aged out', () => {
    const current = weatherFromSources(epoch, forecast, observation, forecastUrl)!;
    expect(current.visibilityM).toBe(800);
    expect(current.fog).toBeCloseTo(.9);
    expect(current.cloudCover).toBeCloseTo(.92);
    expect(current.sources).toEqual({ forecast: forecastUrl, observation: 'https://api.weather.gov/stations/KSFO/observations/latest' });
    expect(weatherFromSources(epoch + WEATHER_STALE_MS + 3_600_000, forecast, observation, forecastUrl)).toBeNull();
  });
  it('shares a cold refresh, serves fresh cache, then retains stale weather through a refresh failure and expires it', async () => {
    const s = setup();
    const [a, b] = await Promise.all([s.service.get(s.request, s.context), s.service.get(s.request, s.context)]);
    expect((await body(a)).status).toBe('live'); expect((await body(b)).status).toBe('live');
    expect(s.fetcher).toHaveBeenCalledTimes(3); expect(s.cache.put).toHaveBeenCalledOnce();
    await s.service.get(s.request, s.context); expect(s.fetcher).toHaveBeenCalledTimes(3);
    s.setTime(epoch + WEATHER_FRESH_MS + 1); s.fail();
    expect((await body(await s.service.get(s.request, s.context))).status).toBe('stale');
    await Promise.all(s.tasks); expect(s.fetcher).toHaveBeenCalledTimes(5);
    await s.service.get(s.request, s.context); expect(s.fetcher).toHaveBeenCalledTimes(5);
    s.setTime(epoch + WEATHER_STALE_MS + 1);
    const fallback = await body(await s.service.get(s.request, s.context));
    expect(fallback.status).toBe('fallback'); expect(fallback.sources).toEqual({ forecast: null, observation: null });
  });
  it('uses shared cache in a fresh isolate without calling NWS', async () => {
    const s = setup(); await s.service.get(s.request, s.context);
    const otherFetch = vi.fn<typeof fetch>();
    const other = createWeatherService({ fetcher: otherFetch, now: () => epoch, cache: () => s.cache });
    expect((await body(await other.get(s.request, s.context))).status).toBe('live');
    expect(otherFetch).not.toHaveBeenCalled();
  });
  it('times out a stalled response body and recovers without blocking subsequent requests', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => new Response(new ReadableStream({ start(controller) {
      init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
    } })));
    const service = createWeatherService({ fetcher, now: () => epoch, cache: () => ({ match: async () => undefined, put: async () => {} }) });
    const request = new Request('https://gtasf.com/api/weather'), context = { waitUntil: () => {} };
    const pending = service.get(request, context);
    await vi.advanceTimersByTimeAsync(6_001);
    expect((await body(await pending)).status).toBe('fallback');
    expect((await body(await service.get(request, context))).status).toBe('fallback');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
