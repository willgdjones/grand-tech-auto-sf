import { flags } from '@gtasf/shared/flags';
import { cleanAnalyticsContext, validAnalyticsId, type AnalyticsContext, type PurchaseEvent, type XConversionEvent } from '@gtasf/shared/analytics';
import { captureAnalyticsEvent, type AnalyticsEnv } from './posthog';

/** Legacy identifier fields remain readable in old order records, but are never forwarded. */
export interface AnalyticsServerContext { ipAddress?: string; userAgent?: string; email?: string; optedOut?: boolean }
export interface ConversionReceipt { conversionId: string; amountCents: number }

/** Only call with the original edge request, never a client-supplied IP field. */
export function analyticsServerContext(request: Request): AnalyticsServerContext {
  if (request.headers.get('sec-gpc') === '1' || request.headers.get('dnt') === '1') return { optedOut: true };
  // Founder ads test uses click attribution only. Do not collect edge IP/UA for CAPI.
  return {};
}

/** Caller owns server confirmation/idempotency. Failure never interrupts gameplay or payment. */
export async function captureXConversion(
  env: AnalyticsEnv, input: AnalyticsContext | undefined, event: XConversionEvent,
  conversionId: string, amountCents = 0, server: AnalyticsServerContext = {}, transport: typeof fetch = fetch,
): Promise<void> {
  const context = cleanAnalyticsContext(input);
  const pixel = env.X_PIXEL_ID;
  const tag = { play_start: env.X_EVENT_PLAY_START, outbid_purchase: env.X_EVENT_OUTBID_PURCHASE, ad_purchase: env.X_EVENT_AD_PURCHASE }[event];
  if (!flags.xAdsPixel || !context || server.optedOut || !env.X_PIXEL_TOKEN?.trim() || !pixel || !/^[a-z0-9]{1,32}$/.test(pixel) ||
      !tag || !new RegExp(`^tw-${pixel}-[a-z0-9]{1,32}$`).test(tag) || !validAnalyticsId(conversionId) ||
      !Number.isSafeInteger(amountCents) || amountCents < 0) return;
  try {
    const identifiers: Record<string, string>[] = [];
    if (context.attribution.twclid) identifiers.push({ twclid: context.attribution.twclid });
    // Ignore legacy stored IP/UA/email too: no raw or hashed account identifiers.
    if (!identifiers.length) return;
    const response = await transport(`https://ads-api.x.com/12/measurement/conversions/${pixel}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Pixel-Token': env.X_PIXEL_TOKEN },
      body: JSON.stringify({ conversions: [{ conversion_time: new Date().toISOString(), event_id: tag,
        conversion_id: conversionId, identifiers, value: (amountCents / 100).toFixed(2), price_currency: 'USD' }] }),
      signal: AbortSignal.timeout(3000),
    });
    await response.body?.cancel();
  } catch { /* Do not log credentials, identifiers or provider response bodies. */ }
}

/** The accepted world join (or consent update on that joined socket) owns this call. */
export async function captureConfirmedPlay(
  env: AnalyticsEnv, server: AnalyticsServerContext, input: AnalyticsContext | undefined, transport: typeof fetch = fetch,
): Promise<void> {
  const context = cleanAnalyticsContext(input);
  if (!context?.playConversionId || server.optedOut) return;
  await Promise.all([
    captureAnalyticsEvent(env, context, 'play_start', {}, context.playConversionId, transport),
    captureXConversion(env, context, 'play_start', context.playConversionId, 0, server, transport),
  ]);
}

/** Invoke only after verified Stripe webhook settlement first credits the order. */
export async function captureConfirmedPurchase(
  env: AnalyticsEnv, input: AnalyticsContext | undefined, event: PurchaseEvent,
  receipt: ConversionReceipt, server: AnalyticsServerContext = {}, transport: typeof fetch = fetch,
): Promise<void> {
  const context = cleanAnalyticsContext(input);
  if (!context || server.optedOut || !validAnalyticsId(receipt.conversionId) || !Number.isSafeInteger(receipt.amountCents) || receipt.amountCents < 0) return;
  await Promise.all([
    captureAnalyticsEvent(env, context, event, { amount_cents: receipt.amountCents }, receipt.conversionId, transport),
    captureXConversion(env, context, event, receipt.conversionId, receipt.amountCents, server, transport),
  ]);
}
