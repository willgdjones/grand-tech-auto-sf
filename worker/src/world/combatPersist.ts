/**
 * gtasf-2cprr: combat state that must survive a WorldDO instance RESET. Cloudflare replaces the instance every
 * ~8-40 min (gtasf-j7wvv root cause): every socket drops with no webSocketClose, so remove() never stashes anything,
 * and the in-memory wanted/health/bust state is gone. A wanted player reconnected clean (free escape), with
 * spawn protection and the bust meter at 0. This keeps a per-device row in the DO's own SQLite, written on a
 * throttle while the player is wanted/wounded/being cuffed and deleted once clean, so the rejoin restores it
 * through the same rules as the in-memory stash.
 */

/** An unchanged row is still re-stamped this often, so a steady state (constant wounds) stays inside the restore TTL. */
const RESTAMP_MS = 20_000;
/** The fields of the in-memory combat stash, as stored. */
export interface PersistedCombat { heat: number; lastCrimeMs: number; health: number; bustMs: number; savedAt: number }

interface Sql { exec(query: string, ...bindings: (string | number | null)[]): { toArray(): unknown[] } }

export class CombatPersistence {
  /** Last row written per device in THIS instance, so an unchanged state isn't rewritten every save. */
  private readonly written = new Map<string, { key: string; at: number }>();
  private ready = false;
  constructor(private readonly sql: Sql) {
    this.ready = this.guard('create', () => {
      sql.exec(`CREATE TABLE IF NOT EXISTS combat_state (device TEXT PRIMARY KEY, heat REAL NOT NULL, last_crime_ms INTEGER NOT NULL,
        health INTEGER NOT NULL, bust_ms INTEGER NOT NULL, saved_at INTEGER NOT NULL)`);
      return true;
    }) ?? false;
  }
  /** Fail open (review 2cprr #6): a storage error must never break the world, a join or the tick; it only loses the
   *  reset protection. Logged at most once per op. */
  private readonly warned = new Set<string>();
  private guard<T>(op: string, fn: () => T): T | undefined {
    try { return fn(); } catch (error) {
      if (!this.warned.has(op)) { this.warned.add(op); console.warn('combat persist failed', op, error instanceof Error ? error.name : 'unknown'); }
      return undefined;
    }
  }

  /** Save each connected device's state; `undefined` = clean (full health, no heat, no cuffs): its row goes. */
  save(states: Iterable<[device: string, state: Omit<PersistedCombat, 'savedAt'> | undefined]>, now: number): void {
    if (this.ready) this.guard('save', () => this.saveAll(states, now));
  }
  private saveAll(states: Iterable<[device: string, state: Omit<PersistedCombat, 'savedAt'> | undefined]>, now: number): void {
    for (const [device, state] of states) {
      if (!state) {
        if (this.written.has(device)) { this.sql.exec('DELETE FROM combat_state WHERE device = ?', device); this.written.delete(device); }
        continue;
      }
      // Heat decays continuously; round it so a wanted player costs a write per meaningful change, not every save.
      const row = [Math.round(state.heat * 10) / 10, state.lastCrimeMs, Math.round(state.health), Math.round(state.bustMs)] as const;
      const key = row.join(',');
      const last = this.written.get(device);
      if (last?.key === key && now - last.at < RESTAMP_MS) continue;
      this.sql.exec(`INSERT INTO combat_state (device, heat, last_crime_ms, health, bust_ms, saved_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(device) DO UPDATE SET heat = excluded.heat, last_crime_ms = excluded.last_crime_ms, health = excluded.health,
        bust_ms = excluded.bust_ms, saved_at = excluded.saved_at`, device, ...row, now);
      this.written.set(device, { key, at: now });
    }
  }

  /** Read and delete a device's row; only a row saved within `ttlMs` counts (the in-memory stash's TTL). */
  take(device: string, now: number, ttlMs: number): PersistedCombat | undefined {
    return this.ready ? this.guard('take', () => this.takeRow(device, now, ttlMs)) : undefined;
  }
  private takeRow(device: string, now: number, ttlMs: number): PersistedCombat | undefined {
    const row = this.sql.exec('SELECT heat, last_crime_ms, health, bust_ms, saved_at FROM combat_state WHERE device = ?', device).toArray()[0] as
      { heat: number; last_crime_ms: number; health: number; bust_ms: number; saved_at: number } | undefined;
    this.forget(device);
    if (!row || row.saved_at + ttlMs <= now) return undefined;
    return { heat: row.heat, lastCrimeMs: row.last_crime_ms, health: row.health, bustMs: row.bust_ms, savedAt: row.saved_at };
  }

  /** Drop a device's row (its state was settled: busted on drop, or restored from the in-memory stash). */
  forget(device: string): void {
    this.written.delete(device);
    if (this.ready) this.guard('forget', () => this.sql.exec('DELETE FROM combat_state WHERE device = ?', device));
  }

  /** Rows nobody came back for. */
  prune(now: number, ttlMs: number): void {
    if (this.ready) this.guard('prune', () => this.sql.exec('DELETE FROM combat_state WHERE saved_at <= ?', now - ttlMs));
  }
}
