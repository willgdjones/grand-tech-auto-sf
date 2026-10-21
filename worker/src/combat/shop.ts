import { flags } from '@gtasf/shared/flags';
import { FUNDING_SEASON, fundingRound } from '@gtasf/shared/funding';
import { armourPriceCents, cappedShopPrice, downRoundAfter, gunPriceCents, isForSale } from '@gtasf/shared/combat/gunShop';
import { isWeaponId, type WeaponId } from '@gtasf/shared/combat/weapons';
import { economyV3Current, refreshEconomyV3Current } from '../funding/economyV3';

/**
 * GTA V pivot — LANE B gun shop purchase (flag gunShop). Server-authoritative: the price is computed from the
 * player's CURRENT valuation stage (never trusting the client), and the debit mirrors chargeRide/applyCombatPenalty
 * (fold burn, then an atomic conditional economy_v3_current_cents debit). Ownership is the idempotency key: buying
 * a weapon you already own never charges again. The CLIENT grants the weapon on a successful/owned result.
 */
export type BuyWeaponResult =
  | { ok: true; weapon: WeaponId; owned: boolean; chargedCents: string; currentCents: string }
  | { ok: false; reason: 'not-for-sale' | 'unknown-profile' | 'unaffordable' | 'retry' }
  | { ok: false; reason: 'down-round'; round: string; priceCents: string }; // needs { allowDownRound: true }

async function lifetime(db: D1Database, deviceId: string): Promise<bigint> {
  const row = await db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS s FROM funding_earnings WHERE device_id=? AND season=?')
    .bind(deviceId, FUNDING_SEASON).first<{ s: number }>();
  return BigInt(row?.s ?? 0);
}
async function readCurrent(db: D1Database, deviceId: string): Promise<bigint | null> {
  const row = await db.prepare('SELECT economy_v3_current_cents AS cur FROM funding_profiles WHERE device_id=?')
    .bind(deviceId).first<{ cur: number | null }>();
  return row ? BigInt(row.cur ?? 0) : null;
}
async function owns(db: D1Database, deviceId: string, weapon: WeaponId): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 AS x FROM combat_weapons WHERE device_id=? AND weapon=?').bind(deviceId, weapon).first());
}

/** savedLoadout (critique #20): the weapons this device bought — read-only, oldest first (the client grants them). */
export async function ownedWeapons(db: D1Database, deviceId: string): Promise<WeaponId[]> {
  const rows = await db.prepare('SELECT weapon FROM combat_weapons WHERE device_id=? ORDER BY purchased_at').bind(deviceId).all<{ weapon: string }>();
  return (rows.results ?? []).map(row => row.weapon).filter(isWeaponId);
}

export async function buyWeapon(db: D1Database, deviceId: string, weapon: string, now = Date.now(), options: { allowDownRound?: boolean } = {}): Promise<BuyWeaponResult> {
  if (!isWeaponId(weapon) || !isForSale(weapon)) return { ok: false, reason: 'not-for-sale' };

  if (await owns(db, deviceId, weapon)) {
    const current = flags.economyV3 ? (await readCurrent(db, deviceId) ?? 0n) : 0n;
    return { ok: true, weapon, owned: true, chargedCents: '0', currentCents: current.toString() };
  }

  if (!flags.economyV3) {
    // No spendable balance (same as rides being free): grant and record ownership at $0.
    await db.batch([
      db.prepare('INSERT INTO combat_weapons(device_id,weapon,price_cents,purchased_at) SELECT ?,?,0,? WHERE NOT EXISTS (SELECT 1 FROM combat_weapons WHERE device_id=? AND weapon=?)')
        .bind(deviceId, weapon, now, deviceId, weapon),
    ]);
    return { ok: true, weapon, owned: false, chargedCents: '0', currentCents: '0' };
  }

  // Confirm the profile exists, fold burn, then price from the CURRENT stage.
  const life = await lifetime(db, deviceId);
  await refreshEconomyV3Current(db, deviceId, now);
  const current = await readCurrent(db, deviceId);
  if (current === null) return { ok: false, reason: 'unknown-profile' };
  const stars = fundingRound(current).stars;
  const price = cappedShopPrice(gunPriceCents(weapon, stars), current); // ≤10% of current valuation
  if (current < price) return { ok: false, reason: 'unaffordable' };
  const drop = downRoundAfter(current, price);
  if (drop && !options.allowDownRound) return { ok: false, reason: 'down-round', round: drop.label, priceCents: price.toString() };
  void life;

  const notOwned = 'NOT EXISTS (SELECT 1 FROM combat_weapons WHERE device_id=? AND weapon=?)';
  await db.batch([
    db.prepare(`UPDATE funding_profiles SET economy_v3_current_cents=economy_v3_current_cents-? WHERE device_id=?
      AND economy_v3_burn_updated_at=? AND economy_v3_current_cents>=? AND ${notOwned}`)
      .bind(Number(price), deviceId, now, Number(price), deviceId, weapon),
    db.prepare('INSERT INTO combat_weapons(device_id,weapon,price_cents,purchased_at) SELECT ?,?,?,? WHERE changes()>0')
      .bind(deviceId, weapon, Number(price), now),
  ]);

  const row = await db.prepare('SELECT price_cents FROM combat_weapons WHERE device_id=? AND weapon=?')
    .bind(deviceId, weapon).first<{ price_cents: number }>();
  if (!row) return { ok: false, reason: 'retry' }; // lost a race against a concurrent snapshot change
  const after = await readCurrent(db, deviceId);
  return { ok: true, weapon, owned: false, chargedCents: String(row.price_cents), currentCents: (after ?? 0n).toString() };
}

export type BuyArmourResult =
  | { ok: true; duplicate: boolean; chargedCents: string; currentCents: string }
  | { ok: false; reason: 'bad-request' | 'unaffordable' | 'unknown-profile' | 'retry' }
  | { ok: false; reason: 'down-round'; round: string; priceCents: string }; // needs { allowDownRound: true }

/** A client purchase id: 8–64 chars of [A-Za-z0-9-] (a UUID in practice). */
export function validArmourRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value);
}

/**
 * Buy a full body-armour vest (vitalsPickups). Server-priced from the CURRENT stage (armourPriceCents), debited
 * atomically against the economy-v3 snapshot, and idempotent per client request id: a replay of the same request never
 * charges again (and reports duplicate, so the caller doesn't grant again). The caller grants the armour.
 */
export async function buyArmour(db: D1Database, deviceId: string, requestId: string, now = Date.now(), options: { allowDownRound?: boolean } = {}): Promise<BuyArmourResult> {
  if (!validArmourRequestId(requestId)) return { ok: false, reason: 'bad-request' };
  const existing = await db.prepare('SELECT device_id FROM combat_armour_purchases WHERE request_id=?').bind(requestId).first<{ device_id: string }>();
  if (existing) {
    if (existing.device_id !== deviceId) return { ok: false, reason: 'bad-request' }; // someone else's id: never grant
    const current = flags.economyV3 ? (await readCurrent(db, deviceId) ?? 0n) : 0n;
    return { ok: true, duplicate: true, chargedCents: '0', currentCents: current.toString() };
  }
  if (!flags.economyV3) {
    // No spendable balance (same as weapons + rides): grant at $0, still once per request.
    await db.prepare('INSERT OR IGNORE INTO combat_armour_purchases(request_id,device_id,price_cents,purchased_at) VALUES(?,?,0,?)').bind(requestId, deviceId, now).run();
    return { ok: true, duplicate: false, chargedCents: '0', currentCents: '0' };
  }
  await refreshEconomyV3Current(db, deviceId, now);
  const current = await readCurrent(db, deviceId);
  if (current === null) return { ok: false, reason: 'unknown-profile' };
  const price = cappedShopPrice(armourPriceCents(fundingRound(current).stars), current); // ≤10% of current valuation
  if (current < price) return { ok: false, reason: 'unaffordable' };
  const drop = downRoundAfter(current, price);
  if (drop && !options.allowDownRound) return { ok: false, reason: 'down-round', round: drop.label, priceCents: price.toString() };
  const unused = 'NOT EXISTS (SELECT 1 FROM combat_armour_purchases WHERE request_id=?)';
  await db.batch([
    db.prepare(`UPDATE funding_profiles SET economy_v3_current_cents=economy_v3_current_cents-? WHERE device_id=?
      AND economy_v3_burn_updated_at=? AND economy_v3_current_cents>=? AND ${unused}`)
      .bind(Number(price), deviceId, now, Number(price), requestId),
    db.prepare('INSERT INTO combat_armour_purchases(request_id,device_id,price_cents,purchased_at) SELECT ?,?,?,? WHERE changes()>0')
      .bind(requestId, deviceId, Number(price), now),
  ]);
  const row = await db.prepare('SELECT price_cents FROM combat_armour_purchases WHERE request_id=? AND device_id=?').bind(requestId, deviceId).first<{ price_cents: number }>();
  if (!row) return { ok: false, reason: 'retry' }; // lost a race against a concurrent snapshot change: nothing charged
  const after = await readCurrent(db, deviceId);
  return { ok: true, duplicate: false, chargedCents: String(row.price_cents), currentCents: (after ?? 0n).toString() };
}
