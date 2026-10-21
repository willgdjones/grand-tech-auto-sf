import type { AnalyticsContext } from './analytics';
/** O01 wire/API contract. Only the ledger may award totals or assign ranks. */
export const OUTBID_VERSION = 1;
export const OUTBID_MINIMUM_CENTS = 100;
export const OUTBID_MAXIMUM_BID_CENTS = 99_999_999;
export const OUTBID_MAX_ENTRIES = 50;
export interface OutbidEntry {
  bidderId: string;
  rank: number;
  name: string;
  message: string;
  url: string;
  /** Decimal integer cents, serialized from a bigint cumulative sum. */
  totalCents: string;
  /** Only an approved asset from the ad-media pipeline may be published. */
  logoUrl?: string;
}
export interface OutbidSnapshot {
  version: 1;
  revision: number;
  currency: 'usd';
  mode: 'test' | 'live';
  checkoutAvailable: boolean;
  minimumBidCents: 100;
  entries: OutbidEntry[];
}
/** HTTP-only bidder authentication belongs to the backend, never a display name. */
export interface OutbidViewer { bidderId: string; totalCents: string }
export interface OutbidResponse { snapshot: OutbidSnapshot; viewer?: OutbidViewer }
export interface OutbidCheckoutRequest {
  name: string;
  message: string;
  url: string;
  amountCents: number;
  /** Previously approved/uploaded media ID; no arbitrary logo URL. */
  logoAssetId?: string;
  useCredit?: boolean;
  expectedCreditCents?: number;
  analytics?: AnalyticsContext;
}
export interface OutbidCheckoutResponse { url: string; orderId: string }

export function outbidCents(value: unknown): bigint | null {
  return typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value) ? BigInt(value) : null;
}
export function formatOutbidMoney(value: string | bigint): string {
  const cents = typeof value === 'bigint' ? value : outbidCents(value);
  if (cents === null || cents < 0n) return '—';
  return `$${(cents / 100n).toLocaleString('en-US')}.${String(cents % 100n).padStart(2, '0')}`;
}
/** Strictly exceed #1, accounting for the signed-in bidder's already paid total. */
export function outbidAmountToLead(snapshot: OutbidSnapshot, viewer?: OutbidViewer): bigint {
  const leader = outbidCents(snapshot.entries[0]?.totalCents ?? '0') ?? 0n;
  const own = outbidCents(viewer?.totalCents ?? '0') ?? 0n;
  return leader - own + 1n > 100n ? leader - own + 1n : 100n;
}
/** Client URL shape check only; server moderation/link reputation must also pass. */
export function safeOutbidLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || /(?:^|\.)(?:localhost|local|internal|invalid)$/.test(host)) return null;
    return url.href;
  } catch { return null; }
}
/** Bounded public input validation is shared by the browser and world broadcast. */
export function isOutbidSnapshot(value: unknown): value is OutbidSnapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<OutbidSnapshot>;
  if (s.version !== 1 || !Number.isSafeInteger(s.revision) || s.revision! < 0 || s.currency !== 'usd'
    || (s.mode !== 'test' && s.mode !== 'live') || typeof s.checkoutAvailable !== 'boolean'
    || s.minimumBidCents !== 100 || !Array.isArray(s.entries) || s.entries.length > 50) return false;
  const ids = new Set<string>(); let previous: bigint | null = null;
  return s.entries.every((entry, index) => {
    if (!entry || typeof entry !== 'object' || typeof entry.bidderId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(entry.bidderId)
      || ids.has(entry.bidderId) || entry.rank !== index + 1 || typeof entry.name !== 'string'
      || !entry.name.trim() || entry.name.length > 48 || typeof entry.message !== 'string'
      || !entry.message.trim() || entry.message.length > 140 || safeOutbidLink(entry.url) === null) return false;
    if (entry.logoUrl !== undefined && (typeof entry.logoUrl !== 'string'
      || !/^\/api\/media\/approved\/[a-zA-Z0-9_-]{1,100}(?:\.(?:webp|png|jpg))?$/.test(entry.logoUrl))) return false;
    const cents = outbidCents(entry.totalCents);
    if (cents === null || cents <= 0n || (previous !== null && cents > previous)) return false;
    ids.add(entry.bidderId); previous = cents; return true;
  });
}
