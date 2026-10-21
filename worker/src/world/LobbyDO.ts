import { DurableObject } from 'cloudflare:workers';
import { QUEUE_LIMIT, launchMode, validAdmissionToken, worldCapacity } from '@gtasf/shared/admission';
import type { AdmissionResponse } from '@gtasf/shared/admission';
import type { Env } from '../env';
import { Mutex } from './admission/mutex';
import { OrderStats } from './admission/orderStats';
import { admissionJson, secretToken, smallJson } from './admission/http';
import type { ReserveResult } from './admission/reservations';

type Ticket = { seq: number; ticket: string; state: 'waiting' | 'granted'; expires_at: number; grant_token: string | null; grant_expiry: number | null };
const TICKET_LEASE_MS = 120_000;

/** A world cold start is 1-2.3 s on prod; anything past this is a stalled world, not a slow one. */
export const WORLD_ADMISSION_TIMEOUT_MS = 8_000;

/** Adapted BDTS FIFO lobby: durable tickets, O(log n) rank, serialized idempotent World reservations.
 * Overflow visitors poll HTTP and never open a World WebSocket until their slot is reserved.
 */
export class LobbyDO extends DurableObject<Env> {
  private readonly mutex = new Mutex();
  private readonly index = new OrderStats();
  private drainAt = 0;
  private armedAt = Infinity;
  private population = 0;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS admission_tickets (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, ticket TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL CHECK(state IN ('waiting','granted')), expires_at INTEGER NOT NULL,
      grant_token TEXT, grant_expiry INTEGER
    ); CREATE INDEX IF NOT EXISTS admission_tickets_queue ON admission_tickets(state,seq);
    CREATE INDEX IF NOT EXISTS admission_tickets_expiry ON admission_tickets(expires_at);
    CREATE TABLE IF NOT EXISTS admission_meta (key TEXT PRIMARY KEY, value REAL NOT NULL)`);
    for (const row of ctx.storage.sql.exec<{ seq: number }>("SELECT seq FROM admission_tickets WHERE state='waiting' ORDER BY seq")) this.index.add(row.seq);
    this.arm();
  }
  private ticket(token: string): Ticket | undefined {
    return this.ctx.storage.sql.exec<Ticket>('SELECT * FROM admission_tickets WHERE ticket=?', token).toArray()[0];
  }
  private drop(row: Ticket): void {
    this.ctx.storage.sql.exec('DELETE FROM admission_tickets WHERE ticket=?', row.ticket); this.index.delete(row.seq);
  }
  private prune(now: number): void {
    for (const row of this.ctx.storage.sql.exec<Ticket>('SELECT * FROM admission_tickets WHERE expires_at<=? ORDER BY expires_at LIMIT 256', now).toArray()) this.drop(row);
  }
  private async world(path: string, body: unknown): Promise<Response> {
    // gtasf-j7wvv (lane E): this runs inside this.mutex. Un-timed, one stalled WorldDO (a 128 s cold start on prod at 07:40)
    // queued every admission behind it until Cloudflare returned 524 and READY took 136 s. Fail fast instead: callers already
    // treat a throw as 'queued, poll again' (drain) or 503 'reconnecting' (renewal), and WorldDO reserve() is idempotent per ticket.
    // An explicit timer, cleared once the world answers: a pending AbortSignal.timeout kept every lobby event open for the
    // full 8 s on prod (#6.24 tail: admission/enter wall 8000 ms while the client had its answer in ~2.5 s).
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(new DOMException('world admission timed out', 'TimeoutError')), WORLD_ADMISSION_TIMEOUT_MS);
    try {
      return await this.env.WORLD.get(this.env.WORLD.idFromName('sf')).fetch(`https://world.internal/internal/admission/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: abort.signal,
      });
    } finally { clearTimeout(timer); }
  }
  private async reserve(row: Ticket): Promise<ReserveResult> {
    const response = await this.world('reserve', { ticket: row.ticket });
    if (!response.ok) throw new Error('World admission unavailable');
    return response.json<ReserveResult>();
  }
  private grant(row: Ticket, result: Extract<ReserveResult, { status: 'reserved' }>): void {
    this.ctx.storage.sql.exec("UPDATE admission_tickets SET state='granted',grant_token=?,grant_expiry=?,expires_at=? WHERE ticket=?",
      result.grant, result.expiresAt, result.expiresAt, row.ticket);
    this.index.delete(row.seq); this.population = result.population;
  }
  private async drain(now: number, force = false): Promise<void> {
    this.prune(now);
    if (launchMode(this.env) === 'waitlist' || !this.index.size || !force && now < this.drainAt) return;
    this.drainAt = now + 2000;
    // Bound one invocation; an alarm continues a large admission wave without monopolizing the DO.
    for (let i = 0; i < 16; i++) {
      const first = this.ctx.storage.sql.exec<Ticket>("SELECT * FROM admission_tickets WHERE state='waiting' ORDER BY seq LIMIT 1").toArray()[0];
      if (!first) break;
      let result: ReserveResult;
      try { result = await this.reserve(first); } catch { break; }
      this.population = result.population;
      if (result.status === 'full') break;
      if (result.status === 'used') { this.drop(first); continue; }
      this.grant(first, result);
    }
  }
  private meta(key: string): number {
    return this.ctx.storage.sql.exec<{ value: number }>('SELECT value FROM admission_meta WHERE key=?', key).toArray()[0]?.value ?? 0;
  }
  private setMeta(key: string, value: number): void {
    this.ctx.storage.sql.exec('INSERT INTO admission_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value);
  }
  private recordRelease(now: number): void {
    const previous = this.meta('last_release'); this.setMeta('last_release', now);
    if (previous && now > previous) {
      const sample = Math.max(1000, Math.min(30 * 60_000, now - previous)), old = this.meta('release_interval');
      this.setMeta('release_interval', old ? old * .8 + sample * .2 : sample);
      this.setMeta('release_samples', this.meta('release_samples') + 1);
    }
  }
  private response(row: Ticket): AdmissionResponse {
    if (row.state === 'granted') return { status: 'admitted', ticket: row.ticket, grant: row.grant_token!, expiresAt: row.grant_expiry!, nextPollS: 10 };
    const position = this.index.rank(row.seq), nextPollS = position <= 25 ? 3 : position <= 250 ? 10 : 30;
    // Show "estimating" until real departures establish a rate; an ETA is never a promise.
    const etaSeconds = this.meta('release_samples') >= 3 ? Math.ceil(position * this.meta('release_interval') / 1000) : null;
    return { status: 'queued', ticket: row.ticket, position, queueLength: this.index.size, population: this.population,
      capacity: worldCapacity(this.env), etaSeconds, nextPollS };
  }
  override async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return admissionJson({ error: 'POST required' }, 405);
    const body = await smallJson(request); if (!body) return admissionJson({ error: 'Invalid body' }, 400);
    const path = new URL(request.url).pathname;
    return this.mutex.run(async () => {
      const now = Date.now(); this.prune(now);
      if (path === '/internal/released') {
        this.recordRelease(now); await this.drain(now, true); this.arm(); return admissionJson({ ok: true });
      }
      if (launchMode(this.env) === 'waitlist') return admissionJson({ status: 'waitlist', nextPollS: 15 } satisfies AdmissionResponse);
      const token = validAdmissionToken(body.ticket) ? body.ticket : undefined;
      if (path === '/api/admission/leave') {
        const row = token ? this.ticket(token) : undefined;
        if (row) { this.drop(row); await this.world('cancel', { ticket: row.ticket }).catch(() => undefined); }
        await this.drain(now, true); this.arm(); return admissionJson({ ok: true });
      }
      if (path !== '/api/admission/enter' && path !== '/api/admission/poll') return admissionJson({ error: 'Not found' }, 404);
      let row = token ? this.ticket(token) : undefined;
      if (!row && path === '/api/admission/poll') return admissionJson({ status: 'expired', nextPollS: 1 } satisfies AdmissionResponse);
      if (!row) {
        const total = this.ctx.storage.sql.exec<{ n: number }>('SELECT count(*) AS n FROM admission_tickets').one().n;
        if (total >= QUEUE_LIMIT) return admissionJson({ status: 'full', nextPollS: 30 } satisfies AdmissionResponse, 429);
        row = this.ctx.storage.sql.exec<Ticket>("INSERT INTO admission_tickets(ticket,state,expires_at) VALUES (?,'waiting',?) RETURNING *",
          secretToken(), now + TICKET_LEASE_MS).one();
        this.index.add(row.seq);
      } else if (row.state === 'waiting') this.ctx.storage.sql.exec('UPDATE admission_tickets SET expires_at=? WHERE ticket=?', now + TICKET_LEASE_MS, row.ticket);
      else {
        try {
          const renewed = await this.reserve(row);
          if (renewed.status !== 'reserved') { this.drop(row); this.arm(); return admissionJson({ status: 'expired', nextPollS: 1 } satisfies AdmissionResponse); }
          this.grant(row, renewed);
        } catch { return admissionJson({ error: 'Admission is reconnecting' }, 503); }
      }
      // Head of the line with nobody ahead: admit now if there's room, instead of answering 'queued' and making
      // the player wait a 3 s poll because another arrival drained within the last 2 s (cold-load, gtasf-0k01).
      // Deeper queues keep the 2 s drain throttle.
      const head = row.state === 'waiting' && this.index.rank(row.seq) === 1;
      await this.drain(now, head); this.arm();
      const current = this.ticket(row.ticket);
      return admissionJson(current ? this.response(current) : { status: 'expired', nextPollS: 1 } satisfies AdmissionResponse);
    });
  }
  private arm(): void {
    const expiry = this.ctx.storage.sql.exec<{ at: number | null }>('SELECT min(expires_at) AS at FROM admission_tickets').one().at;
    const at = this.index.size ? Math.min(expiry ?? Infinity, Date.now() + 2000) : expiry;
    if (at !== null && at < this.armedAt) {
      this.armedAt = at;
      this.ctx.waitUntil(this.ctx.storage.setAlarm(Math.max(Date.now() + 1, at)));
    }
  }
  override async alarm(): Promise<void> {
    await this.mutex.run(async () => { this.armedAt = Infinity; await this.drain(Date.now(), true); this.arm(); });
  }
}
