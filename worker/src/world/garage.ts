/**
 * Garage phase 1 storage (flag garageSlots, critique 20e, docs/PLAN-garage.md; reviewer pre-review conditions in brackets).
 * Slot 0 is the personal car (personalCar.ts, D1 personal_cars), auto-saved on leaving a car. Slots 1+ live in garage_cars:
 * a car kept explicitly ('Keep this car') or a funding-tier gift. Slot counts are derived server-side from the round [4].
 * No money moves. Delivery (one live car per device, one device-wide cooldown, none while wanted [1][3]) is WorldDO's.
 */
import type { FundingRound } from '@gtasf/shared/funding';
import type { VehicleKind } from '@gtasf/shared/protocol/types';
import { GARAGE_GIFT_KIND, garageSlotsForRound } from '@gtasf/shared/garage';
import { tierForRound } from '@gtasf/shared/content/cosmetics';
import { PERSONAL_KINDS, loadPersonalCar } from './personalCar';

type Db = Pick<D1Database, 'prepare'>;
export interface GarageCar { slot: number; kind: VehicleKind; source: 'personal' | 'kept' | 'gift'; savedAt: number;
  /** Above the round's slot count (e.g. after a valuation drop): kept, never deleted, just not usable [4]. */
  hidden: boolean;
  /** A gift car's funding tier (LOOK_TIERS index), so the phone can name it ('Seed gift'). */
  tier?: number }

export async function listGarage(db: Db, device: string, round: Pick<FundingRound, 'id'>): Promise<{ slots: number; cars: GarageCar[] }> {
  const slots = garageSlotsForRound(round), cars: GarageCar[] = [];
  const personal = await loadPersonalCar(db, device);
  if (personal) cars.push({ slot: 0, kind: personal.kind, source: 'personal', savedAt: personal.savedAt, hidden: false });
  const rows = await db.prepare('SELECT c.slot, c.kind, c.source, c.saved_at, g.tier FROM garage_cars c LEFT JOIN garage_gifts g ' +
    "ON g.device_id = c.device_id AND g.slot = c.slot AND c.source = 'gift' WHERE c.device_id=? ORDER BY c.slot").bind(device)
    .all<{ slot: number; kind: string; source: 'kept' | 'gift'; saved_at: number; tier: number | null }>().catch(() => ({ results: [] as never[] }));
  for (const row of rows.results ?? []) {
    if (!PERSONAL_KINDS.has(row.kind as VehicleKind)) continue;
    cars.push({ slot: row.slot, kind: row.kind as VehicleKind, source: row.source, savedAt: row.saved_at, hidden: row.slot >= slots,
      ...(row.source === 'gift' && row.tier != null ? { tier: row.tier } : {}) });
  }
  return { slots, cars };
}

export type KeepResult = { status: 'kept'; car: GarageCar } | { status: 'rejected'; reason: 'slot' | 'kind' };
/** 'Keep this car' into slot 1+ (slot 0 stays the auto-save). Civilian road cars only [2]; the slot must exist for this round
 *  [4]. The stored row is read back and returned, so two tabs replacing the same slot both see what the server kept [6]. */
export async function keepCar(db: Db, device: string, slot: number, kind: VehicleKind, round: Pick<FundingRound, 'id'>, now: number): Promise<KeepResult> {
  if (!PERSONAL_KINDS.has(kind)) return { status: 'rejected', reason: 'kind' };
  if (!Number.isInteger(slot) || slot < 1 || slot >= garageSlotsForRound(round)) return { status: 'rejected', reason: 'slot' };
  await db.prepare('INSERT INTO garage_cars (device_id, slot, kind, source, saved_at) VALUES (?,?,?,?,?) ' +
    'ON CONFLICT(device_id, slot) DO UPDATE SET kind=excluded.kind, source=excluded.source, saved_at=excluded.saved_at')
    .bind(device, slot, kind, 'kept', now).run();
  const row = await db.prepare('SELECT kind, source, saved_at FROM garage_cars WHERE device_id=? AND slot=?').bind(device, slot)
    .first<{ kind: string; source: 'kept' | 'gift'; saved_at: number }>();
  return { status: 'kept', car: { slot, kind: row!.kind as VehicleKind, source: row!.source, savedAt: row!.saved_at, hidden: false } };
}

/** Gift each reached tier's car once per (device, tier) [5]: into the tier's own slot if free, else the first free slot; if
 *  every slot is full the gift waits (not recorded) for the next call. Returns what was given now (for the toast). */
export async function giftTierCars(db: Db, device: string, round: Pick<FundingRound, 'id'>, now: number,
  ref: () => string = () => crypto.randomUUID()): Promise<{ tier: number; slot: number; kind: VehicleKind }[]> {
  const tier = tierForRound(round).index, given: { tier: number; slot: number; kind: VehicleKind }[] = [];
  if (tier < 1) return given;
  const { slots, cars } = await listGarage(db, device, round);
  const taken = new Set(cars.map(car => car.slot));
  for (let t = 1; t <= tier; t++) {
    const kind = GARAGE_GIFT_KIND[t]; if (!kind) continue;
    const already = await db.prepare('SELECT tier FROM garage_gifts WHERE device_id=? AND tier=?').bind(device, t).first();
    if (already) continue;
    const free = [t, ...Array.from({ length: slots }, (_, i) => i)].find(s => s >= 1 && s < slots && !taken.has(s));
    if (free === undefined) continue; // full: the gift waits for a free slot
    const mine = ref();
    await db.prepare('INSERT OR IGNORE INTO garage_gifts (device_id, tier, slot, ref, given_at) VALUES (?,?,?,?,?)').bind(device, t, free, mine, now).run();
    const won = await db.prepare('SELECT ref FROM garage_gifts WHERE device_id=? AND tier=?').bind(device, t).first<{ ref: string }>();
    if (won?.ref !== mine) continue; // another tab/world gave it first [5]
    await db.prepare('INSERT INTO garage_cars (device_id, slot, kind, source, saved_at) VALUES (?,?,?,?,?) ' +
      'ON CONFLICT(device_id, slot) DO NOTHING').bind(device, free, kind, 'gift', now).run();
    // Reviewer LOW: a same-device keep can fill the slot between the claim and this insert (DO NOTHING then drops the gift).
    // Read the slot back; if it isn't this gift, release the claim so the gift retries later, and don't announce it.
    const placed = await db.prepare('SELECT kind, source, saved_at FROM garage_cars WHERE device_id=? AND slot=?').bind(device, free)
      .first<{ kind: string; source: string; saved_at: number }>();
    if (placed?.source !== 'gift' || placed.kind !== kind || placed.saved_at !== now) {
      await db.prepare('DELETE FROM garage_gifts WHERE device_id=? AND tier=? AND ref=?').bind(device, t, mine).run();
      taken.add(free); continue;
    }
    taken.add(free); given.push({ tier: t, slot: free, kind });
  }
  return given;
}
