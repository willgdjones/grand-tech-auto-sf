import { flags } from '@gtasf/shared/flags';
import {
  attributionFromSearch, cleanAnalyticsProperties, isAnalyticsEvent, isPurchaseEvent,
  type AnalyticsContext, type AnalyticsProperties, type AnalyticsPublicConfig,
  type ClientAnalyticsEvent, type PurchaseEvent, type Attribution,
} from '@gtasf/shared/analytics';
import { createXPixel, type XPixel } from './xPixel';
import { clearAnalyticsStorage, persistentContext } from './storage';
import { isAutomatedVisit, markAutomatedVisit } from './bot';
import { isMobileDevice } from './heartbeat';

// Tag automated visits before the first funding request so the Worker can mark the profile as a bot.
if (typeof document !== 'undefined') markAutomatedVisit();

let allowed = false, joined = false;
let landing: Attribution | undefined;
export function captureLandingAttribution(): void { landing ??= attributionFromSearch(location.search); }
let generation = 0;
let context: AnalyticsContext | undefined;
let config: AnalyticsPublicConfig = { posthog: false, xEvents: {} };
let pixel: XPixel | undefined;
let started: Promise<void> | undefined;
const once = new Set<ClientAnalyticsEvent>();
const early: Array<[ClientAnalyticsEvent, AnalyticsProperties]> = [];
export const optedOut = () => (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true || navigator.doNotTrack === '1' || isAutomatedVisit();

/** Consent bootstrap calls this; first-party configuration never blocks READY. */
export function initAnalytics(options: { permitted: boolean; config?: AnalyticsPublicConfig }): Promise<void> {
  if (started) return started;
  if ((!flags.posthogAnalytics && !flags.xAdsPixel) || !options.permitted || optedOut()) return Promise.resolve();
  allowed = true;
  const token = ++generation;
  started = (async () => {
    try {
      const candidate = options.config ?? await fetch('/api/analytics/config', { cache: 'no-store', signal: AbortSignal.timeout(3000) }).then(async response => response.ok ? await response.json() as AnalyticsPublicConfig : undefined);
      if (!candidate || token !== generation || !allowed || optedOut()) return;
      config = candidate;
      if (!config.posthog && !config.xPixelId) return;
      captureLandingAttribution();
      context = persistentContext(landing!);
      pixel = createXPixel(config, context.attribution, allowed);
      // Device class on the funnel's first step, so landing -> READY splits phone vs desktop (gtasf-1k82).
      track('landing_view', { is_mobile: isMobileDevice() });
      for (const [event, properties] of early.splice(0)) track(event, properties);
      window.dispatchEvent(new Event('gtasf:analytics-ready'));
      if (joined) confirmAnalyticsPlay();
    } catch { /* Missing Worker, blocked network or malformed config is a no-op. */ }
    finally { early.length = 0; }
  })();
  return started;
}

export function track(event: ClientAnalyticsEvent, input: AnalyticsProperties = {}): void {
  // play_start belongs to an accepted WELCOME and the server's join path.
  if (event === 'play_start' || !allowed || optedOut() || !isAnalyticsEvent(event) || isPurchaseEvent(event)) return;
  if (!context) {
    if (early.length < 32) early.push([event, cleanAnalyticsProperties(input)]);
    return;
  }
  if (event === 'landing_view' || event === 'first_drive') {
    if (once.has(event)) return;
    once.add(event);
  }
  const properties = cleanAnalyticsProperties(input);
  delete properties.amount_cents;
  if (config.posthog && flags.posthogAnalytics) {
    void fetch('/api/analytics/events', {
      method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ ...context, event, eventId: crypto.randomUUID(), properties }),
    }).catch(() => undefined);
  }
}

/** connectWorld calls only on accepted WELCOME, including joins preceding consent. */
export function confirmAnalyticsPlay(): void {
  joined = true;
  if (allowed && !optedOut() && context?.playConversionId) pixel?.conversion('play_start', context.playConversionId);
}

/** Persist this bounded context with checkout; never use it as authorization. */
export function analyticsContext(): AnalyticsContext | undefined {
  return allowed && !optedOut() && context ? structuredClone(context) : undefined;
}

/** Only call with the server's confirmed payment receipt, never the checkout button. */
export function trackPurchasePixel(event: PurchaseEvent, receipt: { conversionId: string; amountCents: number }): void {
  if (allowed && !optedOut() && isPurchaseEvent(event)) pixel?.conversion(event, receipt.conversionId, receipt.amountCents);
}

export function stopAnalytics(): void {
  allowed = false;
  generation++;
  context = undefined;
  config = { posthog: false, xEvents: {} };
  pixel?.stop();
  pixel = undefined;
  early.length = 0;
  once.clear();
  started = undefined;
  clearAnalyticsStorage();
  window.dispatchEvent(new Event('gtasf:analytics-revoked'));
}
