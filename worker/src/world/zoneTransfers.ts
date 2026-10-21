import { SF_ZONE_GRID, type Cell } from '@gtasf/shared/world/zones';
import { validZoneCell } from '@gtasf/shared/world/topology';
import { validOccupiedTransfer, type OccupiedVehicleTransfer } from './vehicleHandoff';

export const TRANSFER_TIMEOUT_MS = 8000;
export interface ZoneTransfer {
  key: string;
  from: Cell;
  to: Cell;
  expiresAt: number;
  vehicle?: OccupiedVehicleTransfer;
}
export function validZoneTransfer(value: unknown, now: number): value is ZoneTransfer {
  if (!value || typeof value !== 'object') return false;
  const t = value as ZoneTransfer;
  return typeof t.key === 'string' && /^[a-f0-9-]{36}$/.test(t.key)
    && !!t.from && validZoneCell(SF_ZONE_GRID, t.from.cx, t.from.cy)
    && !!t.to && validZoneCell(SF_ZONE_GRID, t.to.cx, t.to.cy)
    && (t.from.cx !== t.to.cx || t.from.cy !== t.to.cy)
    && Number.isFinite(t.expiresAt) && t.expiresAt > now && t.expiresAt <= now + TRANSFER_TIMEOUT_MS
    && (t.vehicle === undefined || validOccupiedTransfer(t.vehicle));
}
type IncomingRow = { id: number; token: string; generation: number; payload: string };
type OutgoingRow = { id: number; generation: number; key: string; expires: number; claimed: number };

/** Durable prepare/claim receipts. A delayed or repeated request cannot create two writable owners. */
export class ZoneTransfers {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS zone_incoming (
      id INTEGER PRIMARY KEY, token TEXT NOT NULL UNIQUE, generation INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS zone_outgoing (
      id INTEGER PRIMARY KEY, generation INTEGER NOT NULL, key TEXT NOT NULL, expires REAL NOT NULL, claimed INTEGER NOT NULL)`);
  }
  prepare(id: number, token: string, generation: number, transfer: ZoneTransfer): void {
    this.storage.sql.exec('INSERT OR REPLACE INTO zone_incoming VALUES (?,?,?,?)', id, token, generation, JSON.stringify(transfer));
  }
  incoming(token: string): { id: number; generation: number; transfer: ZoneTransfer } | undefined {
    const row = this.storage.sql.exec<IncomingRow>('SELECT * FROM zone_incoming WHERE token=?', token).toArray()[0];
    return row && { id: row.id, generation: row.generation, transfer: JSON.parse(row.payload) as ZoneTransfer };
  }
  activate(id: number, generation: number): void {
    this.storage.sql.exec('DELETE FROM zone_incoming WHERE id=? AND generation=?', id, generation);
  }
  begin(id: number, generation: number, transfer: ZoneTransfer): void {
    this.storage.sql.exec('INSERT OR REPLACE INTO zone_outgoing VALUES (?,?,?,?,0)', id, generation, transfer.key, transfer.expiresAt);
  }
  outgoing(id: number): OutgoingRow | undefined {
    return this.storage.sql.exec<OutgoingRow>('SELECT * FROM zone_outgoing WHERE id=?', id).toArray()[0];
  }
  claim(id: number, generation: number, key: string, now: number): boolean {
    const row = this.outgoing(id);
    if (!row || row.generation !== generation || row.key !== key || row.claimed < 0) return false;
    if (row.claimed === 1) return true;
    if (row.expires <= now) return false;
    this.storage.sql.exec('UPDATE zone_outgoing SET claimed=1 WHERE id=?', id);
    return true;
  }
  cancel(id: number): void {
    this.storage.sql.exec('UPDATE zone_outgoing SET claimed=-1 WHERE id=? AND claimed=0', id);
  }
}
