import { validResumeToken } from '../protocol/fields';
import { PROTOCOL_SUBPROTOCOL } from '../protocol/constants';
import { inGrid, type Cell, type ZoneGrid } from './zones';

export interface ObserverIdentity { id: number; home: Cell; token: string }
const PREFIX = 'gtasf.observer.';

/** Session credentials travel in the upgrade header, never URLs or access logs. */
export function observerProtocols(identity: ObserverIdentity): string[] {
  return [PROTOCOL_SUBPROTOCOL, `${PREFIX}${identity.id}.${identity.home.cx}.${identity.home.cy}.${identity.token}`];
}

export function readObserverIdentity(header: string | null, grid: ZoneGrid): ObserverIdentity | undefined {
  const value = header?.split(',').map(p => p.trim()).find(p => p.startsWith(PREFIX));
  const parts = value?.slice(PREFIX.length).split('.');
  if (!parts || parts.length !== 4) return;
  const id = Number(parts[0]), cx = Number(parts[1]), cy = Number(parts[2]), token = parts[3]!;
  if (!Number.isInteger(id) || id <= 0 || id > 0xffffffff || !inGrid(grid, cx, cy) || !validResumeToken(token)) return;
  return { id, home: { cx, cy }, token };
}
