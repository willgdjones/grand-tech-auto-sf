import { normalizeNickname } from './protocol/nickname';
import { flags } from '@gtasf/shared/flags';

/** Earned game funding only. Payment totals, purchases and ad ownership never enter these rules. */
export const FUNDING_SEASON = 'sf-tech-week-2026';
export const ROOM_DURATION_MS = 20_000;
export const ROOM_RADIUS_M = 8;
export const ROOM_HEIGHT_M = 4;
/** Drive-through checkpoint (PLAN-v2 decision 1): generous so a passing car claims reliably. */
export const DRIVE_THROUGH_RADIUS_M = 12;
export const DRIVE_THROUGH_HEIGHT_M = 6;
export const STREAK_WINDOW_MS = 15 * 60_000;
/** A referred friend must be server-observed playing this long before the referrer's warm intro and the
 *  friend's welcome cheque qualify (PLAN-v2 §12 "~2–5 min"; lowered from 5 min for launch virality). Single
 *  source of truth: worker/src/referrals/play.ts (accumulation) and worker/src/funding/bonus.ts (the D1
 *  award gate — both the play-time and the joined-at window) read this, so the two layers can never drift. */
export const REFERRAL_QUALIFIED_PLAY_MS = 120_000;
export const FUNDING_MAX_CENTS = 1_000_000_000_000_000n;
export type FundingKind = 'investor' | 'demo' | 'community';
export type FundingTiming = 'live' | 'upcoming' | 'follow-up';
/** Every way a player's startup can be funded (PLAN-v2 decision 5). Keyed by the cap table. */
export type FundingSource = 'event' | 'vc-drop' | 'celebrity' | 'warm-intro';
export type FundingPerk = 'nicer-car' | 'building-name' | 'party-marker';
export interface FundingEvent {
  id: string; title: string; host?: string | null; tags?: readonly string[];
  start: string; end?: string | null;
}
export interface FundingRound {
  /** Stable ladder key (e.g. 'seed', 'series-m', 'hectocorn'); compared only for equality. */
  id: string;
  label: string; stars: number; thresholdCents: string; headline: string;
}
const SERIES_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Series A ($15M) grows ~17.4% per round to roughly $820M at Series Z, staying under Unicorn ($1B). */
function seriesThresholdCents(index: number): string {
  const dollars = Math.round(15_000_000 * Math.pow(1.1735, index) / 100_000) * 100_000;
  return (BigInt(dollars) * 100n).toString();
}
const SERIES_HEADLINES: readonly string[] = [
  'Series {letter} closes; the deck gains another zero.',
  'Series {letter}: the TAM slide is now mostly fiction, confidently.',
  'Series {letter} led by a fund that just raised a bigger fund.',
  'Series {letter}: headcount doubles, the office espresso machine triples.',
  'Series {letter} announced in a tweet before the wire cleared.',
  'Series {letter}: the roadmap is renamed "the vision" and extended two years.',
  'Series {letter} closes at a valuation last seen in a fever dream.',
  'Series {letter}: a strategic investor joins, meaning nobody is quite sure why.',
];
/** The week-long ladder (PLAN-v2 decision 2): Pre-seed → Seed → Series A–Z → Unicorn → Pre-IPO → Decacorn → Hectocorn.
 *  Stars stay 0–5 (the HUD renders ★ out of 5): 3 = a real startup (Series A), 4 = Unicorn, 5 = Decacorn and beyond. */
function buildFundingRounds(): readonly FundingRound[] {
  const rounds: FundingRound[] = [
    { id: 'bootstrapping', label: 'Bootstrapping', stars: 0, thresholdCents: '0', headline: 'Stealth startup confirms it has a name.' },
    { id: 'pre-seed', label: 'Pre-seed', stars: 1, thresholdCents: '50000000', headline: 'Local founder upgrades from coffee meetings to coffee strategy.' },
    { id: 'seed', label: 'Seed', stars: 2, thresholdCents: '300000000', headline: 'Investors describe spreadsheet as a platform.' },
  ];
  for (let i = 0; i < SERIES_LETTERS.length; i++) {
    const letter = SERIES_LETTERS[i]!;
    rounds.push({ id: `series-${letter.toLowerCase()}`, label: `Series ${letter}`, stars: 3,
      thresholdCents: seriesThresholdCents(i), headline: SERIES_HEADLINES[i % SERIES_HEADLINES.length]!.replace('{letter}', letter) });
  }
  rounds.push(
    { id: 'unicorn', label: 'Unicorn', stars: 4, thresholdCents: '100000000000', headline: 'Valuation now visible from space. Revenue declines to comment.' },
    { id: 'pre-ipo', label: 'Pre-IPO', stars: 4, thresholdCents: '300000000000', headline: 'Bankers circle. The S-1 is mostly adjectives and a hockey-stick chart.' },
    { id: 'decacorn', label: 'Decacorn', stars: 5, thresholdCents: '1000000000000', headline: 'Ten billion dollars, still technically pre-revenue, somehow.' },
    { id: 'hectocorn', label: 'Hectocorn', stars: 5, thresholdCents: '10000000000000', headline: 'A hundred billion. The founder celebrates by buying one hoodie.' },
  );
  return Object.freeze(rounds);
}
/** Economy v3 (PLAN-economy-v3): a harder 5-star ladder — Bootstrapping ★0 → Seed ★1 → Series A ★2 →
 *  B ★3 → C ★4 → Series D ("Decacorn") ★5 (the top; no Unicorn/Pre-IPO/Hectocorn). Thresholds are the
 *  simulator's solved cumulative funding at the time-to-star targets (tools/economy/simulate.mjs:
 *  Seed 30m / A 2h / B 5h / C 10h / D 20h). Behind flags.economyV3; v2 (above) stays the default until
 *  the flag + the proportional rescale migration land together. */
function buildEconomyV3Rounds(): readonly FundingRound[] {
  return Object.freeze([
    // Thresholds solved by tools/economy/simulate.mjs (Seed $75k anchor; time targets 30m/2h/5h/10h/20h with
    // the flat per-stage burn folded in). Founder 06:2x: Seed raised so a single ≤⅓-Seed angel can't reach it.
    { id: 'bootstrapping', label: 'Bootstrapping', stars: 0, thresholdCents: '0', headline: 'Stealth startup confirms it has a name.' },
    { id: 'seed', label: 'Seed', stars: 1, thresholdCents: '7500000', headline: 'Investors describe spreadsheet as a platform.' },
    { id: 'series-a', label: 'Series A', stars: 2, thresholdCents: '69841638', headline: SERIES_HEADLINES[0]!.replace('{letter}', 'A') },
    { id: 'series-b', label: 'Series B', stars: 3, thresholdCents: '258591292', headline: SERIES_HEADLINES[1]!.replace('{letter}', 'B') },
    { id: 'series-c', label: 'Series C', stars: 4, thresholdCents: '635674447', headline: SERIES_HEADLINES[2]!.replace('{letter}', 'C') },
    { id: 'series-d', label: 'Decacorn', stars: 5, thresholdCents: '1445824715', headline: 'Series D — "Decacorn" status, the top of the ladder.' },
  ]);
}
/** Base event payouts per kind. v2: large ($200k–$1M). economy-v3: the simulator's solved values (Seed $75k
 *  anchor) so events pay four–five figures and progression is time-gated (community $2.3k / demo $5.7k /
 *  investor $11.3k). */
const FUNDING_BASE_CENTS_V2: Readonly<Record<FundingKind, bigint>> = Object.freeze({
  investor: 100_000_000n, demo: 50_000_000n, community: 20_000_000n,
});
/** v3 review (docs/economy/v3-review.md): simulate.mjs averages events over the whole 49 km² bbox, but the
 *  real venues cluster around the Ferry spawn, so a CASUAL player (tools/economy/first-hour.mts) reached Seed
 *  in ~14 min (target 30) and Series A in ~52 min (target 2 h). Bases are 40% of the simulate.mjs solve
 *  ($4.5k/$2.3k/$904), which puts a casual player's Seed at ~28 min; thresholds and burn are unchanged. */
export const FUNDING_BASE_CENTS_V3: Readonly<Record<FundingKind, bigint>> = Object.freeze({
  investor: 452_100n, demo: 226_050n, community: 90_420n,
});
/** Economy-v3 flat idle burn, cents/MINUTE, per star (founder 06:3x). ★0 Bootstrapping never burns. Each
 *  star Seed..Decacorn has its own flat rate, calibrated by simulate.mjs to ~10% of that stage's earning
 *  rate, capped so an idle 24h loses ≤25% of the band (gentle — several idle days to drop a round), rising
 *  with stage. Keyed by round id; absent/0 ⇒ no burn. NOT a function of round size. */
export const ECON_V3_BURN_PER_MIN_CENTS: Readonly<Record<string, bigint>> = Object.freeze({
  seed: 10_823n, 'series-a': 32_769n, 'series-b': 65_466n, 'series-c': 140_651n, 'series-d': 140_651n,
});
/** The economy-v3 ladder, exported for direct testing/tooling regardless of the flag. */
export const ECON_V3_ROUNDS: readonly FundingRound[] = buildEconomyV3Rounds();
/** The legacy v2 ladder, kept exported so the rescale migration can map v2→v3 even once the flag is on. */
export const FUNDING_ROUNDS_V2: readonly FundingRound[] = buildFundingRounds();
/** The active ladder + base, selected once at module load by flags.economyV3 (PLAN-economy-v3 decisions
 *  1 + 3). Flag OFF keeps the v2 Pre-seed→Hectocorn ladder and large payouts unchanged. */
export const FUNDING_ROUNDS: readonly FundingRound[] = flags.economyV3 ? ECON_V3_ROUNDS : FUNDING_ROUNDS_V2;
export const FUNDING_BASE_CENTS: Readonly<Record<FundingKind, bigint>> = flags.economyV3 ? FUNDING_BASE_CENTS_V3 : FUNDING_BASE_CENTS_V2;
/** The threshold of the round immediately BEFORE `roundId` in `rounds`, or 0n when it is the first round or
 *  absent. A scripted round floor (founderSeedFloor / founderSeriesAFloor) requires the player to have reached
 *  this prior threshold before it tops the cheque up, so a pitch made out of order can't skip rungs (e.g. a
 *  brand-new founder pitching the Demo Day house can't be floored straight to Series A). Economy-aware: in
 *  economy-v3 Seed's prior is Bootstrapping (0 ⇒ no gate, since Seed is the first funded round), while Series A's
 *  prior is Seed; in v2 Seed's prior is Pre-seed and Series A's is Seed. */
export function priorRoundThresholdCents(rounds: readonly FundingRound[], roundId: string): bigint {
  const i = rounds.findIndex(round => round.id === roundId);
  return i > 0 ? BigInt(rounds[i - 1]!.thresholdCents) : 0n;
}
/** How long (minutes of idle burn) a scripted round-floor cheque should keep the player ABOVE the round
 *  threshold after it closes, so "Seed closed" doesn't instantly undo. Tunable (founder). */
export const ROUND_FLOOR_GRACE_MIN = 60n;
/** The grace margin (cents) a scripted round floor should add ON TOP of a round threshold so economy-v3 idle
 *  burn doesn't drop the player back below it within ~1 s. Without it the Seed floor lands on EXACTLY the Seed
 *  threshold (7,500,000¢) and the next burn tick reverts the current-derived round/pill/HUD to Bootstrapping
 *  (the leaderboard/nameplate, being lifetime-derived, stay Seed — so the player's own HUD disagrees). Equals
 *  ROUND_FLOOR_GRACE_MIN × the round's idle burn rate; 0 when there is no burn (v2, or a non-burning round),
 *  so it is a no-op outside economy-v3. */
export function roundFloorGraceCents(roundId: string): bigint {
  const burnPerMin = flags.economyV3 ? (ECON_V3_BURN_PER_MIN_CENTS[roundId] ?? 0n) : 0n;
  return burnPerMin * ROUND_FLOOR_GRACE_MIN;
}
export interface FundingProfile {
  deviceId: string; startupName: string; nickname: string;
  /** Public cosmetic marker only; present when email capture is enabled. */
  verifiedFounder?: boolean;
  totalCents: string; todayCents: string; round: FundingRound;
  rank: number | null; todayRank: number | null; lastAwardAt: number | null; streak: number;
  // Economy v3 only (undefined on the v2 path): totalCents carries CURRENT (burned) funding and round is
  // fundingRound(current); lifetimeCents is cumulative raised (= ledger SUM, what the cap table shows);
  // burnPerSecCents is the live idle drain at the current stage (HUD runway).
  currentCents?: string; lifetimeCents?: string; burnPerSecCents?: string;
}
export interface FundingLeader extends FundingProfile { live: boolean }
export interface FundingLeaderboard { week: FundingLeader[]; today: FundingLeader[]; you: FundingProfile; serverNow: number;
  /** Economy v3 only: top 50 by CURRENT (burned) funding; `week` stays the lifetime board (decision 5). */
  current?: FundingLeader[] }
export interface FundingQuote {
  kind: FundingKind; baseCents: string; timing: FundingTiming; timeMultiplier: number;
  crowdCount: number; crowdMultiplier: number; streakCount: number; streakMultiplier: number;
  /** This quote was lifted to the upcoming rate because the event is a not-yet-happened preview (see quoteFunding). */
  preview: boolean; amountCents: string;
}
export interface FundingAward extends FundingQuote {
  id: string; eventId: string; eventTitle: string; awardedAt: number; day: string;
  previousRound: FundingRound; profile: FundingProfile;
  /** Set for v2 cap-table credits (drive-through events, VC drops, celebrity angels, warm intros). */
  source?: FundingSource;
}
export interface FundingRoom {
  eventId: string; title: string; anchor: { x: number; y: number; z: number }; radiusM: number;
  approx: boolean; startedAt: number; finishesAt: number; quote: FundingQuote;
}
export interface FundingStatus {
  state: 'idle' | 'working' | 'awarded' | 'cancelled' | 'already-awarded';
  serverNow: number; profile: FundingProfile; room: FundingRoom | null; award: FundingAward | null; reason?: string;
}

export function fundingKind(event: Pick<FundingEvent, 'title' | 'host' | 'tags'>): FundingKind {
  const text = `${event.host ?? ''} ${event.title} ${(event.tags ?? []).join(' ')}`;
  if (/\b(vc|vcs|venture(?:s| capital)?|investors?|investing|investments?|fundraising|angel(?:s| investing)?)\b/i.test(text)
    || /\bcapital\b/i.test(event.host ?? '')) return 'investor';
  if (/\b(demo(?:s|scene)?|pitch(?:es|ing)?|showcase)\b/i.test(text)) return 'demo';
  return 'community';
}
export function fundingTiming(event: Pick<FundingEvent, 'start' | 'end'>, serverNow: number): FundingTiming {
  if (!Number.isFinite(serverNow)) throw new RangeError('Invalid server clock');
  const start = Date.parse(event.start), end = event.end ? Date.parse(event.end) : NaN;
  if (!Number.isFinite(start)) throw new RangeError('Invalid event start');
  // A missing end is not a made-up real event window.
  if (Number.isFinite(end) && end > start && serverNow >= start && serverNow < end) return 'live';
  return serverNow < start && start - serverNow <= 2 * 60 * 60_000 ? 'upcoming' : 'follow-up';
}
/** Pre-Tech-Week preview lull (gtasf-v2-preview-funding-rate): fewer than 30 events live or starting in
 *  the next 24h, mirroring the radar's venue fallback. When true, future preview events quote at the
 *  upcoming rate (see quoteFunding's `preview` arg) instead of the x0.5 "missed it" rate. Both the worker
 *  payout and the client display call this so what you see matches what you are paid. */
export const PREVIEW_FOCUS_MS = 24 * 60 * 60_000;
export const PREVIEW_MIN_NEAR = 30;
export function isPreviewLull(events: readonly Pick<FundingEvent, 'start' | 'end'>[], serverNow: number): boolean {
  if (!Number.isFinite(serverNow)) return false;
  const soon = serverNow + PREVIEW_FOCUS_MS;
  let near = 0;
  for (const event of events) {
    const start = Date.parse(event.start), end = event.end ? Date.parse(event.end) : NaN;
    const live = Number.isFinite(end) && end > start && serverNow >= start && serverNow < end;
    if (live || (start >= serverNow && start <= soon)) { if (++near >= PREVIEW_MIN_NEAR) return false; }
  }
  return true;
}
export function nextFundingStreak(previous: { eventId: string; at: number; count: number } | null, eventId: string, serverNow: number): number {
  return previous && previous.eventId !== eventId && serverNow >= previous.at && serverNow - previous.at <= STREAK_WINDOW_MS
    ? Math.min(5, Math.max(1, Math.floor(previous.count)) + 1) : 1;
}
/** Time is fixed when the server accepts room entry; crowd/streak are measured at completion. */
export function quoteFunding(event: FundingEvent, enteredAt: number, otherDevices: number, streakCount: number, preview = false): FundingQuote {
  if (!Number.isSafeInteger(otherDevices) || otherDevices < 0 || !Number.isSafeInteger(streakCount) || streakCount < 1)
    throw new RangeError('Invalid funding attendance');
  const kind = fundingKind(event), base = FUNDING_BASE_CENTS[kind], rawTiming = fundingTiming(event, enteredAt);
  // A preview event (shown via the pre-Tech-Week fallback) has not happened yet, so it is "early", not
  // "missed": pay it the upcoming rate without widening the deliberate 2h upcoming window. gtasf-v2-preview-funding-rate.
  const early = preview && rawTiming === 'follow-up' && Date.parse(event.start) > enteredAt;
  const timing: FundingTiming = early ? 'upcoming' : rawTiming;
  const timeNumerator = timing === 'live' ? 6 : timing === 'upcoming' ? 3 : 1;
  const crowdCount = Math.min(10, otherDevices), streak = Math.min(5, streakCount), streakNumerator = 3 + streak;
  const cents = base * BigInt(timeNumerator) * BigInt(10 + crowdCount) * BigInt(streakNumerator) / 80n;
  return { kind, baseCents: base.toString(), timing, timeMultiplier: timeNumerator / 2,
    crowdCount, crowdMultiplier: (10 + crowdCount) / 10, streakCount: streak, streakMultiplier: streakNumerator / 4,
    preview: early, amountCents: cents.toString() };
}
const SF_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
export function fundingDay(serverNow: number): string {
  const parts = SF_DAY.formatToParts(serverNow), part = (name: string) => parts.find(value => value.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function fundingCents(value: string): bigint {
  if (!/^(0|[1-9]\d{0,15})$/.test(value)) throw new RangeError('Invalid funding cents');
  const result = BigInt(value); if (result > FUNDING_MAX_CENTS) throw new RangeError('Funding limit exceeded'); return result;
}
export function fundingRound(cents: string | bigint): FundingRound {
  const total = typeof cents === 'bigint' ? fundingCents(cents.toString()) : fundingCents(cents);
  return [...FUNDING_ROUNDS].reverse().find(round => total >= BigInt(round.thresholdCents))!;
}
/** [min threshold at this star, min threshold at the next-higher star) for each star in a ladder. */
function starBands(rounds: readonly FundingRound[]): Map<number, [bigint, bigint]> {
  const minByStar = new Map<number, bigint>();
  for (const r of rounds) { const c = BigInt(r.thresholdCents), cur = minByStar.get(r.stars); if (cur === undefined || c < cur) minByStar.set(r.stars, c); }
  const stars = [...minByStar.keys()].sort((a, b) => a - b), bands = new Map<number, [bigint, bigint]>();
  for (let i = 0; i < stars.length; i++) bands.set(stars[i]!, [minByStar.get(stars[i]!)!, i + 1 < stars.length ? minByStar.get(stars[i + 1]!)! : FUNDING_MAX_CENTS]);
  return bands;
}
const V2_STAR_BANDS = starBands(FUNDING_ROUNDS_V2), V3_STAR_BANDS = starBands(ECON_V3_ROUNDS);
/**
 * Map a v2 funding total to the economy-v3 scale for the one-time rescale migration (PLAN-economy-v3
 * decision 7): proportional WITHIN the player's star band, so (a) their star is preserved — a v2 round
 * maps to the v3 round with the SAME star, nobody jumps to max stars — and (b) relative order is kept
 * (strictly monotonic non-decreasing). bigint-exact; never below the band floor or at/above its ceiling.
 */
export function rescaleV2ToV3Cents(v2TotalCents: string | bigint): bigint {
  const total = typeof v2TotalCents === 'bigint' ? v2TotalCents : fundingCents(v2TotalCents);
  if (total <= 0n) return 0n;
  const star = [...FUNDING_ROUNDS_V2].reverse().find(round => total >= BigInt(round.thresholdCents))!.stars;
  const [lo2, hi2] = V2_STAR_BANDS.get(star)!, [lo3, hi3] = V3_STAR_BANDS.get(star)!;
  const span2 = hi2 - lo2 > 0n ? hi2 - lo2 : 1n, pos = total - lo2 < 0n ? 0n : total - lo2;
  const mapped = lo3 + pos * (hi3 - lo3) / span2;
  return mapped < lo3 ? lo3 : mapped >= hi3 ? hi3 - 1n : mapped; // clamp inside the star's v3 band
}
/** Economy-v3 idle burn (PLAN-economy-v3 decision 4, founder 06:3x — FLAT per-stage $/min, replacing the
 *  old one-round-per-24h band-rate). Each star Seed..Decacorn drains at its own flat ECON_V3_BURN_PER_MIN_CENTS
 *  rate (NOT a function of round size); ★0 Bootstrapping (below the Seed threshold) never burns. Founder 09:2x: Seed is NOT a floor —
 *  Seed burn can demote a player to ★0 (a down round); ★0 then stops, so funding never goes negative. Calibrated by simulate.mjs so an
 *  idle 24h loses ≤25% of the band (gentle: several idle days to drop a round). Lazy, monotonic (never raises
 *  current, never below 0), computed from elapsed seconds since the last update — never ticked per player.
 *  Returns the new current, the live per-MINUTE burn at the resulting stage (HUD shows it as −$X/min), and how
 *  many round boundaries were crossed down. Economy-v3 only; the caller keeps current ≤ lifetime. */
export function applyEconomyV3Burn(currentCents: string | bigint, elapsedSeconds: number): { currentCents: bigint; burnPerMinCents: bigint; downRounds: number } {
  let cur = typeof currentCents === 'bigint' ? currentCents : fundingCents(currentCents);
  if (cur < 0n) cur = 0n;
  const thr = ECON_V3_ROUNDS.map(round => BigInt(round.thresholdCents)); // ascending [0, Seed, A, B, C, D]
  const N = thr.length, seedFloor = thr[1]!; // below Seed = ★0 Bootstrapping, which never burns
  const rateAt = (c: bigint): bigint => { // flat cents/min at c's stage; 0 below Seed (★0)
    if (c < seedFloor) return 0n;
    let i = 1; for (let k = 1; k < N; k++) if (c >= thr[k]!) i = k;
    return ECON_V3_BURN_PER_MIN_CENTS[ECON_V3_ROUNDS[i]!.id] ?? 0n;
  };
  let remaining = Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 ? Math.floor(elapsedSeconds) : 0;
  let downRounds = 0, guard = N + 4;
  while (remaining > 0 && cur >= seedFloor && guard-- > 0) {
    let i = 1; for (let k = 1; k < N; k++) if (cur >= thr[k]!) i = k; // current band [thr[i], thr[i+1)), star i
    const ratePerMin = ECON_V3_BURN_PER_MIN_CENTS[ECON_V3_ROUNDS[i]!.id] ?? 0n;
    if (ratePerMin <= 0n) break;
    const floor = thr[i]!; // band lower bound (reach-star-i threshold); for i===1 this is Seed (hard floor)
    const secsToFloor = Number((cur - floor) * 60n / ratePerMin);
    if (secsToFloor >= remaining) { cur -= ratePerMin * BigInt(remaining) / 60n; remaining = 0; }
    else { cur = floor - 1n; remaining -= secsToFloor + 1; downRounds++; } // crossed down into star i-1 (Seed → ★0 too; ★0 then stops)
  }
  if (cur < 0n) cur = 0n;
  return { currentCents: cur, burnPerMinCents: rateAt(cur), downRounds };
}
/** Economy reset epoch (founder 12:0x). Bumping it resets every profile below it exactly once more, lazily on
 *  first read (worker resetDeviceToEconomyV3). 1 = the morning econ-v3 enable reset; 2 = the 12:0x reset; 3 = the 14:0x reset (balances paid at v2 sizes 12:27–13:35). */
export const ECONOMY_RESET_EPOCH = 3;
/** Robotaxi quick travel (docs/engineering/quick-robotaxi.md): the first ROBOTAXI_FREE_RIDES rides per profile are free. */
export const ROBOTAXI_FREE_RIDES = 3;
/** Robotaxi fare: $100 flag-fall + $150/km over the pickup→drop distance, rounded to the nearest $10. */
export function robotaxiFareCents(distanceM: number): bigint {
  const metres = Number.isFinite(distanceM) && distanceM > 0 ? distanceM : 0;
  return BigInt(Math.round((10_000 + 15_000 * metres / 1000) / 1000)) * 1000n;
}
export function fundingPerks(cents: string): FundingPerk[] {
  const stars = fundingRound(cents).stars;
  return [...(stars >= 1 ? ['nicer-car' as const] : []), ...(stars >= 2 ? ['building-name' as const] : []), ...(stars >= 3 ? ['party-marker' as const] : [])];
}
export function formatFunding(cents: string): string {
  const dollars = fundingCents(cents) / 100n;
  // Scales to T so top-of-ladder amounts (Hectocorn $100B+ and the grinders beyond) read as e.g. $1T, not $1000B.
  for (const [unit, suffix] of [[1_000_000_000_000n, 'T'], [1_000_000_000n, 'B'], [1_000_000n, 'M'], [1_000n, 'k']] as const) {
    if (dollars >= unit) { const tenth = dollars * 10n / unit; return `$${tenth / 10n}${tenth % 10n ? `.${tenth % 10n}` : ''}${suffix}`; }
  }
  return `$${dollars}`;
}
export function normalizeFundingName(value: unknown, kind: 'startup' | 'nickname'): string {
  if (typeof value !== 'string' || value.length > 256) throw new RangeError('Enter a valid name');
  // Saved nicknames become World HELLO names on reload; use its canonical wire contract.
  const clean = kind === 'nickname' ? normalizeNickname(value)
    : value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, '').replace(/\s+/g, ' ').trim();
  if (clean === null) throw new RangeError('Choose a shorter nickname without unsupported characters');
  const length = [...clean].length, max = kind === 'startup' ? 48 : 24;
  if (length < 2 || length > max) throw new RangeError(`${kind === 'startup' ? 'Startup' : 'Nickname'} must be 2–${max} characters`);
  return clean;
}
