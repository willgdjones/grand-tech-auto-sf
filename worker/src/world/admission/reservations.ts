import { secretToken } from './http';

export const GRANT_LEASE_MS = 30_000;
const MAX_LOADING_MS = 180_000;
type Reservation = { ticket: string; grant_token: string; state: 'reserved' | 'connecting' | 'used'; expires_at: number; maximum_at: number };
export type ReserveResult =
  | { status: 'reserved'; grant: string; expiresAt: number; population: number; capacity: number }
  | { status: 'full'; population: number; capacity: number }
  | { status: 'used'; population: number; capacity: number };

/** BDTS reserve→grant→HELLO pattern, adapted to this anonymous world's opaque capabilities.
 * WorldDO owns both active membership and pending reservations, so capacity checks never race LobbyDO.
 */
export class WorldReservations {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS world_admissions (
      ticket TEXT PRIMARY KEY, grant_token TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL CHECK(state IN ('reserved','connecting','used')),
      expires_at INTEGER NOT NULL, maximum_at INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS world_admissions_expiry ON world_admissions(expires_at)`);
  }
  prune(now: number): void { this.storage.sql.exec('DELETE FROM world_admissions WHERE expires_at<=?', now); }
  count(now: number): number {
    return this.storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM world_admissions WHERE state!='used' AND expires_at>?", now).one().n;
  }
  reserve(ticket: string, now: number, population: number, capacity: number): ReserveResult {
    return this.storage.transactionSync(() => {
      this.prune(now);
      const old = this.storage.sql.exec<Reservation>('SELECT * FROM world_admissions WHERE ticket=?', ticket).toArray()[0];
      if (old?.state === 'used') return { status: 'used', population, capacity };
      if (old) {
        const expiresAt = old.state === 'reserved' ? Math.min(old.maximum_at, now + GRANT_LEASE_MS) : old.expires_at;
        this.storage.sql.exec('UPDATE world_admissions SET expires_at=? WHERE ticket=?', expiresAt, ticket);
        return { status: 'reserved', grant: old.grant_token, expiresAt, population, capacity };
      }
      if (population + this.count(now) >= capacity) return { status: 'full', population, capacity };
      const grant = secretToken(), expiresAt = now + GRANT_LEASE_MS;
      this.storage.sql.exec("INSERT INTO world_admissions VALUES (?,?,'reserved',?,?)", ticket, grant, expiresAt, now + MAX_LOADING_MS);
      return { status: 'reserved', grant, expiresAt, population, capacity };
    });
  }
  /** One grant can bind only one pending socket. Invalid clients never allocate an unbounded pending pool. */
  claim(grant: string, now: number): boolean {
    return this.storage.sql.exec<{ ticket: string }>("UPDATE world_admissions SET state='connecting', expires_at=? WHERE grant_token=? AND state='reserved' AND expires_at>? RETURNING ticket",
      now + 5000, grant, now).toArray().length === 1;
  }
  consume(grant: string, now: number): boolean {
    return this.storage.sql.exec<{ ticket: string }>("UPDATE world_admissions SET state='used', expires_at=? WHERE grant_token=? AND state='connecting' AND expires_at>? RETURNING ticket",
      now + MAX_LOADING_MS, grant, now).toArray().length === 1;
  }
  releaseGrant(grant: string): void {
    this.storage.sql.exec("DELETE FROM world_admissions WHERE grant_token=? AND state!='used'", grant);
  }
  cancel(ticket: string): void {
    this.storage.sql.exec("DELETE FROM world_admissions WHERE ticket=? AND state!='used'", ticket);
  }
  nextExpiry(): number | null {
    return this.storage.sql.exec<{ at: number | null }>('SELECT min(expires_at) AS at FROM world_admissions').one().at;
  }
}
