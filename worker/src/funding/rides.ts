import { flags } from '@gtasf/shared/flags';
import { FUNDING_SEASON, ROBOTAXI_FREE_RIDES, robotaxiFareCents } from '@gtasf/shared/funding';
import { economyV3Current, refreshEconomyV3Current } from './economyV3';

/** Robotaxi fares (docs/engineering/quick-robotaxi.md "Fare and free rides"). Behind flags.quickRobotaxi at
 *  the ride entry points; these helpers are the economy side only. Fares debit CURRENT funding (economy v3):
 *  lifetime raised never drops, burn keeps running on the lower balance, and the usual round maths can demote
 *  the player (down to Bootstrapping). Without economy v3 there is no spendable balance, so rides are free. */
export interface RideQuote {
  /** The full fare for this distance, before any free ride. */
  fareCents: string;
  /** What this ride would actually cost now: 0 while free rides remain. */
  chargeCents: string;
  free: boolean;
  freeRidesLeft: number;
  currentCents: string;
  affordable: boolean;
}
export type RideCharge =
  | { ok: true; rideId: string; chargedCents: string; free: boolean; replay: boolean }
  | { ok: false; reason: 'unaffordable' | 'unknown-profile' | 'stale-quote'; fareCents: string };

async function freeRidesUsed(db: D1Database, deviceId: string): Promise<number | null> {
  const row = await db.prepare('SELECT free_rides_used AS n FROM funding_profiles WHERE device_id=?').bind(deviceId).first<{ n: number }>();
  return row ? Number(row.n) : null;
}
async function lifetime(db: D1Database, deviceId: string): Promise<bigint> {
  const row = await db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS s FROM funding_earnings WHERE device_id=? AND season=?')
    .bind(deviceId, FUNDING_SEASON).first<{ s: number }>();
  return BigInt(row?.s ?? 0);
}

export async function quoteRide(db: D1Database, deviceId: string, distanceM: number, now = Date.now()): Promise<RideQuote> {
  const fare = robotaxiFareCents(distanceM), used = await freeRidesUsed(db, deviceId) ?? ROBOTAXI_FREE_RIDES;
  const freeRidesLeft = Math.max(0, ROBOTAXI_FREE_RIDES - used), free = freeRidesLeft > 0 || !flags.economyV3;
  const current = flags.economyV3 ? (await economyV3Current(db, deviceId, await lifetime(db, deviceId), now)).currentCents : 0n;
  const charge = free ? 0n : fare;
  return { fareCents: fare.toString(), chargeCents: charge.toString(), free, freeRidesLeft, currentCents: current.toString(), affordable: current >= charge };
}

/**
 * Charge one ride, once. The ride id is the idempotency key: a replay returns the original charge. A free ride
 * (one of the first three) only bumps free_rides_used. A paid ride folds burn into the snapshot, then debits in
 * one atomic batch whose UPDATE is conditional on the snapshot being unchanged and covering the fare, so
 * funding never goes negative and a concurrent award can't be lost; the fare row is written only if it debited.
 */
export async function chargeRide(db: D1Database, deviceId: string, rideId: string, fareCents: bigint | string, now = Date.now()): Promise<RideCharge> {
  if (typeof rideId !== 'string' || rideId.length < 1 || rideId.length > 200) throw new RangeError('Invalid ride id');
  const fare = BigInt(fareCents);
  if (fare < 0n || fare > 100_000_000n) throw new RangeError('Invalid fare');
  const replay = async (): Promise<RideCharge | null> => {
    const row = await db.prepare('SELECT device_id, amount_cents, free FROM robotaxi_fares WHERE ride_id=?').bind(rideId).first<{ device_id: string; amount_cents: number; free: number }>();
    if (!row) return null;
    if (row.device_id !== deviceId) throw new RangeError('Ride belongs to another player');
    return { ok: true, rideId, chargedCents: String(row.amount_cents), free: row.free === 1, replay: true };
  };
  const prior = await replay(); if (prior) return prior;
  const fresh = (charge: RideCharge | null) => charge?.ok ? { ...charge, replay: false } : charge; // this call wrote the row
  const used = await freeRidesUsed(db, deviceId);
  if (used === null) return { ok: false, reason: 'unknown-profile', fareCents: fare.toString() };
  const notCharged = 'NOT EXISTS (SELECT 1 FROM robotaxi_fares WHERE ride_id=?)';
  // A $0 charge after the free rides are used is a stale quote: reject it rather than grant a fourth free ride.
  if (used >= ROBOTAXI_FREE_RIDES && flags.economyV3 && fare === 0n) return { ok: false, reason: 'stale-quote', fareCents: '0' };
  if (used < ROBOTAXI_FREE_RIDES || !flags.economyV3) {
    const freeRide = used < ROBOTAXI_FREE_RIDES;
    await db.batch([
      db.prepare(`UPDATE funding_profiles SET free_rides_used=free_rides_used+? WHERE device_id=? AND free_rides_used<? AND ${notCharged}`)
        .bind(freeRide ? 1 : 0, deviceId, freeRide ? ROBOTAXI_FREE_RIDES : ROBOTAXI_FREE_RIDES + 1, rideId),
      db.prepare('INSERT INTO robotaxi_fares(ride_id,device_id,amount_cents,free,charged_at) SELECT ?,?,0,1,? WHERE changes()>0')
        .bind(rideId, deviceId, now),
    ]);
    return fresh(await replay()) ?? { ok: false, reason: 'unaffordable', fareCents: fare.toString() }; // lost a race for the last free ride
  }
  await refreshEconomyV3Current(db, deviceId, now); // fold burn up to now; snapshot stamped at `now`
  await db.batch([
    db.prepare(`UPDATE funding_profiles SET economy_v3_current_cents=economy_v3_current_cents-? WHERE device_id=?
      AND economy_v3_burn_updated_at=? AND economy_v3_current_cents>=? AND ${notCharged}`).bind(Number(fare), deviceId, now, Number(fare), rideId),
    db.prepare('INSERT INTO robotaxi_fares(ride_id,device_id,amount_cents,free,charged_at) SELECT ?,?,?,0,? WHERE changes()>0')
      .bind(rideId, deviceId, Number(fare), now),
  ]);
  return fresh(await replay()) ?? { ok: false, reason: 'unaffordable', fareCents: fare.toString() };
}

/** Undo one ride's charge when the trip is abandoned after charging (player gone or request cancelled before
 *  dispatch): a paid fare returns to current funding, a free ride returns to the free count. Idempotent: the
 *  fare row is the refund token, consumed in the same atomic batch. */
export async function refundRide(db: D1Database, deviceId: string, rideId: string): Promise<boolean> {
  const row = 'SELECT {col} FROM robotaxi_fares WHERE ride_id=? AND device_id=?';
  const results = await db.batch([
    db.prepare(`UPDATE funding_profiles SET
        economy_v3_current_cents=economy_v3_current_cents+(${row.replace('{col}', 'amount_cents')}),
        free_rides_used=MAX(0,free_rides_used-(${row.replace('{col}', 'free')}))
      WHERE device_id=? AND EXISTS(${row.replace('{col}', '1')})`).bind(rideId, deviceId, rideId, deviceId, deviceId, rideId, deviceId),
    db.prepare('DELETE FROM robotaxi_fares WHERE ride_id=? AND device_id=?').bind(rideId, deviceId),
  ]);
  return Number(results[0]?.meta.changes ?? 0) > 0;
}
