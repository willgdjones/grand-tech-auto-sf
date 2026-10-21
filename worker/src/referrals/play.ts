import { recordWarmIntro } from '../funding/bonus';
import { ensureReferralAccount, recordReferralPlayer } from './store';
// Shared with the D1 award gate (worker/src/funding/bonus.ts) so the play-accumulation and the payout
// qualification can never drift (gtasf-referral-cash-removal-cleanup-pi1v).
import { REFERRAL_QUALIFIED_PLAY_MS as QUALIFIED_MS } from '@gtasf/shared/funding';
interface ActivePlay { lastAt: number; unpersisted: number; ready: boolean; loading: boolean; retryAt: number }
type PlayRow = { device_id: string; played_ms: number; synced_ms: number; complete: number };

/** One city, one counter per authenticated device, irrespective of socket/tab count. */
export class WorldReferralPlay {
  private readonly active = new Map<string, ActivePlay>();
  private flushing?: Promise<void>;
  private retryAt = 0;
  constructor(private readonly storage: Pick<DurableObjectStorage, 'sql'>, private readonly db: D1Database,
    private readonly retain: (work: Promise<unknown>) => void, private readonly schedule: () => void,
    private readonly bonusesEnabled: boolean) {
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS world_referral_play (
      device_id TEXT PRIMARY KEY,played_ms INTEGER NOT NULL DEFAULT 0,synced_ms INTEGER NOT NULL DEFAULT 0,complete INTEGER NOT NULL DEFAULT 0)`);
  }
  /** Only pass server-accepted, non-idle peer identities. Never accept browser clocks. */
  observe(now: number, devices: Iterable<string>): void {
    const present = new Set(devices);
    for (const [deviceId, state] of this.active) {
      const elapsed = now - state.lastAt; state.lastAt = now;
      // Long tick gaps do not prove play, and an evicted object's offline time never accrues.
      if (state.ready && this.bonusesEnabled && elapsed > 0 && elapsed <= 2000) state.unpersisted += elapsed;
      if (state.unpersisted >= 1000 || !present.has(deviceId)) this.persist(deviceId, state);
      if (!present.has(deviceId)) this.active.delete(deviceId);
    }
    for (const deviceId of present) {
      let state = this.active.get(deviceId);
      if (!state) { state = { lastAt: now, unpersisted: 0, ready: false, loading: false, retryAt: 0 }; this.active.set(deviceId, state); }
      if (!state.ready && !state.loading && state.retryAt <= now) {
        state.loading = true; const current = state;
        this.retain(this.join(deviceId, now).then(ready => { current.ready = ready; }).catch(() => undefined)
          .finally(() => { current.loading = false; current.retryAt = now + 30_000; }));
      }
    }
    if (this.nextFlushAt <= now) this.retain(this.flush(now));
    this.schedule();
  }
  private async join(deviceId: string, now: number): Promise<boolean> {
    await ensureReferralAccount(this.db, deviceId, now);
    await recordReferralPlayer(this.db, deviceId, now);
    const row = await this.db.prepare('SELECT played_ms,warm_intro_at FROM referral_players WHERE buyer_device_id=?').bind(deviceId)
      .first<{ played_ms: number; warm_intro_at: number | null }>();
    if (!row) return false;
    this.storage.sql.exec(`INSERT INTO world_referral_play(device_id,played_ms,synced_ms,complete) VALUES(?,?,?,?)
      ON CONFLICT(device_id) DO UPDATE SET played_ms=max(played_ms,excluded.played_ms),complete=max(complete,excluded.complete)`,
      deviceId, row.played_ms, row.played_ms, Number(row.warm_intro_at !== null));
    this.schedule(); return true;
  }
  private persist(deviceId: string, state: ActivePlay): void {
    if (!state.unpersisted) return;
    this.storage.sql.exec('UPDATE world_referral_play SET played_ms=min(?,played_ms+?) WHERE device_id=? AND complete=0', QUALIFIED_MS, Math.floor(state.unpersisted), deviceId);
    state.unpersisted = 0;
  }
  get nextFlushAt(): number {
    if (!this.bonusesEnabled || this.flushing) return Infinity;
    const pending = this.storage.sql.exec<PlayRow>('SELECT * FROM world_referral_play WHERE played_ms>synced_ms OR (played_ms>=? AND complete=0) LIMIT 1', QUALIFIED_MS).toArray()[0];
    return pending ? this.retryAt : Infinity;
  }
  /** Absolute monotonic updates make a crash after D1 and before acknowledgement harmless. */
  flush(now: number): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.bonusesEnabled) return Promise.resolve();
    this.retryAt = now + 10_000;
    this.flushing = (async () => {
      const pending = this.storage.sql.exec<PlayRow>('SELECT * FROM world_referral_play WHERE played_ms>synced_ms OR (played_ms>=? AND complete=0) LIMIT 100', QUALIFIED_MS).toArray();
      for (const row of pending) {
        try {
          await this.db.prepare('UPDATE referral_players SET played_ms=max(played_ms,?) WHERE buyer_device_id=?').bind(row.played_ms, row.device_id).run();
          if (row.played_ms >= QUALIFIED_MS) await recordWarmIntro(this.db, row.device_id, now);
          this.storage.sql.exec('UPDATE world_referral_play SET synced_ms=max(synced_ms,?),complete=max(complete,?) WHERE device_id=?',
            row.played_ms, Number(row.played_ms >= QUALIFIED_MS), row.device_id);
        } catch { /* Durable pending row retries at the next alarm, even after the player leaves. */ }
      }
    })().finally(() => { this.flushing = undefined; this.schedule(); });
    return this.flushing;
  }
}
