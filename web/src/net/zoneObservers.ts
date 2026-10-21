import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { observerProtocols, type ObserverIdentity } from '@gtasf/shared/world/observers';
import type { Pose, S2CMessage } from '@gtasf/shared/protocol/types';
import { SF_ZONE_GRID, zoneView, zoneId, type Cell, type ZoneGrid } from '@gtasf/shared/world/zones';

/**
 * Client half of seamless cross-zone visibility (docs/engineering/zoned-world.md §5–§7).
 *
 * While the home-zone socket (`ws.ts`) is unchanged, this opens **read-only** observer sockets to
 * the 0–3 neighbour zones whose border is within interest range of the player (`borderObservers`),
 * and feeds their decoded frames into the *same* handler the home socket uses — so SNAPSHOTs from
 * neighbour zones flow into the one `remotes` store. Merging is collision-free because player ids
 * are globally unique across zones (gtasf-l1qi/xlbt). The player re-plans as they move (open new,
 * close stale) and refreshes each observer's server-side filter pose with a non-authoritative MOVE.
 *
 * Opt-in: `main.ts` constructs this only when `flags.zonedWorld`, so the single-world path is
 * untouched. Observer sockets never send gameplay commands; the server rejects any other C2S frame.
 */
export function createZoneObservers(options: {
  /** Feed each observer zone's decoded S2C frames to the home socket's message handler. */
  onMessage(message: S2CMessage, zone: string): void;
  onDrop?(zone: string): void;
  identity?(): ObserverIdentity | undefined;
  grid?: ZoneGrid;
  /** Base URL source; defaults to the page location. */
  location?: { href: string; protocol: string };
}) {
  const grid = options.grid ?? SF_ZONE_GRID;
  const loc = options.location ?? location;
  const sockets = new Map<string, WebSocket>();
  let disposed = false;
  let identityKey = '';

  function urlFor(cell: Cell, pose: Pose): string {
    const url = new URL('/api/world', loc.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('observe', '1');
    url.searchParams.set('zone', `${cell.cx},${cell.cy}`);
    url.searchParams.set('spawn', `${pose.x},${pose.y},${pose.z},${pose.yaw}`);
    return url.toString();
  }

  function openObserver(cell: Cell, pose: Pose): void {
    const id = zoneId(cell.cx, cell.cy);
    if (sockets.has(id)) return;
    const identity = options.identity?.();
    if (!identity) return;
    const socket = new WebSocket(urlFor(cell, pose), observerProtocols(identity));
    socket.binaryType = 'arraybuffer';
    sockets.set(id, socket);
    socket.addEventListener('message', event => {
      if (disposed || sockets.get(id) !== socket || !(event.data instanceof ArrayBuffer)) return;
      const decoded = decodeS2C(new Uint8Array(event.data));
      if (decoded.ok) options.onMessage(decoded.msg, id);
    });
    const drop = () => { if (sockets.get(id) === socket) { sockets.delete(id); options.onDrop?.(id); } };
    socket.addEventListener('close', drop);
    socket.addEventListener('error', drop);
  }

  function closeObserver(id: string): void {
    const socket = sockets.get(id);
    if (!socket) return;
    sockets.delete(id);
    options.onDrop?.(id);
    try { socket.close(); } catch { /* already closing */ }
  }

  return {
    /** Re-plan observer sockets for the player's current pose and refresh their filter poses. */
    update(pose: Pose, authority?: Cell): void {
      if (disposed) return;
      const identity = options.identity?.();
      const nextKey = identity ? `${identity.id}:${identity.home.cx}:${identity.home.cy}:${identity.token}` : '';
      if (nextKey !== identityKey) {
        for (const id of [...sockets.keys()]) closeObserver(id);
        identityKey = nextKey;
      }
      if (!identity) return;
      const view = zoneView(grid, pose.x / 100, pose.z / 100);
      // During the 50 m handoff band, geographic home and writable home differ. Keep observing the
      // destination throughout that band instead of accidentally closing it on the exact border.
      const wanted = authority ? [view.home, ...view.observers].filter(c => c.cx !== authority.cx || c.cy !== authority.cy) : view.observers;
      const wantedIds = new Set(wanted.map(cell => zoneId(cell.cx, cell.cy)));
      for (const cell of wanted) openObserver(cell, pose);
      for (const id of [...sockets.keys()]) if (!wantedIds.has(id)) closeObserver(id);
      for (const socket of sockets.values()) {
        if (socket.readyState !== WebSocket.OPEN) continue;
        try { socket.send(encodeC2S({ type: 'MOVE', seq: 0, x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, flags: 0 })); }
        catch { /* socket closing */ }
      }
    },
    /** Zone ids with an open observer socket (for tests/telemetry). */
    get openZones(): string[] { return [...sockets.keys()]; },
    dispose(): void { disposed = true; for (const id of [...sockets.keys()]) closeObserver(id); },
  };
}
