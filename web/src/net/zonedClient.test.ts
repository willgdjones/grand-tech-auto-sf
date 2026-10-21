import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pose, S2CMessage } from '@gtasf/shared/protocol/types';
import type { ZoneGrid } from '@gtasf/shared/world/zones';

interface FakeHome { spawn?: Pose; zone?: { cx: number; cy: number }; resumeToken?: string; handoffRejected?(): void; clock: object; reconnect: ReturnType<typeof vi.fn>; activity: ReturnType<typeof vi.fn>; move: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; disposed: boolean; message(m: S2CMessage): void }
const homes: FakeHome[] = [];
vi.mock('./ws', () => ({
  connectWorld: vi.fn((opts: { spawn?: Pose; zone?: { cx: number; cy: number }; resumeToken?: string; handoffRejected?(): void; message(m: S2CMessage): void }) => {
    const h: FakeHome = { spawn: opts.spawn, zone: opts.zone, resumeToken: opts.resumeToken, handoffRejected: opts.handoffRejected, clock: { tag: homes.length }, reconnect: vi.fn(), activity: vi.fn(), move: vi.fn(), send: vi.fn(), disposed: false, dispose: vi.fn(), message: opts.message };
    h.dispose.mockImplementation(() => { h.disposed = true; });
    homes.push(h); return h;
  }),
}));

class MockSocket {
  static OPEN = 1;
  static instances: MockSocket[] = [];
  readyState = MockSocket.OPEN; binaryType = 'blob'; closed = false;
  private listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor(readonly url: string, readonly protocol?: string) { MockSocket.instances.push(this); }
  addEventListener(type: string, fn: (e: unknown) => void) { (this.listeners[type] ??= []).push(fn); }
  send() {}
  emit(data: ArrayBuffer) { for (const fn of this.listeners.message ?? []) fn({ data }); }
  close() { this.closed = true; for (const fn of this.listeners.close ?? []) fn({}); }
}

const grid: ZoneGrid = { minX: 0, minZ: 0, cols: 3, rows: 3, cell: 1000 };
const cm = (xm: number, zm: number): Pose => ({ x: xm * 100, y: 300, z: zm * 100, yaw: 0, flags: 0 });

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); homes.length = 0; MockSocket.instances.length = 0; });

async function make(message: (m: S2CMessage) => void = () => {}) {
  vi.stubGlobal('WebSocket', MockSocket as unknown as typeof WebSocket);
  vi.stubGlobal('location', { href: 'https://gtasf.com/play', protocol: 'https:' });
  const { createZonedClient } = await import('./zonedClient');
  return createZonedClient({ name: 'Karl', spawn: cm(1500, 1500), message, status: () => {} }, grid);
}
const handoff = (cx: number, cy: number): S2CMessage => ({ type: 'ZONE_HANDOFF', token: 'a'.repeat(64), cx, cy });

const welcome = (id = 7): S2CMessage => ({ type: 'WELCOME', id, resumed: true, resumeToken: 'a'.repeat(64), lastMoveSeq: 4, name: 'Karl', serverT: 1000, pose: cm(2100, 1500) });

describe('zoned client handoff (server-driven)', () => {
  it('uses the server destination and token, preserving the old transport until destination WELCOME', async () => {
    const net = await make();
    net.move(cm(1500, 1500)); // home (1,1)
    net.move(cm(2100, 1500)); // crossed into (2,1) — but the client no longer self-detects
    expect(homes).toHaveLength(1);
    homes[0]!.message(handoff(2, 1)); // the origin zone drives the handoff after transferring the session
    expect(homes).toHaveLength(2);
    expect(homes[1]!.spawn).toBeUndefined(); // preserve transferred authoritative position and movement debt
    expect(homes[1]!.zone).toEqual({ cx: 2, cy: 1 });
    expect(homes[1]!.resumeToken).toBe('a'.repeat(64));
    expect(homes[0]!.disposed).toBe(false);
    homes[1]!.message(welcome());
    expect(homes[0]!.disposed).toBe(true);
    expect(homes[1]!.disposed).toBe(false);
  });

  it('preserves the scene on a resumed handoff and fences late source frames', async () => {
    const seen: string[] = [];
    const net = await make(m => seen.push(m.type));
    homes[0]!.message(welcome());
    homes[0]!.message(handoff(2, 1));
    // Client prediction may already be back in the old cell; the server's decision still wins.
    net.move(cm(1500, 1500));
    homes[0]!.message({ type: 'PLAYER_LEAVE', id: 12 });
    homes[0]!.message(handoff(0, 0));
    expect(homes).toHaveLength(2);
    expect(homes[1]!.zone).toEqual({ cx: 2, cy: 1 });
    homes[1]!.message(welcome());
    expect(seen).toEqual(['WELCOME']); // no scene-clearing second WELCOME or stale PLAYER_LEAVE
    net.dispose();
    homes[1]!.message(handoff(1, 1));
    expect(homes).toHaveLength(2);
  });

  it('never re-homes on its own — only the server ZONE_HANDOFF triggers it', async () => {
    const net = await make();
    net.move(cm(1500, 1500));
    net.move(cm(2030, 1500)); // just past the boundary
    net.move(cm(2500, 1500)); // well into the neighbour cell
    expect(homes).toHaveLength(1);        // the server owns the decision now; the client stays put
    expect(homes[0]!.disposed).toBe(false);
  });

  it('does not forward ZONE_HANDOFF to the game (transport-only)', async () => {
    const seen: string[] = [];
    const net = await make(m => seen.push(m.type));
    net.move(cm(1500, 1500));
    homes[0]!.message(handoff(2, 1));
    homes[1]!.message({ type: 'PLAYER_LEAVE', id: 7 }); // an ordinary frame on the new home is forwarded
    expect(seen).toEqual(['PLAYER_LEAVE']); // ZONE_HANDOFF was swallowed by the transport
  });

  it('forwards the live interface to the current home and tears everything down on dispose', async () => {
    const net = await make();
    net.move(cm(1500, 1500));
    homes[0]!.message(handoff(2, 1)); // handoff to a new home
    expect(net.send({ type: 'VEHICLE_EXIT', vehicleId: 0 })).toBe(false);
    homes[1]!.message(welcome());
    net.send({ type: 'VEHICLE_EXIT', vehicleId: 0 });
    expect(homes[1]!.send).toHaveBeenCalledTimes(1); // send goes to the CURRENT home, not the old one
    expect(homes[0]!.send).not.toHaveBeenCalled();
    expect(net.clock).toBe(homes[1]!.clock);          // clock getter tracks the current home
    net.dispose();
    expect(homes[1]!.dispose).toHaveBeenCalled();
    expect(MockSocket.instances.every(s => s.closed)).toBe(true); // observer sockets closed too
  });

  it('keeps destination observation in the handoff band and merges complete vehicle sets', async () => {
    const seen: S2CMessage[] = [];
    const net = await make(m => seen.push(m));
    homes[0]!.message({ ...welcome(), pose: cm(1500, 1500) } as S2CMessage);
    net.send({ type: 'VEHICLE_MOVE', vehicleId: 1, seq: 1, ...cm(2020, 1500) });
    const destination = MockSocket.instances.find(s => s.url.includes('zone=2%2C1') && !s.closed)!;
    expect(destination).toBeDefined(); // 20 m past the border; authority is still (1,1)
    const { encodeS2C } = await import('@gtasf/shared/protocol/s2c');
    const car = (id: number, x = 0) => ({ id, ...cm(x, 1500), kind: 'prius' as const, driverId: 0, speedCmps: 0 });
    homes[0]!.message({ type: 'VEHICLE_SNAPSHOT', tick: 1, serverT: 1000, entries: [car(1), car(3)] });
    const frame = encodeS2C({ type: 'VEHICLE_SNAPSHOT', tick: 1, serverT: 1001, entries: [car(2), car(3, 1)] });
    destination.emit(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) as ArrayBuffer);
    const merged = seen.at(-1) as Extract<S2CMessage, { type: 'VEHICLE_SNAPSHOT' }>;
    expect(merged.entries.map(c => c.id).sort()).toEqual([1, 2, 3]);
    expect(merged.entries.find(c => c.id === 3)!.x).toBe(100);
    homes[0]!.message({ type: 'VEHICLE_SNAPSHOT', tick: 2, serverT: 1002, entries: [car(1)] });
    expect((seen.at(-1) as typeof merged).entries.map(c => c.id).sort()).toEqual([1, 2, 3]);
    net.dispose();
  });

  it('recovers a rejected claim on the existing source without minting a new player', async () => {
    const net = await make();
    homes[0]!.message(welcome()); homes[0]!.message(handoff(2, 1));
    homes[1]!.handoffRejected!();
    expect(homes[1]!.disposed).toBe(true);
    expect(homes[0]!.reconnect).toHaveBeenCalledOnce();
    net.move(cm(1900, 1500));
    expect(homes[0]!.move).toHaveBeenCalled();
    homes[1]!.message(welcome(8)); // late destination messages have no authority
    expect(homes).toHaveLength(2);
    expect(homes[0]!.disposed).toBe(false);
    net.dispose();
  });
  it('does not re-enter the same vehicle or reset its input sequence after a resumed transfer', async () => {
    const seen: S2CMessage[] = [];
    const net = await make(m => seen.push(m));
    const seat: S2CMessage = { type: 'VEHICLE_STATE', vehicleId: 100, playerId: 7, mode: 'driver' };
    homes[0]!.message(welcome()); homes[0]!.message(seat); homes[0]!.message(handoff(2, 1));
    homes[1]!.message(welcome()); homes[1]!.message(seat);
    expect(seen.filter(m => m.type === 'VEHICLE_STATE')).toHaveLength(1);
    homes[1]!.message({ ...seat, mode: 'on-foot' });
    expect(seen.filter(m => m.type === 'VEHICLE_STATE')).toHaveLength(2);
    net.dispose();
  });
});
