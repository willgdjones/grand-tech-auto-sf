import { normalizeUsername, deriveUsernameBase, USERNAME_MAX } from '@gtasf/shared/friends/username';

/**
 * Friends D1 store (PLAN-v2.1 decision 5, gtasf-q4yo). Keyed by the funding device id. Usernames are
 * globally unique + case-insensitive (username_key is the casefolded UNIQUE column). Friendships are
 * mutual opt-in, stored once as the ordered pair (a < b). The route layer validates + Jev-moderates a
 * username before claiming; this store owns the atomic D1 writes. Device ids never leave the server —
 * the routes expose usernames only.
 */

export async function usernameForDevice(db: D1Database, deviceId: string): Promise<{ display: string; key: string } | null> {
  const row = await db.prepare('SELECT username, username_key FROM friend_usernames WHERE device_id=?').bind(deviceId).first<{ username: string; username_key: string }>();
  return row ? { display: row.username, key: row.username_key } : null;
}

export async function deviceForUsernameKey(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT device_id FROM friend_usernames WHERE username_key=?').bind(key).first<{ device_id: string }>();
  return row?.device_id ?? null;
}

export async function isUsernameKeyTaken(db: D1Database, key: string): Promise<boolean> {
  return (await deviceForUsernameKey(db, key)) !== null;
}

export type ClaimResult = { ok: true; username: string } | { ok: false; reason: 'taken' | 'already-claimed'; current?: string };
/** Claim a (pre-validated, pre-moderated) username once per device. Atomic on the UNIQUE key. */
export async function claimUsername(db: D1Database, deviceId: string, display: string, key: string, now: number): Promise<ClaimResult> {
  const existing = await usernameForDevice(db, deviceId);
  if (existing) return existing.key === key ? { ok: true, username: existing.display } : { ok: false, reason: 'already-claimed', current: existing.display };
  // INSERT OR IGNORE loses the race on a duplicate username_key; re-read the owner to decide.
  await db.prepare('INSERT OR IGNORE INTO friend_usernames(device_id,username,username_key,claimed_at) VALUES(?,?,?,?)').bind(deviceId, display, key, now).run();
  return (await deviceForUsernameKey(db, key)) === deviceId ? { ok: true, username: display } : { ok: false, reason: 'taken' };
}

/** Available username suggestions derived from a base (e.g. the player's nickname), skipping taken keys. */
export async function suggestUsernames(db: D1Database, base: string, count = 3): Promise<string[]> {
  const root = (deriveUsernameBase(base) ?? 'founder').slice(0, USERNAME_MAX - 3);
  const out: string[] = [];
  for (let n = 1; out.length < count && n < 1000; n++) {
    const norm = normalizeUsername(n === 1 ? root : `${root}${n}`);
    if (norm && !(await isUsernameKeyTaken(db, norm.key))) out.push(norm.display);
  }
  return out;
}

const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

export async function areFriends(db: D1Database, a: string, b: string): Promise<boolean> {
  const [lo, hi] = pair(a, b);
  return (await db.prepare('SELECT 1 FROM friendships WHERE a=? AND b=?').bind(lo, hi).first()) !== null;
}

async function befriend(db: D1Database, a: string, b: string, now: number): Promise<void> {
  const [lo, hi] = pair(a, b);
  await db.prepare('INSERT OR IGNORE INTO friendships(a,b,created_at) VALUES(?,?,?)').bind(lo, hi, now).run();
  await db.prepare('DELETE FROM friend_requests WHERE (requester=? AND target=?) OR (requester=? AND target=?)').bind(a, b, b, a).run();
}

export type RequestResult = 'self' | 'already-friends' | 'friends' | 'requested' | 'exists';
/** Send a friend request. A pending reverse request turns straight into a mutual friendship. */
export async function sendRequest(db: D1Database, requester: string, target: string, source: string, now: number): Promise<RequestResult> {
  if (requester === target) return 'self';
  if (await areFriends(db, requester, target)) return 'already-friends';
  if (await db.prepare('SELECT 1 FROM friend_requests WHERE requester=? AND target=?').bind(target, requester).first()) {
    await befriend(db, requester, target, now); return 'friends';
  }
  if (await db.prepare('SELECT 1 FROM friend_requests WHERE requester=? AND target=?').bind(requester, target).first()) return 'exists';
  await db.prepare('INSERT OR IGNORE INTO friend_requests(requester,target,created_at,source) VALUES(?,?,?,?)').bind(requester, target, now, source).run();
  return 'requested';
}

export type RespondResult = 'friends' | 'declined' | 'none';
/** Accept or decline an incoming request (requester -> me). */
export async function respondRequest(db: D1Database, me: string, requester: string, accept: boolean, now: number): Promise<RespondResult> {
  if (!(await db.prepare('SELECT 1 FROM friend_requests WHERE requester=? AND target=?').bind(requester, me).first())) return 'none';
  if (accept) { await befriend(db, me, requester, now); return 'friends'; }
  await db.prepare('DELETE FROM friend_requests WHERE requester=? AND target=?').bind(requester, me).run();
  return 'declined';
}

export async function removeFriend(db: D1Database, me: string, other: string, now: number): Promise<void> {
  const [lo, hi] = pair(me, other);
  await db.prepare('DELETE FROM friendships WHERE a=? AND b=?').bind(lo, hi).run();
  // Also clear any lingering request either way.
  await db.prepare('DELETE FROM friend_requests WHERE (requester=? AND target=?) OR (requester=? AND target=?)').bind(me, other, other, me).run();
}

export interface FriendList { friends: string[]; incoming: string[]; outgoing: string[] }
/** Device ids of the player's friends + pending incoming/outgoing requests (routes map to usernames). */
export async function listFriends(db: D1Database, deviceId: string): Promise<FriendList> {
  const f = await db.prepare('SELECT a,b FROM friendships WHERE a=? OR b=?').bind(deviceId, deviceId).all<{ a: string; b: string }>();
  const inc = await db.prepare('SELECT requester FROM friend_requests WHERE target=?').bind(deviceId).all<{ requester: string }>();
  const out = await db.prepare('SELECT target FROM friend_requests WHERE requester=?').bind(deviceId).all<{ target: string }>();
  return {
    friends: (f.results ?? []).map(r => (r.a === deviceId ? r.b : r.a)),
    incoming: (inc.results ?? []).map(r => r.requester),
    outgoing: (out.results ?? []).map(r => r.target),
  };
}

/** Atomic conditional increment (same shape as referralRateLimit): true when allowed. */
export async function friendsRateLimit(db: D1Database, key: string, maximum: number, windowMs: number, now: number): Promise<boolean> {
  const row = await db.prepare(`INSERT INTO friend_limits(key,window_at,count) VALUES(?,?,1)
    ON CONFLICT(key) DO UPDATE SET window_at=CASE WHEN window_at<=? THEN excluded.window_at ELSE window_at END,
    count=CASE WHEN window_at<=? THEN 1 ELSE count+1 END WHERE window_at<=? OR count<? RETURNING count`)
    .bind(key, now, now - windowMs, now - windowMs, now - windowMs, maximum).first();
  return Boolean(row);
}
