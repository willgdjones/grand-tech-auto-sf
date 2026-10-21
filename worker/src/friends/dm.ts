/**
 * Friend DM store (PLAN-v2.1 d5/d6, gtasf-q4yo S5). Store-and-forward direct messages between two
 * friends, keyed by the ordered pair (pair_a < pair_b) so a thread is one indexed range scan. Device
 * ids are internal; the route maps sender/recipient to usernames and Jev-moderates before insert. The
 * chat DM tab polls the thread (no WorldDO socket).
 */
const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

export interface DmRow { sender: string; recipient: string; text: string; created_at: number }

/** Append a pre-moderated DM only while still friends, with an increasing per-thread cursor. */
export async function insertDm(db: D1Database, sender: string, recipient: string, text: string, now: number): Promise<boolean> {
  const [a, b] = pair(sender, recipient);
  // Moderation can finish out of order, and several messages can share one millisecond.
  // Assign the cursor atomically with the insert so neither case falls behind a reader's `since`.
  // HAVING guards the aggregate's single output row, including an empty first-message thread.
  const inserted = await db.prepare(`INSERT INTO friend_dms(pair_a,pair_b,sender,recipient,text,created_at)
    SELECT ?,?,?,?,?,MAX(?,COALESCE(MAX(created_at)+1,?)) FROM friend_dms WHERE pair_a=? AND pair_b=?
    HAVING EXISTS(SELECT 1 FROM friendships WHERE a=? AND b=?) RETURNING id`)
    .bind(a, b, sender, recipient, text, now, now, a, b, a, b).first<{ id: number }>();
  return inserted !== null;
}

/** The thread between two devices, ascending, only messages strictly after `since` (ms), capped. */
export async function dmThread(db: D1Database, me: string, other: string, since = 0, limit = 100): Promise<DmRow[]> {
  const [a, b] = pair(me, other);
  const rows = await db.prepare('SELECT sender,recipient,text,created_at FROM friend_dms WHERE pair_a=? AND pair_b=? AND created_at>? ORDER BY created_at ASC LIMIT ?')
    .bind(a, b, since, Math.max(1, Math.min(200, limit))).all<DmRow>();
  return rows.results ?? [];
}
