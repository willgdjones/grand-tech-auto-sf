import type { Pose, S2CMessage, VehicleEntry } from '@gtasf/shared/protocol/types';
import { SF_ZONE_GRID, cellOf, inGrid, zoneId, type Cell, type ZoneGrid } from '@gtasf/shared/world/zones';
import { connectWorld } from './ws';
import { createZoneObservers } from './zoneObservers';

type VehicleFrame = Extract<S2CMessage, { type: 'VEHICLE_SNAPSHOT' }>;

/** One writable home plus observers. Each socket owns a complete vehicle set; merge those sets
 * before the renderer sees them, and retain the source until a claimed destination welcomes us. */
export function createZonedClient(options: Parameters<typeof connectWorld>[0], grid: ZoneGrid = SF_ZONE_GRID): ReturnType<typeof connectWorld> {
  let lastPose: Pose | undefined = options.spawn;
  let selfId: number | undefined, disposed = false;
  let observerToken: string | undefined;
  let selfSeat: Extract<S2CMessage, { type: 'VEHICLE_STATE' }> | undefined;
  let pending: ReturnType<typeof connectWorld> | undefined;
  let pendingCell: Cell | undefined, pendingGeneration: number | undefined;
  let generation = 0, homeGeneration = 0;
  let homeCell = options.spawn ? cellOf(grid, options.spawn.x / 100, options.spawn.z / 100) : undefined;
  const vehicles = new Map<string, VehicleFrame>();
  const observers = createZoneObservers({
    identity: () => selfId !== undefined && homeCell && observerToken ? { id: selfId, home: homeCell, token: observerToken } : undefined,
    onMessage: (m, zone) => { if (!disposed) deliver(m, `observer:${zone}`); },
    onDrop(zone) { vehicles.delete(`observer:${zone}`); }, grid,
  });
  let home = open(homeCell);

  function deliver(m: S2CMessage, source: string): void {
    if (m.type !== 'VEHICLE_SNAPSHOT') { options.message(m); return; }
    vehicles.set(source, m);
    const merged = new Map<number, { entry: VehicleEntry; at: number; home: boolean }>();
    for (const [key, frame] of vehicles) for (const entry of frame.entries) {
      const before = merged.get(entry.id), isHome = key === 'home';
      if (!before || frame.serverT > before.at || (frame.serverT === before.at && isHome))
        merged.set(entry.id, { entry, at: frame.serverT, home: isHome });
    }
    options.message({ ...m, entries: [...merged.values()].map(v => v.entry) });
  }
  function updateObservers(): void { if (lastPose) observers.update(lastPose, homeCell); }
  function cancelPending(): void {
    const rejected = pending; pending = undefined; pendingCell = undefined; pendingGeneration = undefined;
    rejected?.dispose(); home.reconnect(); updateObservers();
  }
  function open(zone?: Cell, transfer?: Extract<S2CMessage, { type: 'ZONE_HANDOFF' }>): ReturnType<typeof connectWorld> {
    const mine = ++generation;
    if (transfer) pendingGeneration = mine; else homeGeneration = mine;
    return connectWorld({ ...options, zone, spawn: transfer ? undefined : options.spawn,
      resumeToken: transfer?.token,
      ...(transfer ? { handoffRejected() { if (!disposed && mine === pendingGeneration) cancelPending(); } } : {}),
      status(text) {
        if (!disposed && mine === homeGeneration && !pending) options.status(text);
      },
      message(m) {
        if (disposed) return;
        if (pending && mine === homeGeneration) {
          // A source correction means its prepare/claim expired. Resume that same owner and token.
          if (m.type !== 'CORRECTION') return;
          cancelPending();
        }
        if (mine !== homeGeneration && mine !== pendingGeneration) return;
        if (m.type === 'ZONE_HANDOFF') {
          if (pending || !inGrid(grid, m.cx, m.cy)) return;
          pendingCell = { cx: m.cx, cy: m.cy };
          pending = open(pendingCell, m);
          return;
        }
        if (m.type === 'WELCOME') {
          if (pending && mine === pendingGeneration) {
            const previous = home; home = pending; pending = undefined;
            homeGeneration = mine; homeCell = pendingCell; pendingCell = undefined; pendingGeneration = undefined;
            // Promote the destination's last observer frame before closing its observer socket.
            const observed = homeCell && vehicles.get(`observer:${zoneId(homeCell.cx, homeCell.cy)}`);
            if (observed) vehicles.set('home', observed);
            previous.dispose(); options.status('Connected');
          }
          const samePlayer = m.resumed && m.id === selfId;
          selfId = m.id; observerToken = m.resumeToken; lastPose = { ...m.pose };
          homeCell ??= cellOf(grid, m.pose.x / 100, m.pose.z / 100);
          updateObservers();
          if (samePlayer) return; // main.ts WELCOME resets the scene and ejects the driver
          selfSeat = undefined;
        }
        if (m.type === 'VEHICLE_STATE' && m.playerId === selfId) {
          // main.ts treats this as a fresh entry and resets vehicleSeq/camera. A transferred seat is
          // already occupied, so its replay must not rewind the driver's sequence to zero.
          if (selfSeat?.vehicleId === m.vehicleId && selfSeat.mode === m.mode) return;
          selfSeat = m;
        }
        if (m.type === 'CORRECTION' || (m.type === 'ROBOTAXI_STATE' && m.state === 'riding')) {
          lastPose = { ...m.pose }; updateObservers();
        }
        deliver(m, 'home');
      },
    });
  }

  return {
    get clock() { return home.clock; },
    reconnect() { if (!pending) home.reconnect(); },
    activity() { if (!pending) home.activity(); },
    move(pose) { lastPose = { ...pose }; if (!pending) home.move(pose); updateObservers(); },
    send(message) {
      if (message.type === 'VEHICLE_MOVE') { lastPose = { ...message }; updateObservers(); }
      return pending ? false : home.send(message);
    },
    dispose() { disposed = true; observers.dispose(); vehicles.clear(); pending?.dispose(); home.dispose(); },
  };
}
