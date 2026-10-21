/**
 * gtasf-yufot: in-progress mission / drive-quest / time-trial runs that must survive a WorldDO instance RESET
 * (Cloudflare replaces the instance every ~8-40 min, gtasf-j7wvv): the run Maps live in memory, so a job mid-run was
 * wiped and its delivery answered no-active-mission. Each run is saved as JSON keyed by (kind, session id), written
 * only on change and deleted once the run ends. A fresh instance loads the recent rows back and hands them to the
 * reconnectGrace machinery (held for a plain resume, dropped on ?at= or when the grace ends). Fails open.
 */
const RESTAMP_MS = 20_000;
interface Sql { exec(query: string, ...bindings: (string | number | null)[]): { toArray(): unknown[] } }

export type RunKind = 'mission' | 'drive' | 'trial';
export interface StoredRun { kind: RunKind; sid: number; value: Record<string, unknown>; savedAt: number }

export class RunPersistence {
  private readonly written = new Map<string, { json: string; at: number }>(); // `${kind}:${sid}` -> last write by THIS instance
  private ready = false;
  private readonly warned = new Set<string>();
  constructor(private readonly sql: Sql) {
    this.ready = this.guard('create', () => {
      sql.exec('CREATE TABLE IF NOT EXISTS world_runs (kind TEXT NOT NULL, sid INTEGER NOT NULL, json TEXT NOT NULL, saved_at INTEGER NOT NULL, PRIMARY KEY (kind, sid))');
      return true;
    }) ?? false;
  }
  private guard<T>(op: string, fn: () => T): T | undefined {
    try { return fn(); } catch (error) {
      if (!this.warned.has(op)) { this.warned.add(op); console.warn('run persist failed', op, error instanceof Error ? error.name : 'unknown'); }
      return undefined;
    }
  }

  /** Rows left by the previous instance, saved within `maxAgeMs`; older rows are deleted (nobody is coming back). */
  load(now: number, maxAgeMs: number): StoredRun[] {
    if (!this.ready) return [];
    return this.guard('load', () => {
      this.sql.exec('DELETE FROM world_runs WHERE saved_at < ?', now - maxAgeMs);
      const rows = this.sql.exec('SELECT kind, sid, json, saved_at FROM world_runs').toArray() as { kind: RunKind; sid: number; json: string; saved_at: number }[];
      const runs: StoredRun[] = [];
      for (const row of rows) {
        try { runs.push({ kind: row.kind, sid: row.sid, value: JSON.parse(row.json) as Record<string, unknown>, savedAt: row.saved_at }); this.written.set(`${row.kind}:${row.sid}`, { json: row.json, at: row.saved_at }); }
        catch { this.sql.exec('DELETE FROM world_runs WHERE kind = ? AND sid = ?', row.kind, row.sid); }
      }
      return runs;
    }) ?? [];
  }

  /** Write the current runs: upsert changed ones, delete the rows of runs that ended. */
  save(runs: Iterable<{ kind: RunKind; sid: number; value: object }>, now: number): void {
    if (!this.ready) return;
    this.guard('save', () => {
      const seen = new Set<string>();
      for (const run of runs) {
        const key = `${run.kind}:${run.sid}`, json = JSON.stringify(run.value);
        seen.add(key);
        const last = this.written.get(key);
        if (last?.json === json && now - last.at < RESTAMP_MS) continue; // unchanged runs are re-stamped so load() keeps them
        this.sql.exec(`INSERT INTO world_runs (kind, sid, json, saved_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(kind, sid) DO UPDATE SET json = excluded.json, saved_at = excluded.saved_at`, run.kind, run.sid, json, now);
        this.written.set(key, { json, at: now });
      }
      for (const key of [...this.written.keys()]) {
        if (seen.has(key)) continue;
        const [kind, sid] = key.split(':') as [RunKind, string];
        this.sql.exec('DELETE FROM world_runs WHERE kind = ? AND sid = ?', kind, Number(sid));
        this.written.delete(key);
      }
    });
  }
}
