import { expect, test } from 'vitest';
import { encodeC2S, decodeC2S } from './c2s';
import { encodeS2C, decodeS2C } from './s2c';
import type { C2SMessage, S2CMessage } from './types';
const destination = { x: -100000, y: 8400, z: -199000 }, pose = { ...destination, yaw: 45, flags: 0x80 };
const quick = { title: 'Lombard Street', eventId: '', friend: '', maxFareCents: '55000' };
test('quick ride metadata, quotes, readiness and friend notice survive the wire; fallback stays unchanged', () => {
  const requests: C2SMessage[] = [
    { type: 'ROBOTAXI_HAIL', requestId: 7, destination },
    { type: 'ROBOTAXI_HAIL', requestId: 8, destination, quick },
    { type: 'ROBOTAXI_QUOTE', requestId: 9, destination, quick: { ...quick, friend: 'founder' } },
    { type: 'ROBOTAXI_READY', requestId: 8 },
  ];
  for (const msg of requests) expect(decodeC2S(encodeC2S(msg))).toEqual({ ok: true, msg });
  expect(encodeC2S(requests[0]!)).toHaveLength(17);
  const messages: S2CMessage[] = [
    { type: 'ROBOTAXI_STATE', requestId: 8, vehicleId: 1001, state: 'quick', pose, destination, etaSeconds: 0,
      quick: { title: 'Lombard Street', fareCents: '0', freeRidesLeft: 2, durationMs: 4000 } },
    { type: 'ROBOTAXI_FRIEND_NOTICE', name: 'A founder' },
  ];
  for (const msg of messages) expect(decodeS2C(encodeS2C(msg))).toEqual({ ok: true, msg });
  expect(decodeC2S(encodeC2S(requests[1]!).slice(0, -1)).ok).toBe(false);
  expect(decodeS2C(encodeS2C(messages[0]!).slice(0, -1)).ok).toBe(false);
});
test('reject malformed quoted fares before dispatch', () => {
  const msg: C2SMessage = { type: 'ROBOTAXI_HAIL', requestId: 1, destination, quick: { ...quick, maxFareCents: '-100' } };
  expect(decodeC2S(encodeC2S(msg))).toMatchObject({ ok: false, err: 'OUT_OF_RANGE' });
});
