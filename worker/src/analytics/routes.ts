import { flags } from '@gtasf/shared/flags';
import {
  cleanAnalyticsProperties, cleanAttribution, isAnalyticsEvent, isPurchaseEvent, validAnalyticsId,
  type AnalyticsPublicConfig, type XConversionEvent,
} from '@gtasf/shared/analytics';
import { captureAnalyticsEvent, type AnalyticsEnv } from './posthog';

const emptyConfig = (): AnalyticsPublicConfig => ({ posthog: false, xEvents: {} });
export function analyticsConfig(env: AnalyticsEnv, optedOut = false): AnalyticsPublicConfig {
  if (optedOut) return emptyConfig();
  const config = emptyConfig();
  config.posthog = flags.posthogAnalytics && !!env.POSTHOG_KEY?.trim();
  if (flags.xAdsPixel && env.X_PIXEL_ID && /^[a-z0-9]{1,32}$/.test(env.X_PIXEL_ID)) {
    config.xPixelId = env.X_PIXEL_ID;
    const pairs: [XConversionEvent, string | undefined][] = [
      ['play_start', env.X_EVENT_PLAY_START], ['outbid_purchase', env.X_EVENT_OUTBID_PURCHASE], ['ad_purchase', env.X_EVENT_AD_PURCHASE],
    ];
    for (const [event, id] of pairs) {
      if (id && new RegExp(`^tw-${env.X_PIXEL_ID}-[a-z0-9]{1,32}$`).test(id)) config.xEvents[event] = id;
    }
  }
  return config;
}

async function boundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 8192) { await reader.cancel(); throw new RangeError('too large'); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Public client collection accepts no purchase events. All responses avoid caching. */
export async function handleAnalyticsRequest(
  request: Request, env: AnalyticsEnv, context: Pick<ExecutionContext, 'waitUntil'>,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/analytics/config' && url.pathname !== '/api/analytics/events') return;
  const headers = { 'cache-control': 'no-store' };
  const optedOut = request.headers.get('sec-gpc') === '1' || request.headers.get('dnt') === '1';
  const config = analyticsConfig(env, optedOut);
  if (url.pathname === '/api/analytics/config') {
    // Cloudflare sets cf.country; unknown geography asks instead of guessing.
    const country = (request as Request & { cf?: { country?: string } }).cf?.country;
    return request.method === 'GET' ? Response.json({ ...config, consentRequired: country !== 'US' }, { headers }) : new Response(null, { status: 405, headers });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers });
  if (!config.posthog) return new Response(null, { status: 204, headers });
  if (request.headers.get('origin') !== url.origin || !request.headers.get('content-type')?.startsWith('application/json')) {
    return new Response(null, { status: 403, headers });
  }
  try {
    const input = await boundedJson(request);
    if (!input || typeof input !== 'object') return new Response(null, { status: 400, headers });
    const body = input as Record<string, unknown>;
    if (body.permitted !== true || !validAnalyticsId(body.distinctId) || !validAnalyticsId(body.eventId) ||
        !isAnalyticsEvent(body.event) || isPurchaseEvent(body.event) || body.event === 'play_start') return new Response(null, { status: 400, headers });
    const properties = cleanAnalyticsProperties(body.properties);
    delete properties.amount_cents;
    context.waitUntil(captureAnalyticsEvent(env, {
      permitted: true, distinctId: body.distinctId, attribution: cleanAttribution(body.attribution),
    }, body.event, properties, body.eventId));
    return new Response(null, { status: 202, headers });
  } catch (error) {
    return new Response(null, { status: error instanceof RangeError ? 413 : 400, headers });
  }
}
