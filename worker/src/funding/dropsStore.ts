import { flags } from '@gtasf/shared/flags';
import { DROP_CAPACITY, DROP_SEASON, type FundDrop, type FundDropClaim, type SponsorOverride } from '@gtasf/shared/drops';
import { fundingCents, fundingDay } from '@gtasf/shared/funding';

interface ClaimRow { id: string; drop_id: string; slot: number; fund_name: string; position: number; amount_cents: number; claimed_at: number }

/** The cap-table view of a drop cheque (PLAN-v2 decision 5: every funding source is listed). */
export interface DropCapTableEntry {
  source: 'fund-drop';
  dropId: string;
  slot: number;
  fundName: string;
  amountCents: string;
  position: number;
  claimedAt: number;
}

function toClaim(row: ClaimRow): FundDropClaim {
  return { dropId: row.drop_id, slot: row.slot, fundName: row.fund_name,
    amountCents: String(row.amount_cents), position: row.position, claimedAt: row.claimed_at };
}

/** Live count of cheques already handed out for a drop, for the N/50 counter and the capacity guard. */
export async function dropClaimCount(db: D1Database, dropId: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) n FROM fund_drop_claims WHERE season=? AND drop_id=?')
    .bind(DROP_SEASON, dropId).first<{ n: number }>();
  return row?.n ?? 0;
}
/** Claim counts for several drops at once (usually one active drop). */
export async function dropClaimCounts(db: D1Database, dropIds: readonly string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!dropIds.length) return counts;
  const placeholders = dropIds.map(() => '?').join(',');
  const rows = await db.prepare(`SELECT drop_id, COUNT(*) n FROM fund_drop_claims WHERE season=? AND drop_id IN (${placeholders}) GROUP BY drop_id`)
    .bind(DROP_SEASON, ...dropIds).all<{ drop_id: string; n: number }>();
  for (const row of rows.results) counts.set(row.drop_id, row.n);
  return counts;
}
/** This device's cheque for a specific drop, or null if they have not claimed it. */
export async function yourDropClaim(db: D1Database, deviceId: string, dropId: string): Promise<FundDropClaim | null> {
  const row = await db.prepare('SELECT id,drop_id,slot,fund_name,position,amount_cents,claimed_at FROM fund_drop_claims WHERE device_id=? AND season=? AND drop_id=?')
    .bind(deviceId, DROP_SEASON, dropId).first<ClaimRow>();
  return row ? toClaim(row) : null;
}
/** This device's most recent cheque, so a reloaded client can still raise the one-shot toast. */
export async function recentDropClaim(db: D1Database, deviceId: string): Promise<FundDropClaim | null> {
  const row = await db.prepare('SELECT id,drop_id,slot,fund_name,position,amount_cents,claimed_at FROM fund_drop_claims WHERE device_id=? AND season=? ORDER BY claimed_at DESC,id DESC LIMIT 1')
    .bind(deviceId, DROP_SEASON).first<ClaimRow>();
  return row ? toClaim(row) : null;
}
/** Every drop cheque this device has earned, newest first — the `fund-drop` rows of its cap table. */
export async function listDropCapTable(db: D1Database, deviceId: string): Promise<DropCapTableEntry[]> {
  const rows = await db.prepare('SELECT drop_id,slot,fund_name,position,amount_cents,claimed_at FROM fund_drop_claims WHERE device_id=? AND season=? ORDER BY claimed_at DESC,id DESC')
    .bind(deviceId, DROP_SEASON).all<ClaimRow>();
  return rows.results.map(row => ({ source: 'fund-drop', dropId: row.drop_id, slot: row.slot, fundName: row.fund_name,
    amountCents: String(row.amount_cents), position: row.position, claimedAt: row.claimed_at }));
}
/** Paid sponsor overrides for the season (empty unless the ad product has sold any). */
export async function dropSponsorOverrides(db: D1Database): Promise<SponsorOverride[]> {
  const rows = await db.prepare('SELECT slot,name,url,logo_url FROM fund_drop_sponsors WHERE season=? ORDER BY slot')
    .bind(DROP_SEASON).all<{ slot: number; name: string; url: string | null; logo_url: string | null }>();
  return rows.results.map(row => ({ slot: row.slot,
    sponsor: { name: row.name, ...(row.url ? { url: row.url } : {}), ...(row.logo_url ? { logoUrl: row.logo_url } : {}) } }));
}
/** Sell/assign a drop slot to a real sponsor (ad product). Upsert keyed by (season, slot). */
export async function setDropSponsor(db: D1Database, input: { slot: number; name: string; url?: string; logoUrl?: string; now: number }): Promise<SponsorOverride> {
  if (!Number.isSafeInteger(input.slot) || input.slot < 0) throw new RangeError('Invalid drop slot');
  const name = input.name.trim();
  if (!name || name.length > 120) throw new RangeError('Sponsor name must be 1–120 characters');
  const url = input.url?.trim() || null, logoUrl = input.logoUrl?.trim() || null;
  if ((url && url.length > 2048) || (logoUrl && logoUrl.length > 2048)) throw new RangeError('Sponsor URL too long');
  await db.prepare(`INSERT INTO fund_drop_sponsors(season,slot,name,url,logo_url,created_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(season,slot) DO UPDATE SET name=excluded.name,url=excluded.url,logo_url=excluded.logo_url`)
    .bind(DROP_SEASON, input.slot, name, url, logoUrl, input.now).run();
  return { slot: input.slot, sponsor: { name, ...(url ? { url } : {}), ...(logoUrl ? { logoUrl } : {}) } };
}
/** Release a sponsored slot back to its parody default. Returns whether a row was removed. */
export async function clearDropSponsor(db: D1Database, slot: number): Promise<boolean> {
  if (!Number.isSafeInteger(slot) || slot < 0) throw new RangeError('Invalid drop slot');
  const result = await db.prepare('DELETE FROM fund_drop_sponsors WHERE season=? AND slot=?').bind(DROP_SEASON, slot).run();
  return (result.meta?.changes ?? 0) > 0;
}

/** A pending/settled sponsor-slot purchase (the checkout ledger; the live rename lives in fund_drop_sponsors). */
export interface SponsorOrder {
  checkoutId: string; season: string; slot: number; name: string;
  url?: string; logoUrl?: string; amountCents: string; status: 'pending' | 'settled' | 'refunded'; createdAt: number;
}
interface SponsorOrderRow { checkout_id: string; season: string; slot: number; name: string; url: string | null; logo_url: string | null; amount_cents: number; status: string; created_at: number }
function toSponsorOrder(row: SponsorOrderRow): SponsorOrder {
  return { checkoutId: row.checkout_id, season: row.season, slot: row.slot, name: row.name,
    ...(row.url ? { url: row.url } : {}), ...(row.logo_url ? { logoUrl: row.logo_url } : {}),
    amountCents: String(row.amount_cents), status: row.status as SponsorOrder['status'], createdAt: row.created_at };
}
/** Record a purchased-but-not-yet-captured sponsor slot, keyed by its Stripe Checkout session id. */
export async function insertPendingSponsorOrder(db: D1Database, input: { checkoutId: string; slot: number; name: string; url?: string; logoUrl?: string; amountCents: bigint; now: number }): Promise<void> {
  await db.prepare(`INSERT INTO fund_drop_sponsor_orders(checkout_id,season,slot,name,url,logo_url,amount_cents,status,created_at)
    VALUES(?,?,?,?,?,?,?,'pending',?)`)
    .bind(input.checkoutId, DROP_SEASON, input.slot, input.name, input.url ?? null, input.logoUrl ?? null, Number(input.amountCents), input.now).run();
}
/** The order awaiting a given Checkout session (the webhook looks it up to apply the sponsor). */
export async function getSponsorOrderByCheckoutId(db: D1Database, checkoutId: string): Promise<SponsorOrder | null> {
  const row = await db.prepare('SELECT checkout_id,season,slot,name,url,logo_url,amount_cents,status,created_at FROM fund_drop_sponsor_orders WHERE checkout_id=?')
    .bind(checkoutId).first<SponsorOrderRow>();
  return row ? toSponsorOrder(row) : null;
}
/** Is a recent pending order already holding this slot? Double-sell guard at checkout-create time. */
export async function pendingSponsorOrderForSlot(db: D1Database, slot: number, since: number): Promise<boolean> {
  return Boolean(await db.prepare("SELECT checkout_id FROM fund_drop_sponsor_orders WHERE season=? AND slot=? AND status='pending' AND created_at>=? LIMIT 1")
    .bind(DROP_SEASON, slot, since).first());
}
/** Mark an order settled once the sponsor has been applied to fund_drop_sponsors. Idempotent. */
export async function markSponsorOrderSettled(db: D1Database, checkoutId: string, now: number): Promise<void> {
  await db.prepare("UPDATE fund_drop_sponsor_orders SET status='settled',settled_at=? WHERE checkout_id=? AND status='pending'").bind(now, checkoutId).run();
}
/** Mark an order refunded (the slot was taken between purchase and capture). Idempotent. */
export async function markSponsorOrderRefunded(db: D1Database, checkoutId: string, now: number): Promise<void> {
  await db.prepare("UPDATE fund_drop_sponsor_orders SET status='refunded',settled_at=? WHERE checkout_id=? AND status='pending'").bind(now, checkoutId).run();
}

export interface DropClaimResult { credited: boolean; full: boolean; claim: FundDropClaim | null; claimedCount: number }

/**
 * Atomic first-{@link DROP_CAPACITY} claim. One conditional INSERT is the money boundary:
 * UNIQUE(device_id,season,drop_id) guarantees a player is paid at most once per drop, and the
 * capacity sub-select stops the cheque once the drop is full. WorldDrops serialises writes per
 * drop so the COUNT snapshot is reliable; the guard is belt-and-braces besides that.
 */
export async function recordDropClaim(db: D1Database, input: { deviceId: string; drop: FundDrop; now: number }): Promise<DropClaimResult> {
  const { deviceId, drop, now } = input;
  const amount = fundingCents(drop.chequeCents);
  if (amount === 0n || amount > (flags.economyV3 ? 300_000n : 50_000_000n)) throw new RangeError('Invalid drop cheque');
  const id = crypto.randomUUID(), day = fundingDay(now), sponsored = drop.sponsored ? 1 : 0;
  await db.prepare(`INSERT INTO fund_drop_claims(id,device_id,season,drop_id,slot,fund_name,sponsored,position,amount_cents,claimed_at,day)
    SELECT ?,?,?,?,?,?,?,(SELECT COUNT(*)+1 FROM fund_drop_claims WHERE season=? AND drop_id=?),?,?,?
    WHERE (SELECT COUNT(*) FROM fund_drop_claims WHERE season=? AND drop_id=?) < ?
    ON CONFLICT(device_id,season,drop_id) DO NOTHING`)
    .bind(id, deviceId, DROP_SEASON, drop.id, drop.slot, drop.fundName, sponsored,
      DROP_SEASON, drop.id, Number(amount), now, day, DROP_SEASON, drop.id, drop.capacity).run();
  const stored = await db.prepare('SELECT id,drop_id,slot,fund_name,position,amount_cents,claimed_at FROM fund_drop_claims WHERE device_id=? AND season=? AND drop_id=?')
    .bind(deviceId, DROP_SEASON, drop.id).first<ClaimRow>();
  const claimedCount = await dropClaimCount(db, drop.id);
  if (!stored) return { credited: false, full: true, claim: null, claimedCount };
  return { credited: stored.id === id, full: false, claim: toClaim(stored), claimedCount };
}

export { DROP_CAPACITY };
