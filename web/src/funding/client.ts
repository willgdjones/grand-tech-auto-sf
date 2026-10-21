import { flags } from '@gtasf/shared/flags';
import { ROOM_HEIGHT_M, fundingCents, type FundingAward, type FundingLeaderboard, type FundingProfile, type FundingRoom, type FundingStatus } from '@gtasf/shared/funding';

class FundingRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
function canRetryRequest(error: unknown): boolean {
  return error instanceof FundingRequestError ? error.status === 408 || error.status === 429 || error.status >= 500
    : error instanceof TypeError || error instanceof DOMException && error.name === 'AbortError';
}

export type FundingTarget = Pick<FundingRoom, 'eventId' | 'title' | 'anchor' | 'radiusM' | 'approx' | 'quote'> & { alreadyAwarded: boolean };
let prefetchedProfile: Promise<Response> | undefined;
/** Start the boot profile read early (cold load, gtasf-1k82). Call only once the device cookie exists (after
 *  referrals/admission): a cookieless read mints a device, and two concurrent mints would split the player. */
export function prefetchFundingProfile(): void {
  if (!flags.fundingLoop || prefetchedProfile) return;
  prefetchedProfile = fetch('/api/funding/profile', { credentials: 'same-origin', cache: 'no-store' });
  prefetchedProfile.catch(() => {});
}
/** A prefetched response, or undefined if it failed or has not settled within `ms` (the fallback fetch keeps its
 *  own abort timeout, so a hung boot-time prefetch can never stall boot). */
function settleWithin(early: Promise<Response>, ms: number): Promise<Response | undefined> {
  return Promise.race([early.catch(() => undefined), new Promise<undefined>(resolve => setTimeout(resolve, ms))]);
}
function takePrefetchedProfile(): Promise<Response> | undefined { const early = prefetchedProfile; prefetchedProfile = undefined; return early; }
// critic N3 (flag chequeOnce): after a reload the server's first status read still answers the last award as 'awarded', so
// the cheque card, the cha-ching and every award hook replayed a cheque banked minutes ago. The ids of awards already shown
// on this device persist (a short ring); an award that was never shown (the tab closed first) still shows after a reload.
const SEEN_AWARDS_KEY = 'gtasf.funding.seenAwards.v1', SEEN_AWARDS_KEEP = 50;
function loadSeenAwards(): string[] {
  if (!flags.chequeOnce) return [];
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SEEN_AWARDS_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string').slice(-SEEN_AWARDS_KEEP) : [];
  } catch { return []; } // storage blocked / corrupt: replays as before
}
function saveSeenAwards(seen: ReadonlySet<string>): void {
  if (!flags.chequeOnce) return;
  try { localStorage.setItem(SEEN_AWARDS_KEY, JSON.stringify([...seen].slice(-SEEN_AWARDS_KEEP))); } catch { /* storage blocked */ }
}

export function createFundingClient(options: {
  onProfile?(profile: FundingProfile): void;
  /** `replay`: chequeOnce — this device already showed the award (a reload); run state hooks, skip the cheque display. */
  onAward?(award: FundingAward, info?: { replay: boolean }): void;
  onStatus?(status: FundingStatus): void; onLeaderboard?(value: FundingLeaderboard): void; onError?(message: string): void;
} = {}) {
  if (!flags.fundingLoop) return null;
  let profile: FundingProfile | null = null, target: FundingTarget | null = null, status: FundingStatus | null = null;
  let transportFailures = 0; // cold-load hiccups retry silently; only a sustained outage shows the toast
  // Status-poll server blips (5xx/408/429 — e.g. the world DO restarting after a deploy; QA saw status 503 on 2 of ~8
  // boots): the poll repeats every 1.5 s anyway, so the first two in a row stay silent instead of flashing
  // 'temporarily unavailable' over the valuation HUD. A sustained outage still reports.
  let statusBlips = 0;
  let disposed = false, inside = false, busy = false, loading = false, generation = 0, attempted = false, error = '';
  let identityRevision = 0, refreshingTarget = false;
  // Issue time of the latest post-debit refreshProfile() read. Routine reads issued before it — or within
  // STALE_AFTER_DEBIT_MS after it (the world's funding status keeps a 5 s profile cache, and debits applied outside
  // the world DO don't invalidate it) — may carry the pre-debit total and must not restore the old $.
  let authoritativeIssuedAt = -Infinity;
  const STALE_AFTER_DEBIT_MS = 6000;
  let selectedEventId: string | null = null, retryTargetAt = Infinity;
  let receivedAt = 0, lastPoll = -Infinity, lastLeaders = -Infinity, nextAttempt = 0, nextRefreshAt = Infinity, lastStatusPoll = -Infinity, nearTargetUntil = -Infinity;
  let pending: Promise<void> = Promise.resolve(), initializing: Promise<FundingProfile> | undefined;
  const controllers = new Set<AbortController>(), seenAwards = new Set<string>(), shownBefore = new Set<string>(loadSeenAwards());
  async function request<T>(path: string, body?: unknown): Promise<T> {
    if (disposed) throw new Error('Funding closed');
    const controller = new AbortController(); controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      // The boot-time profile read (prefetchFundingProfile) is consumed by the first GET of 'profile' only.
      const early = path === 'profile' && body === undefined ? takePrefetchedProfile() : undefined;
      const response = (early ? await settleWithin(early, 8000) : undefined) ?? await fetch(`/api/funding/${path}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      const text = await response.text(); if (text.length > 262144) throw new Error('Funding response was too large');
      let value: T & { error?: string };
      try { value = JSON.parse(text) as T & { error?: string }; } catch { throw new FundingRequestError('Funding is temporarily unavailable', response.status); }
      if (!response.ok) throw new FundingRequestError(typeof value?.error === 'string' ? value.error.slice(0, 180) : 'Funding is temporarily unavailable', response.status);
      return value;
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }
  function setProfile(value: FundingProfile, authoritativeDecrease = false, issuedAt?: number) {
    if (disposed) return;
    if (issuedAt !== undefined && !authoritativeDecrease && issuedAt < authoritativeIssuedAt + STALE_AFTER_DEBIT_MS) return; // may predate the debit
    fundingCents(value.totalCents); fundingCents(value.todayCents);
    // A slow pre-award poll cannot rewind earned money — unless this is a deliberate fresh read taken AFTER a
    // server-applied debit (combat penalty / purchase), which must be allowed to lower the shown valuation.
    if (!authoritativeDecrease && profile && fundingCents(value.totalCents) < fundingCents(profile.totalCents)) return;
    profile = value; options.onProfile?.(value);
  }
  function reconcileIdentity<T extends FundingProfile>(value: T, requestedAtRevision: number): T {
    // A successful name save supersedes identity fields in reads already in flight.
    // Keep their independently earned money/rank, and allow fresh reads from another tab.
    return requestedAtRevision < identityRevision && profile?.deviceId === value.deviceId
      ? { ...value, startupName: profile.startupName, nickname: profile.nickname } : value;
  }
  function reportError(value: unknown) {
    if (disposed) return;
    const transportFailure = value instanceof TypeError || value instanceof DOMException && value.name === 'AbortError';
    const message = transportFailure ? 'Funding updates are delayed. Retrying…'
      : value instanceof Error ? value.message : 'Funding is temporarily unavailable';
    if (transportFailure && ++transportFailures < 3) { nextAttempt = performance.now() + 3000; return; }
    if (message !== error) options.onError?.(message);
    error = message; nextAttempt = performance.now() + 3000;
  }
  function accept(value: FundingStatus, requestedAtRevision: number, issuedAt?: number) {
    if (disposed) return;
    value = { ...value, profile: reconcileIdentity(value.profile, requestedAtRevision),
      award: value.award ? { ...value.award, profile: reconcileIdentity(value.award.profile, requestedAtRevision) } : null };
    status = value; receivedAt = performance.now(); error = ''; transportFailures = 0; setProfile(value.profile, false, issuedAt);
    if (value.state === 'awarded' && value.award) {
      if (target?.eventId === value.award.eventId) target.alreadyAwarded = true;
      if (!seenAwards.has(value.award.id)) { // once per session, as before
        seenAwards.add(value.award.id); if (seenAwards.size > 200) seenAwards.delete(seenAwards.values().next().value!);
        // Reviewer 06:3x: a replay still reaches onAward (its state hooks — onboarding, collected events — must run, as the
        // old replay healed a reload mid-step); only the cheque display is skipped by the host.
        const replay = shownBefore.has(value.award.id);
        if (!replay) { shownBefore.add(value.award.id); saveSeenAwards(shownBefore); }
        options.onAward?.(value.award, { replay });
      }
    }
    if (value.state === 'already-awarded' && target) target.alreadyAwarded = true;
    if (value.state === 'cancelled' || value.state === 'idle') { attempted = false; nextAttempt = performance.now() + 1200; }
    options.onStatus?.(value);
  }
  async function action(path: 'start' | 'status' | 'cancel', body?: unknown): Promise<void> {
    if (busy || disposed) return;
    busy = true;
    const requestedAtRevision = identityRevision, issuedAt = performance.now();
    pending = request<FundingStatus>(path, body).then(value => { statusBlips = 0; accept(value, requestedAtRevision, issuedAt); })
      .catch(value => { attempted = false; if (path === 'status' && value instanceof FundingRequestError && canRetryRequest(value) && ++statusBlips < 3) { nextAttempt = performance.now() + 1500; return; } reportError(value); }).finally(() => { busy = false; });
    await pending;
  }
  async function initialProfile(): Promise<FundingProfile> {
    let requestedAtRevision = identityRevision, value: FundingProfile;
    try { value = await request<FundingProfile>('profile'); }
    catch (error) {
      if (disposed || !canRetryRequest(error)) throw error;
      // Boot still waits for one canonical profile. Retry only this read, once.
      await new Promise<void>((resolve, reject) => {
        const controller = new AbortController(); controllers.add(controller);
        const aborted = () => { clearTimeout(timer); controllers.delete(controller); reject(new Error('Funding closed')); };
        const timer = setTimeout(() => {
          controllers.delete(controller); controller.signal.removeEventListener('abort', aborted); resolve();
        }, 750);
        controller.signal.addEventListener('abort', aborted, { once: true });
      });
      requestedAtRevision = identityRevision; value = await request<FundingProfile>('profile');
    }
    const next = reconcileIdentity(value, requestedAtRevision); setProfile(next); return next;
  }
  /** Re-read the canonical profile AFTER a server-applied debit/credit (combat penalty, gun shop, robbery) and
   *  publish it to the HUD — allowed to lower the shown valuation, unlike the routine status poll. */
  async function refreshProfile(): Promise<void> {
    if (disposed || !profile) return;
    const requestedAtRevision = identityRevision, issuedAt = performance.now();
    try {
      const value = await request<FundingProfile>('profile');
      authoritativeIssuedAt = Math.max(authoritativeIssuedAt, issuedAt);
      setProfile(reconcileIdentity(value, requestedAtRevision), true, issuedAt);
    }
    catch (value) { reportError(value); }
  }
  async function init(): Promise<FundingProfile> {
    initializing ??= initialProfile().catch(error => { initializing = undefined; throw error; });
    return initializing;
  }
  async function saveIdentity(startupName: string, nickname: string): Promise<FundingProfile> {
    const value = await request<FundingProfile>('profile', { startupName, nickname });
    if (disposed) return value;
    // An award may arrive while the save response travels back. Keep that money.
    const next = profile?.deviceId === value.deviceId && fundingCents(profile.totalCents) > fundingCents(value.totalCents)
      ? { ...profile, startupName: value.startupName, nickname: value.nickname } : value;
    identityRevision++; setProfile(next); return next;
  }
  async function leaderboard(): Promise<FundingLeaderboard> {
    const requestedAtRevision = identityRevision, issuedAt = performance.now();
    const value = await request<FundingLeaderboard>('leaderboard');
    if (disposed) return value;
    const next = { ...value, you: reconcileIdentity(value.you, requestedAtRevision),
      week: value.week.map(entry => reconcileIdentity(entry, requestedAtRevision)),
      today: value.today.map(entry => reconcileIdentity(entry, requestedAtRevision)) };
    setProfile(next.you, false, issuedAt); options.onLeaderboard?.(next); return next;
  }
  async function requestTarget(eventId: string): Promise<FundingTarget> {
    const value = await request<FundingTarget>(`event?id=${encodeURIComponent(eventId)}`);
    if (!value || value.eventId !== eventId || !value.anchor || !Number.isFinite(value.anchor.x + value.anchor.y + value.anchor.z) || value.radiusM !== 8)
      throw new Error('Invalid event marker');
    return value;
  }
  async function refreshTarget(now: number): Promise<void> {
    if (refreshingTarget || disposed || !target) return;
    const previous = target, selected = generation;
    refreshingTarget = true; nextRefreshAt = now + 60_000;
    try {
      const value = await requestTarget(previous.eventId);
      if (disposed || selected !== generation || target !== previous) return;
      target = value; error = ''; nextRefreshAt = performance.now() + 60_000;
      // Only the server can reopen daily eligibility; do not carry yesterday's attempt forward.
      if (!value.alreadyAwarded) { attempted = false; status = null; }
    } catch (value) {
      if (!disposed && selected === generation && target === previous) {
        reportError(value); nextRefreshAt = performance.now() + 10_000;
      }
    } finally { refreshingTarget = false; }
  }
  async function loadSelectedTarget(eventId: string, selected: number): Promise<FundingTarget | null> {
    loading = true; retryTargetAt = Infinity;
    try {
      const value = await requestTarget(eventId);
      if (selected !== generation || disposed) return null;
      target = value; error = ''; nextRefreshAt = performance.now() + 60_000; return value;
    } catch (value) {
      if (selected === generation && !disposed) {
        reportError(value);
        if (canRetryRequest(value)) retryTargetAt = nextAttempt;
      }
      return null;
    } finally { if (selected === generation) loading = false; }
  }
  async function selectEvent(eventId: string | null): Promise<FundingTarget | null> {
    const selected = ++generation; loading = true; target = null; inside = false; attempted = false; error = '';
    selectedEventId = eventId; retryTargetAt = Infinity;
    await pending;
    if (status?.state === 'working') await action('cancel', {});
    if (selected !== generation || disposed) return null;
    status = null;
    if (!eventId) { loading = false; return null; }
    return loadSelectedTarget(eventId, selected);
  }
  async function pitchCelebrity(celebId: string): Promise<{ firstTime: boolean; pitchedIds: string[] }> {
    const requestedAtRevision = identityRevision;
    const value = await request<FundingStatus & { pitchedIds?: string[] }>('pitch', { celebId });
    if (!disposed) accept(value, requestedAtRevision); // fires onAward for a first-time cheque
    return { firstTime: value.state === 'awarded', pitchedIds: Array.isArray(value.pitchedIds) ? value.pitchedIds : [] };
  }
  async function pitchedCelebs(): Promise<string[]> {
    const value = await request<{ pitchedIds?: string[] }>('pitch');
    return Array.isArray(value?.pitchedIds) ? value.pitchedIds : [];
  }
  /**
   * Compact funding (startup/stage/raised) for nearby peers OUTSIDE the top-50 leaderboard, so their
   * overhead nameplate can show more than a bare nickname (gtasf-nameplate-funding-beyond-top50-zqnk).
   * POST /api/funding/summary is nickname-keyed and bounded server-side; callers throttle + cache.
   */
  async function summaries(nicknames: readonly string[]): Promise<FundingProfile[]> {
    if (!nicknames.length) return [];
    const value = await request<{ summaries?: FundingProfile[] }>('summary', { nicknames });
    return Array.isArray(value?.summaries) ? value.summaries : [];
  }
  /**
   * The player's already-collected (drive-through once-ever) event ids. Seed the radar's and world
   * markers' collected-dim from this on load so a RETURNING player sees events they were already paid
   * for dimmed — not just this session's (main's collectedEventIds otherwise starts empty). GET
   * /api/funding/collected, behind driveThroughFunding server-side. [gtasf-ykbb]
   */
  async function collected(): Promise<string[]> {
    const value = await request<{ collectedEventIds?: string[] }>('collected');
    return Array.isArray(value?.collectedEventIds) ? value.collectedEventIds : [];
  }
  return {
    init, refreshProfile, saveIdentity, leaderboard, selectEvent, pitchCelebrity, pitchedCelebs, summaries, collected,
    get profile() { return profile; }, get target() { return target; }, get status() { return status; },
    get inside() { return inside; }, get error() { return error; }, get busy() { return busy; },
    get progress() {
      if (status?.state !== 'working' || !status.room) return 0;
      return Math.max(0, Math.min(.985, (status.serverNow + performance.now() - receivedAt - status.room.startedAt) / (status.room.finishesAt - status.room.startedAt)));
    },
    update(position: { x: number; y: number; z: number }, mode: 'on-foot' | 'driver' | 'passenger', connected: boolean, now = performance.now()) {
      if (disposed || !profile) return;
      const wasInside = inside;
      inside = Boolean(connected && target && mode === 'on-foot'
        && Math.hypot(position.x - target.anchor.x, position.z - target.anchor.z) <= target.radiusM
        && Math.abs(position.y - target.anchor.y) <= ROOM_HEIGHT_M);
      if (wasInside && !inside) attempted = false;
      // Drive-through (PLAN-v2 decision 1): the server pays on pass-through, so there is no room to
      // work. Poll status for the award toast and keep GPS targets and the leaderboard fresh.
      if (flags.driveThroughFunding) {
        if (busy || loading || now < nextAttempt) return;
        if (connected && !target && selectedEventId && now >= retryTargetAt) { void loadSelectedTarget(selectedEventId, generation); return; }
        // Funding GETs are served by the single-threaded world DO; a flat 1.5 s poll was ~40 req/min per player (lane E). The
        // award only happens at the selected target, so poll fast near it (and for a few seconds after a pass-through, while
        // the server settles the payout) or while recovering from a failed poll, and every 6 s otherwise.
        if (target && Math.hypot(position.x - target.anchor.x, position.z - target.anchor.z) <= target.radiusM + 80) nearTargetUntil = now + 4000;
        const fast = now < nearTargetUntil || transportFailures > 0 || statusBlips > 0 || Boolean(error); // recovering from a failed poll keeps the old cadence
        if (connected && now - lastStatusPoll >= (fast ? 1500 : 6000)) { lastStatusPoll = now; void action('status'); return; }
        if (connected && target?.alreadyAwarded && !refreshingTarget && now >= nextRefreshAt) { void refreshTarget(now); return; }
        if (connected && now - lastLeaders >= 10_000) { lastLeaders = now; void leaderboard().catch(reportError); }
        return;
      }
      if (busy || loading || now < nextAttempt) return;
      if (connected && !target && selectedEventId && now >= retryTargetAt) {
        void loadSelectedTarget(selectedEventId, generation); return;
      }
      if ((!inside || !connected) && status?.state === 'working') { void action('cancel', {}); return; }
      if (status?.state === 'working' && now - lastPoll >= 1000) { lastPoll = now; void action('status'); return; }
      if (inside && !attempted && !target?.alreadyAwarded && profile.startupName && profile.nickname && now >= nextAttempt) {
        attempted = true; lastPoll = now; void action('start', { eventId: target!.eventId }); return;
      }
      if (connected && target?.alreadyAwarded && !refreshingTarget && now >= nextRefreshAt) { void refreshTarget(now); return; }
      if (connected && now - lastLeaders >= 10_000) {
        lastLeaders = now; void leaderboard().catch(reportError);
      }
    },
    destroy() {
      if (disposed) return;
      if (status?.state === 'working') void fetch('/api/funding/cancel', { method: 'POST', credentials: 'same-origin', keepalive: true,
        headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
      disposed = true; generation++; for (const controller of controllers) controller.abort(); controllers.clear();
    },
  };
}
export type FundingClient = NonNullable<ReturnType<typeof createFundingClient>>;
