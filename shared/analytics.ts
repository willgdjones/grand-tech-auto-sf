/** GTASF funnel contract. No chat, email, URLs, payment or claim capabilities. */
export const ANALYTICS_EVENTS = [
  'landing_view', 'queue_join', 'play_start', 'first_drive', 'robotaxi_hail',
  'event_view', 'event_navigate', 'event_arrive', 'chat_send', 'outbid_view',
  'outbid_purchase', 'ad_claim_view', 'ad_purchase', 'share_link', 'email_captured',
  'onboarding_start', 'onboarding_complete', 'onboarding_step', 'session_heartbeat',
  'organiser_link_view', 'organiser_share_click',
  // Voice (no audio/text): spoken-bubble attempt outcome; proximity voice switched on.
  'voice_caption', 'voice_enabled',
  // Loading funnel by device (gtasf-1k82): READY reached, with an elapsed-time bucket in 'stage'.
  'load_ready',
  // Paint-step assist fired (gtasf-mi3b): stage 'first' (20 s) or 'retry' (35 s); shows who is still there by then.
  'paint_assist',
  // Founder ladder funnel (gtasf-founder-ladder-p1-ilnl): experiment entry on a new device (both A/B
  // buckets, the denominator), the startup founded, and the billboard first seen (the success metric:
  // % of new players who see their billboard within 2 min). All carry `bucket` + `ms_since_join`.
  'founder_bucket', 'founder_found', 'billboard_seen',
  // GTA-pivot lane C funnel (gtasf-ldlm): mission progress (source = mission id, step = 'start' | objective id |
  // 'complete' | 'abandon'), an SF-pilgrimage landmark collected (source = site id), and quest-giver calls
  // (source = mission id, outcome = 'ring' | 'answer' | 'decline').
  'mission_step', 'pilgrimage_collect', 'phone_call',
  // GTA-pivot lane B combat funnel (flag combatAnalytics, no PII): step = 'gate_shown' | 'gate_accept' |
  // 'gate_decline' | 'weapon_pickup' | 'gun_buy' | 'robbery' | 'wasted' | 'busted' | 'wanted'; source = weapon /
  // store id; stage = the wanted level for 'wanted'.
  'combat_step',
  // Founder-ladder opening beats (lane C, actionOpening/openingDrive): step = 'pear_drive' | 'pear_prompt' | 'pear_arrived' |
  // 'convo_open' | 'pitch_sent' | 'preseed_cheque' | 'seed_drive' | 'seed_arrived' | 'seed_convo' | 'seed_cheque', once per
  // session each, with ms_since_join + is_mobile — so the funnel shows where new players stop between billboard and cheque.
  'opening_step',
] as const;
export type AnalyticsEvent = typeof ANALYTICS_EVENTS[number];
export type PurchaseEvent = Extract<AnalyticsEvent, 'outbid_purchase' | 'ad_purchase'>;
export type ClientAnalyticsEvent = Exclude<AnalyticsEvent, PurchaseEvent>;
export const X_CONVERSION_EVENTS = ['play_start', 'outbid_purchase', 'ad_purchase'] as const;
export type XConversionEvent = typeof X_CONVERSION_EVENTS[number];
export type Attribution = Record<string, string>;
export interface AnalyticsProperties {
  event_id?: string;
  /** Organiser link channel (?c=): dm | em | link. */
  channel?: string;
  building_id?: string;
  company_slug?: string;
  product?: string;
  source?: string;
  device?: 'desktop' | 'mobile';
  quality?: 'low' | 'medium' | 'high';
  amount_cents?: number;
  /** Play-time funnel (no PII): tutorial step, funding round id, active minutes, coarse device class. */
  step?: string;
  stage?: string;
  minutes_played?: number;
  is_mobile?: boolean;
  /** voice_caption result: sent | empty | rejected | paused | busy | error. */
  outcome?: string;
  /** Founder-ladder A/B bucket: 'control' | 'ladder'. */
  bucket?: string;
  /** Founder-ladder funnel timing: ms since this session joined (billboard-within-2-min metric). */
  ms_since_join?: number;
}
export interface AnalyticsContext {
  distinctId: string;
  attribution: Attribution;
  permitted: true;
  playConversionId?: string;
}
export interface AnalyticsPublicConfig {
  posthog: boolean;
  consentRequired?: boolean;
  xPixelId?: string;
  xEvents: Partial<Record<XConversionEvent, string>>;
}
export function isAnalyticsEvent(value: unknown): value is AnalyticsEvent {
  return typeof value === 'string' && (ANALYTICS_EVENTS as readonly string[]).includes(value);
}
export function isPurchaseEvent(value: AnalyticsEvent): value is PurchaseEvent {
  return value === 'outbid_purchase' || value === 'ad_purchase';
}
export function validAnalyticsId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Untrusted client context is bounded and never acts as authentication. */
export function cleanAnalyticsContext(input: unknown): AnalyticsContext | undefined {
  const value = record(input);
  if (value.permitted !== true || !validAnalyticsId(value.distinctId)) return;
  return { permitted: true, distinctId: value.distinctId, attribution: cleanAttribution(value.attribution),
    ...(validAnalyticsId(value.playConversionId) ? { playConversionId: value.playConversionId } : {}) };
}

/** Campaign slugs and X click IDs only. Raw query/path/referrer are never retained. */
export function cleanAttribution(input: unknown): Attribution {
  const result: Attribution = {};
  for (const [name, value] of Object.entries(record(input)).sort(([a], [b]) => Number(b === 'twclid') - Number(a === 'twclid'))) {
    if (Object.keys(result).length >= 16) break;
    if (!(name === 'twclid' || /^utm_[a-z0-9_]{1,32}$/.test(name))) continue;
    if (typeof value === 'string' && value.length <= 256 && /^[a-zA-Z0-9_.~+ -]+$/.test(value) && JSON.stringify({ ...result, [name]: value }).length <= 1024) result[name] = value;
  }
  return result;
}
export function attributionFromSearch(search: string): Attribution {
  return cleanAttribution(Object.fromEntries(new URLSearchParams(search.slice(0, 8192))));
}
export function cleanAnalyticsProperties(input: unknown): AnalyticsProperties {
  const source = record(input);
  const result: AnalyticsProperties = {};
  for (const key of ['event_id', 'building_id', 'company_slug', 'product', 'source', 'step', 'stage', 'channel', 'outcome', 'bucket'] as const) {
    const value = source[key];
    if (typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value)) result[key] = value;
  }
  // Founder-ladder timing: bounded to 24h of ms so a bad clock can't inject an absurd value.
  if (typeof source.ms_since_join === 'number' && Number.isSafeInteger(source.ms_since_join) && source.ms_since_join >= 0 && source.ms_since_join <= 86_400_000) result.ms_since_join = source.ms_since_join;
  if (source.device === 'desktop' || source.device === 'mobile') result.device = source.device;
  if (source.quality === 'low' || source.quality === 'medium' || source.quality === 'high') result.quality = source.quality;
  if (typeof source.minutes_played === 'number' && Number.isSafeInteger(source.minutes_played) && source.minutes_played >= 0 && source.minutes_played <= 1440) result.minutes_played = source.minutes_played;
  if (typeof source.is_mobile === 'boolean') result.is_mobile = source.is_mobile;
  if (typeof source.amount_cents === 'number' && Number.isSafeInteger(source.amount_cents) && source.amount_cents >= 0) result.amount_cents = source.amount_cents;
  return result;
}
