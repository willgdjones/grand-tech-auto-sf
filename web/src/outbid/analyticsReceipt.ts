import { flags } from '@gtasf/shared/flags';
import { validAnalyticsId } from '@gtasf/shared/analytics';
import { analyticsContext, trackPurchasePixel } from '../analytics';
const KEY = 'gtasf.outbid.analytics.pending.v1';
interface PendingOrder { orderId: string; expires: number }
function pendingOrders(): PendingOrder[] {
  try {
    const values: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(values)) return [];
    return values.filter((value): value is PendingOrder => value && typeof value.orderId === 'string' && /^[a-f0-9]{32}$/.test(value.orderId) && Number.isFinite(value.expires) && value.expires > Date.now()).slice(-8);
  } catch { return []; }
}
function save(values: PendingOrder[]) { try { sessionStorage.setItem(KEY, JSON.stringify(values)); } catch {} }

/** Called only after a successful authenticated checkout response, before leaving for Stripe. */
export function rememberOutbidCheckout(orderId: unknown): void {
  if (!flags.xAdsPixel || !analyticsContext() || typeof orderId !== 'string' || !/^[a-f0-9]{32}$/.test(orderId)) return;
  save([...pendingOrders().filter(order => order.orderId !== orderId), { orderId, expires: Date.now() + 86400_000 }].slice(-8));
}

/** One bounded refresh, driven by panel/focus/consent events. Redirect parameters grant nothing. */
export function createOutbidReceiptTracker() {
  if (!flags.xAdsPixel) return { refresh: async () => {}, destroy() {} };
  let disposed = false, running: Promise<void> | undefined, retries = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  async function check() {
    if (disposed || !flags.xAdsPixel || !analyticsContext()) return;
    let waiting = false;
    for (const order of pendingOrders()) {
      if (disposed) return;
      try {
        const response = await fetch(`/api/outbid/receipt?orderId=${order.orderId}`, {
          credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]),
        });
        if (response.status === 202) { waiting = true; continue; }
        if (response.status === 404) { save(pendingOrders().filter(item => item.orderId !== order.orderId)); continue; }
        if (!response.ok || response.status !== 200) continue;
        const body = await response.json() as { receipt?: { conversionId?: unknown; amountCents?: unknown } };
        const receipt = body.receipt;
        if (!receipt || !validAnalyticsId(receipt.conversionId) || typeof receipt.amountCents !== 'number' || !Number.isSafeInteger(receipt.amountCents) || receipt.amountCents < 0) continue;
        if (disposed || !analyticsContext()) return;
        trackPurchasePixel('outbid_purchase', { conversionId: receipt.conversionId, amountCents: receipt.amountCents });
        save(pendingOrders().filter(item => item.orderId !== order.orderId));
      } catch { /* Network failure/late webhook can retry at next visible refresh. */ }
    }
    if (waiting && !disposed && retries++ < 5) retry = setTimeout(() => { void perform(); }, 2000);
  }
  function perform(): Promise<void> {
    if (running) return running;
    running = check().finally(() => { running = undefined; });
    return running;
  }
  function refresh(): Promise<void> { clearTimeout(retry); retries = 0; return perform(); }
  const ready = () => { void refresh(); };
  window.addEventListener('gtasf:analytics-ready', ready);
  return { refresh, destroy() { disposed = true; clearTimeout(retry); controller.abort(); window.removeEventListener('gtasf:analytics-ready', ready); } };
}
