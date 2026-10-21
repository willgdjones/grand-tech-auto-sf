/**
 * D1 access for "Become an angel" (docs/engineering/become-an-angel.md §3, bead
 * gtasf-become-an-angel-7ggb, migration 0022_sponsored_angels). Pure data layer: the submit route,
 * the sponsor dashboard, and pane 6's world spawn merge call through here. No Stripe/Jev here.
 */
import { SPONSORED_ANGEL_TIER, type SponsoredAngel, type SponsoredAngelDraft } from '@gtasf/shared/sponsoredAngels';

interface Row {
  id: string;
  sponsor_device_id: string;
  display_name: string;
  line: string;
  avatar_color: string | null;
  spot_id: string;
  tier: string;
  status: string;
  checkout_id: string | null;
  pitch_count: number;
  created_at: number;
  published_at: number | null;
  removed_at: number | null;
}

function mapRow(row: Row): SponsoredAngel {
  return {
    id: row.id,
    sponsorDeviceId: row.sponsor_device_id,
    displayName: row.display_name,
    line: row.line,
    avatarColor: row.avatar_color ?? null,
    spotId: row.spot_id,
    tier: row.tier,
    status: row.status as SponsoredAngel['status'],
    pitchCount: Number(row.pitch_count),
    createdAt: Number(row.created_at),
    publishedAt: row.published_at == null ? null : Number(row.published_at),
    removedAt: row.removed_at == null ? null : Number(row.removed_at),
  };
}

export interface InsertAngelParams {
  id: string;
  sponsorDeviceId: string;
  draft: SponsoredAngelDraft;
  checkoutId?: string | null;
  now: number;
}

/** Record a purchased-but-not-yet-live angel. Charge capture + Jev pass happen before publish. */
export async function insertPendingAngel(db: D1Database, p: InsertAngelParams): Promise<void> {
  await db.prepare(
    `INSERT INTO sponsored_angels(id, sponsor_device_id, display_name, line, avatar_color, spot_id, tier, status, checkout_id, pitch_count, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?)`,
  ).bind(p.id, p.sponsorDeviceId, p.draft.displayName, p.draft.line, p.draft.avatarColor, p.draft.spotId, SPONSORED_ANGEL_TIER, p.checkoutId ?? null, p.now).run();
}

export type PublishResult = 'published' | 'spot-taken' | 'not-pending';

/**
 * Make a pending angel live. The `sponsored_angels_live_spot` partial unique index guarantees at most
 * one live angel per spot; we check first for a clean message and still catch the race on the index.
 */
export async function publishAngel(db: D1Database, id: string, now: number): Promise<PublishResult> {
  const current = await db.prepare('SELECT status FROM sponsored_angels WHERE id = ?').bind(id).first<{ status: string }>();
  if (!current || current.status !== 'pending') return 'not-pending';
  const taken = await db.prepare(`SELECT 1 AS one FROM sponsored_angels WHERE spot_id = (SELECT spot_id FROM sponsored_angels WHERE id = ?) AND status = 'live' LIMIT 1`).bind(id).first<{ one: number }>();
  if (taken) return 'spot-taken';
  try {
    await db.prepare(`UPDATE sponsored_angels SET status = 'live', published_at = ? WHERE id = ? AND status = 'pending'`).bind(now, id).run();
    return 'published';
  } catch {
    // Lost the race for the spot's live slot (partial unique index).
    return 'spot-taken';
  }
}

/** Retire an angel (admin removal or sponsor request); frees its spot for re-use. */
export async function removeAngel(db: D1Database, id: string, now: number): Promise<void> {
  await db.prepare(`UPDATE sponsored_angels SET status = 'removed', removed_at = ? WHERE id = ?`).bind(now, id).run();
}

/**
 * Count a unique pitch against a live angel; returns the new total (authoritative for the dashboard).
 * UPDATE ... RETURNING keeps the increment and the read in one atomic statement, so concurrent
 * pitches can't interleave and report a stale/duplicated count. Returns 0 when no live angel matched.
 */
export async function incrementPitchCount(db: D1Database, id: string): Promise<number> {
  const row = await db.prepare(`UPDATE sponsored_angels SET pitch_count = pitch_count + 1 WHERE id = ? AND status = 'live' RETURNING pitch_count`).bind(id).first<{ pitch_count: number }>();
  return row ? Number(row.pitch_count) : 0;
}

export async function getAngel(db: D1Database, id: string): Promise<SponsoredAngel | null> {
  const row = await db.prepare('SELECT * FROM sponsored_angels WHERE id = ?').bind(id).first<Row>();
  return row ? mapRow(row) : null;
}

/**
 * The pending angel awaiting a given Stripe Checkout session (its {@link insertPendingAngel}
 * `checkoutId`). The webhook settlement (worker/src/ledger/sponsoredAngelCheckout.ts) uses this to
 * find the angel to {@link publishAngel} once the charge captures. Returns null for an unknown session.
 */
export async function getAngelByCheckoutId(db: D1Database, checkoutId: string): Promise<SponsoredAngel | null> {
  const row = await db.prepare('SELECT * FROM sponsored_angels WHERE checkout_id = ?').bind(checkoutId).first<Row>();
  return row ? mapRow(row) : null;
}

/** All live angels — pane 6's world spawn merge pulls this set. */
export async function listLiveAngels(db: D1Database): Promise<SponsoredAngel[]> {
  const { results } = await db.prepare(`SELECT * FROM sponsored_angels WHERE status = 'live' ORDER BY published_at ASC`).all<Row>();
  return (results ?? []).map(mapRow);
}

/** A sponsor's angels (newest first) for their dashboard. */
export async function listAngelsBySponsor(db: D1Database, sponsorDeviceId: string): Promise<SponsoredAngel[]> {
  const { results } = await db.prepare('SELECT * FROM sponsored_angels WHERE sponsor_device_id = ? ORDER BY created_at DESC').bind(sponsorDeviceId).all<Row>();
  return (results ?? []).map(mapRow);
}

/** Spot ids currently held by a live angel — feed to openSponsoredAngelSpots() to build the picker. */
export async function takenSpotIds(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare(`SELECT spot_id FROM sponsored_angels WHERE status = 'live'`).all<{ spot_id: string }>();
  return (results ?? []).map(row => row.spot_id);
}
