import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, test, vi } from 'vitest';
import { createXPixel, publicPixelLocation } from './xPixel';
import { initAnalytics, track, stopAnalytics, analyticsContext, confirmAnalyticsPlay, trackPurchasePixel } from './index';
import { consentDecision } from './consent';
import { persistentContext, readConsent, rememberConsent } from './storage';
import { observeOnboarding } from './onboarding';
import { freshOnboarding } from '@gtasf/shared/onboarding/state';
vi.mock('@gtasf/shared/flags', () => ({ flags: { posthogAnalytics: true, xAdsPixel: true } }));

test('consent + literal head pixel: region decision, persisted click, confirmed play/purchase and revoke', async () => {
  const location = { pathname: '/', search: '?utm_source=x&utm_campaign=sf26&utm_content=taxi_clip&twclid=click_123', hash: '' };
  const browser = Object.assign(new EventTarget(), { location, navigator: { doNotTrack: '0' }, twq: undefined as undefined | (((...args: unknown[]) => void) & { queue: unknown[][] }) });
  const scripts: unknown[] = [];
  const doc = Object.assign(new EventTarget(), {
    createElement: () => ({}), getElementsByTagName: () => [{ parentNode: { insertBefore: (script: unknown) => scripts.push(script) } }],
  });
  const makeStorage = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }; };
  const send = vi.fn(async () => new Response(null, { status: 202 }));
  const config = { posthog: true, xPixelId: 'rgc75', xEvents: { play_start: 'tw-rgc75-rgc7f', ad_purchase: 'tw-rgc75-rgc7n' }, consentRequired: true };
  vi.stubGlobal('fetch', send); vi.stubGlobal('navigator', browser.navigator); vi.stubGlobal('location', location);
  vi.stubGlobal('window', browser); vi.stubGlobal('document', doc);
  vi.stubGlobal('localStorage', makeStorage()); vi.stubGlobal('sessionStorage', makeStorage());
  try {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const snippet = html.match(/<script>\s*([\s\S]*?)<\/script>/)![1]!;
    expect(html.match(/twq\('config','rgc75'\)/g)).toHaveLength(1);
    runInNewContext(snippet, { window: browser, document: doc, get twq() { return browser.twq; } });
    expect(scripts).toHaveLength(0);
    expect(consentDecision(config, undefined, false)).toBeUndefined(); // EU/UK/unknown prompt
    expect(consentDecision({ ...config, consentRequired: false }, undefined, false)).toBe(true); // US
    expect(consentDecision(config, false, false)).toBe(false);
    expect(consentDecision(config, true, false)).toBe(true);
    expect(consentDecision({ ...config, consentRequired: false }, true, true)).toBe(false); // GPC
    await initAnalytics({ permitted: false, config });
    const onboarding = observeOnboarding(freshOnboarding());
    expect(send).not.toHaveBeenCalled(); expect(scripts).toHaveLength(0);
    rememberConsent(true); expect(readConsent()).toBe(true);
    confirmAnalyticsPlay(); // WELCOME may happen before consent.
    await initAnalytics({ permitted: true, config });
    const context = analyticsContext()!;
    expect(context.attribution).toEqual({ twclid: 'click_123', utm_source: 'x', utm_campaign: 'sf26', utm_content: 'taxi_clip' });
    expect(persistentContext({}).attribution).toEqual(context.attribution);
    expect(persistentContext({}).playConversionId).toBe(context.playConversionId);
    confirmAnalyticsPlay(); track('play_start');
    track('first_drive'); track('first_drive');
    onboarding({ ...freshOnboarding(), step: 'done', completed: true, skipped: true });
    onboarding({ ...freshOnboarding(), step: 'done', completed: true });
    onboarding({ ...freshOnboarding(), step: 'done', completed: true });
    const events = send.mock.calls.map(call => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)).event);
    expect(events).toEqual(['landing_view', 'onboarding_start', 'first_drive', 'onboarding_step', 'onboarding_complete']); // server owns play_start; skip is not completion
    const receipt = { conversionId: crypto.randomUUID(), amountCents: 10000 };
    trackPurchasePixel('ad_purchase', receipt); trackPurchasePixel('ad_purchase', receipt);
    expect(scripts).toHaveLength(1);
    const queue = browser.twq!.queue;
    expect(queue).toHaveLength(3);
    expect(Array.from(queue[0]!)).toEqual(['config', 'rgc75']);
    expect(Array.from(queue[1]!)).toEqual(['event', 'tw-rgc75-rgc7f', expect.objectContaining({ conversion_id: context.playConversionId, value: 0, currency: 'USD' })]);
    expect(Array.from(queue[2]!)).toEqual(['event', 'tw-rgc75-rgc7n', expect.objectContaining({ conversion_id: receipt.conversionId, value: 100, currency: 'USD', twclid: 'click_123' })]);
    createXPixel(config, {}, true, browser as unknown as Window, doc as unknown as Document); // never load base twice
    expect(scripts).toHaveLength(1);
    expect(publicPixelLocation({ ...location, pathname: '/claim/private' })).toBe(false);
    expect(publicPixelLocation({ ...location, search: '?token=private' })).toBe(false);
    expect(publicPixelLocation({ ...location, search: '?utm_campaign=person%40example.com' })).toBe(false);
    expect(publicPixelLocation({ ...location, search: '?ref=person%40example.com' })).toBe(false);
    stopAnalytics(); rememberConsent(false);
    expect(analyticsContext()).toBeUndefined(); expect(readConsent()).toBe(false);
    trackPurchasePixel('ad_purchase', { ...receipt, conversionId: crypto.randomUUID() });
    expect(queue).toHaveLength(3);
  } finally { stopAnalytics(); vi.unstubAllGlobals(); }
});
