import { normalizeNickname } from '@gtasf/shared/protocol/nickname';
import { validResumeToken } from '@gtasf/shared/protocol/fields';
import { validPose } from '@gtasf/shared/protocol/pose';
import { ZONE_ID_STRIDE } from '@gtasf/shared/world/zones';
import { MOVE_BURST_CM, type MovementState } from './movement';
import { LOCAL_SPAWN } from './localSpawn';

export const IDLE_MS = 30_000;
export const RESUME_GRACE_MS = 120_000;
export interface WorldSession {
  id: number;
  token: string;
  name: string;
  generation: number;
  movement: MovementState;
  lastSeen: number;
  lastInput: number;
  expiresAt: number;
  /** Opaque cosmetic appearance id (gtasf-hrmk/apsync2); persisted so a look survives hibernate/resume
   *  and a cross-zone handoff. 0 = the default look. Never influences gameplay beyond cosmetic/stage. */
  appearance: number;
}
type SessionRow = {
  id: number; token: string; name: string; generation: number;
  x: number; y: number; z: number; yaw: number; flags: number;
  seq: number; accepted: number; last_at: number; carry_cm: number;
  last_seen: number; last_input: number; expires_at: number; appearance: number;
};
function fromRow(row: SessionRow): WorldSession {
  return {
    id: row.id, token: row.token, name: row.name, generation: row.generation,
    movement: {
      pose: { x: row.x, y: row.y, z: row.z, yaw: row.yaw, flags: row.flags },
      seq: row.seq, accepted: row.accepted === 1, lastAt: row.last_at, carryCm: row.carry_cm,
    },
    lastSeen: row.last_seen, lastInput: row.last_input, expiresAt: row.expires_at, appearance: row.appearance ?? 0,
  };
}

/** Synchronous SQLite commits fence connection takeovers before any response is sent. */
export class WorldSessions {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS world_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT CHECK(id BETWEEN 1 AND 4294967295),
      token TEXT NOT NULL UNIQUE, name TEXT NOT NULL, generation INTEGER NOT NULL,
      x INTEGER NOT NULL, y INTEGER NOT NULL, z INTEGER NOT NULL, yaw INTEGER NOT NULL, flags INTEGER NOT NULL,
      seq INTEGER NOT NULL, accepted INTEGER NOT NULL, last_at REAL NOT NULL, carry_cm REAL NOT NULL,
      last_seen REAL NOT NULL, expires_at REAL NOT NULL
    ); CREATE INDEX IF NOT EXISTS world_sessions_expiry ON world_sessions(expires_at)`);
    storage.sql.exec('CREATE TABLE IF NOT EXISTS world_session_ids (first_id INTEGER PRIMARY KEY, last_id INTEGER NOT NULL)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS world_session_departures (id INTEGER PRIMARY KEY, generation INTEGER NOT NULL)');
    const columns = storage.sql.exec<{ name: string }>('PRAGMA table_info(world_sessions)').toArray();
    if (!columns.some(column => column.name === 'last_input')) {
      storage.sql.exec('ALTER TABLE world_sessions ADD COLUMN last_input REAL NOT NULL DEFAULT 0');
      storage.sql.exec('UPDATE world_sessions SET last_input=last_seen');
    }
    // Cosmetic appearance id, added by ALTER so hibernated DOs pick it up without a recreate (gtasf-apsync2).
    if (!columns.some(column => column.name === 'appearance')) {
      storage.sql.exec('ALTER TABLE world_sessions ADD COLUMN appearance INTEGER NOT NULL DEFAULT 0');
    }
  }
  get(id: number): WorldSession | undefined {
    const row = this.storage.sql.exec<SessionRow>('SELECT * FROM world_sessions WHERE id = ?', id).toArray()[0];
    return row && fromRow(row);
  }
  admit(name: string, token: string | undefined, now: number, firstId?: number): WorldSession | 'BAD_NAME' | 'BAD_RESUME' {
    return this.storage.transactionSync(() => {
      if (token !== undefined) {
        if (!validResumeToken(token)) return 'BAD_RESUME';
        const row = this.storage.sql.exec<SessionRow>('SELECT * FROM world_sessions WHERE token = ?', token).toArray()[0];
        if (!row || row.expires_at <= now) return 'BAD_RESUME';
        const session = fromRow(row);
        session.generation++;
        // Offline time grants no movement credit; preserve the last sequence and existing debt.
        session.movement.lastAt = now;
        session.lastSeen = now;
        session.lastInput = now;
        session.expiresAt = now + IDLE_MS + RESUME_GRACE_MS;
        this.storage.sql.exec('UPDATE world_sessions SET generation = ?, last_at = ?, last_seen = ?, last_input = ?, expires_at = ? WHERE id = ?',
          session.generation, now, now, now, session.expiresAt, session.id);
        return session;
      }
      const normalized = normalizeNickname(name);
      if (!normalized) return 'BAD_NAME';
      const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
      // Zoned worlds seed the very first session id to the cell's id block so player ids
      // stay globally unique across zones (gtasf-l1qi/xlbt); AUTOINCREMENT then continues
      // inside the block. A single world passes no firstId and keeps plain AUTOINCREMENT.
      // Zoned worlds allocate inside this cell's id block [firstId, firstId+STRIDE): the next free
      // in-block id, or firstId if none yet. Computed from the max in-block id (not table-empty), so a
      // session ADOPTED from another zone on handoff (gtasf-djjz) — whose id is in the origin's block —
      // never shifts this cell's native ids out of its own block. A single world passes no firstId.
      // Never recycle an expired native id: its owner may still be alive in another zone.
      // This high-water mark survives session pruning and is isolated from adopted foreign ids.
      let blockId: number | undefined;
      if (firstId !== undefined) {
        const saved = this.storage.sql.exec<{ last_id: number }>('SELECT last_id FROM world_session_ids WHERE first_id=?', firstId).toArray()[0]?.last_id ?? firstId - 1;
        const live = this.storage.sql.exec<{ m: number | null }>('SELECT max(id) AS m FROM world_sessions WHERE id >= ? AND id < ?', firstId, firstId + ZONE_ID_STRIDE - 1).one().m ?? firstId - 1;
        blockId = Math.max(saved, live) + 1;
        if (blockId >= firstId + ZONE_ID_STRIDE - 1) throw new Error('Zone player id block exhausted');
        this.storage.sql.exec('INSERT INTO world_session_ids VALUES (?,?) ON CONFLICT(first_id) DO UPDATE SET last_id=excluded.last_id', firstId, blockId);
      }
      const row = blockId !== undefined
        ? this.storage.sql.exec<SessionRow>(`INSERT INTO world_sessions
            (id,token,name,generation,x,y,z,yaw,flags,seq,accepted,last_at,carry_cm,last_seen,last_input,expires_at)
            VALUES (?,?,?,1,?,?,?,?,0,0,0,?,?,?,?,?) RETURNING *`,
            blockId, secret, normalized, LOCAL_SPAWN.x, LOCAL_SPAWN.y, LOCAL_SPAWN.z, LOCAL_SPAWN.yaw,
            now, MOVE_BURST_CM, now, now, now + IDLE_MS + RESUME_GRACE_MS).one()
        : this.storage.sql.exec<SessionRow>(`INSERT INTO world_sessions
            (token,name,generation,x,y,z,yaw,flags,seq,accepted,last_at,carry_cm,last_seen,last_input,expires_at)
            VALUES (?,?,1,?,?,?,?,0,0,0,?,?,?,?,?) RETURNING *`,
            secret, normalized, LOCAL_SPAWN.x, LOCAL_SPAWN.y, LOCAL_SPAWN.z, LOCAL_SPAWN.yaw,
            now, MOVE_BURST_CM, now, now, now + IDLE_MS + RESUME_GRACE_MS).one();
      return fromRow(row);
    });
  }
  /** Install a session transferred from another zone (seamless handoff, gtasf-djjz), preserving its
   *  globally-unique id, resume token and generation so the player's resume in THIS cell returns the
   *  SAME id — no border id-blink. The id lives in the origin cell's block; the cell-namespaced global
   *  id scheme (globalPlayerId) keeps it unique here even though it is outside this cell's own block. */
  adopt(session: WorldSession, now: number): WorldSession | 'BAD_RESUME' {
    if (!validResumeToken(session.token)) return 'BAD_RESUME';
    if (!Number.isInteger(session.id) || session.id < 1 || session.id > 4294967295) return 'BAD_RESUME';
    const name = normalizeNickname(session.name);
    if (!name || !validPose(session.movement.pose) || !Number.isSafeInteger(session.generation) || session.generation < 1
      || !Number.isInteger(session.movement.seq) || session.movement.seq < 0 || session.movement.seq > 65535
      || !Number.isFinite(session.movement.carryCm) || session.movement.carryCm < -1 || session.movement.carryCm > MOVE_BURST_CM) return 'BAD_RESUME';
    return this.storage.transactionSync(() => {
      const departed = this.storage.sql.exec<{ generation: number }>('SELECT generation FROM world_session_departures WHERE id=?', session.id).toArray()[0];
      if (departed && departed.generation >= session.generation) return 'BAD_RESUME';
      const existing = this.get(session.id);
      if (existing && (existing.token !== session.token || existing.generation > session.generation)) return 'BAD_RESUME';
      if (existing?.generation === session.generation) return existing; // retry: never rewind accepted moves
      const tokenOwner = this.storage.sql.exec<{ id: number }>('SELECT id FROM world_sessions WHERE token=?', session.token).toArray()[0];
      if (tokenOwner && tokenOwner.id !== session.id) return 'BAD_RESUME';
      const m = session.movement, p = m.pose;
      const row = this.storage.sql.exec<SessionRow>(`INSERT OR REPLACE INTO world_sessions
        (id,token,name,generation,x,y,z,yaw,flags,seq,accepted,last_at,carry_cm,last_seen,last_input,expires_at,appearance)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
        session.id, session.token, name, session.generation,
        p.x, p.y, p.z, p.yaw, p.flags, m.seq, m.accepted ? 1 : 0, now, m.carryCm, now, now, now + IDLE_MS + RESUME_GRACE_MS, session.appearance).one();
      return fromRow(row);
    });
  }
  save(session: WorldSession): void {
    const m = session.movement, p = m.pose;
    this.storage.sql.exec(`UPDATE world_sessions SET x=?,y=?,z=?,yaw=?,flags=?,seq=?,accepted=?,last_at=?,carry_cm=?,last_seen=?,last_input=?,expires_at=?,appearance=?
      WHERE id=? AND generation=?`,
      p.x, p.y, p.z, p.yaw, p.flags, m.seq, m.accepted ? 1 : 0, m.lastAt, m.carryCm,
      session.lastSeen, session.lastInput, session.expiresAt, session.appearance, session.id, session.generation);
  }
  /** Only a server-verified profile save may rename a session; movement and generation stay intact. */
  rename(session: WorldSession, name: string): boolean {
    const normalized = normalizeNickname(name);
    if (!normalized || normalized === session.name) return false;
    const row = this.storage.sql.exec<{ name: string }>('UPDATE world_sessions SET name=? WHERE id=? AND generation=? RETURNING name',
      normalized, session.id, session.generation).toArray()[0];
    if (!row) return false;
    session.name = row.name;
    return true;
  }
  disconnect(session: WorldSession, now: number): void {
    session.expiresAt = now + RESUME_GRACE_MS;
    this.save(session);
  }
  /** A claimed handoff invalidates the origin resume token without recycling its native ID. */
  depart(id: number, generation: number): void {
    this.storage.sql.exec('INSERT INTO world_session_departures VALUES (?,?) ON CONFLICT(id) DO UPDATE SET generation=max(generation,excluded.generation)', id, generation);
    this.storage.sql.exec('DELETE FROM world_sessions WHERE id=? AND generation=?', id, generation);
  }
  prune(now: number): void {
    this.storage.sql.exec('DELETE FROM world_sessions WHERE expires_at <= ?', now);
  }
  nextExpiry(): number | null {
    return this.storage.sql.exec<{ at: number | null }>('SELECT min(expires_at) AS at FROM world_sessions').one().at;
  }
}
