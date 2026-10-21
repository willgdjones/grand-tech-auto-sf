import { flags } from '@gtasf/shared/flags';
import { formatFunding } from './funding';

/**
 * VC fund drops (PLAN-v2 decision 3). The server schedules "<Fund> announces a new
 * fund — come pitch!" checkpoints at real SF spots. The first {@link DROP_CAPACITY}
 * players to drive (or walk) through an open drop get a cheque, recorded on the cap
 * table as a `fund-drop` funding source. Fund names are parody by default; a paid
 * sponsor slot (Stripe-gated, off until keys exist) can rename a drop.
 *
 * The schedule is a pure function of the clock: every GTASF node and client computes
 * the same canonical slots, so "server-scheduled" needs no cron or extra Durable
 * Object. Only the server resolves anchors, counts claims and awards cheques.
 */
export const DROP_SEASON = 'sf-tech-week-2026';
export const DROP_CAPACITY = 50;
/** Checkpoint radius in metres. Generous so a car passing through claims reliably. */
export const DROP_RADIUS_M = 12;
/** Vertical tolerance so a car or pedestrian at road height both register. */
export const DROP_HEIGHT_M = 6;
/** Tuning choice: a drop cheque is a meaningful bonus, one notch of early progression. Economy v3 (Seed $75k):
 *  ~$1.5k, a few minutes of event earnings (tools/economy/simulate.mjs VC DROP) — the v2 $250k is 3.3× Seed. */
export const DROP_CHEQUE_CENTS = flags.economyV3 ? 150_000n : 25_000_000n; // v3 $1,500 · v2 $250,000
/** A fresh drop begins every interval; the slot rotates to a new fund and spot each time. */
export const DROP_INTERVAL_MS = 15 * 60_000;
/** Each slot stays open for its whole interval, so exactly one drop is always live somewhere
 *  (GTA "there is always something on the radar"). The per-drop countdown to {@link FundDrop.closesAt}
 *  — which is when it rotates to the next fund — still supplies the "timed window" urgency, and
 *  continuous availability keeps a drop reachable in a short playtest session. */
export const DROP_WINDOW_MS = DROP_INTERVAL_MS;
/** Clients may surface an "incoming" teaser this far ahead of the next slot opening. */
export const DROP_LOOKAHEAD_MS = 2 * 60_000;

export interface DropLocation { lat: number; lon: number; label: string }
export interface DropAnchor { x: number; y: number; z: number }
export interface FundDropSponsor { name: string; url?: string; logoUrl?: string }

/** Parody fund names — generic startup-world jokes, not real firms. SA-style signage. */
export const PARODY_FUNDS: readonly string[] = Object.freeze([
  'Dry Powder Partners', 'Term Sheet Capital', 'Blitzscale Ventures', 'Runway Capital',
  'Unicorn Farms', 'Vesting Cliff Ventures', 'Burn Rate Capital', 'SAFE Note Syndicate',
  'Founder Mode Capital', 'Cap Table Capital', 'Series Infinity', 'Zero-to-One-ish Ventures',
  '10x Engineer Ventures', 'Product-Market Fit Partners', 'TAM Expansion Fund', 'Moonshot & Chandler',
  'Pre-Seed & Desist', 'Patient Capital (allegedly)', 'Growth At All Costs', 'Down Round Capital',
]);

/** Spots along the playable Ferry→Columbus→Lombard corridor; each verified to snap to a real road
 *  (worker/src/funding/dropAnchors.test.ts). Keep new spots on this route or the drop won't appear. */
export const DROP_LOCATIONS: readonly DropLocation[] = Object.freeze([
  { lat: 37.7955, lon: -122.3937, label: 'Ferry Building Plaza' },
  { lat: 37.7968, lon: -122.3958, label: 'Embarcadero & Washington' },
  { lat: 37.7975, lon: -122.4045, label: 'Montgomery & Columbus' },
  { lat: 37.7982, lon: -122.4058, label: 'Columbus & Broadway' },
  { lat: 37.7995, lon: -122.4078, label: 'Columbus & Green, North Beach' },
  { lat: 37.8008, lon: -122.4100, label: 'Washington Square, North Beach' },
  { lat: 37.8035, lon: -122.4155, label: 'Columbus & Lombard' },
  { lat: 37.8021, lon: -122.4187, label: 'Lombard switchbacks (crooked street)' },
]);

export interface FundDrop {
  /** Stable per scheduled slot so claims dedupe across nodes and restarts. */
  id: string;
  slot: number;
  fundName: string;
  tagline: string;
  sponsored: boolean;
  sponsor?: FundDropSponsor;
  location: DropLocation;
  opensAt: number;
  closesAt: number;
  capacity: number;
  chequeCents: string;
}
/** A drop enriched with server-resolved geometry and live claim counts. */
export interface LiveFundDrop extends FundDrop {
  anchor: DropAnchor;
  radiusM: number;
  claimed: number;
  remaining: number;
  yourClaim: FundDropClaim | null;
}
export interface FundDropClaim {
  dropId: string;
  slot: number;
  fundName: string;
  amountCents: string;
  /** 1..capacity — your place in the queue of cheques for this drop. */
  position: number;
  claimedAt: number;
}
export interface FundDropState {
  serverNow: number;
  active: LiveFundDrop[];
  /** The next slot opening within {@link DROP_LOOKAHEAD_MS}, for an incoming teaser. */
  upcoming: { id: string; slot: number; fundName: string; opensAt: number; location: DropLocation } | null;
  /** The player's most recent claim, so the client can raise a one-shot toast. */
  recentClaim: FundDropClaim | null;
}

export interface SponsorOverride { slot: number; sponsor: FundDropSponsor }

/**
 * Paid sponsor-slot ad product (PLAN-v2 decision 3; bead gtasf-v2-drop-sponsor-checkout-c41g).
 * A real VC/startup pays to rename a future drop under its real name. Priced as a premium ad slot —
 * it renames a whole "come pitch!" drop (banner, N/50 counter, radar blip) for a 15-minute window —
 * sitting above the billboard ($250) and plane-flyover ($500) tiers in shared/gtm/catalogue.ts.
 * USD because the Stripe account default is GBP (see worker/src/outbid/stripeEnv.ts). Charges stay
 * off until Stripe keys exist and `flags.fundDropSponsors` + `checkoutConfigured(env)` are both true.
 */
export const FUND_DROP_SPONSOR_PRICE_USD_CENTS = 50_000n; // $500.00
export const FUND_DROP_SPONSOR_NAME_MAX = 120;
export const FUND_DROP_SPONSOR_URL_MAX = 2048;
/** How far ahead a slot may be bought, so a buyer cannot reserve an absurd far-future slot. */
export const DROP_SPONSOR_MAX_AHEAD_MS = 14 * 24 * 60 * 60_000; // 14 days

/** What the sponsor checkout form sends; the worker validates it with {@link validateFundDropSponsorDraft}. */
export interface FundDropSponsorDraftInput { slot?: unknown; name?: unknown; url?: unknown; logoUrl?: unknown }
export interface FundDropSponsorDraft { slot: number; name: string; url?: string; logoUrl?: string }

/** Only https links are stored/shown for a sponsor, so a drop banner never points at a junk scheme. */
function cleanSponsorUrl(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new RangeError(`Invalid sponsor ${field}`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > FUND_DROP_SPONSOR_URL_MAX) throw new RangeError(`Sponsor ${field} is too long`);
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { throw new RangeError(`Sponsor ${field} must be a valid URL`); }
  if (parsed.protocol !== 'https:') throw new RangeError(`Sponsor ${field} must be an https:// link`);
  return trimmed;
}

/**
 * Validate and normalise a sponsor-slot purchase. The slot must be a future drop within
 * {@link DROP_SPONSOR_MAX_AHEAD_MS}; the name is 1–{@link FUND_DROP_SPONSOR_NAME_MAX} characters
 * with control characters stripped; url/logoUrl are optional https links. Throws RangeError on
 * anything invalid so the route can answer 400 with the message.
 */
export function validateFundDropSponsorDraft(input: FundDropSponsorDraftInput, now: number): FundDropSponsorDraft {
  if (!Number.isFinite(now) || now < 0) throw new RangeError('Invalid server clock');
  const slot = input.slot;
  if (typeof slot !== 'number' || !Number.isSafeInteger(slot) || slot < 0) throw new RangeError('A numeric drop slot is required');
  const current = dropSlotAt(now);
  if (slot <= current) throw new RangeError('That drop has already opened — choose a future slot');
  if (slot * DROP_INTERVAL_MS - now > DROP_SPONSOR_MAX_AHEAD_MS) throw new RangeError('That slot is too far in the future');
  if (typeof input.name !== 'string') throw new RangeError('A sponsor name is required');
  const name = input.name.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length < 1 || [...name].length > FUND_DROP_SPONSOR_NAME_MAX) throw new RangeError(`Sponsor name must be 1–${FUND_DROP_SPONSOR_NAME_MAX} characters`);
  const url = cleanSponsorUrl(input.url, 'URL');
  const logoUrl = cleanSponsorUrl(input.logoUrl, 'logo URL');
  return { slot, name, ...(url ? { url } : {}), ...(logoUrl ? { logoUrl } : {}) };
}

export function dropId(slot: number): string {
  if (!Number.isSafeInteger(slot) || slot < 0) throw new RangeError('Invalid drop slot');
  return `drop-${DROP_SEASON}-${slot}`;
}
export function dropSlotAt(now: number): number {
  if (!Number.isFinite(now) || now < 0) throw new RangeError('Invalid server clock');
  return Math.floor(now / DROP_INTERVAL_MS);
}
export function dropTagline(fundName: string): string {
  return `${fundName} announces a new fund — come pitch!`;
}
/** Deterministic canonical drop for a slot, optionally renamed by a paid sponsor. */
export function scheduleDrop(slot: number, sponsor?: FundDropSponsor): FundDrop {
  if (!Number.isSafeInteger(slot) || slot < 0) throw new RangeError('Invalid drop slot');
  const location = DROP_LOCATIONS[slot % DROP_LOCATIONS.length]!;
  const fundName = sponsor?.name ?? PARODY_FUNDS[slot % PARODY_FUNDS.length]!;
  const opensAt = slot * DROP_INTERVAL_MS;
  return {
    id: dropId(slot), slot, fundName, tagline: dropTagline(fundName),
    sponsored: Boolean(sponsor), ...(sponsor ? { sponsor } : {}),
    location, opensAt, closesAt: opensAt + DROP_WINDOW_MS,
    capacity: DROP_CAPACITY, chequeCents: DROP_CHEQUE_CENTS.toString(),
  };
}
/**
 * Slots currently open. The schedule is a continuous rotation (DROP_WINDOW_MS === DROP_INTERVAL_MS),
 * so this is always the single current slot. The window check is kept so that if a future gap is
 * introduced (window < interval) it correctly reports no open slot during the gap rather than one.
 */
export function activeDropSlots(now: number): number[] {
  const slot = dropSlotAt(now), opensAt = slot * DROP_INTERVAL_MS;
  return now < opensAt + DROP_WINDOW_MS ? [slot] : [];
}
/** The next slot opening within the lookahead window, or null. */
export function upcomingDropSlot(now: number): number | null {
  const next = dropSlotAt(now) + 1, opensAt = next * DROP_INTERVAL_MS;
  return opensAt - now <= DROP_LOOKAHEAD_MS && opensAt > now ? next : null;
}
/** The sponsor paid for a slot, if any. Sponsor slots are a Stripe-gated ad product. */
export function sponsorForSlot(sponsors: readonly SponsorOverride[] | undefined, slot: number): FundDropSponsor | undefined {
  return sponsors?.find(override => override.slot === slot)?.sponsor;
}
/** Canonical scheduled drops currently open, newest first. Normally one (the schedule is continuous). */
export function activeDrops(now: number, sponsors?: readonly SponsorOverride[]): FundDrop[] {
  return activeDropSlots(now).map(slot => scheduleDrop(slot, sponsorForSlot(sponsors, slot))).reverse();
}
/** The canonical drop teased as "incoming", or null when none is within the lookahead. */
export function upcomingDrop(now: number, sponsors?: readonly SponsorOverride[]): FundDrop | null {
  const slot = upcomingDropSlot(now);
  return slot === null ? null : scheduleDrop(slot, sponsorForSlot(sponsors, slot));
}
export function formatCheque(amountCents: string): string {
  return formatFunding(amountCents);
}
