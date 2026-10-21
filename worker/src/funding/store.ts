import { defaultFundingNames } from '@gtasf/shared/startupNames';
import { flags } from '@gtasf/shared/flags';
import { ECONOMY_RESET_EPOCH, FUNDING_MAX_CENTS, FUNDING_SEASON, fundingCents, fundingDay, fundingRound, normalizeFundingName,
  type FundingAward, type FundingLeaderboard, type FundingLeader, type FundingProfile, type FundingQuote } from '@gtasf/shared/funding';
import { currentFromSnapshot, economyV3Current, refreshEconomyV3Current, resetDeviceToEconomyV3, resetPendingEconomyV3 } from './economyV3';

interface ProfileRow { device_id: string; startup_name: string; nickname: string; verified_founder: number }
interface TotalsRow extends ProfileRow { total_cents: string; today_cents: string }
/** Leaderboard rows of profiles not yet backfilled show the same deterministic default the backfill will store. */
function namesOf(row: { device_id: string; startup_name: string | null; nickname: string | null }) {
  if (row.startup_name && row.nickname) return { startupName: row.startup_name, nickname: row.nickname };
  const names = defaultFundingNames(row.device_id);
  return { startupName: row.startup_name || names.startupName, nickname: row.nickname || names.nickname };
}
interface AwardRow { id: string; device_id: string; event_id: string; event_title: string; day: string; entered_at: number; awarded_at: number; amount_cents: number; quote_json: string }
export interface PreviousFundingAward { eventId: string; at: number; count: number }
const totalsSql = `SELECT p.device_id,p.startup_name,p.nickname,
  ${flags.emailCapture ? 'EXISTS(SELECT 1 FROM email_captures e WHERE e.device_id=p.device_id AND e.verified_at IS NOT NULL)' : '0'} verified_founder,
  CAST(COALESCE(SUM(a.amount_cents),0) AS TEXT) total_cents,
  CAST(COALESCE(SUM(CASE WHEN a.day=? THEN a.amount_cents ELSE 0 END),0) AS TEXT) today_cents
  FROM funding_profiles p LEFT JOIN funding_earnings a ON a.device_id=p.device_id AND a.season=?`;

// Most Wanted bounty credits (founder/bounty.ts: source 'celebrity', ref 'bounty:<day>') are victim-funded TRANSFERS: the
// victim's WASTED debit only lowers their current balance, so counting the killer's credit on the lifetime / today boards
// would let a ring move up to $50k per killer per day onto them (review A-M1). The BOARDS (and board ranks) leave them out;
// the player's own valuation (ledger SUM) and the economy-v3 current board still include them.
const BOUNTY_CREDIT = "c.source='celebrity' AND c.source_ref LIKE 'bounty:%'";
/** totalsSql for the lifetime / today BOARDS: bounty credits subtracted. Binds ?1 = SF day, ?2 = season. */
const boardTotalsSql = `SELECT p.device_id,p.startup_name,p.nickname,
  ${flags.emailCapture ? 'EXISTS(SELECT 1 FROM email_captures e WHERE e.device_id=p.device_id AND e.verified_at IS NOT NULL)' : '0'} verified_founder,
  CAST(COALESCE(SUM(a.amount_cents),0) - COALESCE(MAX(b.total),0) AS TEXT) total_cents,
  CAST(COALESCE(SUM(CASE WHEN a.day=?1 THEN a.amount_cents ELSE 0 END),0) - COALESCE(MAX(b.today),0) AS TEXT) today_cents
  FROM funding_profiles p LEFT JOIN funding_earnings a ON a.device_id=p.device_id AND a.season=?2
  LEFT JOIN (SELECT c.device_id, SUM(c.amount_cents) total, SUM(CASE WHEN c.day=?1 THEN c.amount_cents ELSE 0 END) today
    FROM funding_credits c WHERE c.season=?2 AND ${BOUNTY_CREDIT} GROUP BY c.device_id) b ON b.device_id=p.device_id`;

export async function createFundingProfile(db: D1Database, deviceId: string, tokenHash: string, now: number): Promise<void> {
  // Economy v3: a new player starts already through the reset (stamped), so the pending-reset probe skips them.
  // Every new founder starts with a funny generated identity (founder, Oct 6); rename any time in Game options.
  const names = defaultFundingNames(deviceId);
  await db.prepare(`INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at${flags.economyV3 ? ',economy_v3_current_cents,economy_v3_lifetime_cents,economy_v3_burn_updated_at,economy_reset_epoch' : ''})
    VALUES(?,?,?,?,?,?${flags.economyV3 ? ',0,0,?,?' : ''})`).bind(deviceId, tokenHash, names.startupName, names.nickname, now, now, ...(flags.economyV3 ? [now, ECONOMY_RESET_EPOCH] : [])).run();
}
export async function fundingDeviceByHash(db: D1Database, hash: string): Promise<string | null> {
  const direct = (await db.prepare('SELECT device_id FROM funding_profiles WHERE token_hash=?').bind(hash).first<{ device_id: string }>())?.device_id;
  if (direct) return direct;
  // Account recovery (gtasf-17df): a recovered device's fresh cookie resolves to the original profile
  // via device_aliases. Flag-gated and guarded so an un-migrated DB can never break core identity.
  if (!flags.accountRecovery) return null;
  try {
    return (await db.prepare('SELECT device_id FROM device_aliases WHERE token_hash=?').bind(hash).first<{ device_id: string }>())?.device_id ?? null;
  } catch { return null; }
}
export async function saveFundingNames(db: D1Database, deviceId: string, startupName: unknown, nickname: unknown, now: number): Promise<FundingProfile> {
  const startup = normalizeFundingName(startupName, 'startup'), name = normalizeFundingName(nickname, 'nickname');
  await db.prepare('UPDATE funding_profiles SET startup_name=?,nickname=?,updated_at=? WHERE device_id=?').bind(startup, name, now, deviceId).run();
  return getFundingProfile(db, deviceId, now);
}
export async function previousFundingAward(db: D1Database, deviceId: string): Promise<PreviousFundingAward | null> {
  const row = await db.prepare('SELECT event_id,awarded_at,quote_json FROM funding_awards WHERE device_id=? AND season=? ORDER BY awarded_at DESC,id DESC LIMIT 1')
    .bind(deviceId, FUNDING_SEASON).first<Pick<AwardRow, 'event_id' | 'awarded_at' | 'quote_json'>>();
  if (!row) return null;
  const quote = JSON.parse(row.quote_json) as FundingQuote;
  return { eventId: row.event_id, at: row.awarded_at, count: quote.streakCount };
}
/** A player's place on the lifetime (or `day`) BOARD: board totals exclude bounty credits, for everyone and for `amount`. */
async function rank(db: D1Database, deviceId: string, amount: string, day?: string): Promise<number | null> {
  if (fundingCents(amount) <= 0n) return null;
  const dayFilter = day ? 'AND day=?' : '', cDayFilter = day ? 'AND c.day=?' : '';
  const sql = `SELECT COUNT(*)+1 rank FROM (SELECT device_id,SUM(amount_cents) total FROM (
      SELECT device_id,amount_cents FROM funding_earnings WHERE season=? ${dayFilter}
      UNION ALL SELECT c.device_id,-c.amount_cents FROM funding_credits c WHERE c.season=? ${cDayFilter} AND ${BOUNTY_CREDIT}
    ) GROUP BY device_id HAVING total>?)`;
  const row = await db.prepare(sql).bind(FUNDING_SEASON, ...(day ? [day] : []), FUNDING_SEASON, ...(day ? [day] : []), Number(fundingCents(amount))).first<{ rank: number }>();
  return row?.rank ?? null;
}
/** A device's bounty credits (lifetime + `day`), to place it on the bounty-free boards. */
async function bountyCredits(db: D1Database, deviceId: string, day: string): Promise<{ total: bigint; today: bigint }> {
  const row = await db.prepare(`SELECT COALESCE(SUM(c.amount_cents),0) total, COALESCE(SUM(CASE WHEN c.day=? THEN c.amount_cents ELSE 0 END),0) today
    FROM funding_credits c WHERE c.device_id=? AND c.season=? AND ${BOUNTY_CREDIT}`).bind(day, deviceId, FUNDING_SEASON).first<{ total: number; today: number }>();
  return { total: BigInt(row?.total ?? 0), today: BigInt(row?.today ?? 0) };
}
export async function getFundingProfile(db: D1Database, deviceId: string, now: number): Promise<FundingProfile> {
  const day = fundingDay(now);
  // Economy-v3 enable trigger (founder 07:5x — one-time RESET, not rescale): the first time a player's profile
  // is read after the flag goes on, wipe their funding to $0 / Bootstrapping (keeping name/looks/friends/recovery)
  // — idempotent via the burn-stamp marker, so it runs exactly once. Must precede the totals read because it
  // deletes the funding ledgers (SUM). Pane 5 ALSO runs enableEconomyV3Migration once at the enable deploy to
  // reset everyone up front (after the D1 backup); this lazy path is the belt-and-braces guarantee.
  if (flags.economyV3) await resetDeviceToEconomyV3(db, deviceId, now);
  const row = await db.prepare(`${totalsSql} WHERE p.device_id=? GROUP BY p.device_id`).bind(day, FUNDING_SEASON, deviceId).first<TotalsRow>();
  if (!row) throw new RangeError('Funding profile unavailable');
  if (!row.startup_name || !row.nickname) {
    // Lazy backfill for profiles created before default names: fill only the missing field(s), never a chosen name.
    const names = defaultFundingNames(deviceId);
    await db.prepare('UPDATE funding_profiles SET startup_name=COALESCE(NULLIF(startup_name,\'\'),?),nickname=COALESCE(NULLIF(nickname,\'\'),?) WHERE device_id=?')
      .bind(names.startupName, names.nickname, deviceId).run();
    row.startup_name ||= names.startupName; row.nickname ||= names.nickname;
  }
  const bounty = await bountyCredits(db, deviceId, day); // ranks are BOARD places: bounty transfers excluded (review A-M1)
  const [weekRank, todayRank, previous] = await Promise.all([
    rank(db, deviceId, (fundingCents(row.total_cents) - bounty.total).toString()), rank(db, deviceId, (fundingCents(row.today_cents) - bounty.today).toString(), day),
    previousFundingAward(db, deviceId),
  ]);
  const base = { deviceId, startupName: row.startup_name, nickname: row.nickname, todayCents: row.today_cents,
    ...(flags.emailCapture ? { verifiedFounder: Boolean(row.verified_founder) } : {}),
    rank: weekRank, todayRank, lastAwardAt: previous?.at ?? null, streak: previous?.count ?? 0 };
  if (flags.economyV3) {
    // v3: the headline total is CURRENT (burned) funding and the round follows it; lifetime (= ledger SUM,
    // what the cap table reports) and the live burn rate ride alongside. rank stays lifetime-ranked (the
    // lifetime leaderboard); a current-ranked board is separate (PLAN-economy-v3 decision 5).
    const { currentCents, burnPerSecCents } = await economyV3Current(db, deviceId, fundingCents(row.total_cents), now);
    return { ...base, totalCents: currentCents.toString(), round: fundingRound(currentCents),
      currentCents: currentCents.toString(), lifetimeCents: row.total_cents, burnPerSecCents: burnPerSecCents.toString() };
  }
  return { ...base, totalCents: row.total_cents, round: fundingRound(row.total_cents) };
}
export async function fundingAlreadyAwarded(db: D1Database, deviceId: string, eventId: string, now: number): Promise<boolean> {
  return Boolean(await db.prepare('SELECT id FROM funding_awards WHERE device_id=? AND season=? AND event_id=? AND day=?')
    .bind(deviceId, FUNDING_SEASON, eventId, fundingDay(now)).first());
}
/** One conditional SQL insert is the atomic money boundary; repeats cannot add a second award. */
export async function recordFundingAward(db: D1Database, input: {
  deviceId: string; eventId: string; eventTitle: string; enteredAt: number; now: number; quote: FundingQuote;
}): Promise<{ credited: boolean; award: FundingAward }> {
  const before = await getFundingProfile(db, input.deviceId, input.now);
  if (!before.startupName || !before.nickname) throw new RangeError('Choose your startup and nickname first');
  const amount = fundingCents(input.quote.amountCents), id = crypto.randomUUID(), day = fundingDay(input.now);
  if (amount === 0n || amount > (flags.economyV3 ? 20_000_000n : 1_200_000_000n)) throw new RangeError('Invalid event award');
  // SUM is an integer in SQLite. The safe guard is also inside the insert, including concurrent attempts.
  await db.prepare(`INSERT INTO funding_awards(id,device_id,season,event_id,event_title,day,entered_at,awarded_at,amount_cents,quote_json)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(amount_cents),0) FROM funding_earnings WHERE device_id=? AND season=?) <= ?
    ON CONFLICT(device_id,season,event_id,day) DO NOTHING`).bind(id, input.deviceId, FUNDING_SEASON, input.eventId, input.eventTitle,
    day, input.enteredAt, input.now, Number(amount), JSON.stringify(input.quote), input.deviceId, FUNDING_SEASON, Number(FUNDING_MAX_CENTS - amount)).run();
  const stored = await db.prepare('SELECT * FROM funding_awards WHERE device_id=? AND season=? AND event_id=? AND day=?')
    .bind(input.deviceId, FUNDING_SEASON, input.eventId, day).first<AwardRow>();
  if (!stored) throw new RangeError('Funding limit reached');
  if (flags.economyV3 && stored.id === id) await refreshEconomyV3Current(db, input.deviceId, input.now); // fold burn + book this award into current
  const profile = await getFundingProfile(db, input.deviceId, input.now);
  return { credited: stored.id === id, award: { ...(JSON.parse(stored.quote_json) as FundingQuote), id: stored.id,
    eventId: stored.event_id, eventTitle: stored.event_title, awardedAt: stored.awarded_at, day: stored.day,
    previousRound: stored.id === id ? before.round : fundingRound(fundingCents(profile.totalCents) - BigInt(stored.amount_cents)), profile } };
}
export async function fundingLeaderboard(db: D1Database, deviceId: string, now: number, liveDevices: ReadonlySet<string>): Promise<FundingLeaderboard> {
  if (flags.economyV3) await resetPendingEconomyV3(db, now);
  const day = fundingDay(now);
  const query = async (today: boolean): Promise<FundingLeader[]> => {
    // Exclude automated-test visits (is_bot, migration 0033) from the player-facing board BEFORE ranking, so the
    // leaderboard and its ranks reflect real founders only — matches is_bot's stated purpose ("player counts
    // exclude it"). is_bot IS NOT 1 keeps real (0) and pre-0033 (NULL) profiles.
    const rows = await db.prepare(`WITH totals AS (${boardTotalsSql} WHERE p.is_bot IS NOT 1 GROUP BY p.device_id), ranked AS (
      SELECT *,RANK() OVER (ORDER BY CAST(total_cents AS INTEGER) DESC) week_rank,
      RANK() OVER (ORDER BY CAST(today_cents AS INTEGER) DESC) today_rank FROM totals
    ) SELECT * FROM ranked WHERE CAST(${today ? 'today_cents' : 'total_cents'} AS INTEGER)>0
      ORDER BY CAST(${today ? 'today_cents' : 'total_cents'} AS INTEGER) DESC,device_id LIMIT 50`)
      .bind(day, FUNDING_SEASON).all<TotalsRow & { week_rank: number; today_rank: number }>();
    return rows.results.map(row => ({ deviceId: row.device_id, ...namesOf(row),
      ...(flags.emailCapture ? { verifiedFounder: Boolean(row.verified_founder) } : {}),
      totalCents: row.total_cents, todayCents: row.today_cents, round: fundingRound(row.total_cents), rank: Number(row.total_cents) > 0 ? row.week_rank : null,
      todayRank: Number(row.today_cents) > 0 ? row.today_rank : null, lastAwardAt: null, streak: 0, live: liveDevices.has(row.device_id) }));
  };
  // Economy v3 current board: burn is lazy per player, so derive each current in code (fine at playtest scale).
  const currentBoard = async (): Promise<FundingLeader[]> => {
    const rows = await db.prepare(`WITH totals AS (${totalsSql} WHERE p.is_bot IS NOT 1 GROUP BY p.device_id)
      SELECT t.*, p.economy_v3_current_cents cur, p.economy_v3_lifetime_cents life, p.economy_v3_burn_updated_at at
      FROM totals t JOIN funding_profiles p ON p.device_id=t.device_id WHERE CAST(t.total_cents AS INTEGER)>0`)
      .bind(day, FUNDING_SEASON).all<TotalsRow & { cur: number | null; life: number | null; at: number | null }>();
    const ranked = rows.results.map(row => ({ row, current: currentFromSnapshot(BigInt(row.total_cents), row, now) }))
      .filter(entry => entry.current > 0n)
      .sort((a, b) => a.current === b.current ? (a.row.device_id < b.row.device_id ? -1 : 1) : a.current > b.current ? -1 : 1);
    let rank = 0, previous: bigint | null = null;
    return ranked.slice(0, 50).map(({ row, current }, index) => {
      if (current !== previous) { rank = index + 1; previous = current; }
      return { deviceId: row.device_id, ...namesOf(row),
        ...(flags.emailCapture ? { verifiedFounder: Boolean(row.verified_founder) } : {}),
        totalCents: current.toString(), todayCents: row.today_cents, round: fundingRound(current), rank, todayRank: null,
        lastAwardAt: null, streak: 0, live: liveDevices.has(row.device_id), currentCents: current.toString(), lifetimeCents: row.total_cents };
    });
  };
  const [week, today, you, current] = await Promise.all([query(false), query(true), getFundingProfile(db, deviceId, now),
    flags.economyV3 ? currentBoard() : Promise.resolve(undefined)]);
  return { week, today, you, serverNow: now, ...(current ? { current } : {}) };
}
/** Max nicknames per summary batch — a dense crowd of nearby peers, bounded so the IN query stays cheap. */
export const FUNDING_SUMMARY_MAX = 64;
/**
 * Compact public funding profiles for a batch of peers, keyed by nickname — the same join key overhead
 * nameplates already use (PLAN-v2 decision 6, gtasf-nameplate-funding-beyond-top50-zqnk). `fundingLeaderboard`
 * only returns the top 50, so a nearby player outside it would otherwise show a bare nickname; this fills
 * their startup / stage / raised. Public display fields only — never email, token or payment data.
 *
 * Duplicate nicknames resolve to the best-funded profile (deterministic). rank/todayRank/lastAwardAt/streak
 * are NOT computed in a batch (the leaderboard owns ranking and the crown); callers merge these summaries
 * BEHIND the top-50 leaderboard, never over it, so a crowned top-50 plate is never downgraded.
 */
export async function fundingSummariesByNickname(db: D1Database, nicknames: readonly string[], now: number): Promise<FundingProfile[]> {
  const unique = [...new Set(nicknames)].filter(name => typeof name === 'string' && name.length > 0 && name.length <= 64).slice(0, FUNDING_SUMMARY_MAX);
  if (unique.length === 0) return [];
  if (flags.economyV3) await resetPendingEconomyV3(db, now);
  const day = fundingDay(now);
  const rows = await db.prepare(`${totalsSql} WHERE p.nickname IN (${unique.map(() => '?').join(',')}) GROUP BY p.device_id`)
    .bind(day, FUNDING_SEASON, ...unique).all<TotalsRow>();
  const best = new Map<string, FundingProfile>();
  for (const row of rows.results) {
    const existing = best.get(row.nickname);
    if (existing && BigInt(row.total_cents) <= BigInt(existing.totalCents)) continue;
    best.set(row.nickname, { deviceId: row.device_id, startupName: row.startup_name, nickname: row.nickname,
      ...(flags.emailCapture ? { verifiedFounder: Boolean(row.verified_founder) } : {}),
      totalCents: row.total_cents, todayCents: row.today_cents, round: fundingRound(row.total_cents),
      rank: null, todayRank: null, lastAwardAt: null, streak: 0 });
  }
  return [...best.values()];
}
/**
 * Resolve a nickname to the best-funded device holding it — for "click any player" (PLAN-v2 decision 5)
 * when the client only knows a nearby peer's nickname, not their deviceId. Same best-funded tie-break as
 * {@link fundingSummariesByNickname}, so captable?nick= returns exactly what a summary→deviceId→captable
 * round-trip would, in one request. Null when no profile carries that nickname. */
export async function fundingDeviceByNickname(db: D1Database, nickname: string, now: number): Promise<string | null> {
  const [best] = await fundingSummariesByNickname(db, [nickname], now);
  return best?.deviceId ?? null;
}
