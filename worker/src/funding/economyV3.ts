import { ECONOMY_RESET_EPOCH, FUNDING_SEASON, rescaleV2ToV3Cents, applyEconomyV3Burn } from '@gtasf/shared/funding';

/** The four earned-funding ledgers that sum into funding_earnings (and feed the cap table). */
const LEDGERS = ['funding_awards', 'funding_credits', 'funding_bonuses', 'fund_drop_claims'] as const;

export interface EconomyV3RescaleResult {
  migrated: boolean;           // false => already migrated (idempotent skip) or nothing to do
  lifetimeCents: string;       // new v3 lifetime = SUM of the rescaled ledgers
  rowsScaled: number;
}

/**
 * One-time per-player rescale to economy v3 (PLAN-economy-v3 decision 7). Scales EVERY earned-funding
 * ledger row by the player's uniform factor (new_v3_total / old_v2_total) so that:
 *   - the cap table still reconciles — lifetime stays SUM(funding_earnings), now at the v3 scale, and
 *     each backer keeps their exact share (uniform factor), so groups still sum to the total;
 *   - the player's round maps to the matching new star and relative leaderboard order is preserved
 *     (rescaleV2ToV3Cents does the band-proportional star mapping).
 * Stores current = the new lifetime (pre-burn) + the burn stamp. Idempotent: a device whose burn stamp
 * is already set is skipped, so a re-run or replay never double-rescales. Rows never drop to 0 (clamped
 * to ≥1, within every ledger's amount CHECK since v3 amounts are far smaller than v2).
 *
 * Called ONLY when enabling economyV3 (flags.economyV3), never on the v2 path. Pure DB effect; no clock
 * ticking. The caller runs it once per device inside the enable migration.
 */
export async function rescaleDeviceToEconomyV3(db: D1Database, deviceId: string, now: number): Promise<EconomyV3RescaleResult> {
  const already = await db.prepare('SELECT economy_v3_burn_updated_at AS at FROM funding_profiles WHERE device_id=?')
    .bind(deviceId).first<{ at: number | null }>();
  if (already?.at != null) return { migrated: false, lifetimeCents: '0', rowsScaled: 0 };

  // Gather every ledger row + the old v2 total.
  const rows: { table: string; id: string; amount: bigint }[] = [];
  let oldTotal = 0n;
  for (const table of LEDGERS) {
    const r = await db.prepare(`SELECT id, amount_cents FROM ${table} WHERE device_id=? AND season=?`)
      .bind(deviceId, FUNDING_SEASON).all<{ id: string; amount_cents: number }>();
    for (const row of r.results) { const amount = BigInt(row.amount_cents); rows.push({ table, id: row.id, amount }); oldTotal += amount; }
  }

  if (oldTotal <= 0n) { // nothing earned yet: just stamp so burn starts from now and we don't re-scan
    await db.prepare('UPDATE funding_profiles SET economy_v3_lifetime_cents=0, economy_v3_current_cents=0, economy_v3_burn_updated_at=? WHERE device_id=?').bind(now, deviceId).run();
    return { migrated: true, lifetimeCents: '0', rowsScaled: 0 };
  }

  const target = rescaleV2ToV3Cents(oldTotal); // the player's new v3 total (band-proportional, star-preserving)
  // Scale each row by the uniform factor target/oldTotal (floor), clamped to >= 1. Floor truncation makes
  // Σ(scaled) drift up to #rows cents below target, which for a player sitting exactly on a band edge would
  // drop them a star. Correct it by putting the whole remainder (target − Σ) on the largest row, so
  // newTotal == rescaleV2ToV3Cents(oldTotal) EXACTLY and no band-edge star can move (gtasf-econv3-rescale-band-edge-uvy6).
  const scaled = rows.map(row => ({ table: row.table, id: row.id, next: (row.amount * target / oldTotal) < 1n ? 1n : row.amount * target / oldTotal }));
  let sum = 0n, largest = scaled[0]!;
  for (const r of scaled) { sum += r.next; if (r.next > largest.next) largest = r; }
  largest.next += target - sum;               // remainder is at most ±#rows cents; the largest row stays ≥ 1 and far under its CHECK
  if (largest.next < 1n) largest.next = 1n;   // guard the pathological target < #rows case (keeps amount CHECK > 0)
  let newTotal = 0n;
  for (const r of scaled) {
    await db.prepare(`UPDATE ${r.table} SET amount_cents=? WHERE id=?`).bind(Number(r.next), r.id).run();
    newTotal += r.next;
  }
  // lifetime (cache) = current = the actual new lifetime (SUM of the rescaled rows), so current ==
  // lifetime pre-burn AND the cap table reconciles exactly (groups still sum to SUM == this total).
  await db.prepare('UPDATE funding_profiles SET economy_v3_lifetime_cents=?, economy_v3_current_cents=?, economy_v3_burn_updated_at=? WHERE device_id=?')
    .bind(Number(newTotal), Number(newTotal), now, deviceId).run();
  return { migrated: true, lifetimeCents: newTotal.toString(), rowsScaled: rows.length };
}

/**
 * One-time ECONOMY RESET — the economy-v3 enable action the founder chose (07:5x, "reset everyone's
 * progress") INSTEAD of the rescale. Wipes all of a player's funding so they restart at $0 / Bootstrapping:
 * deletes every earned-funding ledger row (events — so events can pay again — plus celebrity/warm-intro
 * credits, referral bonuses, angel/VC drop claims) and zeroes the stored current/lifetime + stamps the burn
 * marker. The derived leaderboards go to zero automatically (they sum the now-empty ledgers). KEPT, because
 * they live in other tables/columns the reset never touches: identity (device_id/token_hash/startup_name/
 * nickname on funding_profiles), looks (profile_cosmetics), friends (friendships + friend_*), recovery codes,
 * and the outbid/office records. NO account deletion. Idempotent: the burn stamp marks a device already
 * reset, so it runs exactly once. Called ONLY when enabling economyV3 (lazily on first profile read, or in
 * the bulk pass pane 5 runs at the enable deploy). rescaleDeviceToEconomyV3 is kept but no longer called.
 */
export async function resetDeviceToEconomyV3(db: D1Database, deviceId: string, now: number): Promise<{ reset: boolean }> {
  // One atomic D1 batch whose every statement is conditional on the profile still being below the current
  // reset epoch: two concurrent first loads can't both reset, and a slower reset can't wipe an award booked
  // after a faster one (o1pf.2). Epoch 2 (founder 12:0x) also gives robotaxi free rides back.
  const stale = '(SELECT economy_reset_epoch FROM funding_profiles WHERE device_id=?) < ?';
  const results = await db.batch([
    ...LEDGERS.map(table => db.prepare(`DELETE FROM ${table} WHERE device_id=? AND season=? AND ${stale}`).bind(deviceId, FUNDING_SEASON, deviceId, ECONOMY_RESET_EPOCH)),
    db.prepare(`UPDATE funding_profiles SET economy_v3_current_cents=0, economy_v3_lifetime_cents=0, economy_v3_burn_updated_at=?,
        free_rides_used=0, economy_reset_epoch=? WHERE device_id=? AND economy_reset_epoch<?`)
      .bind(now, ECONOMY_RESET_EPOCH, deviceId, ECONOMY_RESET_EPOCH),
  ]);
  return { reset: Number(results[results.length - 1]?.meta.changes ?? 0) > 0 };
}

/**
 * Reset any players not yet through the v3 enable (bounded per call). Public reads that show OTHER players'
 * totals (leaderboards, nameplate summaries) call this first, so an un-reset player's old v2 total can never
 * appear on a board; nothing at deploy has to run the bulk pass. One cheap indexed probe when all are done.
 */
export async function resetPendingEconomyV3(db: D1Database, now: number, limit = 200): Promise<number> {
  const pending = await db.prepare('SELECT device_id FROM funding_profiles WHERE economy_reset_epoch<? LIMIT ?')
    .bind(ECONOMY_RESET_EPOCH, limit).all<{ device_id: string }>();
  let reset = 0;
  for (const { device_id } of pending.results) if ((await resetDeviceToEconomyV3(db, device_id, now)).reset) reset++;
  return reset;
}

/**
 * Enable driver (founder 07:5x): RESET every player to economy v3, once. Pane 5 runs this at the enable
 * deploy (AFTER the D1 backup) so everyone is zeroed up front rather than lazily on first read. Idempotent
 * (resetDeviceToEconomyV3 skips devices already reset via the burn stamp), so it is safe to re-run / resume.
 * For a large player base this should be paginated; for the playtest's device count a single pass is fine.
 */
export async function enableEconomyV3Migration(db: D1Database, now: number): Promise<{ reset: number; skipped: number }> {
  const devices = await db.prepare('SELECT device_id FROM funding_profiles').all<{ device_id: string }>();
  let reset = 0, skipped = 0;
  for (const { device_id } of devices.results) {
    const r = await resetDeviceToEconomyV3(db, device_id, now);
    if (r.reset) reset++; else skipped++;
  }
  return { reset, skipped };
}

export interface EconomyV3Snapshot { cur: number | null; life: number | null; at: number | null }
/** Pure current-funding derivation shared by the profile read and the current leaderboard. */
export function currentFromSnapshot(lifetimeCents: bigint, snap: EconomyV3Snapshot | null, now: number): bigint {
  let current: bigint;
  if (snap?.at != null && snap.cur != null) {
    const burned = applyEconomyV3Burn(BigInt(snap.cur), (now - snap.at) / 1000).currentCents;
    const bookedSince = lifetimeCents - BigInt(snap.life ?? snap.cur); // awards booked since the snapshot (self-heal)
    current = burned + (bookedSince > 0n ? bookedSince : 0n);
  } else {
    current = lifetimeCents; // not migrated / brand-new: current == lifetime until the first snapshot write
  }
  if (current > lifetimeCents) current = lifetimeCents;
  return current < 0n ? 0n : current;
}

/**
 * Read-time economy-v3 current funding (PLAN-economy-v3 decisions 4 + 5). Burns the stored snapshot
 * forward to `now`, then adds any funding booked since that snapshot (lifetime − snapshot lifetime), so
 * the value SELF-HEALS: a missed snapshot write (e.g. a crash between an award INSERT and its UPDATE) is
 * recovered on the next read because the ledger SUM (= lifetime) is the source of truth, not the
 * snapshot. current is always clamped to [0, lifetime]. burnPerSecCents (= the flat per-stage per-minute
 * burn ÷ 60, founder 06:3x) is the live drain at the
 * resulting stage (the HUD runway reads it). economyV3 only — never called on the v2 path.
 */
export async function economyV3Current(db: D1Database, deviceId: string, lifetimeCents: bigint, now: number): Promise<{ currentCents: bigint; burnPerSecCents: bigint }> {
  const snap = await db.prepare('SELECT economy_v3_current_cents AS cur, economy_v3_lifetime_cents AS life, economy_v3_burn_updated_at AS at FROM funding_profiles WHERE device_id=?')
    .bind(deviceId).first<EconomyV3Snapshot>();
  const current = currentFromSnapshot(lifetimeCents, snap, now);
  // The profile contract stays per-SECOND (pane 3's runway meter + hud.ts read burnPerSecCents); convert
  // the flat per-minute rate. Pane 3 shows it as −$X/min (= burnPerSecCents × 60).
  return { currentCents: current, burnPerSecCents: applyEconomyV3Burn(current, 0).burnPerMinCents / 60n };
}

/**
 * Write the economy-v3 current snapshot after funding is booked: fold burn up to `now`, capture awards
 * booked since the last snapshot, reset the lifetime baseline to SUM(funding_earnings), and stamp now.
 * Call AFTER a credited award/credit INSERT. Because economyV3Current re-derives current from the ledger
 * SUM, a missed call self-heals on the next read — this snapshot is an optimisation (it folds burn into
 * older balances and advances the baseline), never load-bearing for correctness. economyV3 only.
 */
export async function refreshEconomyV3Current(db: D1Database, deviceId: string, now: number): Promise<void> {
  // Compare-and-swap (review A-H1): the write only lands if the snapshot is still exactly what was read. Without it, a
  // debit (death / bust / ride / shop / acqui-hire escrow) committing between this read and write was overwritten —
  // the debit vanished while its ledger row (e.g. combat_penalties) stayed, which a victim-funded bounty turned into
  // minting. On a lost race, re-read and retry; giving up is safe (the snapshot self-heals from the ledger SUM, and
  // callers' own debit batches require the snapshot stamped at `now`, so they report 'retry' rather than mis-charge).
  for (let attempt = 0; attempt < 5; attempt++) {
    const sumRow = await db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS s FROM funding_earnings WHERE device_id=? AND season=?')
      .bind(deviceId, FUNDING_SEASON).first<{ s: number }>();
    const lifetime = BigInt(sumRow?.s ?? 0);
    const snap = await db.prepare('SELECT economy_v3_current_cents AS cur, economy_v3_lifetime_cents AS life, economy_v3_burn_updated_at AS at FROM funding_profiles WHERE device_id=?')
      .bind(deviceId).first<EconomyV3Snapshot>();
    if (!snap) return;
    const currentCents = currentFromSnapshot(lifetime, snap, now);
    const write = await db.prepare(`UPDATE funding_profiles SET economy_v3_current_cents=?, economy_v3_lifetime_cents=?, economy_v3_burn_updated_at=?
      WHERE device_id=? AND economy_v3_current_cents IS ? AND economy_v3_lifetime_cents IS ? AND economy_v3_burn_updated_at IS ?`)
      .bind(Number(currentCents), Number(lifetime), now, deviceId, snap.cur ?? null, snap.life ?? null, snap.at ?? null).run();
    if ((write.meta?.changes ?? 0) > 0) return;
  }
}
