import { flags } from '@gtasf/shared/flags';
import { isCityWeather, WEATHER_FRESH_MS, type CityWeather } from '@gtasf/shared/weather';

/** Nonblocking same-origin feed. A failed request leaves the last useful atmosphere intact. */
export function createWeatherFeed(enabled: boolean = flags.weather) {
  if (!enabled || typeof window === 'undefined') return undefined;
  let disposed = false, pending: AbortController | undefined, value: CityWeather | undefined;
  let nextRefresh = 0;
  const stats = { state: 'loading', requests: 0, errors: 0, lastError: '', fetchedAt: 0 };
  async function refresh() {
    const now = Date.now();
    if (disposed || pending || document.hidden || now < nextRefresh) return;
    nextRefresh = now + 10 * 60_000;
    const controller = new AbortController(); pending = controller;
    const timer = setTimeout(() => controller.abort(), 8_000); stats.requests++;
    try {
      const response = await fetch('/api/weather', { signal: controller.signal, cache: 'no-cache' });
      if (!response.ok) throw new Error(`Weather HTTP ${response.status}`);
      const text = await response.text(); if (text.length > 12_000) throw new Error('Weather feed exceeds budget');
      const data: unknown = JSON.parse(text);
      if (!isCityWeather(data) || data.fetchedAt > now + 300_000) throw new Error('Invalid weather feed');
      if (!disposed && (!value || data.fetchedAt >= value.fetchedAt)) {
        value = data; stats.state = data.status; stats.fetchedAt = data.fetchedAt; stats.lastError = '';
      }
    } catch (error) {
      if (!disposed) { stats.errors++; stats.lastError = String(error); stats.state = value ? 'stale' : 'fallback'; nextRefresh = Date.now() + 60_000; }
    } finally { clearTimeout(timer); if (pending === controller) pending = undefined; }
  }
  function visible() { if (!document.hidden && Date.now() - stats.fetchedAt > WEATHER_FRESH_MS) { nextRefresh = 0; void refresh(); } }
  document.addEventListener('visibilitychange', visible);
  const timer = setInterval(() => { void refresh(); }, 60_000);
  void refresh();
  return {
    stats,
    current(now = Date.now()): CityWeather | undefined {
      if (!value || now > value.expiresAt || now < value.fetchedAt - 300_000) return undefined;
      return value;
    },
    dispose() { if (disposed) return; disposed = true; pending?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); stats.state = 'disposed'; },
  };
}
