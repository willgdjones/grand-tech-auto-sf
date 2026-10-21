/**
 * GTASF acqui-hire quest — the escrow money path (flag acquihireQuest, lane C; docs/decision-burnt-out-founder.md
 * option A). A burnt-out founder sells you their startup: you PAY 10% of current valuation at the start (min $1k,
 * capped at demo×4), deliver their laptop to the hacker house (a mission: server pose + in-order checkpoints + path
 * travel floor + same session, cleared on any teleport), and get 1.5× the price back — net +5% for the errand.
 *
 * Money rules (orchestrator, 2026-10-14; claim-first fix after review):
 *  • DEBIT at start: idempotent + atomic + never negative. One D1 batch: fold burn, then a conditional UPDATE (snapshot
 *    unchanged, balance ≥ cost, no ACTIVE purchase, no delivery credit today = the cooldown) and an INSERT guarded by
 *    changes()>0 — the applyCombatPenalty / chargeRide pattern. A partial unique index allows at most one active
 *    ('open' | 'delivering') purchase per device.
 *  • CREDIT at delivery is CLAIM-FIRST: one conditional UPDATE 'open' → 'delivering' (within the deadline, exactly one
 *    change) before any award. From then on every refund path (abandon, disconnect, ?at=, a second tab's start, the
 *    sweep) is a no-op — they only refund 'open' rows — so a racing refund can never pay the price back after the flip.
 *    Then the reviewed recordFundingCredit (ref `mission:acquihire:<start day>`); credited → 'delivered'; not credited
 *    or a throw → the claimed price is refunded ('refunded'). A crash between claim and settle is recovered by the sweep.
 *  • REFUND (abandon / teleport / disconnect / timeout / superseded): one atomic batch that returns cost_cents to
 *    current only while the row is 'open', settling it 'refunded' in the same batch (idempotent). The escrow lives in
 *    D1, so a Durable Object eviction cannot lose it (deadline sweep + lazy settle on the next start).
 * Economy v3 only (there is no spendable balance without it — same gate as rides / combat penalties).
 */
import { flags } from '@gtasf/shared/flags';
import { FUNDING_BASE_CENTS, FUNDING_SEASON, fundingDay, type FundingSource } from '@gtasf/shared/funding';
import { refreshEconomyV3Current } from '../funding/economyV3';

export const ACQUIHIRE_MISSION_ID = 'acquihire';
/** The errand must be delivered within this window, else the purchase is refunded. */
export const ACQUIHIRE_TIMEOUT_MS = 10 * 60_000;
/** Minimum price ($1,000); a player with less current valuation can't buy. */
export const ACQUIHIRE_MIN_CENTS = 100_000n;
export function acquihireCapCents(): bigint { return FUNDING_BASE_CENTS.demo * 4n; }

/** Price for a player at `current` valuation: 10% clamped to [$1k, demo×4]; null when they can't afford the minimum.
 *  Never more than current (min ≤ current is checked, and 10% ≤ current). */
export function acquihireCostCents(current: bigint): bigint | null {
  if (current < ACQUIHIRE_MIN_CENTS) return null;
  let cost = current / 10n;
  if (cost < ACQUIHIRE_MIN_CENTS) cost = ACQUIHIRE_MIN_CENTS;
  const cap = acquihireCapCents();
  if (cost > cap) cost = cap;
  return cost;
}
/** What the flip pays at delivery: 1.5× the price (net +50% of the price ≈ +5% of valuation). */
export function acquihirePayoutCents(cost: bigint): bigint { return cost * 3n / 2n; }
/** The delivery credit's ref for a purchase started on SF `day` (equals missionCredit(acquihire, start) — the cooldown). */
export function acquihireCreditRef(day: string): string { return `mission:${ACQUIHIRE_MISSION_ID}:${day}`; }
const SOURCE: FundingSource = 'celebrity';

export interface AcquisitionRow { acq_id: string; device_id: string; day: string; cost_cents: number; status: 'open' | 'delivering' | 'delivered' | 'refunded'; started_at: number; deadline_at: number; settled_at: number | null }

export type StartResult =
  | { ok: true; acqId: string; costCents: string; deadlineAt: number }
  | { ok: false; reason: 'economy-off' | 'unknown-profile' | 'unaffordable' | 'cooldown' | 'retry' };

export type DeliverResult =
  | { status: 'completed'; credited: boolean; costCents: string; payoutCents: string }
  | { status: 'expired' | 'refunded' | 'already-delivered' | 'in-progress' | 'no-acquisition' }
  | { status: 'refunded-on-error'; reason: string };

export interface AcquihireDeps {
  /** The reviewed credit path (WorldFunding.award → recordFundingCredit). Throws on unnamed / ledger cap. */
  award(input: { source: FundingSource; sourceRef: string; label: string; amountCents: string; metaJson: string }): Promise<{ credited: boolean }>;
}

const CREDIT_EXISTS = `SELECT 1 FROM funding_credits c WHERE c.device_id = ? AND c.season = ? AND c.source = '${SOURCE}' AND c.source_ref = ?`;
/** Grace before the sweep treats a 'delivering' claim as a crashed delivery. */
export const ACQUIHIRE_CLAIM_GRACE_MS = 45 * 60_000; // review E-L1: well past any in-flight delivery (the cron runs every 3 h)

export async function getAcquisition(db: D1Database, deviceId: string, acqId: string): Promise<AcquisitionRow | null> {
  return db.prepare('SELECT * FROM acquisitions WHERE acq_id = ? AND device_id = ?').bind(acqId, deviceId).first<AcquisitionRow>();
}
export async function openAcquisition(db: D1Database, deviceId: string): Promise<AcquisitionRow | null> {
  return db.prepare("SELECT * FROM acquisitions WHERE device_id = ? AND status = 'open'").bind(deviceId).first<AcquisitionRow>();
}

/** Return the price of a purchase in `fromStatus` and settle it 'refunded' — one atomic batch; true when this call moved
 *  the money. Only an 'open' purchase is ever refunded by abandon/teleport/timeout; 'delivering' only by the delivery
 *  itself (award failed) or the crash sweep. */
async function refundFrom(db: D1Database, deviceId: string, acqId: string, fromStatus: 'open' | 'delivering', now: number): Promise<boolean> {
  if (fromStatus === 'delivering') return settleDelivering(db, deviceId, acqId, now);
  const results = await db.batch([
    db.prepare(`UPDATE funding_profiles SET economy_v3_current_cents = economy_v3_current_cents +
        (SELECT cost_cents FROM acquisitions WHERE acq_id = ? AND device_id = ? AND status = ?)
      WHERE device_id = ? AND EXISTS (SELECT 1 FROM acquisitions WHERE acq_id = ? AND device_id = ? AND status = ?)`)
      .bind(acqId, deviceId, fromStatus, deviceId, acqId, deviceId, fromStatus),
    db.prepare("UPDATE acquisitions SET status = 'refunded', settled_at = ? WHERE acq_id = ? AND device_id = ? AND status = ?")
      .bind(now, acqId, deviceId, fromStatus),
  ]);
  return Number(results[0]?.meta.changes ?? 0) > 0;
}

/** Settle a CLAIMED purchase whose award didn't report credited (threw / not credited) or whose delivery crashed (sweep):
 *  refund the price ONLY if no delivery credit exists for its day, else mark it delivered — in one batch (review E-H1:
 *  an award that throws AFTER its credit row is written must not also refund, which paid +150%). Safe because the
 *  one-active index + the in-batch cooldown mean no other credit can carry that ref while the row is active. */
async function settleDelivering(db: D1Database, deviceId: string, acqId: string, now: number): Promise<boolean> {
  const row = await getAcquisition(db, deviceId, acqId);
  if (!row || row.status !== 'delivering') return false;
  const ref = acquihireCreditRef(row.day);
  const results = await db.batch([
    db.prepare(`UPDATE funding_profiles SET economy_v3_current_cents = economy_v3_current_cents + ?
      WHERE device_id = ? AND EXISTS (SELECT 1 FROM acquisitions WHERE acq_id = ? AND device_id = ? AND status = 'delivering')
        AND NOT EXISTS (${CREDIT_EXISTS})`)
      .bind(row.cost_cents, deviceId, acqId, deviceId, deviceId, FUNDING_SEASON, ref),
    db.prepare(`UPDATE acquisitions SET status = CASE WHEN EXISTS (${CREDIT_EXISTS}) THEN 'delivered' ELSE 'refunded' END, settled_at = ?
      WHERE acq_id = ? AND device_id = ? AND status = 'delivering'`)
      .bind(deviceId, FUNDING_SEASON, ref, now, acqId, deviceId),
  ]);
  return Number(results[0]?.meta.changes ?? 0) > 0;
}

/** Refund one OPEN purchase (abandon / teleport / disconnect / timeout / superseded). Atomic + idempotent; a purchase a
 *  delivery has already claimed ('delivering' / 'delivered') is never refunded here. */
export async function refundAcquisition(db: D1Database, deviceId: string, acqId: string, now = Date.now()): Promise<boolean> {
  return refundFrom(db, deviceId, acqId, 'open', now);
}

/** Debit the price and open the escrow (atomic). A stale OPEN purchase (its run was lost) is refunded first, so a new
 *  start supersedes it; a purchase being delivered blocks a new one (the active index). The cooldown (a delivery
 *  credit today) is checked INSIDE the debit batch. */
export async function startAcquisition(db: D1Database, deviceId: string, now = Date.now()): Promise<StartResult> {
  if (!flags.economyV3) return { ok: false, reason: 'economy-off' };
  const day = fundingDay(now), ref = acquihireCreditRef(day);
  const stale = await openAcquisition(db, deviceId);
  if (stale) await refundAcquisition(db, deviceId, stale.acq_id, now);
  await refreshEconomyV3Current(db, deviceId, now); // fold burn up to now; snapshot stamped at `now`
  const snap = await db.prepare('SELECT economy_v3_current_cents AS cur FROM funding_profiles WHERE device_id = ?').bind(deviceId).first<{ cur: number | null }>();
  if (!snap) return { ok: false, reason: 'unknown-profile' };
  const cost = acquihireCostCents(BigInt(snap.cur ?? 0));
  if (cost === null) return { ok: false, reason: 'unaffordable' };
  const acqId = crypto.randomUUID(), deadlineAt = now + ACQUIHIRE_TIMEOUT_MS;
  await db.batch([
    db.prepare(`UPDATE funding_profiles SET economy_v3_current_cents = economy_v3_current_cents - ? WHERE device_id = ?
      AND economy_v3_burn_updated_at = ? AND economy_v3_current_cents >= ?
      AND NOT EXISTS (SELECT 1 FROM acquisitions WHERE device_id = ? AND status IN ('open', 'delivering'))
      AND NOT EXISTS (${CREDIT_EXISTS})`)
      .bind(Number(cost), deviceId, now, Number(cost), deviceId, deviceId, FUNDING_SEASON, ref),
    db.prepare(`INSERT INTO acquisitions (acq_id, device_id, day, cost_cents, status, started_at, deadline_at)
      SELECT ?, ?, ?, ?, 'open', ?, ? WHERE changes() > 0`)
      .bind(acqId, deviceId, day, Number(cost), now, deadlineAt),
  ]);
  const row = await getAcquisition(db, deviceId, acqId);
  if (row) return { ok: true, acqId, costCents: String(row.cost_cents), deadlineAt };
  const done = await db.prepare(CREDIT_EXISTS).bind(deviceId, FUNDING_SEASON, ref).first();
  return { ok: false, reason: done ? 'cooldown' : 'retry' };
}

/** Pay the flip for a SERVER-VALIDATED delivery (the caller checked pose, checkpoints, travel floor and session).
 *  CLAIM first ('open' → 'delivering' within the deadline), then award, then settle — see the module header. */
export async function deliverAcquisition(db: D1Database, deviceId: string, acqId: string, deps: AcquihireDeps, now = Date.now()): Promise<DeliverResult> {
  const claim = await db.prepare("UPDATE acquisitions SET status = 'delivering', settled_at = ? WHERE acq_id = ? AND device_id = ? AND status = 'open' AND deadline_at >= ?")
    .bind(now, acqId, deviceId, now).run();
  if (Number(claim.meta.changes ?? 0) !== 1) {
    const row = await getAcquisition(db, deviceId, acqId);
    if (!row) return { status: 'no-acquisition' };
    if (row.status === 'delivered') return { status: 'already-delivered' };
    if (row.status === 'delivering') return { status: 'in-progress' };
    if (row.status === 'refunded') return { status: 'refunded' };
    await refundAcquisition(db, deviceId, acqId, now); // still open: past its deadline
    return { status: 'expired' };
  }
  const row = (await getAcquisition(db, deviceId, acqId))!;
  const cost = BigInt(row.cost_cents), payout = acquihirePayoutCents(cost);
  let credited = false, reason = 'not-credited';
  try {
    ({ credited } = await deps.award({ source: SOURCE, sourceRef: acquihireCreditRef(row.day), label: 'Mission: Buy My Company (flipped)', // 'Mission: ' → the HUD's JOB DONE card
      amountCents: payout.toString(), metaJson: JSON.stringify({ acquihire: acqId, costCents: row.cost_cents }) }));
  } catch (error) { reason = error instanceof Error ? error.message : 'unknown'; }
  if (!credited) {
    // Not reported credited (cap / unnamed / a throw): refund the price — unless the credit row actually landed (a throw
    // after the INSERT), in which case the claim settles as delivered (never both the payout and the refund).
    if (await refundFrom(db, deviceId, acqId, 'delivering', now)) return { status: 'refunded-on-error', reason };
    if ((await getAcquisition(db, deviceId, acqId))?.status === 'delivered') return { status: 'completed', credited: true, costCents: cost.toString(), payoutCents: payout.toString() };
    return { status: 'refunded-on-error', reason };
  }
  await db.prepare("UPDATE acquisitions SET status = 'delivered', settled_at = ? WHERE acq_id = ? AND device_id = ? AND status = 'delivering'")
    .bind(now, acqId, deviceId).run();
  return { status: 'completed', credited, costCents: cost.toString(), payoutCents: payout.toString() };
}

/** Cron safety net: refund OPEN purchases past their deadline (runs lost to eviction), and settle 'delivering' claims
 *  older than the grace (a crash between claim and settle): delivered if their credit exists, else refunded. */
export async function sweepExpiredAcquisitions(db: D1Database, now = Date.now(), limit = 200): Promise<number> {
  let settled = 0;
  const open = await db.prepare("SELECT acq_id, device_id FROM acquisitions WHERE status = 'open' AND deadline_at < ? LIMIT ?")
    .bind(now, limit).all<{ acq_id: string; device_id: string }>();
  for (const r of open.results) if (await refundAcquisition(db, r.device_id, r.acq_id, now)) settled += 1;
  const stuck = await db.prepare("SELECT acq_id, device_id, day FROM acquisitions WHERE status = 'delivering' AND settled_at < ? LIMIT ?")
    .bind(now - ACQUIHIRE_CLAIM_GRACE_MS, limit).all<{ acq_id: string; device_id: string; day: string }>();
  for (const r of stuck.results) if (await settleDelivering(db, r.device_id, r.acq_id, now)) settled += 1; // credit-guarded, atomic
  return settled;
}
