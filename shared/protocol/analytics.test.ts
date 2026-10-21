import { expect, test } from 'vitest';
import { encodeC2S, decodeC2S } from './c2s';
import { C2S, C2S_MAX_BYTES } from './constants';

test('analytics HELLO preserves legacy framing, carries bounded consent, and supports opt-in/revoke', () => {
  const hello = { type: 'HELLO' as const, name: 'Founder' };
  const legacy = encodeC2S(hello);
  expect(legacy[0]).toBe(C2S.HELLO);
  expect(decodeC2S(legacy)).toEqual({ ok: true, msg: hello });
  const analytics = { permitted: true as const, distinctId: crypto.randomUUID(), playConversionId: crypto.randomUUID(), attribution: { twclid: 'click_123', utm_source: 'x' } };
  const bytes = encodeC2S({ ...hello, analytics });
  expect(bytes[0]).toBe(C2S.HELLO_ANALYTICS);
  expect(decodeC2S(bytes)).toEqual({ ok: true, msg: { ...hello, analytics } });
  expect(decodeC2S(encodeC2S({ type: 'ANALYTICS', analytics }))).toEqual({ ok: true, msg: { type: 'ANALYTICS', analytics } });
  expect(decodeC2S(encodeC2S({ type: 'ANALYTICS' }))).toEqual({ ok: true, msg: { type: 'ANALYTICS' } });
  const many = { ...analytics, attribution: { ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`utm_${i}`, 'a'.repeat(256)])), twclid: 'keep_this' } };
  const bounded = encodeC2S({ ...hello, analytics: many });
  expect(bounded.length).toBeLessThan(C2S_MAX_BYTES);
  const decoded = decodeC2S(bounded);
  expect(decoded.ok && decoded.msg.type === 'HELLO' && decoded.msg.analytics?.attribution.twclid).toBe('keep_this');
  expect(decodeC2S(bytes.slice(0, -1)).ok).toBe(false);
});
