import { flags } from '@gtasf/shared/flags';
import {
  DROP_HEIGHT_M, DROP_INTERVAL_MS, DROP_LOCATIONS, DROP_RADIUS_M, FUND_DROP_SPONSOR_PRICE_USD_CENTS, PARODY_FUNDS,
  activeDrops, dropSlotAt, scheduleDrop, sponsorForSlot, upcomingDrop, validateFundDropSponsorDraft,
  type DropAnchor, type FundDrop, type FundDropClaim, type FundDropSponsorDraft, type FundDropState, type LiveFundDrop, type SponsorOverride,
} from '@gtasf/shared/drops';
import type { Pose } from '@gtasf/shared/protocol/types';
import type { Env } from '../env';
import { type FundingAnchorResolver, fundingAnchor } from './anchors';
import { fundingDevice, fundingSameOrigin } from './identity';
import { fundingJson } from './routes';
import { checkoutConfigured } from '../outbid/stripeEnv';
import {
  clearDropSponsor, dropClaimCounts, dropSponsorOverrides, insertPendingSponsorOrder, pendingSponsorOrderForSlot,
  recentDropClaim, recordDropClaim, setDropSponsor, yourDropClaim,
} from './dropsStore';

/** A Stripe Checkout session; the ledger (worker/src/ledger/fundDropSponsorCheckout.ts) supplies it. */
export interface CheckoutSession { id: string; url: string }
/**
 * Create a **USD** Stripe Checkout session to sponsor one drop slot. Owned by the ledger and injected
 * here so the route is testable and this module never reaches into the ledger. Absent ⇒ the checkout
 * route answers 503 (feature reachable, purchase not yet wired).
 */
export type FundDropSponsorCheckout = (args: { draft: FundDropSponsorDraft; amountUsdCents: bigint }) => Promise<CheckoutSession>;
export interface DropsDeps {
  /** Ledger checkout; absent ⇒ /sponsor/checkout returns 503. */
  checkout?: FundDropSponsorCheckout;
  now?: () => number;
}
/** How many upcoming slots the /sponsor/offer endpoint lists as purchasable (≈2 hours at 15-min slots). */
const SPONSOR_OFFER_SLOTS = 8;
/** A recent pending order holds its slot for this long before another buyer may attempt it. */
const SPONSOR_HOLD_MS = 30 * 60_000;

export interface DropPeer { id: number; deviceId?: string; pose: Pose }
const COUNTS_TTL_MS = 3000;
const SPONSOR_TTL_MS = 60_000;

/**
 * Server-authoritative VC fund drops. WorldDO supplies the clock, peers and an anchor resolver.
 * The 10 Hz tick detects a player driving or walking through an open drop and records the cheque;
 * clients only read `/api/drops/state` to show the banner, the N/50 counter and the claim toast.
 */
export class WorldDrops {
  private readonly anchors = new Map<number, DropAnchor | null>();
  private readonly counts = new Map<string, { at: number; n: number }>();
  private readonly claimed = new Map<string, FundDropClaim>();
  private readonly pending = new Set<string>();
  private readonly recent = new Map<string, FundDropClaim>();
  private readonly budgets = new Map<string, { at: number; credit: number }>();
  private sponsors: SponsorOverride[] = [];
  private sponsorsAt = 0;
  private sponsorLoad?: Promise<void>;
  // Claims are serialised so each drop's capacity COUNT snapshot is reliable under the single WorldDO.
  private writing: Promise<unknown> = Promise.resolve();
  private sweptAt = 0;

  constructor(
    private readonly env: Pick<Env, 'DB'>,
    private readonly peers: () => Iterable<DropPeer>,
    private readonly retain: (work: Promise<unknown>) => void,
    private readonly anchorForLocation: FundingAnchorResolver = fundingAnchor,
  ) {}

  private anchorFor(drop: FundDrop): DropAnchor | null {
    if (!this.anchors.has(drop.slot)) this.anchors.set(drop.slot, this.anchorForLocation(drop.location));
    return this.anchors.get(drop.slot) ?? null;
  }
  private inside(peer: DropPeer, anchor: DropAnchor): boolean {
    return Boolean(peer.deviceId) && Math.hypot(peer.pose.x / 100 - anchor.x, peer.pose.z / 100 - anchor.z) <= DROP_RADIUS_M
      && Math.abs(peer.pose.y / 100 - anchor.y) <= DROP_HEIGHT_M;
  }
  private sponsorOverrides(now: number): SponsorOverride[] {
    if (!flags.fundDropSponsors) return [];
    if (now - this.sponsorsAt > SPONSOR_TTL_MS && !this.sponsorLoad) {
      this.sponsorLoad = dropSponsorOverrides(this.env.DB).then(value => { this.sponsors = value; this.sponsorsAt = now; })
        .catch(() => undefined).finally(() => { this.sponsorLoad = undefined; });
      this.retain(this.sponsorLoad);
    }
    return this.sponsors;
  }

  /** Detect drive/walk-throughs of the open drop(s) and record cheques for the first 50. */
  tick(now: number): void {
    const drops = activeDrops(now, this.sponsorOverrides(now));
    for (const drop of drops) {
      const anchor = this.anchorFor(drop);
      if (!anchor) continue;
      for (const peer of this.peers()) {
        if (!peer.deviceId || !this.inside(peer, anchor)) continue;
        const key = `${peer.deviceId}:${drop.id}`;
        if (this.claimed.has(key) || this.pending.has(key)) continue;
        this.pending.add(key);
        const deviceId = peer.deviceId;
        this.writing = this.writing.then(() => this.claimOne(deviceId, drop, key, now)).catch(() => undefined);
        this.retain(this.writing);
      }
    }
    if (now - this.sweptAt > 60_000) {
      this.sweptAt = now;
      for (const [id, value] of this.counts) if (now - value.at > 10 * 60_000) this.counts.delete(id);
      // Keep only live peers' claim/recent memory; everything else is re-read from D1 on demand.
      const live = new Set([...this.peers()].flatMap(peer => peer.deviceId ? [peer.deviceId] : []));
      for (const key of this.claimed.keys()) if (![...live].some(id => key.startsWith(`${id}:`))) this.claimed.delete(key);
      for (const id of this.recent.keys()) if (!live.has(id)) this.recent.delete(id);
      for (const [id, value] of this.budgets) if (now - value.at > 10 * 60_000) this.budgets.delete(id);
    }
  }
  private async claimOne(deviceId: string, drop: FundDrop, key: string, now: number): Promise<void> {
    try {
      const result = await recordDropClaim(this.env.DB, { deviceId, drop, now });
      this.counts.set(drop.id, { at: Date.now(), n: result.claimedCount });
      if (result.claim) {
        this.claimed.set(key, result.claim);
        if (result.credited) this.recent.set(deviceId, result.claim);
      } else if (result.full) {
        // Drop is out of cheques for everyone; stop re-attempting this device on it.
        this.claimed.set(key, { dropId: drop.id, slot: drop.slot, fundName: drop.fundName, amountCents: '0', position: 0, claimedAt: now });
      }
    } finally { this.pending.delete(key); }
  }

  private async count(drop: FundDrop, now: number): Promise<number> {
    const cached = this.counts.get(drop.id);
    if (cached && now - cached.at < COUNTS_TTL_MS) return cached.n;
    const counts = await dropClaimCounts(this.env.DB, [drop.id]);
    const n = counts.get(drop.id) ?? 0; this.counts.set(drop.id, { at: now, n }); return n;
  }
  private async claimFor(deviceId: string, drop: FundDrop): Promise<FundDropClaim | null> {
    const key = `${deviceId}:${drop.id}`, cached = this.claimed.get(key);
    if (cached) return cached.position > 0 ? cached : null;
    const claim = await yourDropClaim(this.env.DB, deviceId, drop.id);
    if (claim) this.claimed.set(key, claim);
    return claim;
  }
  private async live(deviceId: string | null, drop: FundDrop, anchor: DropAnchor, now: number): Promise<LiveFundDrop> {
    const [claimed, yourClaim] = await Promise.all([this.count(drop, now), deviceId ? this.claimFor(deviceId, drop) : Promise.resolve(null)]);
    return { ...drop, anchor, radiusM: DROP_RADIUS_M, claimed,
      remaining: Math.max(0, drop.capacity - claimed), yourClaim };
  }
  private async state(deviceId: string | null, now: number): Promise<FundDropState> {
    const sponsors = this.sponsorOverrides(now);
    const scheduled = activeDrops(now, sponsors).map(drop => ({ drop, anchor: this.anchorFor(drop) }))
      .filter((entry): entry is { drop: FundDrop; anchor: DropAnchor } => entry.anchor !== null);
    const active = await Promise.all(scheduled.map(({ drop, anchor }) => this.live(deviceId, drop, anchor, now)));
    const next = upcomingDrop(now, sponsors);
    const recentClaim = deviceId ? (this.recent.get(deviceId) ?? await recentDropClaim(this.env.DB, deviceId)) : null;
    return {
      serverNow: now, active,
      upcoming: next ? { id: next.id, slot: next.slot, fundName: next.fundName, opensAt: next.opensAt, location: next.location } : null,
      recentClaim,
    };
  }

  async handle(request: Request): Promise<Response> {
    if (!fundingSameOrigin(request)) return fundingJson({ error: 'Same-origin request required' }, 403);
    const url = new URL(request.url), path = url.pathname;
    if (path !== '/api/drops/state' || request.method !== 'GET') return fundingJson({ error: 'Not found' }, 404);
    try {
      // The drop schedule and N/50 counts are public; a funding session is only needed for the
      // per-player yourClaim/recentClaim (which null out without one). Serve public state rather than
      // 401, since the client polls /state before the funding-session cookie exists — a 401 here is a
      // harmless-but-noisy console error and would also hide the drop banner until the session starts.
      const deviceId = await fundingDevice(request, this.env.DB);
      const now = Date.now();
      const budgetKey = deviceId ?? 'anon';
      const budget = this.budgets.get(budgetKey) ?? { at: now, credit: 12 };
      budget.credit = Math.min(12, budget.credit + Math.max(0, now - budget.at) / 300); budget.at = now; this.budgets.set(budgetKey, budget);
      if (--budget.credit < 0) return fundingJson({ error: 'Please slow down' }, 429);
      this.tick(now);
      return fundingJson(await this.state(deviceId, now));
    } catch (error) {
      return fundingJson({ error: error instanceof RangeError ? error.message : 'Fund drops are temporarily unavailable' }, error instanceof RangeError ? 400 : 503);
    }
  }
}

/** Constant-time Bearer check against ADMIN_TOKEN (same scheme as the event-submission admin). */
function dropsAdmin(request: Request, env: Env): boolean {
  const token = env.ADMIN_TOKEN?.trim(); if (!token) return false;
  const match = /^Bearer\s+(.+)$/.exec(request.headers.get('authorization') ?? ''); if (!match) return false;
  const provided = match[1]!; let diff = provided.length ^ token.length;
  for (let i = 0; i < token.length; i++) diff |= (i < provided.length ? provided.charCodeAt(i) : 0) ^ token.charCodeAt(i);
  return diff === 0;
}

/** Public-Worker forwarder: /api/drops/state goes to the WorldDO (live poses); the sponsor ad-product
 *  admin routes are direct D1 writes (no DO), invisible unless fundDropSponsors + ADMIN_TOKEN are set. */
export async function handleDropsRequest(request: Request, env: Env, deps: DropsDeps = {}): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/drops/')) return null;
  if (!flags.fundDrops) {
    // Feature off (e.g. not in the prod allowlist): serve a clean empty state for /state so stray or
    // legacy callers get valid 200 JSON instead of a console error; hide the admin routes.
    return path === '/api/drops/state'
      ? fundingJson({ serverNow: Date.now(), active: [], upcoming: null, recentClaim: null } satisfies FundDropState)
      : fundingJson({ error: 'Not found' }, 404);
  }
  if (!fundingSameOrigin(request)) return fundingJson({ error: 'Same-origin request required' }, 403);
  // Paid sponsor-slot ad product (buyer-facing, no ADMIN_TOKEN): the upcoming-slot offer and the
  // Stripe Checkout purchase. 404 until fundDropSponsors is on; the purchase additionally requires
  // checkoutConfigured(env), which is always false in production until the founder enables a live charge.
  if (path === '/api/drops/sponsor/offer' || path === '/api/drops/sponsor/checkout') {
    if (!flags.fundDropSponsors) return fundingJson({ error: 'Not found' }, 404);
    const now = (deps.now ?? Date.now)();
    if (path === '/api/drops/sponsor/offer') {
      if (request.method !== 'GET') return fundingJson({ error: 'Method not allowed' }, 405);
      const sponsors = await dropSponsorOverrides(env.DB);
      const current = dropSlotAt(now);
      const upcoming = Array.from({ length: SPONSOR_OFFER_SLOTS }, (_, i) => {
        const slot = current + 1 + i, location = DROP_LOCATIONS[slot % DROP_LOCATIONS.length]!;
        const sponsor = sponsorForSlot(sponsors, slot);
        return { slot, opensAt: slot * DROP_INTERVAL_MS, location,
          defaultFund: PARODY_FUNDS[slot % PARODY_FUNDS.length]!, sponsored: Boolean(sponsor),
          ...(sponsor ? { sponsorName: sponsor.name } : {}) };
      });
      return fundingJson({ priceUsdCents: FUND_DROP_SPONSOR_PRICE_USD_CENTS.toString(), serverNow: now,
        checkoutAvailable: checkoutConfigured(env) && Boolean(deps.checkout), upcoming });
    }
    if (request.method !== 'POST') return fundingJson({ error: 'Method not allowed' }, 405);
    // Belt-and-braces for the live key: never start a real charge unless checkout is configured for this
    // environment (false in production until the founder approves one real purchase) — the live-charge
    // gate lives on the route itself, not just the flag + DI wiring (mirrors sponsoredAngels/routes.ts).
    if (!checkoutConfigured(env)) return fundingJson({ error: 'Checkout is not available in this environment.' }, 503);
    if (!deps.checkout) return fundingJson({ error: 'Checkout is not configured yet.' }, 503);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    let draft: FundDropSponsorDraft;
    try { draft = validateFundDropSponsorDraft(body ?? {}, now); }
    catch (error) { return fundingJson({ error: error instanceof Error ? error.message : 'Check your entry.' }, 400); }
    // First paid buyer wins a slot: refuse a slot that is already live-sponsored or held by a recent
    // pending purchase, so a second buyer is never charged for a slot they cannot have.
    if (sponsorForSlot(await dropSponsorOverrides(env.DB), draft.slot)) return fundingJson({ error: 'That slot is already sponsored.' }, 409);
    if (await pendingSponsorOrderForSlot(env.DB, draft.slot, now - SPONSOR_HOLD_MS)) return fundingJson({ error: 'That slot has a pending purchase — try again shortly or pick another slot.' }, 409);
    let session: CheckoutSession;
    try { session = await deps.checkout({ draft, amountUsdCents: FUND_DROP_SPONSOR_PRICE_USD_CENTS }); }
    catch { return fundingJson({ error: 'Could not start checkout. Please try again.' }, 502); }
    await insertPendingSponsorOrder(env.DB, { checkoutId: session.id, slot: draft.slot, name: draft.name,
      url: draft.url, logoUrl: draft.logoUrl, amountCents: FUND_DROP_SPONSOR_PRICE_USD_CENTS, now });
    return fundingJson({ checkoutUrl: session.url });
  }
  if (path === '/api/drops/sponsor' || path === '/api/drops/sponsor/clear' || path === '/api/drops/sponsors') {
    // Paid purchase/checkout is Stripe-gated and deferred; this is the operator-set plumbing only.
    if (!flags.fundDropSponsors || !env.ADMIN_TOKEN?.trim()) return fundingJson({ error: 'Not found' }, 404);
    if (!dropsAdmin(request, env)) return fundingJson({ error: 'Admin authorization required' }, 401);
    try {
      if (path === '/api/drops/sponsors') {
        if (request.method !== 'GET') return fundingJson({ error: 'Method not allowed' }, 405);
        return fundingJson({ sponsors: await dropSponsorOverrides(env.DB) });
      }
      if (request.method !== 'POST') return fundingJson({ error: 'Method not allowed' }, 405);
      const body = await request.json().catch(() => null) as Record<string, unknown> | null;
      if (!body || typeof body.slot !== 'number') return fundingJson({ error: 'A numeric slot is required' }, 400);
      if (path === '/api/drops/sponsor/clear') return fundingJson({ cleared: await clearDropSponsor(env.DB, body.slot) });
      if (typeof body.name !== 'string') return fundingJson({ error: 'A sponsor name is required' }, 400);
      const sponsor = await setDropSponsor(env.DB, { slot: body.slot, name: body.name,
        url: typeof body.url === 'string' ? body.url : undefined, logoUrl: typeof body.logoUrl === 'string' ? body.logoUrl : undefined, now: Date.now() });
      return fundingJson({ sponsor });
    } catch (error) {
      return fundingJson({ error: error instanceof RangeError ? error.message : 'Fund drop sponsor update failed' }, error instanceof RangeError ? 400 : 503);
    }
  }
  if (path !== '/api/drops/state') return fundingJson({ error: 'Not found' }, 404);
  try {
    return await env.WORLD.get(env.WORLD.idFromName('sf')).fetch(request);
  } catch {
    return fundingJson({ error: 'Fund drops are temporarily unavailable' }, 503);
  }
}
