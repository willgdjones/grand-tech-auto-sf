import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectWorld } from './ws';
import { flags } from '@gtasf/shared/flags';
vi.mock('../admission/client', () => ({ waitForAdmission: vi.fn(async () => undefined), admissionConsumed: vi.fn(), invalidateAdmission: vi.fn() }));
// Pin this disabled-feature scenario independently of the playable local flag map.
vi.mock('@gtasf/shared/flags', async importOriginal => {
  const original = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { ...original, flags: { ...original.flags, chat: false, eventChat: false, zonedWorld: true } };
});
import { decodeC2S } from '@gtasf/shared/protocol/c2s';
import { encodeS2C } from '@gtasf/shared/protocol/s2c';
import { CloseCode, PROTOCOL_SUBPROTOCOL } from '@gtasf/shared/protocol/constants';
import type { Pose, S2CMessage } from '@gtasf/shared/protocol/types';

class Transport {
  static OPEN = 1;
  static instances: Transport[] = [];
  readyState = 0;
  binaryType = '';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: Uint8Array[] = [];
  constructor(readonly url: URL, readonly protocol: string) { Transport.instances.push(this); }
  send(bytes: Uint8Array) { this.sent.push(bytes); }
  open() { this.readyState = 1; this.onopen?.(); }
  close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
  receive(message: S2CMessage) { this.onmessage?.({ data: encodeS2C(message).buffer as ArrayBuffer }); }
}
const welcome = { type: 'WELCOME' as const, id: 70000, serverT: 1780000000000, name: 'Karl',
  pose: { x: 900000, y: 12000, z: -900000, yaw: 0, flags: 0 }, resumeToken: 'a'.repeat(64), lastMoveSeq: 65535, resumed: true };
let disconnect: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers(); Transport.instances = [];
  const data = new Map<string, string>();
  vi.stubGlobal('WebSocket', Transport);
  vi.stubGlobal('location', { href: 'https://gtasf.example/' });
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
});
afterEach(() => { disconnect?.(); disconnect = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
async function harness(spawn?: Pose) {
  const message = vi.fn(), status = vi.fn();
  const net = connectWorld({ name: '  Karl ', spawn, message, status }); disconnect = net.dispose;
  await Promise.resolve();
  return { net, message, status, current: () => Transport.instances.at(-1)! };
}
it('sends ride-stage metadata with rides on while character looks stay disabled', async () => {
  const saved = { personalRides: flags.personalRides, characterLooks: flags.characterLooks };
  Object.assign(flags, { personalRides: true, characterLooks: false });
  try {
    const h = await harness(); h.current().open(); h.current().receive(welcome);
    const message = { type: 'SET_APPEARANCE' as const, appearance: 12345 };
    expect(h.net.send(message)).toBe(true);
    expect(decodeC2S(h.current().sent.at(-1)!)).toEqual({ ok: true, msg: message });
    Object.assign(flags, { personalRides: false });
    expect(h.net.send(message)).toBe(false);
  } finally { Object.assign(flags, saved); }
});
it('resumes with its token, restores feet after WELCOME and continues the acknowledged sequence', async () => {
  const h = await harness(welcome.pose), first = h.current();
  expect(first.url.searchParams.get('spawn')).toBe('900000,12000,-900000,0');
  expect(first.protocol).toBe(PROTOCOL_SUBPROTOCOL);
  first.open(); expect(decodeC2S(first.sent[0]!)).toEqual({ ok: true, msg: { type: 'HELLO', name: 'Karl' } });
  first.receive(welcome);
  expect(h.message.mock.calls.map(call => call[0].type)).toEqual(['WELCOME', 'CORRECTION']);
  expect(h.message.mock.lastCall?.[0]).toEqual({ type: 'CORRECTION', pose: welcome.pose });
  h.net.move(welcome.pose);
  expect(decodeC2S(first.sent.at(-1)!)).toEqual({ ok: true, msg: { type: 'MOVE', seq: 0, ...welcome.pose } });
  first.close(1006); await vi.advanceTimersByTimeAsync(800);
  const second = h.current(); second.open();
  expect(second.url.searchParams.has('spawn')).toBe(false);
  expect(decodeC2S(second.sent[0]!)).toEqual({ ok: true, msg: { type: 'HELLO', name: 'Karl', resumeToken: welcome.resumeToken } });
  second.receive(welcome);
  const calls = h.message.mock.calls.length;
  first.onmessage?.({ data: encodeS2C({ type: 'PLAYER_LEAVE', id: 3 }).buffer as ArrayBuffer });
  first.onclose?.({ code: 1006 });
  await vi.advanceTimersByTimeAsync(1500);
  expect(h.message.mock.calls.length).toBe(calls);
  expect(Transport.instances).toHaveLength(2);
});
it('abandons an expired token and lets a duplicated tab join with a separate identity', async () => {
  const h = await harness(); h.current().open(); h.current().receive(welcome); h.current().close(1006);
  await vi.advanceTimersByTimeAsync(800); h.current().open(); h.current().close(CloseCode.BAD_RESUME);
  await vi.advanceTimersByTimeAsync(1400); const fresh = h.current(); fresh.open();
  expect(decodeC2S(fresh.sent[0]!)).toEqual({ ok: true, msg: { type: 'HELLO', name: 'Karl' } });
  fresh.receive({ ...welcome, resumed: false }); fresh.close(CloseCode.SUPERSEDED);
  await vi.advanceTimersByTimeAsync(800); const duplicate = h.current(); duplicate.open();
  expect(decodeC2S(duplicate.sent[0]!)).toEqual({ ok: true, msg: { type: 'HELLO', name: 'Karl' } });
  expect(duplicate.url.searchParams.get('spawn')).toBe('900000,12000,-900000,0');
  duplicate.receive({ ...welcome, id: welcome.id + 1, resumeToken: 'b'.repeat(64), resumed: false });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(Transport.instances).toHaveLength(4);
  expect(h.status).toHaveBeenLastCalledWith('Connected');
});
it('gtasf-j7wvv: a socket that was up >= 5 s retries at once after a 1006; one that died sooner backs off', async () => {
  const h = await harness(), first = h.current();
  first.open(); first.receive(welcome);
  await vi.advanceTimersByTimeAsync(6000);
  first.close(1006); await vi.advanceTimersByTimeAsync(360);
  expect(Transport.instances).toHaveLength(2); // 100 ms + <=250 ms jitter, not 500-750 ms
  const second = h.current(); second.open(); second.receive(welcome);
  second.close(1006); await vi.advanceTimersByTimeAsync(360);
  expect(Transport.instances).toHaveLength(2); // up < 5 s: the normal backoff
  await vi.advanceTimersByTimeAsync(500);
  expect(Transport.instances).toHaveLength(3);
});
it('bounds handshake retries, leaves disabled gameplay off and cancels all retries on dispose', async () => {
  const h = await harness(); h.current().open();
  await vi.advanceTimersByTimeAsync(10_800); expect(Transport.instances).toHaveLength(2);
  h.current().open(); h.current().receive(welcome);
  expect(h.net.send({ type: 'CHAT', clientMsgId: 1, eventId: 0, text: 'hello' })).toBe(false);
  h.current().close(1006); h.net.dispose(); await vi.advanceTimersByTimeAsync(60_000);
  expect(Transport.instances).toHaveLength(2);
});
it('keeps anonymous reconnect usable when browser storage is unavailable', async () => {
  vi.stubGlobal('sessionStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  const h = await harness(); h.current().open(); h.current().receive(welcome); h.current().close(1006);
  await vi.advanceTimersByTimeAsync(800); h.current().open();
  const decoded = decodeC2S(h.current().sent[0]!);
  expect(decoded.ok && decoded.msg.type === 'HELLO' && decoded.msg.resumeToken).toBe(welcome.resumeToken);
});

it('pins the transferred zone on reconnect and resumes without session storage or a spawn override', async () => {
  vi.stubGlobal('sessionStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  const net = connectWorld({ name: 'Karl', zone: { cx: 1, cy: 0 }, resumeToken: welcome.resumeToken, message: vi.fn(), status: vi.fn() });
  disconnect = net.dispose;
  await Promise.resolve();
  const first = Transport.instances.at(-1)!; first.open();
  expect(first.url.searchParams.get('zone')).toBe('1,0');
  expect(first.url.searchParams.has('spawn')).toBe(false);
  expect(first.url.searchParams.has('token')).toBe(false);
  expect(decodeC2S(first.sent[0]!)).toEqual({ ok: true, msg: { type: 'HELLO', name: 'Karl', resumeToken: welcome.resumeToken } });
  first.receive(welcome); first.close(1006);
  await vi.advanceTimersByTimeAsync(800);
  const second = Transport.instances.at(-1)!;
  expect(second.url.searchParams.get('zone')).toBe('1,0');
});
it('holds server state sent before WELCOME (a restored wanted level) and replays it after, instead of closing', async () => {
  const h = await harness(), socket = h.current();
  const close = vi.spyOn(socket, 'close');
  socket.open();
  socket.receive({ type: 'WANTED', level: 2 }); // WorldDO.install() restored the stashed heat on a reconnect
  expect(close).not.toHaveBeenCalled();
  expect(h.message).not.toHaveBeenCalled();
  socket.receive(welcome);
  expect(h.message.mock.calls.map(call => call[0].type)).toEqual(['WELCOME', 'CORRECTION', 'WANTED']);
  expect(h.message.mock.lastCall?.[0]).toEqual({ type: 'WANTED', level: 2 });
  expect(h.status).toHaveBeenLastCalledWith('Connected');
});
it('retries a PROTOCOL close a few times (with backoff) before telling the player to reload', async () => {
  const h = await harness(), first = h.current();
  first.open(); first.receive(welcome);
  first.receive(welcome); // a repeated WELCOME is a protocol error → client closes 4004
  expect(h.status).toHaveBeenLastCalledWith('Reconnecting');
  for (let i = 0; i < 3; i++) {
    await vi.advanceTimersByTimeAsync(5_000); // backoff ≤ ~4.3 s; under the 10 s handshake timeout
    const next = h.current(); next.open(); next.close(CloseCode.PROTOCOL);
  }
  expect(Transport.instances).toHaveLength(4); // 1 + 3 retries
  expect(h.status).toHaveBeenLastCalledWith('Connection rejected; reload to reconnect');
  await vi.advanceTimersByTimeAsync(20_000);
  expect(Transport.instances).toHaveLength(4); // gave up
});
