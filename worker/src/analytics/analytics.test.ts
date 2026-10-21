import { analyticsServerContext, captureConfirmedPlay, captureConfirmedPurchase, captureXConversion } from './xConversions';
import { expect, test, vi } from 'vitest';
import { attributionFromSearch } from '@gtasf/shared/analytics';
import { captureAnalyticsEvent } from './posthog';
import { analyticsConfig, handleAnalyticsRequest } from './routes';
vi.mock('@gtasf/shared/flags', () => ({ flags: { posthogAnalytics: true, xAdsPixel: true } }));

test('funnel smoke: env no-op, bounded attribution, EU forwarding and server-only purchases', async () => {
  const send = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', send);
  const id = crypto.randomUUID(), eventId = crypto.randomUUID();
  const attribution = attributionFromSearch('?utm_source=x&utm_medium=paid_social&utm_campaign=sf26&utm_content=taxi_clip&twclid=click_123&token=PRIVATE&email=private%40example.test');
  const context = { permitted: true as const, distinctId: id, attribution };
  const env = { ENVIRONMENT: 'test', POSTHOG_KEY: 'phc_fixture', X_PIXEL_ID: 'fixture', X_EVENT_PLAY_START: 'tw-fixture-play' };
  const pending: Promise<unknown>[] = [];
  const execution = { waitUntil(promise: Promise<unknown>) { pending.push(promise); } };
  const request = (event: string, override: Record<string, unknown> = {}) => new Request('https://gtasf.test/api/analytics/events', {
    method: 'POST', headers: { origin: 'https://gtasf.test', 'content-type': 'application/json' },
    body: JSON.stringify({ ...context, event, eventId, properties: { source: 'radar', chat: 'PRIVATE', email: 'PRIVATE', amount_cents: 100 }, ...override }),
  });
  try {
    await captureAnalyticsEvent({ ENVIRONMENT: 'test' }, context, 'play_start');
    expect(send).not.toHaveBeenCalled();
    expect(analyticsConfig({ ENVIRONMENT: 'test' })).toEqual({ posthog: false, xEvents: {} });
    expect(analyticsConfig(env, true)).toEqual({ posthog: false, xEvents: {} });
    expect(JSON.stringify(analyticsConfig(env))).not.toContain('phc_fixture');
    expect((await handleAnalyticsRequest(request('event_navigate'), env, execution))?.status).toBe(202);
    await Promise.all(pending);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, options] = send.mock.calls[0]! as unknown as [string, RequestInit];
    const body = JSON.parse(String(options.body));
    expect(url).toBe('https://eu.i.posthog.com/i/v0/e/');
    expect(body).toMatchObject({ event: 'event_navigate', distinct_id: id, uuid: eventId, properties: { ...attribution, source: 'radar', environment: 'test', $process_person_profile: false } });
    expect(JSON.stringify(body)).not.toContain('PRIVATE');
    expect(body.properties.amount_cents).toBeUndefined();
    expect((await handleAnalyticsRequest(request('ad_purchase'), env, execution))?.status).toBe(400);
    expect((await handleAnalyticsRequest(request('play_start', { permitted: false }), env, execution))?.status).toBe(400);
    expect((await handleAnalyticsRequest(request('unknown_event'), env, execution))?.status).toBe(400);
    expect((await handleAnalyticsRequest(request('play_start', { properties: { source: 'a'.repeat(9000) } }), env, execution))?.status).toBe(413);
    await captureAnalyticsEvent({ ...env, POSTHOG_HOST: 'https://configured.example/ingest' }, context, 'ad_purchase', { amount_cents: 10000 }, eventId);
    expect(send).toHaveBeenLastCalledWith('https://configured.example/ingest/i/v0/e/', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(String((send.mock.calls[1]! as unknown as [string, RequestInit])[1].body)).properties.amount_cents).toBe(10000);
    const xenv = { ENVIRONMENT: 'test', X_PIXEL_ID: 'rgc75', X_PIXEL_TOKEN: 'server-fixture-only', X_EVENT_PLAY_START: 'tw-rgc75-rgc7f', X_EVENT_OUTBID_PURCHASE: 'tw-rgc75-rgc7h', X_EVENT_AD_PURCHASE: 'tw-rgc75-rgc7n' };
    const xcontext = { ...context, playConversionId: crypto.randomUUID() };
    const edge = analyticsServerContext(new Request('https://gtasf.test/api/world', { headers: { 'cf-connecting-ip': '192.0.2.1', 'user-agent': 'Fixture browser' } }));
    send.mockClear();
    await captureXConversion({ ...xenv, X_PIXEL_TOKEN: undefined }, xcontext, 'play_start', eventId);
    await captureXConversion({ ...xenv, X_EVENT_PLAY_START: undefined }, xcontext, 'play_start', eventId);
    expect(send).not.toHaveBeenCalled();
    await captureConfirmedPlay(xenv, edge, xcontext);
    await captureConfirmedPurchase(xenv, xcontext, 'outbid_purchase', { conversionId: eventId, amountCents: 1250 }, { ...edge, email: ' TEST@X.COM ' });
    await captureConfirmedPurchase(xenv, { ...xcontext, attribution: {} }, 'ad_purchase', { conversionId: eventId, amountCents: 100 }, edge);
    expect(send).toHaveBeenCalledTimes(2);
    const requests = send.mock.calls as unknown as [string, RequestInit][];
    const conversions = requests.map(call => JSON.parse(String(call[1].body)).conversions[0]);
    expect(requests[0]![0]).toBe('https://ads-api.x.com/12/measurement/conversions/rgc75');
    expect(requests[0]![1].headers).toMatchObject({ 'X-Pixel-Token': 'server-fixture-only' });
    expect(conversions[0]).toMatchObject({ event_id: 'tw-rgc75-rgc7f', conversion_id: xcontext.playConversionId, identifiers: [{ twclid: 'click_123' }] });
    expect(conversions[1]).toMatchObject({ event_id: 'tw-rgc75-rgc7h', conversion_id: eventId, value: '12.50', price_currency: 'USD', identifiers: [{ twclid: 'click_123' }] });
    expect(JSON.stringify(conversions)).not.toMatch(/hashed_email|ip_address|user_agent/);
    expect(JSON.stringify(conversions)).not.toContain('TEST@');
    expect(edge).toEqual({});
    for (const country of ['US', 'GB', 'DE', undefined]) {
      const countryRequest = new Request('https://gtasf.test/api/analytics/config');
      Object.defineProperty(countryRequest, 'cf', { value: { country } });
      expect(await (await handleAnalyticsRequest(countryRequest, env, execution))!.json()).toMatchObject({ consentRequired: country !== 'US' });
    }
    send.mockClear();
    for (const event of ['landing_view', 'onboarding_start', 'onboarding_complete']) {
      expect((await handleAnalyticsRequest(request(event), env, execution))?.status).toBe(202);
    }
    await Promise.all(pending);
    const funnel = send.mock.calls.map(call => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    expect(funnel.map(body => body.event)).toEqual(['landing_view', 'onboarding_start', 'onboarding_complete']);
    expect(funnel.every(body => body.properties.utm_campaign === 'sf26' && body.properties.utm_content === 'taxi_clip' && body.properties.twclid === 'click_123')).toBe(true);
    expect(JSON.stringify(funnel)).not.toContain('PRIVATE');
  } finally { vi.unstubAllGlobals(); }
});
