import { afterEach, describe, expect, it, vi } from 'vitest';
import { createZoneObservers } from './zoneObservers';
import { encodeS2C } from '@gtasf/shared/protocol/s2c';
import type { Pose, S2CMessage } from '@gtasf/shared/protocol/types';
import type { ZoneGrid } from '@gtasf/shared/world/zones';

// Minimal WebSocket stub: records the URL, captures listeners, lets the test push frames.
class MockSocket {
  static OPEN = 1;
  static instances: MockSocket[] = [];
  readyState = MockSocket.OPEN;
  binaryType = 'blob';
  sent: Uint8Array[] = [];
  closed = false;
  private listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor(readonly url: string, readonly protocol?: string) { MockSocket.instances.push(this); }
  addEventListener(type: string, fn: (e: unknown) => void) { (this.listeners[type] ??= []).push(fn); }
  send(data: Uint8Array) { this.sent.push(data); }
  close() { this.closed = true; for (const fn of this.listeners.close ?? []) fn({}); }
  emit(data: ArrayBuffer) { for (const fn of this.listeners.message ?? []) fn({ data }); }
}

const grid: ZoneGrid = { minX: 0, minZ: 0, cols: 3, rows: 3, cell: 1000 };
const page = { href: 'https://gtasf.com/play', protocol: 'https:' };
// Poses are centimetres; /100 gives metres. Centre of cell (1,1) = 1500 m; near its west edge = 1050 m.
const cm = (xm: number, zm: number): Pose => ({ x: xm * 100, y: 300, z: zm * 100, yaw: 0, flags: 0 });

afterEach(() => { vi.unstubAllGlobals(); MockSocket.instances.length = 0; });

describe('client zone observer sockets', () => {
  it('opens a read-only observer socket to the neighbour across a near edge', () => {
    vi.stubGlobal('WebSocket', MockSocket as unknown as typeof WebSocket);
    const observers = createZoneObservers({ onMessage: () => {}, grid, location: page, identity: () => ({ id: 7, home: { cx: 1, cy: 1 }, token: 'a'.repeat(64) }) });
    observers.update(cm(1050, 1500)); // near the west edge of cell (1,1)
    expect(observers.openZones).toEqual(['z:0:1']);
    const sock = MockSocket.instances[0]!;
    expect(sock.protocol).toBeDefined();
    expect(sock.url).toContain('observe=1');
    expect(sock.url).toContain('zone=0%2C1'); // "0,1" url-encoded
    expect(sock.url.startsWith('wss://')).toBe(true);
    // A non-authoritative MOVE refreshes the server-side filter pose.
    expect(sock.sent.length).toBe(1);
  });

  it('routes an observer SNAPSHOT to the shared message handler', () => {
    vi.stubGlobal('WebSocket', MockSocket as unknown as typeof WebSocket);
    const received: S2CMessage[] = [];
    const observers = createZoneObservers({ onMessage: m => received.push(m), grid, location: page, identity: () => ({ id: 7, home: { cx: 1, cy: 1 }, token: 'a'.repeat(64) }) });
    observers.update(cm(1050, 1500));
    const frame = encodeS2C({ type: 'SNAPSHOT', tick: 1, serverT: 123, entries: [{ id: 99, x: 7, y: 8, z: 9, yaw: 0, flags: 0 }] });
    MockSocket.instances[0]!.emit(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) as ArrayBuffer);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: 'SNAPSHOT', entries: [{ id: 99 }] });
  });

  it('re-plans: closes observers no longer adjacent, and disposes all', () => {
    vi.stubGlobal('WebSocket', MockSocket as unknown as typeof WebSocket);
    const observers = createZoneObservers({ onMessage: () => {}, grid, location: page, identity: () => ({ id: 7, home: { cx: 1, cy: 1 }, token: 'a'.repeat(64) }) });
    observers.update(cm(1050, 1050)); // SW corner of (1,1): three neighbours
    expect(observers.openZones.sort()).toEqual(['z:0:0', 'z:0:1', 'z:1:0']);
    observers.update(cm(1500, 1500)); // centre: no neighbours in range
    expect(observers.openZones).toEqual([]);
    expect(MockSocket.instances.every(s => s.closed)).toBe(true);
    observers.update(cm(1050, 1500)); // one neighbour again
    expect(observers.openZones).toEqual(['z:0:1']);
    observers.dispose();
    expect(observers.openZones).toEqual([]);
  });
});
