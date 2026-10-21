import { flags } from '@gtasf/shared/flags';
import {
  cleanAnalyticsProperties, cleanAttribution, isAnalyticsEvent, validAnalyticsId,
  type AnalyticsContext, type AnalyticsEvent, type AnalyticsProperties,
} from '@gtasf/shared/analytics';

export interface AnalyticsEnv {
  ENVIRONMENT: string;
  POSTHOG_KEY?: string;
  /** Configurable ingestion host; the GTASF project is in the EU region. */
  POSTHOG_HOST?: string;
  X_PIXEL_ID?: string;
  /** Server-only Conversion API credential, never returned in public config. */
  X_PIXEL_TOKEN?: string;
  X_EVENT_PLAY_START?: string;
  X_EVENT_OUTBID_PURCHASE?: string;
  X_EVENT_AD_PURCHASE?: string;
}

/** Call purchases only after a verified, idempotently committed server payment. */
export async function captureAnalyticsEvent(
  env: AnalyticsEnv,
  context: AnalyticsContext | undefined,
  event: AnalyticsEvent,
  properties: AnalyticsProperties = {},
  eventId: string = crypto.randomUUID(),
  transport: typeof fetch = fetch,
): Promise<void> {
  if (!flags.posthogAnalytics || !env.POSTHOG_KEY?.trim() || context?.permitted !== true ||
      !validAnalyticsId(context.distinctId) || !validAnalyticsId(eventId) || !isAnalyticsEvent(event)) return;
  try {
    const host = new URL(env.POSTHOG_HOST?.trim() || 'https://eu.i.posthog.com');
    if (host.protocol !== 'https:' || host.username || host.password || host.search || host.hash) return;
    const endpoint = `${host.href.replace(/\/$/, '')}/i/v0/e/`;
    const response = await transport(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: env.POSTHOG_KEY,
        event,
        uuid: eventId,
        distinct_id: context.distinctId,
        properties: {
          ...cleanAttribution(context.attribution), ...cleanAnalyticsProperties(properties),
          distinct_id: context.distinctId, environment: env.ENVIRONMENT,
          $insert_id: eventId, $ip: null, $geoip_disable: true, $process_person_profile: false,
        },
      }),
      signal: AbortSignal.timeout(3000),
    });
    // Do not expose provider response bodies, keys or event data in logs.
    await response.body?.cancel();
  } catch { /* Analytics cannot interrupt gameplay or payment completion. */ }
}
