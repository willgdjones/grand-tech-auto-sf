import { DRIVE_THROUGH_HEIGHT_M, DRIVE_THROUGH_RADIUS_M, FUNDING_ROUNDS, ROOM_DURATION_MS, ROOM_HEIGHT_M, ROOM_RADIUS_M, isPreviewLull, nextFundingStreak, quoteFunding,
  type FundingAward, type FundingProfile, type FundingQuote, type FundingRound, type FundingRoom, type FundingStatus, type FundingSource } from '@gtasf/shared/funding';
import { flags } from '@gtasf/shared/flags';
import { founderRankFor } from '../founder/rankQuery';
import type { Pose } from '@gtasf/shared/protocol/types';
import type { Env } from '../env';
import { listEvents } from '../events/store';
import type { TechWeekEvent } from '../events/types';
import { smallJson } from '../world/admission/http';
import { PASSENGER_FLAG } from '../world/vehicles';
import { fundingAnchor, project, type FundingAnchor, type FundingAnchorResolver } from './anchors';
import { fundingDevice, fundingSameOrigin } from './identity';
import { fundingJson } from './routes';
import { fundingAlreadyAwarded, fundingDeviceByNickname, fundingLeaderboard, fundingSummariesByNickname, FUNDING_SUMMARY_MAX, getFundingProfile, previousFundingAward, recordFundingAward, saveFundingNames } from './store';
import { alreadyCredited, creditAward, creditedRefs, getCapTable, recordFundingCredit, type FundingCreditResult } from './credits';
import { celebById, celebChequeCents, celebLabel } from '@gtasf/shared/content/celebs';
import { FundingPartiesState } from './parties';
import { orientationCredit, orientationQualifies } from './orientation';
import { resetDeviceToEconomyV3 } from './economyV3';
import { eventVisibilityWindowEnd, eventVisibleIn, venueBuckets, venueCentroid } from '@gtasf/shared/eventVisibility';
import { quoteRide } from './rides';

export interface FundingPeer { id: number; deviceId?: string; pose: Pose; onFoot: boolean }
interface ActiveRoom { room: FundingRoom; event: TechWeekEvent; playerId: number; settling: boolean }
/** Grid cell for drive-through spatial lookup; must be >= the checkpoint radius so a 3×3 scan is exhaustive. */
const DRIVE_CELL_M = 30;
/** Server-side pitch tolerance around a hidden angel's spot (economy v3). */
const CELEB_PITCH_SERVER_M = 30;
interface AnchoredEvent { event: TechWeekEvent; anchor: FundingAnchor }
/** Credit payout fields a drop/celebrity pane supplies; the device, clock and toast come from WorldFunding. */
export type FundingAwardInput = { source: FundingSource; sourceRef: string; label: string; amountCents: bigint | string; metaJson?: string; allowUnnamed?: boolean };

/** All clock/position/attendance inputs come from WorldDO; HTTP accepts only an event ID. */
export class WorldFunding {
  private readonly parties = new FundingPartiesState();
  private readonly active = new Map<string, ActiveRoom>();
  private readonly results = new Map<string, { at: number; value: FundingStatus }>();
  private readonly profiles = new Map<string, { at: number; value: FundingProfile; identityRevision: number }>();
  private readonly movementRefreshes = new Map<string, number>();
  private readonly movementLoading = new Set<string>();
  private identityRevision = 0;
  private readonly budgets = new Map<string, { at: number; credit: number }>();
  private events: Map<string, TechWeekEvent> | null = null;
  private eventsAt = 0;
  private eventLoad?: Promise<void>;
  // Preview lull: when fewer than PREVIEW_MIN_NEAR events are live/starting within the next 24h (the
  // same fallback the radar uses before Tech Week), future events shown as previews pay the upcoming
  // rate instead of the x0.5 "missed it" rate. Mirrors venues MIN_FOCUS_EVENTS/FOCUS_WINDOW_MS.
  private previewMode = false;
  private visibleWindow: { at: number; end: number } | null = null;
  private readonly anchors = new Map<string, ReturnType<typeof fundingAnchor>>();
  private sweptAt = 0;
  // Drive-through state (PLAN-v2 decision 1), active only when flags.driveThroughFunding.
  private driveIndex: Map<string, AnchoredEvent[]> | null = null;
  private driveIndexAt = 0;
  private driveIndexLoading?: Promise<void>;
  private readonly creditedEvents = new Map<string, Set<string>>();
  private readonly creditedLoading = new Set<string>();
  private readonly crediting = new Set<string>();
  private readonly lastEventCredit = new Map<string, { eventId: string; at: number; count: number }>();
  // Founder Orientation (onboarding tutorial): devices already paid / mid-credit, so the ring pays once.
  private readonly orientationDone = new Set<string>();
  private readonly orientationPending = new Set<string>();
  constructor(private readonly env: Pick<Env, 'DB'>, private readonly peers: () => Iterable<FundingPeer>,
    private readonly retain: (work: Promise<unknown>) => void,
    private readonly onIdentitySaved?: (profile: FundingProfile) => void,
    private readonly anchorForEvent: FundingAnchorResolver = fundingAnchor) {}

  private cacheProfile(value: FundingProfile, now: number, readRevision: number): FundingProfile {
    const current = this.profiles.get(value.deviceId);
    // An older status/award read cannot undo a profile save that completed while it awaited D1.
    if (current && current.identityRevision > readRevision)
      value = { ...value, startupName: current.value.startupName, nickname: current.value.nickname };
    this.profiles.set(value.deviceId, { at: now, value, identityRevision: current?.identityRevision ?? 0 });
    return value;
  }

  profileForConnection(deviceId: string): Promise<FundingProfile> {
    return this.profile(deviceId, Date.now());
  }

  /** MOVE stays synchronous; only the verified connection's D1 profile grants ride tiers. */
  roundForMovement(deviceId: string | undefined, now: number): FundingRound {
    if (!deviceId) return FUNDING_ROUNDS[0]!;
    const cached = this.profiles.get(deviceId);
    if ((!cached || now - cached.at >= 5000) && !this.movementLoading.has(deviceId) &&
      now - (this.movementRefreshes.get(deviceId) ?? -Infinity) >= 5000) {
      // Coalesce 10 Hz MOVE reads, including after hibernation, and bound retries if D1 is down.
      this.movementRefreshes.set(deviceId, now);
      this.movementLoading.add(deviceId);
      this.retain(this.profile(deviceId, now).catch(() => undefined).finally(() => this.movementLoading.delete(deviceId)));
    }
    return cached?.value.round ?? FUNDING_ROUNDS[0]!;
  }

  private async profile(deviceId: string, now: number, fresh = false): Promise<FundingProfile> {
    const cached = this.profiles.get(deviceId);
    if (!fresh && cached && now - cached.at < 5000) return cached.value;
    const revision = this.identityRevision;
    return this.cacheProfile(await getFundingProfile(this.env.DB, deviceId, now), now, revision);
  }
  private async ensureEvents(): Promise<Map<string, TechWeekEvent>> {
    if (!this.events || Date.now() - this.eventsAt > 5 * 60_000) {
      this.eventLoad ??= listEvents(this.env.DB).then(events => {
        this.events = new Map(events.map(event => [event.id, event])); this.anchors.clear(); this.driveIndex = null; this.eventsAt = Date.now();
        this.previewMode = isPreviewLull(events, this.eventsAt);
      }).finally(() => { this.eventLoad = undefined; });
      await this.eventLoad;
    }
    return this.events ?? new Map();
  }
  private async event(id: string): Promise<{ event: TechWeekEvent; anchor: NonNullable<ReturnType<typeof fundingAnchor>> }> {
    await this.ensureEvents();
    const event = this.events?.get(id);
    if (!event) throw new RangeError('Event unavailable');
    if (!this.anchors.has(id)) this.anchors.set(id, this.anchorForEvent(event));
    const anchor = this.anchors.get(id);
    if (!anchor) throw new RangeError('This event is outside the current playable road area');
    return { event, anchor };
  }
  private inside(peer: FundingPeer, room: FundingRoom): boolean {
    return peer.onFoot && Math.hypot(peer.pose.x / 100 - room.anchor.x, peer.pose.z / 100 - room.anchor.z) <= room.radiusM
      && Math.abs(peer.pose.y / 100 - room.anchor.y) <= ROOM_HEIGHT_M;
  }
  private attendee(deviceId: string, active: ActiveRoom): FundingPeer | undefined {
    return [...this.peers()].find(peer => peer.deviceId === deviceId && peer.id === active.playerId && this.inside(peer, active.room));
  }
  private crowd(deviceId: string, room: FundingRoom): number {
    return new Set([...this.peers()].filter(peer => peer.deviceId && peer.deviceId !== deviceId && this.inside(peer, room)).map(peer => peer.deviceId!)).size;
  }
  private cancel(deviceId: string, reason: string, now: number): void {
    const active = this.active.get(deviceId); if (!active || active.settling) return;
    this.active.delete(deviceId);
    const profile = this.profiles.get(deviceId)?.value;
    if (profile) this.results.set(deviceId, { at: now, value: { state: 'cancelled', serverNow: now, profile, room: null, award: null, reason } });
  }
  /** Called immediately on accepted movement/mode change, in addition to the 10 Hz clock. */
  presenceChanged(playerId: number, now: number): void {
    for (const [deviceId, active] of this.active) if (active.playerId === playerId && !active.settling && !this.attendee(deviceId, active))
      this.cancel(deviceId, 'You left the room. Stay in the marker for 20 seconds.', now);
  }
  disconnect(playerId: number, now: number): void {
    for (const [deviceId, active] of this.active) if (active.playerId === playerId) this.cancel(deviceId, 'Connection lost. Re-enter the room to start again.', now);
  }
  tick(now: number): void {
    if (flags.driveThroughFunding) this.driveThrough(now);
    if (flags.onboarding) this.orientation(now);
    for (const [deviceId, active] of this.active) {
      if (active.settling) continue;
      if (!this.attendee(deviceId, active)) { this.cancel(deviceId, 'You left the room. Stay in the marker for 20 seconds.', now); continue; }
      if (now >= active.room.finishesAt) {
        // Once twenty continuous seconds are observed, later movement cannot revoke the earned award.
        active.settling = true;
        const crowd = this.crowd(deviceId, active.room);
        this.retain(this.complete(deviceId, active, crowd, now));
      }
    }
    if (now - this.sweptAt > 60_000) {
      this.sweptAt = now;
      const connected = new Set([...this.peers()].flatMap(peer => peer.deviceId ? [peer.deviceId] : []));
      for (const [id, value] of this.results) if (now - value.at > 10 * 60_000) this.results.delete(id);
      for (const [id, value] of this.profiles) if (!this.active.has(id) && now - value.at > 10 * 60_000) this.profiles.delete(id);
      for (const [id, at] of this.movementRefreshes) if (now - at > 10 * 60_000) this.movementRefreshes.delete(id);
      for (const [id, value] of this.budgets) if (now - value.at > 10 * 60_000) this.budgets.delete(id);
      // Drive-through caches reload cheaply on reconnect; drop them for departed devices.
      for (const id of this.creditedEvents.keys()) if (!connected.has(id)) this.creditedEvents.delete(id);
      for (const [id, value] of this.lastEventCredit) if (!connected.has(id) && now - value.at > 10 * 60_000) this.lastEventCredit.delete(id);
    }
  }
  private async complete(deviceId: string, active: ActiveRoom, crowd: number, now: number): Promise<void> {
    const revision = this.identityRevision;
    try {
      const previous = await previousFundingAward(this.env.DB, deviceId);
      const quote = quoteFunding(active.event, active.room.startedAt, crowd, nextFundingStreak(previous, active.event.id, now));
      const result = await recordFundingAward(this.env.DB, { deviceId, eventId: active.event.id, eventTitle: active.event.title,
        enteredAt: active.room.startedAt, now, quote });
      const profile = this.cacheProfile(result.award.profile, now, revision); result.award.profile = profile;
      this.results.set(deviceId, { at: now, value: { state: result.credited ? 'awarded' : 'already-awarded', serverNow: now,
        profile, room: null, award: result.credited ? result.award : null, ...(!result.credited ? { reason: 'This event already paid you today.' } : {}) } });
    } catch {
      const profile = this.profiles.get(deviceId)?.value;
      if (profile) this.results.set(deviceId, { at: now, value: { state: 'cancelled', serverNow: now, profile, room: null, award: null,
        reason: 'Funding is temporarily unavailable. Re-enter the room to retry.' } });
    } finally { if (this.active.get(deviceId) === active) this.active.delete(deviceId); }
  }
  private crowdAt(deviceId: string, anchor: FundingAnchor, radiusM: number): number {
    return new Set([...this.peers()].filter(peer => peer.deviceId && peer.deviceId !== deviceId
      && Math.hypot(peer.pose.x / 100 - anchor.x, peer.pose.z / 100 - anchor.z) <= radiusM
      && Math.abs(peer.pose.y / 100 - anchor.y) <= DRIVE_THROUGH_HEIGHT_M).map(peer => peer.deviceId!)).size;
  }
  /** Rebuild the drive-through spatial grid from the current event set; retained, never awaited in tick. */
  private ensureDriveIndex(): void {
    if (this.driveIndexLoading) return;
    this.driveIndexLoading = this.ensureEvents().then(events => {
      const grid = new Map<string, AnchoredEvent[]>();
      // One ring per VENUE, exactly as the client draws it (shared venueKey + centroid, same road snap), and
      // every event at that venue pays when you pass through it. Per-event anchors used to land up to 100 m
      // from the visible ring for neighbourhood-level venues (founder 12:5x "can't walk through some circles").
      for (const bucket of venueBuckets([...events.values()]).values()) {
        const anchor = this.anchorForEvent(venueCentroid(bucket)); if (!anchor) continue;
        const key = `${Math.floor(anchor.x / DRIVE_CELL_M)}:${Math.floor(anchor.z / DRIVE_CELL_M)}`;
        const cellEvents = grid.get(key) ?? [];
        for (const event of bucket) { this.anchors.set(event.id, anchor); cellEvents.push({ event, anchor }); }
        grid.set(key, cellEvents);
      }
      this.driveIndex = grid; this.driveIndexAt = Date.now();
    }).catch(() => { /* Leave the previous index in place; retry on the next tick. */ })
      .finally(() => { this.driveIndexLoading = undefined; });
    this.retain(this.driveIndexLoading);
  }
  private ensureCredited(deviceId: string): void {
    if (this.creditedEvents.has(deviceId) || this.creditedLoading.has(deviceId)) return;
    this.creditedLoading.add(deviceId);
    // Economy v3: run the one-time reset BEFORE caching paid events, else a pre-reset load keeps the
    // wiped events marked paid in memory and they never pay again after the reset.
    const ready = flags.economyV3 ? resetDeviceToEconomyV3(this.env.DB, deviceId, Date.now()) : Promise.resolve();
    this.retain(ready.then(() => creditedRefs(this.env.DB, deviceId, 'event'))
      .then(set => { this.creditedEvents.set(deviceId, set); })
      .catch(() => { /* Retry next tick; the UNIQUE insert is the authoritative guard anyway. */ })
      .finally(() => { this.creditedLoading.delete(deviceId); }));
  }
  /** GTA checkpoint detection: any peer (on foot or driving) inside an event marker is paid once ever. */
  /** End of the visible-event window (shared with the client's markers): live, or starting before this.
   *  Cached 30 s; the window moves with time, so it is applied at payout time, never baked into the index. */
  private visibleWindowEnd(now: number): number {
    if (!this.visibleWindow || now - this.visibleWindow.at > 30_000) {
      this.visibleWindow = { at: now, end: eventVisibilityWindowEnd([...(this.events?.values() ?? [])], now, flags.eventFocus24h) };
    }
    return this.visibleWindow.end;
  }
  private driveThrough(now: number): void {
    if (!this.driveIndex) { this.ensureDriveIndex(); return; }
    if (now - this.driveIndexAt > 5 * 60_000) this.ensureDriveIndex();
    const windowEnd = this.visibleWindowEnd(now);
    for (const peer of this.peers()) {
      if (!peer.deviceId || this.crediting.has(peer.deviceId)) continue;
      // Mad-Max: robotaxi passengers earn nothing from rings while riding; crediting resumes on exit
      // (their pose flag clears). A self-driver is not a passenger, so driving still pays. (gtasf-jl6b)
      if ((flags.madMaxRobotaxi || flags.quickRobotaxi || flags.rideAnyVehicle) && (peer.pose.flags & PASSENGER_FLAG)) continue;
      // Unnamed players are paid too (gtasf founder bug, Oct 6): naming comes after the first payout
      // (post-first-payout identity screen), and a new device — e.g. the founder's phone — starts unnamed.
      const credited = this.creditedEvents.get(peer.deviceId);
      if (!credited) { this.ensureCredited(peer.deviceId); continue; }
      const px = peer.pose.x / 100, py = peer.pose.y / 100, pz = peer.pose.z / 100;
      const cx = Math.floor(px / DRIVE_CELL_M), cz = Math.floor(pz / DRIVE_CELL_M);
      // Collect every uncredited event this peer is inside this tick (a venue can host several).
      const hits: AnchoredEvent[] = [];
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const bucket = this.driveIndex.get(`${gx}:${gz}`); if (!bucket) continue;
        for (const { event, anchor } of bucket) {
          if (credited.has(event.id)) continue;
          if (!eventVisibleIn(event, now, windowEnd)) continue; // only pay for events the player can see
          if (Math.hypot(px - anchor.x, pz - anchor.z) > DRIVE_THROUGH_RADIUS_M || Math.abs(py - anchor.y) > DRIVE_THROUGH_HEIGHT_M) continue;
          hits.push({ event, anchor });
        }
      }
      if (hits.length) this.claimDriveThrough(peer.deviceId, hits, now);
    }
  }
  /** Founder Orientation: credit a driver passing through the tutorial ring once, ever (server pose). */
  private orientation(now: number): void {
    for (const peer of this.peers()) {
      const deviceId = peer.deviceId;
      if (!deviceId || this.orientationDone.has(deviceId) || this.orientationPending.has(deviceId) || !orientationQualifies(peer)) continue;
      this.orientationPending.add(deviceId);
      this.retain(this.credit(deviceId, orientationCredit(), now)
        .then(() => { this.orientationDone.add(deviceId); }) // credited now or already before: either way done
        .catch(() => { /* transient D1 error: retry while still inside the ring */ })
        .finally(() => { this.orientationPending.delete(deviceId); }));
    }
  }
  /** Pay for every event passed through this tick as one combined cheque + one "+$X · N events" toast. */
  private claimDriveThrough(deviceId: string, hits: readonly AnchoredEvent[], now: number): void {
    if (this.crediting.has(deviceId)) return;
    this.crediting.add(deviceId);
    const previous = this.lastEventCredit.get(deviceId) ?? null;
    // One streak step for the whole venue pass, shared across its events.
    const streak = nextFundingStreak(previous, hits[0]!.event.id, now);
    this.retain((async () => {
      const credited = this.creditedEvents.get(deviceId); if (!credited) return;
      let total = 0n, count = 0, anyLive = false, lastEventId = '', lastTitle = '';
      let lastResult: FundingCreditResult | null = null, lastQuote: FundingQuote | undefined, firstPrevRound: FundingRound | undefined;
      const windowEnd = this.visibleWindowEnd(now);
      for (const { event, anchor } of hits) {
        if (credited.has(event.id) || !eventVisibleIn(event, now, windowEnd)) continue;
        const quote = quoteFunding(event, now, this.crowdAt(deviceId, anchor, DRIVE_THROUGH_RADIUS_M), streak, this.previewMode);
        let result: FundingCreditResult;
        // Transient D1 error on one event: skip it; a later tick re-attempts while the peer is still inside.
        try { result = await this.recordCredit(deviceId, { source: 'event', sourceRef: event.id, label: event.title, amountCents: quote.amountCents, metaJson: JSON.stringify(quote), allowUnnamed: true }, now); }
        catch { continue; }
        credited.add(event.id);
        if (result.credited) {
          total += BigInt(result.credit.amountCents); count++;
          firstPrevRound ??= result.previousRound; lastResult = result; lastQuote = quote; lastEventId = event.id; lastTitle = event.title;
          if (quote.timing === 'live') anyLive = true;
        }
      }
      if (count > 0 && lastResult) {
        this.lastEventCredit.set(deviceId, { eventId: lastEventId, at: now, count: streak });
        const award: FundingAward = { ...creditAward(lastResult, now), amountCents: total.toString(), baseCents: total.toString(),
          eventId: lastEventId, eventTitle: count > 1 ? `${count} events` : lastTitle, source: 'event', kind: 'community',
          previousRound: firstPrevRound ?? lastResult.previousRound,
          timing: anyLive ? 'live' : 'follow-up', timeMultiplier: anyLive ? 3 : 0.5,
          crowdCount: 0, crowdMultiplier: 1, streakCount: streak, streakMultiplier: (3 + streak) / 4,
          // A single event has an exact quote. Keep its preview/timing, base,
          // kind and bonuses instead of replacing them with a venue summary.
          ...(count === 1 ? lastQuote : {}) };
        this.stashAward(deviceId, award, now);
      }
    })().finally(() => { this.crediting.delete(deviceId); }));
  }
  private async recordCredit(deviceId: string, input: FundingAwardInput, now: number): Promise<FundingCreditResult> {
    const revision = this.identityRevision;
    const result = await recordFundingCredit(this.env.DB, { deviceId, now, ...input });
    result.profile = this.cacheProfile(result.profile, now, revision);
    return result;
  }
  private stashAward(deviceId: string, award: FundingAward, now: number): void {
    this.results.set(deviceId, { at: now, value: { state: 'awarded', serverNow: now, profile: award.profile, room: null, award } });
  }
  /** Record a v2 credit, cache the profile, and surface a one-shot award toast through the status poll. */
  private async credit(deviceId: string, input: FundingAwardInput, now: number, toast?: (result: FundingCreditResult) => FundingAward): Promise<FundingCreditResult> {
    const result = await this.recordCredit(deviceId, input, now);
    if (result.credited) this.stashAward(deviceId, toast ? toast(result) : creditAward(result, now), now);
    return result;
  }
  /**
   * Shared payout API for other panes (VC fund drops, celebrity angels). Credits the cheque once ever,
   * updates the player's cap table/totals, and raises the award toast on their next status poll.
   */
  /** Refetch a player's funding after a robotaxi fare so the next status poll / HUD shows the debit. */
  async refreshAfterRide(deviceId: string, now = Date.now()): Promise<FundingProfile> {
    return this.profile(deviceId, now, true);
  }
  award(deviceId: string, input: FundingAwardInput, now = Date.now()): Promise<FundingCreditResult> {
    return this.credit(deviceId, input, now);
  }
  private async status(deviceId: string, now: number): Promise<FundingStatus> {
    const profile = await this.profile(deviceId, now), active = this.active.get(deviceId);
    if (active) {
      const quote = quoteFunding(active.event, active.room.startedAt, this.crowd(deviceId, active.room), active.room.quote.streakCount);
      return { state: 'working', serverNow: now, profile, room: { ...active.room, quote }, award: null };
    }
    const previous = this.results.get(deviceId)?.value;
    return previous ? { ...previous, profile, serverNow: now } : { state: 'idle', serverNow: now, profile, room: null, award: null };
  }
  async handle(request: Request): Promise<Response> {
    if (!fundingSameOrigin(request)) return fundingJson({ error: 'Same-origin request required' }, 403);
    try {
      const deviceId = await fundingDevice(request, this.env.DB);
      if (!deviceId) return fundingJson({ error: 'Start a funding session first' }, 401);
      const now = Date.now(), url = new URL(request.url), path = url.pathname;
      const budget = this.budgets.get(deviceId) ?? { at: now, credit: 12 };
      budget.credit = Math.min(12, budget.credit + Math.max(0, now - budget.at) / 200); budget.at = now; this.budgets.set(deviceId, budget);
      if (--budget.credit < 0) return fundingJson({ error: 'Please slow down' }, 429);
      this.tick(now);
      if (path === '/api/funding/leaderboard' && request.method === 'GET') {
        const live = new Set([...this.peers()].flatMap(peer => peer.deviceId ? [peer.deviceId] : []));
        return fundingJson(await fundingLeaderboard(this.env.DB, deviceId, now, live));
      }
      if (path === '/api/funding/status' && request.method === 'GET') return fundingJson(await this.status(deviceId, now));
      // Founder Rank (flag founderRank, critique #20): read-only XP/level from the device's own ledgers.
      if (path === '/api/funding/rank' && request.method === 'GET') {
        if (!flags.founderRank) return fundingJson({ error: 'Founder rank is disabled' }, 404);
        return fundingJson(await founderRankFor(this.env.DB, deviceId));
      }
      if (path === '/api/funding/captable' && request.method === 'GET') {
        if (!flags.capTable) return fundingJson({ error: 'Cap table is disabled' }, 503);
        const device = url.searchParams.get('device'), nick = url.searchParams.get('nick');
        if (device !== null && (device.length < 1 || device.length > 200)) return fundingJson({ error: 'Invalid player' }, 400);
        if (nick !== null && (nick.length < 1 || nick.length > 64)) return fundingJson({ error: 'Invalid player' }, 400);
        // "Click any player" (decision 5): an explicit deviceId wins; otherwise a nickname resolves to the
        // best-funded holder server-side (one request instead of summary->deviceId->captable); else self.
        let target = device ?? deviceId;
        if (device === null && nick !== null) {
          const resolved = await fundingDeviceByNickname(this.env.DB, nick, now);
          if (!resolved) return fundingJson({ error: 'That player has no cap table yet' }, 404);
          target = resolved;
        }
        try { return fundingJson(await getCapTable(this.env.DB, target, now)); }
        catch (error) { if (error instanceof RangeError) return fundingJson({ error: 'That player has no cap table yet' }, 404); throw error; }
      }
      if (path === '/api/funding/pitch' && request.method === 'GET') {
        if (!flags.celebNpcs) return fundingJson({ error: 'Celebrity pitches are disabled' }, 503);
        // gtasf-y5vc: real-person celebrities keep their one-tap pre-written pitch even under flags.pitching —
        // they are excluded from voice/AI pitching (pitch.ts pitchSpots), so there is no double-cheque risk.
        // Seed the client's once-ever set from authoritative credits (localStorage is dev-only).
        return fundingJson({ pitchedIds: [...await creditedRefs(this.env.DB, deviceId, 'celebrity')] });
      }
      if (path === '/api/funding/collected' && request.method === 'GET') {
        // Drive-through events the player has already been paid for (once-ever). Lets world markers
        // dim a ring that will no longer pay (PLAN-v2 decision 1, gtasf-ykbb). Source 'event' is the
        // drive-through ledger; the authoritative guard stays the funding_credits UNIQUE constraint.
        if (!flags.driveThroughFunding) return fundingJson({ error: 'Drive-through funding is disabled' }, 503);
        return fundingJson({ collectedEventIds: [...await creditedRefs(this.env.DB, deviceId, 'event')] });
      }
      if (path === '/api/funding/parties' && request.method === 'GET') return fundingJson(this.parties.snapshot(deviceId, [...this.peers()], now));
      if (path === '/api/funding/event' && request.method === 'GET') {
        const id = url.searchParams.get('id'); if (!id || id.length > 160) return fundingJson({ error: 'Event required' }, 400);
        const { event, anchor } = await this.event(id);
        const previous = await previousFundingAward(this.env.DB, deviceId);
        const alreadyAwarded = flags.driveThroughFunding
          ? await alreadyCredited(this.env.DB, deviceId, 'event', id) : await fundingAlreadyAwarded(this.env.DB, deviceId, id, now);
        return fundingJson({ eventId: id, title: event.title, anchor, radiusM: ROOM_RADIUS_M, approx: event.approx,
          quote: quoteFunding(event, now, 0, nextFundingStreak(previous, id, now)), alreadyAwarded });
      }
      if (request.method !== 'POST') return fundingJson({ error: 'Method not allowed' }, 405);
      const body = await smallJson(request);
      if (path === '/api/funding/robotaxi/quote') {
        // Quick robotaxi fare preview for the "Where to?" picker (docs/engineering/quick-robotaxi.md).
        if (!flags.quickRobotaxi) return fundingJson({ error: 'Quick robotaxi is disabled' }, 503);
        if (!body || Object.keys(body).some(key => key !== 'distanceM') || typeof body.distanceM !== 'number'
          || !Number.isFinite(body.distanceM) || body.distanceM < 0 || body.distanceM > 50_000)
          return fundingJson({ error: 'A distanceM is required' }, 400);
        return fundingJson(await quoteRide(this.env.DB, deviceId, body.distanceM, now));
      }
      if (path === '/api/funding/summary') {
        // Batched compact funding for overhead nameplates on peers OUTSIDE the top-50 leaderboard
        // (PLAN-v2 decision 6, gtasf-nameplate-funding-beyond-top50-zqnk). POST because it carries a
        // list of peer nicknames; it only reads public display fields.
        if (!flags.nameplates) return fundingJson({ error: 'Nameplates are disabled' }, 503);
        if (!body || Object.keys(body).some(key => key !== 'nicknames') || !Array.isArray(body.nicknames)
          || body.nicknames.length > FUNDING_SUMMARY_MAX || !body.nicknames.every(name => typeof name === 'string' && name.length <= 64))
          return fundingJson({ error: 'A nicknames array is required' }, 400);
        return fundingJson({ summaries: await fundingSummariesByNickname(this.env.DB, body.nicknames as string[], now), serverNow: now });
      }
      if (path === '/api/funding/profile') {
        if (!body || Object.keys(body).some(key => key !== 'startupName' && key !== 'nickname'))
          return fundingJson({ error: 'Startup name and nickname required' }, 400);
        const profile = await saveFundingNames(this.env.DB, deviceId, body.startupName, body.nickname, now);
        this.profiles.set(deviceId, { at: Date.now(), value: profile, identityRevision: ++this.identityRevision });
        this.onIdentitySaved?.(profile);
        return fundingJson(profile);
      }
      if (path === '/api/funding/parties') {
        if (!body || Object.keys(body).length !== 1 || typeof body.hosting !== 'boolean') return fundingJson({ error: 'Only a hosting choice is accepted' }, 400);
        const profile = await this.profile(deviceId, now, true), peers = [...this.peers()];
        this.parties.set(profile, body.hosting, peers, Date.now());
        return fundingJson(this.parties.snapshot(deviceId, peers, Date.now()));
      }
      if (path === '/api/funding/cancel') {
        if (!body || Object.keys(body).length) return fundingJson({ error: 'Invalid cancellation' }, 400);
        this.cancel(deviceId, 'You left the room. Stay in the marker for 20 seconds.', Date.now());
        return fundingJson(await this.status(deviceId, Date.now()));
      }
      if (path === '/api/funding/pitch') {
        if (!flags.celebNpcs) return fundingJson({ error: 'Celebrity pitches are disabled' }, 503);
        if (!body || Object.keys(body).some(key => key !== 'celebId') || typeof body.celebId !== 'string' || body.celebId.length > 80)
          return fundingJson({ error: 'A celebId is required' }, 400);
        const npc = celebById(body.celebId);
        if (!npc) return fundingJson({ error: 'Unknown investor' }, 404);
        const profile = await this.profile(deviceId, now, true);
        if (!profile.startupName || !profile.nickname) return fundingJson({ error: 'Choose your startup and nickname first' }, 409);
        // The client gates the pitch at 3 m (angelInvestors.pitch). Economy v3 also checks server-side,
        // against the server-held pose, so a scripted POST can't claim every hidden angel without visiting
        // it. The tolerance is generous because the NPC paces around its spot and poses lag.
        if (flags.economyV3) {
          const spot = project(npc.spot[0], npc.spot[1]);
          const near = [...this.peers()].some(peer => peer.deviceId === deviceId
            && Math.hypot(peer.pose.x / 100 - spot.x, peer.pose.z / 100 - spot.z) <= CELEB_PITCH_SERVER_M);
          if (!near) return fundingJson({ error: 'Walk up to the investor to pitch' }, 409);
        }
        const result = await this.award(deviceId, { source: 'celebrity', sourceRef: npc.id, label: celebLabel(npc), amountCents: celebChequeCents(npc.id) }, now);
        const pitchedIds = [...await creditedRefs(this.env.DB, deviceId, 'celebrity')];
        if (result.credited) return fundingJson({ ...await this.status(deviceId, now), pitchedIds });
        return fundingJson({ state: 'already-awarded', serverNow: now, profile: result.profile, room: null, award: null,
          reason: 'You have already pitched this investor.', pitchedIds } satisfies FundingStatus & { pitchedIds: string[] });
      }
      if (path !== '/api/funding/start' || !body || Object.keys(body).some(key => key !== 'eventId') || typeof body.eventId !== 'string' || body.eventId.length > 160)
        return fundingJson({ error: 'Only an event ID is accepted' }, 400);
      // Drive-through mode has no "work the room": the tick pays on pass-through, so never open a room here.
      if (flags.driveThroughFunding) {
        const profile = await this.profile(deviceId, now);
        return fundingJson({ state: 'idle', serverNow: now, profile, room: null, award: null,
          reason: 'Just drive or walk through the event marker — no need to stop.' } satisfies FundingStatus);
      }
      if (this.active.has(deviceId)) return fundingJson(await this.status(deviceId, Date.now()));
      const profile = await this.profile(deviceId, now, true);
      if (!profile.startupName || !profile.nickname) return fundingJson({ error: 'Choose your startup and nickname first' }, 409);
      const { event, anchor } = await this.event(body.eventId);
      if (!eventVisibleIn(event, now, this.visibleWindowEnd(now))) return fundingJson({ error: 'This event is not on the map right now' }, 409);
      if (await fundingAlreadyAwarded(this.env.DB, deviceId, event.id, Date.now())) {
        const value: FundingStatus = { state: 'already-awarded', serverNow: Date.now(), profile, room: null, award: null, reason: 'This event already paid you today.' };
        this.results.set(deviceId, { at: Date.now(), value }); return fundingJson(value);
      }
      const previous = await previousFundingAward(this.env.DB, deviceId), startedAt = Date.now();
      const room: FundingRoom = { eventId: event.id, title: event.title, anchor, radiusM: ROOM_RADIUS_M, approx: event.approx,
        startedAt, finishesAt: startedAt + ROOM_DURATION_MS, quote: quoteFunding(event, startedAt, 0, nextFundingStreak(previous, event.id, startedAt)) };
      const devicePeers = [...this.peers()].filter(peer => peer.deviceId === deviceId);
      const peer = devicePeers.find(peer => this.inside(peer, room));
      if (!peer) {
        // Prediction can enter the marker before its next accepted MOVE reaches the server.
        // This is a normal pending arrival, with no room or running clock until authority catches up.
        if (devicePeers.some(peer => peer.onFoot)) return fundingJson({ state: 'idle', serverNow: startedAt, profile,
          room: null, award: null, reason: 'Walk into the glowing event marker first.' } satisfies FundingStatus);
        return fundingJson({ error: 'Join the city on foot before working the room' }, 409);
      }
      // A concurrent request may have started another room while D1 was awaited.
      if (this.active.has(deviceId)) return fundingJson(await this.status(deviceId, startedAt));
      this.results.delete(deviceId); this.active.set(deviceId, { room, event, playerId: peer.id, settling: false });
      return fundingJson(await this.status(deviceId, startedAt));
    } catch (error) {
      // Log the cause of a 503 (name + short message, no ids) so `wrangler tail` shows what failed (D1 timeout, reset…).
      if (!(error instanceof RangeError)) console.warn('funding handle 503', new URL(request.url).pathname, error instanceof Error ? `${error.name}: ${error.message.slice(0, 120)}` : 'unknown');
      return fundingJson({ error: error instanceof RangeError ? error.message : 'Funding is temporarily unavailable' }, error instanceof RangeError ? 400 : 503);
    }
  }
}
