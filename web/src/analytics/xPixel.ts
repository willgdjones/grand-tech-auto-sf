import { flags } from '@gtasf/shared/flags';
import {
  cleanAttribution, validAnalyticsId, type AnalyticsPublicConfig, type Attribution, type XConversionEvent,
} from '@gtasf/shared/analytics';

type Twq = (...args: unknown[]) => void;
type PixelWindow = Pick<Window, 'location' | 'navigator'> & { twq?: Twq };
export interface XPixel {
  conversion(event: XConversionEvent, conversionId: string, amountCents?: number): void;
  stop(): void;
}
const noop: XPixel = { conversion() {}, stop() {} };

/** Do not load a third-party script on capability-bearing claim/checkout URLs. */
export function publicPixelLocation(location: Pick<Location, 'pathname' | 'search' | 'hash'>): boolean {
  if (!/^\/(?:go\/[a-z0-9-]+)?$/.test(location.pathname) || location.hash) return false;
  // The third-party script can read the URL itself: validate values as well as
  // keys, rather than only sanitizing the attribution payload we send it.
  return [...new URLSearchParams(location.search)].every(([key, value]) => {
    if (key === 'twclid' || /^utm_[a-z0-9_]{1,32}$/.test(key)) return cleanAttribution({ [key]: value })[key] === value;
    return ['at', 'preset', 'ref', 'outbid'].includes(key) && /^[a-zA-Z0-9_.~,+-]{1,256}$/.test(value);
  });
}
export function createXPixel(
  config: AnalyticsPublicConfig, attribution: Attribution, permitted: boolean,
  browser: PixelWindow = window, documentNode: Document = document,
): XPixel {
  if (!flags.xAdsPixel || !permitted || !config.xPixelId || !/^[a-z0-9]{1,32}$/.test(config.xPixelId) ||
      (browser.navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl ||
      browser.navigator.doNotTrack === '1' || !publicPixelLocation(browser.location)) return noop;
  let active = true;
  const seen = new Set<string>();
  try {
    documentNode.dispatchEvent(new CustomEvent('gtasf:load-x-pixel', { detail: config.xPixelId }));
    if (!browser.twq) return noop;
  } catch { return noop; }
  return {
    conversion(event, conversionId, amountCents) {
      if (!active || !publicPixelLocation(browser.location) ||
          (browser.navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl ||
          browser.navigator.doNotTrack === '1' || !validAnalyticsId(conversionId)) return;
      const tag = config.xEvents[event];
      if (!tag || !new RegExp(`^tw-${config.xPixelId}-[a-z0-9]{1,32}$`).test(tag)) return;
      const dedupe = `${event}:${conversionId}`;
      if (seen.has(dedupe) || seen.size >= 256) return;
      const params: Record<string, string | number> = { conversion_id: conversionId, value: 0, currency: 'USD' };
      const twclid = cleanAttribution(attribution).twclid;
      if (twclid) params.twclid = twclid;
      if (event !== 'play_start') {
        if (amountCents === undefined || !Number.isSafeInteger(amountCents) || amountCents < 0) return;
        params.value = amountCents / 100;
        params.currency = 'USD';
      }
      try { browser.twq?.('event', tag, params); seen.add(dedupe); } catch { /* Best effort. */ }
    },
    stop() { active = false; },
  };
}
