import { cleanAttribution, validAnalyticsId, type AnalyticsContext, type Attribution } from '@gtasf/shared/analytics';
const ATTRIBUTION_KEY = 'gtasf.analytics.attribution.v1';
const ID_KEY = 'gtasf.analytics.visitor.v1';
const PLAY_KEY = 'gtasf.analytics.play.v1';
const CONSENT_KEY = 'gtasf.analytics.consent.v1';
const MONTH = 30 * 86400_000;
export function readConsent(): boolean | undefined {
  try { const entry = JSON.parse(localStorage.getItem(CONSENT_KEY) ?? 'null'); return entry?.expires > Date.now() && typeof entry.allowed === 'boolean' ? entry.allowed : undefined; } catch { return; }
}
export function rememberConsent(allowed: boolean): void {
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ allowed, expires: Date.now() + 6 * MONTH })); } catch { /* Storage may be disabled. */ }
}
/** Called only after permission; URL attribution stays in memory until then. */
export function persistentContext(landing: Attribution): AnalyticsContext {
  let attribution = cleanAttribution(landing), distinctId: string = crypto.randomUUID(), playConversionId: string = crypto.randomUUID();
  try {
    const saved = JSON.parse(localStorage.getItem(ATTRIBUTION_KEY) ?? 'null');
    if (saved?.expires > Date.now()) attribution = { ...cleanAttribution(saved.attribution), ...attribution };
    if (Object.keys(landing).length) localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify({ attribution, expires: Date.now() + MONTH }));
    const storedId = localStorage.getItem(ID_KEY);
    if (validAnalyticsId(storedId)) distinctId = storedId;
    else localStorage.setItem(ID_KEY, distinctId);
    const storedPlay = sessionStorage.getItem(PLAY_KEY);
    if (validAnalyticsId(storedPlay)) playConversionId = storedPlay;
    else sessionStorage.setItem(PLAY_KEY, playConversionId);
  } catch { /* In-memory attribution still works. */ }
  return { permitted: true, distinctId, attribution, playConversionId };
}
export function clearAnalyticsStorage(): void {
  try { for (const key of [ATTRIBUTION_KEY, ID_KEY]) localStorage.removeItem(key); sessionStorage.removeItem(PLAY_KEY); } catch { /* Best effort. */ }
}
