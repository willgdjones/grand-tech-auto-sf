import { expect, test, vi } from 'vitest';
import { createOutbidReceiptTracker, rememberOutbidCheckout } from './analyticsReceipt';
const state = vi.hoisted(() => ({ permitted: true, pixel: vi.fn() }));
vi.mock('@gtasf/shared/flags', () => ({ flags: { xAdsPixel: true } }));
vi.mock('../analytics', () => ({ analyticsContext: () => state.permitted ? { permitted: true } : undefined, trackPurchasePixel: state.pixel }));

test('pending checkout cannot convert; authenticated paid receipt uses cash cents and exact UUID once', async () => {
  vi.useFakeTimers();
  const storage = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal('window', new EventTarget());
  const receipt = { conversionId: crypto.randomUUID(), amountCents: 650 };
  const send = vi.fn().mockResolvedValueOnce(new Response(null, { status: 202 })).mockResolvedValue(Response.json({ receipt }));
  vi.stubGlobal('fetch', send);
  const tracker = createOutbidReceiptTracker();
  try {
    state.permitted = false; rememberOutbidCheckout('a'.repeat(32)); await tracker.refresh();
    expect(send).not.toHaveBeenCalled();
    state.permitted = true; rememberOutbidCheckout('a'.repeat(32));
    await tracker.refresh();
    expect(state.pixel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenLastCalledWith(`/api/outbid/receipt?orderId=${'a'.repeat(32)}`, expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }));
    expect(state.pixel).toHaveBeenCalledExactlyOnceWith('outbid_purchase', receipt);
    await tracker.refresh(); expect(send).toHaveBeenCalledTimes(2);
    rememberOutbidCheckout('b'.repeat(32));
    state.permitted = false; await tracker.refresh(); expect(send).toHaveBeenCalledTimes(2);
  } finally { tracker.destroy(); state.permitted = true; vi.useRealTimers(); vi.unstubAllGlobals(); }
});
