/**
 * Time trials — worker routes (flag timeTrials, GTA-pivot lane C, docs/PLAN-gta-pivot.md section C).
 *   GET /api/time-trials/board?route=<id>  -> { routeId, day, records: TimeTrialRecord[], you, championGhost }
 * The daily per-route board (one best per device per SF day) lives in D1 (migration 0044 + ghost 0045). This is
 * the read-only board edge; the SUBMIT (write) moved into the WorldDO (review fix 2) so it can validate against the
 * authoritative pose + a server-recorded start + the server-measured elapsed — a client-trusted finish let anyone
 * post a spoofed time. The board I/O (ttReadBest/ttWriteBest/ttRankOf/ttDisplayName) is exported for that handler.
 * A SKILL board — no money/valuation — so, like place stamps, the read stays at the worker edge.
 */
import { flags } from '@gtasf/shared/flags';
import { timeTrialById, timeTrialDay, type TimeTrialRecord } from '@gtasf/shared/founder/timeTrials';
import type { Env } from '../env';
import { fundingDevice } from '../funding/identity';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const BOARD_LIMIT = 20;

/** The display name for a device's board rows (startup / founder handle, capped). */
export async function ttDisplayName(db: D1Database, deviceId: string): Promise<string> {
  const row = await db.prepare('SELECT startup_name, nickname FROM funding_profiles WHERE device_id = ?')
    .bind(deviceId).first<{ startup_name: string | null; nickname: string | null }>();
  return (row?.startup_name || row?.nickname || 'Anon').slice(0, 40);
}

/** The device's current best ms on a route's daily board, or null if it has none yet. */
export async function ttReadBest(db: D1Database, routeId: string, day: string, deviceId: string): Promise<number | null> {
  const row = await db.prepare('SELECT ms FROM time_trials WHERE route_id = ? AND day = ? AND device_id = ?')
    .bind(routeId, day, deviceId).first<{ ms: number }>();
  return row?.ms ?? null;
}

/** Upsert a device's best for a route's daily board, keeping the minimum (concurrent slower writes can't regress
 *  the board — the WHERE guards the DO UPDATE). The ghost (sampled path) is stored with the best so the board can
 *  hand back the champion's run to race (migration 0045). */
export async function ttWriteBest(db: D1Database, routeId: string, day: string, deviceId: string, name: string, ms: number, now: number, ghost: string | null): Promise<void> {
  await db.prepare(
    `INSERT INTO time_trials (route_id, day, device_id, name, ms, updated_at, ghost) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(route_id, day, device_id) DO UPDATE SET ms = excluded.ms, name = excluded.name, updated_at = excluded.updated_at, ghost = excluded.ghost
     WHERE excluded.ms < time_trials.ms`,
  ).bind(routeId, day, deviceId, name, ms, now, ghost).run();
}

/** A device's 1-based rank on the daily board for a given ms. */
export async function ttRankOf(db: D1Database, routeId: string, day: string, ms: number): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM time_trials t ${REAL_PLAYERS} WHERE t.route_id = ? AND t.day = ? AND t.ms < ? AND ${NOT_BOT}`)
    .bind(routeId, day, ms).first<{ n: number }>();
  return (row?.n ?? 0) + 1;
}

/** The champion (fastest) run's ghost for a route's day, parsed, or null. The client races it. */
/** Automated-test visits (funding_profiles.is_bot, migration 0033) never show on, rank on, or set the ghost of the
 *  player-facing board — prod smokes ran on is_bot devices and topped the real daily board. Same rule as the funding
 *  leaderboard (store.ts): is_bot IS NOT 1 keeps real (0), pre-0033 (NULL) and profile-less rows. */
const REAL_PLAYERS = 'LEFT JOIN funding_profiles p ON p.device_id = t.device_id';
const NOT_BOT = 'p.is_bot IS NOT 1';

async function championGhost(db: D1Database, routeId: string, day: string): Promise<unknown> {
  const row = await db.prepare(`SELECT t.ghost FROM time_trials t ${REAL_PLAYERS} WHERE t.route_id = ? AND t.day = ? AND ${NOT_BOT} ORDER BY t.ms ASC LIMIT 1`)
    .bind(routeId, day).first<{ ghost: string | null }>();
  if (!row?.ghost) return null;
  try { return JSON.parse(row.ghost); } catch { return null; }
}

async function topN(db: D1Database, routeId: string, day: string, n: number): Promise<TimeTrialRecord[]> {
  const rows = await db.prepare(`SELECT t.route_id, t.day, t.device_id, t.name, t.ms FROM time_trials t ${REAL_PLAYERS} WHERE t.route_id = ? AND t.day = ? AND ${NOT_BOT} ORDER BY t.ms ASC LIMIT ?`)
    .bind(routeId, day, n).all<{ route_id: string; day: string; device_id: string; name: string; ms: number }>();
  return rows.results.map(r => ({ routeId: r.route_id, day: r.day, deviceId: r.device_id, name: r.name, ms: r.ms }));
}

/** TTL purge (review fix 3): drop every board row for an SF day before today, so the ghost blobs don't accumulate
 *  forever (the board is daily; past days are never read). Scheduled from the worker cron behind flags.timeTrials. */
export async function purgeOldTimeTrials(db: D1Database, now: number): Promise<void> {
  await db.prepare('DELETE FROM time_trials WHERE day < ?').bind(timeTrialDay(now)).run();
}

export async function handleTimeTrialRequest(request: Request, env: Env, now = Date.now()): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/time-trials/board') return null; // submit moved to the WorldDO (review fix 2)
  if (!flags.timeTrials) return json({ error: 'off' }, 404);
  if (request.method !== 'GET') return json({ error: 'method' }, 405);
  const db = env.DB;
  const day = timeTrialDay(now);
  const routeId = url.searchParams.get('route') ?? '';
  if (!timeTrialById(routeId)) return json({ error: 'route' }, 404);
  const you = await fundingDevice(request, env.DB); // optional: lets the client highlight the viewer's row
  return json({ routeId, day, records: await topN(db, routeId, day, BOARD_LIMIT), you: you ?? null, championGhost: await championGhost(db, routeId, day) });
}
