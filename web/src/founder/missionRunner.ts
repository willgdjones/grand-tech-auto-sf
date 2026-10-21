/**
 * GTASF mission runner (docs/PLAN-gta-pivot.md LANE C). The client-side objective state machine for a
 * MissionSpec: it walks the ordered objectives (reach a waypoint, grab, escape, deliver), POSTs mission-start /
 * mission-complete to the worker (which validates proximity from the authoritative pose and pays the valuation
 * credit — the handleDriveStart/Complete pattern), and surfaces the current objective (+ its GPS waypoint) so
 * the phone, the minimap letter marker and the HUD can render it. Headless (no DOM): the UI subscribes via
 * `onObjective`/`notify`. Mounted only behind flags.missions; inert otherwise.
 */
import { MISSION_ARRIVE_RADIUS_M, type MissionObjective, type MissionSpec } from '@gtasf/shared/founder/missions';
import { formatFunding, type FundingProfile } from '@gtasf/shared/funding';
import { flags } from '@gtasf/shared/flags';
import { placePoint } from '../spawn/locations';

export interface FounderMissionDeps {
  /** Refresh the valuation HUD + round state with the server's post-credit profile. */
  onProfile(profile: FundingProfile): void;
  /** Non-blocking toast for mission prompts/results. */
  notify(title: string, detail?: string): void;
  /** The active objective changed (or cleared): the phone / minimap marker / HUD render `objective` + `waypoint`
   *  (world x,z of its `at`, or null for a non-geo objective like the escape). Called with null when the mission
   *  ends. */
  onObjective(state: { mission: MissionSpec; objective: MissionObjective; index: number; waypoint: { x: number; z: number } | null } | null): void;
  /** The live wanted level (0–5) when lane B's wanted system is active, else null. When non-null, a heist's escape
   *  objective becomes "lose the SFPD heat" (the grab raised wanted server-side); null → the client-timed stub. */
  wantedLevel?(): number | null;
  /** This connection's session id (the WELCOME id). Sent with mission-start/complete so the server binds the run
   *  to the EXACT tab — two tabs of one device don't collide (two-tab fix). Omit → server falls back to device. */
  sid?(): number;
  /** missionPresentation: when true, the start / next-objective / complete toasts are skipped (the title slab, the
   *  objective line and the MISSION PASSED band say the same thing); every toast that carries a reason still shows. */
  quietProgress?: () => boolean;
  /** Funnel hook: 'start' | objective id | 'complete' | 'abandon' (analytics; no game effect). */
  onStep?(missionId: string, step: string): void;
  fetcher?: typeof fetch;
}

interface Active {
  mission: MissionSpec;
  index: number;
  startMs: number;
  escapeFrom: { x: number; z: number } | null; // the grab point an escape objective runs from
  escapeStartMs: number;
  escapeHeatSeen: boolean; // wanted-based escape: the grab's heat has arrived (so clearing it completes the escape)
  /** Acqui-hire: the server's deadline (epoch ms); past it the client abandons so the escrow is refunded at once. */
  deadlineAt?: number;
}

export interface FounderMissionRunner {
  /** Begin a mission (POSTs mission-start). No-op if one is already running. */
  start(mission: MissionSpec): void;
  /** Per-frame: advance objectives from the player's pose; POST mission-complete on the final objective. */
  update(player: { readonly x: number; readonly z: number }, inVehicle: boolean, driving?: boolean): void;
  readonly running: boolean;
  /** Abandon the active job (client-side; a later start re-arms the server run, which simply overwrites). */
  cancel(): void;
  dispose(): void;
}

export function createFounderMissionRunner(deps: FounderMissionDeps): FounderMissionRunner {
  const fetcher = deps.fetcher ?? fetch;
  let active: Active | null = null;
  let completing = false;

  async function post(path: string, body: unknown, timeoutMs?: number): Promise<{ status: number; body: Record<string, unknown> | null }> {
    const controller = timeoutMs && typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    try {
      const r = await fetcher(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...(controller ? { signal: controller.signal } : {}) });
      let parsed: Record<string, unknown> | null = null;
      try { parsed = await r.json() as Record<string, unknown>; } catch { /* empty / non-JSON body */ }
      return { status: r.status, body: parsed };
    } catch { return { status: 0, body: null }; }
    finally { if (timer) clearTimeout(timer); }
  }

  function waypointOf(objective: MissionObjective): { x: number; z: number } | null {
    return objective.at ? placePoint(objective.at) : null;
  }
  function emit(): void {
    if (!active) { deps.onObjective(null); return; }
    const objective = active.mission.objectives[active.index]!;
    deps.onObjective({ mission: active.mission, objective, index: active.index, waypoint: waypointOf(objective) });
  }
  function clear(): void { active = null; completing = false; deps.onObjective(null); }
  /** End the job on the server too (refunds an acqui-hire's escrow), then locally. */
  /** The escape failed. failBandReason (critic N47 nit): with the presentation on, the MISSION FAILED band carries the reason
   *  as its subtitle instead of a second toast for the same event. */
  function caughtUp(): void {
    if (!active) return;
    if (flags.failBandReason && deps.quietProgress?.()) deps.onStep?.(active.mission.id, 'failed:They caught up. Try again.');
    else deps.notify('They caught up — job failed.', 'Try again.');
    clear();
  }
  async function abandon(title: string): Promise<void> {
    if (!active) return;
    const mission = active.mission;
    // gtasf-9lzk6 (#6.25 regression): the job stayed live until the mission-abandon POST answered, so a slow or stalled
    // world DO left the phone IN PROGRESS, the objective up and no notice. The job ends locally NOW; the server call only
    // ends the server run and refunds an acqui-hire escrow (the sweep refunds it anyway if this never lands).
    try { deps.onStep?.(mission.id, 'abandon'); } catch (error) { console.warn('mission abandon step failed', error); }
    clear();
    deps.notify(title, mission.acquihire ? 'Refunding your purchase price…' : 'Start it again from the phone any time.');
    const { body: res } = await post('/api/funding/mission-abandon', { sid: deps.sid?.() }, 8000);
    if (res?.profile) deps.onProfile(res.profile as FundingProfile);
    if (res?.refunded) deps.notify('Purchase refunded', 'Your purchase price was refunded.');
  }

  function advance(player: { x: number; z: number }): void {
    if (!active) return;
    const finished = active.mission.objectives[active.index]!;
    deps.onStep?.(active.mission.id, finished.id);
    // An escape objective runs from the preceding grab point (snapshot it as we leave that objective).
    if (finished.escape) active.escapeFrom = null;
    active.index += 1;
    if (active.index >= active.mission.objectives.length) { void complete(); return; }
    const next = active.mission.objectives[active.index]!;
    // A collect loop's pickups: say so, and what's next (the heist's grab→escape keeps its HUD-only cue).
    if (finished.kind === 'goto') {
      const done = active.mission.objectives.slice(0, active.index).filter(o => o.kind === 'goto').length;
      const total = active.mission.objectives.filter(o => o.kind === 'goto').length;
      if (!deps.quietProgress?.()) deps.notify(`${active.mission.title} — ${done}/${total}`, next.label);
    }
    if (next.kind === 'escape') { active.escapeFrom = waypointOf(finished) ?? player; active.escapeStartMs = Date.now(); active.escapeHeatSeen = false; }
    emit();
  }

  async function complete(): Promise<void> {
    if (!active || completing) return;
    completing = true;
    const mission = active.mission;
    const { status, body: res } = await post('/api/funding/mission-complete', { missionId: mission.id, sid: deps.sid?.() });
    if (res?.status === 'completed') {
      deps.onStep?.(mission.id, 'complete');
      if (res.profile) deps.onProfile(res.profile as FundingProfile);
      const flip = (res.outcome as { payoutCents?: string } | undefined)?.payoutCents;
      if (!deps.quietProgress?.() || (mission.acquihire && flip)) deps.notify(`Mission complete: ${mission.title}`, mission.acquihire && flip ? `Flipped for ${formatFunding(flip)}.` : 'Valuation up.');
      clear();
    } else if (mission.acquihire && typeof res?.status === 'string' && /expired|refunded/.test(res.status)) {
      if (res.profile) deps.onProfile(res.profile as FundingProfile);
      deps.notify('The deal went cold.', 'Your purchase price was refunded.'); clear();
    } else if (res?.status === 'blocked') { deps.notify('You already ran this job today.'); clear(); }
    else if (res?.status === 'unnamed') { deps.notify('Found your startup first.', 'Name your startup, then run the job again.'); clear(); }
    else if (status === 409 && (res?.error === 'no-active-mission' || res?.status === 'stale-session')) {
      // The server dropped the mission — a recovery/resume/quick-robotaxi teleport cleared it (anti-cheat). End
      // cleanly with a restart cue instead of silently retrying (which can't succeed and, worse, crashes: advance()
      // has already moved index past the end).
      deps.notify('Job reset after recovery.', `Head back to the ${mission.title} start marker to restart.`);
      clear();
    }
    else if (active) {
      // 'incomplete' / transient disagreement (not confirmed at the deliver yet, or a pose-sync hiccup): re-check
      // from the deliver objective next frame. advance() left index PAST the end, so clamp it back — otherwise the
      // next update() reads objectives[length] (undefined) and throws.
      active.index = active.mission.objectives.length - 1;
      completing = false;
    }
  }

  return {
    get running() { return active != null; },
    start(mission) {
      if (active) return;
      void post('/api/funding/mission-start', { missionId: mission.id, sid: deps.sid?.() }).then(({ body: res }) => {
        if (res?.status === 'blocked') { deps.notify(`${mission.title}: done for today`, 'This job resets tomorrow (SF time).'); return; }
        if (res?.status === 'refused' && res.reason === 'unaffordable') { deps.notify(`${mission.title}: you can't afford it yet`, 'You need at least $1,000 of valuation.'); return; }
        if (!res || res.status !== 'started') { deps.notify('Can’t start that job from here.'); return; }
        active = { mission, index: 0, startMs: Date.now(), escapeFrom: null, escapeStartMs: 0, escapeHeatSeen: false,
          deadlineAt: typeof res.deadlineAt === 'number' ? res.deadlineAt : undefined };
        if (mission.acquihire && typeof res.costCents === 'string') deps.notify(`You bought it for ${formatFunding(res.costCents)}`, 'Get the laptop to the hacker house within 10 minutes to flip it for 1.5×.');
        deps.onStep?.(mission.id, 'start');
        const first = mission.objectives[0]!;
        if (first.kind === 'escape') { active.escapeFrom = null; active.escapeStartMs = Date.now(); }
        if (!deps.quietProgress?.()) deps.notify(mission.title, mission.objectives[0]!.label);
        emit();
      });
    },
    update(player, inVehicle, driving = inVehicle) {
      if (!active || completing) return;
      if (active.deadlineAt !== undefined && Date.now() > active.deadlineAt) { void abandon('The deal went cold.'); return; }
      const objective = active.mission.objectives[active.index]!;
      if (objective.kind === 'escape' && objective.escape) {
        const elapsed = Date.now() - active.escapeStartMs;
        const wanted = deps.wantedLevel?.();
        if (wanted != null) {
          // Real escape (lane B's wanted on): the grab raised heat (3 stars); lose the SFPD by breaking their
          // line of sight until the heat decays to 0. A generous fail-safe prevents a stuck state hanging it.
          if (wanted > 0) active.escapeHeatSeen = true;
          if (active.escapeHeatSeen && wanted === 0) { advance(player); return; }
          // heistHeatOnLeave: the heat only lands once the player is 50 m from the grab, so the fail-safe clock starts then;
          // otherwise a player still looking for the getaway car near the office failed at 240 s with 0 stars (lane E 15:5x).
          if (flags.heistHeatOnLeave && !active.escapeHeatSeen) { active.escapeStartMs = Date.now(); return; }
          if (elapsed > objective.escape.limitMs * 4) { caughtUp(); return; }
          return;
        }
        // Fallback stub (wanted off): driven escapeM from the grab point, in a vehicle, in time.
        const from = active.escapeFrom;
        const dist = from ? Math.hypot(player.x - from.x, player.z - from.z) : Infinity;
        if (inVehicle && dist >= objective.escape.escapeM) { advance(player); return; }
        if (elapsed > objective.escape.limitMs) { caughtUp(); return; }
        return;
      }
      // goto / collect / deliver: reach the waypoint.
      const wp = waypointOf(objective);
      if (!wp) { advance(player); return; } // no waypoint → treat as immediately satisfied
      const radius = objective.radiusM ?? MISSION_ARRIVE_RADIUS_M;
      if (objective.drive && !driving) return; // taxi fare: the server only counts it from the driver's seat
      if (Math.hypot(player.x - wp.x, player.z - wp.z) <= radius) advance(player);
    },
    cancel() { if (active) void abandon(`Job abandoned: ${active.mission.title}`); },
    dispose() { clear(); },
  };
}
