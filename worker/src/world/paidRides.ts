/**
 * gtasf-vmpq1: quick-robotaxi fares that were charged but whose ride never arrived because the WorldDO instance was
 * RESET mid-ride (Cloudflare replaces it every ~8-40 min, gtasf-j7wvv). The trip and the car live only in memory, so the
 * fare was simply kept. Each charged ride is recorded in the DO's SQLite until it arrives or its trip ends some other
 * way (cancel/timeout keep today's no-refund policy); a fresh instance finds only rides orphaned by a dead instance and
 * refunds them once (refundRide is idempotent by rideId: it credits only while the fare row exists).
 */
interface Sql { exec(query: string, ...bindings: (string | number | null)[]): { toArray(): unknown[] } }

export interface OrphanRide { rideId: string; device: string }

export class PaidRides {
  private readonly live = new Map<number, string>(); // playerId -> rideId charged by THIS instance
  private ready = false;
  private readonly warned = new Set<string>();
  constructor(private readonly sql: Sql) {
    this.ready = this.guard('create', () => {
      sql.exec('CREATE TABLE IF NOT EXISTS taxi_paid (ride_id TEXT PRIMARY KEY, device TEXT NOT NULL, player_id INTEGER NOT NULL, charged_at INTEGER NOT NULL)');
      return true;
    }) ?? false;
  }
  /** Fail open: storage trouble only loses the reset refund; it never breaks a hail or the tick. */
  private guard<T>(op: string, fn: () => T): T | undefined {
    try { return fn(); } catch (error) {
      if (!this.warned.has(op)) { this.warned.add(op); console.warn('paid rides failed', op, error instanceof Error ? error.name : 'unknown'); }
      return undefined;
    }
  }

  /** Rows left by a dead instance. Call once, at construction, before this instance records anything. */
  orphans(): OrphanRide[] {
    if (!this.ready) return [];
    return this.guard('orphans', () => (this.sql.exec('SELECT ride_id, device FROM taxi_paid').toArray() as { ride_id: string; device: string }[])
      .map(row => ({ rideId: row.ride_id, device: row.device }))) ?? [];
  }
  charged(playerId: number, rideId: string, device: string, now: number): void {
    this.live.set(playerId, rideId);
    if (this.ready) this.guard('charged', () => this.sql.exec('INSERT OR REPLACE INTO taxi_paid (ride_id, device, player_id, charged_at) VALUES (?, ?, ?, ?)', rideId, device, playerId, now));
  }
  /** The device that paid for a ride this instance recorded (for a refund after the socket is gone). */
  deviceOf(playerId: number, rideId: string): string | undefined {
    if (this.live.get(playerId) !== rideId || !this.ready) return undefined;
    return this.guard('deviceOf', () => (this.sql.exec('SELECT device FROM taxi_paid WHERE ride_id = ?', rideId).toArray()[0] as { device: string } | undefined)?.device);
  }
  /** A refund is in flight (review LOW on d4zmv): stop tracking the ride live (the step sweep ignores it) but KEEP its row
   *  until the refund lands; the caller drop()s it on success. If the refund fails the row stays, and the next
   *  instance's orphan sweep retries it (refundRide is idempotent by rideId). True when the ride was live. */
  detach(playerId: number, rideId: string): boolean {
    if (this.live.get(playerId) !== rideId) return false;
    this.live.delete(playerId);
    return true;
  }
  /** The ride arrived (or its trip ended / was refunded): no longer owed. */
  settled(playerId: number): void {
    const rideId = this.live.get(playerId);
    if (rideId === undefined) return;
    this.live.delete(playerId);
    this.drop(rideId);
  }
  drop(rideId: string): void {
    if (this.ready) this.guard('drop', () => this.sql.exec('DELETE FROM taxi_paid WHERE ride_id = ?', rideId));
  }
  /** Settle every recorded ride whose trip no longer exists (cancelled, timed out, already arrived). */
  sweep(hasTrip: (playerId: number) => boolean): void {
    for (const playerId of [...this.live.keys()]) if (!hasTrip(playerId)) this.settled(playerId);
  }
}
