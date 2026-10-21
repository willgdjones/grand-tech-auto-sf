import { flags } from '@gtasf/shared/flags';
import { type DeathKind, deathCostCents } from '@gtasf/shared/combat/economy';
import { refreshEconomyV3Current } from './economyV3';

/**
 * GTA V pivot — LANE B (combat & police): the authoritative valuation cost of dying (flag combat,
 * gtasf-combat-gate-health-economy-8cqg). WASTED = −2% of current valuation (min $1,000); BUSTED = −5%.
 *
 * The debit mirrors chargeRide (rides.ts): fold idle burn into the snapshot, then debit in one atomic
 * batch whose UPDATE is conditional on the snapshot being unchanged and covering the cost, so valuation
 * never goes negative and a concurrent award can't be lost. `incidentId` is the idempotency key — a replay
 * (a laggy retry, or a server-driven death firing once later) returns the original charge without debiting
 * again. The cost is computed from CURRENT valuation (post-burn) and is pure/shared (economy.ts), so the
 * client preview and the tests agree with the server.
 *
 * Without economy v3 there is no spendable balance (same as rides being free), so death is recorded at $0.
 * In production economyV3 is force-on (prepare.ts productionOverrides), so the real path is the v3 debit.
 */
export type CombatPenaltyCharge = { ok: true; incidentId: string; kind: DeathKind; costCents: string; currentCents: string; replay: boolean };
export type CombatPenaltyResult = CombatPenaltyCharge | { ok: false; reason: 'unknown-profile' | 'retry' };

const EXISTS_INCIDENT = 'SELECT 1 FROM combat_penalties WHERE incident_id=?';

async function readSnapshot(db: D1Database, deviceId: string): Promise<bigint | null> {
  const row = await db.prepare('SELECT economy_v3_current_cents AS cur FROM funding_profiles WHERE device_id=?')
    .bind(deviceId).first<{ cur: number | null }>();
  return row ? BigInt(row.cur ?? 0) : null;
}

/** riskReward (store robbery): a player's current valuation with burn folded to `now`; null without economy v3 / a profile. */
export async function currentValuationCents(db: D1Database, deviceId: string, now: number): Promise<bigint | null> {
  if (!flags.economyV3) return null;
  await refreshEconomyV3Current(db, deviceId, now);
  return readSnapshot(db, deviceId);
}

async function replayPenalty(db: D1Database, deviceId: string, incidentId: string): Promise<CombatPenaltyCharge | null> {
  const row = await db.prepare('SELECT device_id, kind, amount_cents FROM combat_penalties WHERE incident_id=?')
    .bind(incidentId).first<{ device_id: string; kind: DeathKind; amount_cents: number }>();
  if (!row) return null;
  if (row.device_id !== deviceId) throw new RangeError('Incident belongs to another player');
  const current = flags.economyV3 ? (await readSnapshot(db, deviceId) ?? 0n) : 0n;
  return { ok: true, incidentId, kind: row.kind, costCents: String(row.amount_cents), currentCents: current.toString(), replay: true };
}

/**
 * Apply one death's valuation cost, once. Safe to call repeatedly with the same incidentId.
 */
export async function applyCombatPenalty(db: D1Database, deviceId: string, incidentId: string, kind: DeathKind, now = Date.now()): Promise<CombatPenaltyResult> {
  if (typeof incidentId !== 'string' || incidentId.length < 1 || incidentId.length > 200) throw new RangeError('Invalid incident id');
  if (kind !== 'wasted' && kind !== 'busted') throw new RangeError('Invalid death kind');

  const prior = await replayPenalty(db, deviceId, incidentId);
  if (prior) return prior;

  if (!flags.economyV3) {
    // No spendable balance: record the incident at $0 so the idempotency contract still holds.
    await db.batch([
      db.prepare(`INSERT INTO combat_penalties(incident_id,device_id,kind,amount_cents,created_at)
        SELECT ?,?,?,0,? WHERE NOT EXISTS (${EXISTS_INCIDENT})`).bind(incidentId, deviceId, kind, now, incidentId),
    ]);
    return (await replayPenalty(db, deviceId, incidentId)) ?? { ok: false, reason: 'retry' };
  }

  await refreshEconomyV3Current(db, deviceId, now); // fold burn up to now; snapshot stamped at `now`
  const current = await readSnapshot(db, deviceId);
  if (current === null) return { ok: false, reason: 'unknown-profile' };
  const cost = deathCostCents(kind, current, flags.riskReward); // clamped to current; never negative (riskReward caps it)

  const notCharged = `NOT EXISTS (${EXISTS_INCIDENT})`;
  await db.batch([
    db.prepare(`UPDATE funding_profiles SET economy_v3_current_cents=economy_v3_current_cents-? WHERE device_id=?
      AND economy_v3_burn_updated_at=? AND economy_v3_current_cents>=? AND ${notCharged}`)
      .bind(Number(cost), deviceId, now, Number(cost), incidentId),
    db.prepare('INSERT INTO combat_penalties(incident_id,device_id,kind,amount_cents,created_at) SELECT ?,?,?,?,? WHERE changes()>0')
      .bind(incidentId, deviceId, kind, Number(cost), now),
  ]);

  const settled = await replayPenalty(db, deviceId, incidentId);
  if (settled) return { ...settled, replay: false };
  return { ok: false, reason: 'retry' }; // lost a race against a concurrent snapshot write; the caller may retry
}

/**
 * Review (low): a server-applied death/bust debit that loses a race against a concurrent snapshot change returns
 * 'retry' and used to be dropped (the victim paid $0). Re-run it a few times with the SAME incident id — the replay
 * guard makes that idempotent, so it can never charge twice.
 */
export async function settleWithRetry<T extends { ok: boolean; reason?: string }>(attempt: (tryIndex: number) => Promise<T>, tries = 4): Promise<T> {
  let result = await attempt(0);
  for (let i = 1; i < tries && !result.ok && result.reason === 'retry'; i++) result = await attempt(i);
  return result;
}
