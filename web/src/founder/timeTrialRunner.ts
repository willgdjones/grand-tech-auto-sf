/**
 * GTASF time-trial runner (docs/PLAN-gta-pivot.md LANE C). The client-side checkpoint + clock state machine for a
 * TimeTrialSpec: it starts the clock at the start marker, advances through the ordered gates by proximity (in the
 * right mode — a `drive` route needs a vehicle, a `foot` route needs to be on foot), stops at the finish and
 * submits the total to the worker, which validates the splits + the anti-cheese floor and keeps the per-route
 * daily best-time leaderboard. Headless (no DOM): the HUD / minimap marker subscribe via `onState`/`notify`.
 * Mounted only behind flags.timeTrials; inert otherwise. Ghost record/replay is a later refinement.
 */
import {
  isPlausibleTime, type TimeTrialSpec, type TimeTrialCheckpoint,
} from '@gtasf/shared/founder/timeTrials';
import { placePoint } from '../spawn/locations';
import { createGhostRecorder, loadBestGhost, saveBestGhost, type GhostData } from './timeTrialGhost';

/** The live run surfaced to the HUD: which gate is next, its waypoint, elapsed time and the par to beat. `null`
 *  when no run is active. */
export interface TimeTrialState {
  readonly spec: TimeTrialSpec;
  readonly gateIndex: number;              // 0..checkpoints.length (== length means heading for the finish)
  readonly gatesTotal: number;             // checkpoints + 1 (the finish)
  readonly waypoint: { x: number; z: number };
  readonly elapsedMs: number;
  readonly parMs: number;
}

export interface TimeTrialDeps {
  notify(title: string, detail?: string): void;
  /** The run advanced (or cleared): the HUD timer + the minimap marker render `state`, or clear on `null`. */
  onState(state: TimeTrialState | null): void;
  /** A finished run's result (after the server responds): best = this is a new personal/daily best. */
  onResult?(result: { spec: TimeTrialSpec; totalMs: number; best: boolean; rank: number | null }): void;
  /** On start, the device's stored personal-best ghost for this route (null = none) so the scene can replay it as
   *  a translucent racer; null again when the run ends (hide the racer). */
  onGhost?(ghost: GhostData | null): void;
  /** This connection's session id (the WELCOME id). Sent with tt-start/tt-submit so the server binds the run to
   *  the EXACT tab — two tabs of one device run independent trials (two-tab fix). Omit → device-only fallback. */
  sid?(): number;
  fetcher?: typeof fetch;
  now?: () => number;
}

export interface TimeTrialRunner {
  /** Begin a run. No-op if one is active. Rejects if the player is in the wrong mode for the route. */
  start(spec: TimeTrialSpec, inVehicle: boolean): void;
  /** Per-frame: advance gates from the player's pose; submit on the finish. Fails the run on a mode change. */
  update(player: { readonly x: number; readonly z: number }, inVehicle: boolean): void;
  /** Abandon the current run (e.g. the player drove off / died). */
  cancel(): void;
  readonly running: boolean;
  dispose(): void;
}

/** Player-facing text for a server-refused time-trial submit (worker/src/founder/timeTrialBoard.ts + serverRunTimingOk). */
function rejectionText(reason: string | undefined): string {
  switch (reason) {
    case 'not-at-finish': return 'cross the finish gate before the clock stops.';
    case 'too-soon': case 'time-mismatch': return "the server couldn't verify that time.";
    case 'no-active-run': case 'stale-session': return 'the run had expired. Start it again at the T.';
    default: return 'the run could not be verified.';
  }
}

export function createTimeTrialRunner(deps: TimeTrialDeps): TimeTrialRunner {
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now ?? (() => Date.now());
  let spec: TimeTrialSpec | null = null;
  let gateIndex = 0;            // index into checkpoints; == checkpoints.length means the finish is next
  let startMs = 0;
  const splits: number[] = []; // elapsed ms at each gate crossed (for the server to re-check monotonicity)
  let submitting = false;
  const recorder = createGhostRecorder(); // records THIS run's path to store as the next personal-best ghost

  function gateAt(index: number): TimeTrialCheckpoint {
    return index < spec!.checkpoints.length ? spec!.checkpoints[index]! : spec!.finish;
  }
  function waypointOf(index: number): { x: number; z: number } {
    return placePoint(gateAt(index).at);
  }
  function emit(): void {
    if (!spec) { deps.onState(null); return; }
    deps.onState({
      spec, gateIndex, gatesTotal: spec.checkpoints.length + 1,
      waypoint: waypointOf(gateIndex), elapsedMs: now() - startMs, parMs: spec.parMs,
    });
  }
  function clear(): void { spec = null; gateIndex = 0; splits.length = 0; submitting = false; recorder.reset(); deps.onState(null); deps.onGhost?.(null); }

  async function submit(totalMs: number): Promise<void> {
    const finished = spec!;
    submitting = true;
    const ghost = recorder.finish(finished.id, totalMs);
    saveBestGhost(ghost); // local personal-best ghost (fallback when there's no server champion)
    try {
      // Submit to the WorldDO (review fix 2): it owns the server-recorded start + the authoritative finish-pose /
      // elapsed check. The ghost rides along so the server can serve the daily champion's run for others to race.
      const r = await fetcher('/api/funding/tt-submit', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ routeId: finished.id, totalMs, splits, ghost, sid: deps.sid?.() }),
      });
      const res = await r.json().catch(() => null) as { best?: boolean; rank?: number | null; status?: string; reason?: string } | null;
      const title = `${finished.title} — ${(totalMs / 1000).toFixed(2)}s`;
      if (!r.ok || res?.status === 'rejected') {
        // Never claim a run counted when the server refused it (QA: a 422 still toasted "Run recorded."). [gtasf-qa]
        deps.onResult?.({ spec: finished, totalMs, best: false, rank: null });
        deps.notify(title, `Not counted: ${rejectionText(res?.reason)}`);
        return;
      }
      deps.onResult?.({ spec: finished, totalMs, best: Boolean(res?.best), rank: res?.rank ?? null });
      deps.notify(title, res?.best ? 'New best time!' : totalMs <= finished.parMs ? 'Under par — gold!' : 'Run recorded.');
    } catch {
      // Offline / no server: show the local time, but say it didn't reach the board.
      deps.onResult?.({ spec: finished, totalMs, best: false, rank: null });
      deps.notify(`${finished.title} — ${(totalMs / 1000).toFixed(2)}s`, "Couldn't reach the board, so this time wasn't saved.");
    } finally { clear(); }
  }

  function correctMode(inVehicle: boolean): boolean {
    return spec!.mode === 'drive' ? inVehicle : !inVehicle;
  }

  return {
    get running() { return spec != null; },
    start(next, inVehicle) {
      if (spec) return;
      if (next.mode === 'drive' && !inVehicle) { deps.notify('Get in a car to run this trial.'); return; }
      if (next.mode === 'foot' && inVehicle) { deps.notify('This is a foot race — leave the car.'); return; }
      spec = next; gateIndex = 0; startMs = now(); splits.length = 0; submitting = false;
      recorder.reset();
      // Arm the SERVER clock (review fix 2): the WorldDO records the start from the authoritative pose, so the
      // finish submit is timed server-side. Fire-and-forget — if it's rejected (too far / off), the submit simply
      // won't record, the local run + HUD still work.
      void fetcher('/api/funding/tt-start', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ routeId: next.id, sid: deps.sid?.() }),
      }).catch(() => { /* server unavailable → local run only */ });
      deps.onGhost?.(loadBestGhost(next.id)); // immediate: race your stored personal best (null = none yet)
      // Then try the daily CHAMPION's ghost from the board — swap to racing them if there is one (and the run is
      // still live). The run's clock is driven separately, so a late swap doesn't disturb the timer.
      void fetcher(`/api/time-trials/board?route=${encodeURIComponent(next.id)}`, { credentials: 'same-origin' })
        .then(r => r.ok ? r.json() as Promise<{ championGhost?: GhostData | null }> : null)
        .then(data => { const cg = data?.championGhost; if (spec === next && cg && Array.isArray(cg.samples) && cg.samples.length) deps.onGhost?.(cg); })
        .catch(() => { /* board unavailable → keep the personal-best ghost */ });
      deps.notify(next.title, `Go! Beat ${(next.parMs / 1000).toFixed(0)}s.`);
      emit();
    },
    update(player, inVehicle) {
      if (!spec || submitting) return;
      if (!correctMode(inVehicle)) { deps.notify('Trial failed — wrong vehicle.', 'Try again from the start.'); clear(); return; }
      recorder.sample(now() - startMs, player.x, player.z); // record the path for the next personal-best ghost
      const gate = gateAt(gateIndex);
      const wp = placePoint(gate.at);
      if (Math.hypot(player.x - wp.x, player.z - wp.z) > gate.radiusM) return;
      // Crossed this gate.
      const elapsed = now() - startMs;
      splits.push(elapsed);
      if (gateIndex < spec.checkpoints.length) { gateIndex += 1; emit(); return; }
      // That was the finish: validate locally (the server re-checks) and submit.
      if (!isPlausibleTime(spec, elapsed)) { deps.notify('Trial voided — impossible time.', 'No shortcuts.'); clear(); return; }
      void submit(elapsed);
    },
    cancel() { if (spec) { deps.notify('Trial abandoned.'); clear(); } },
    dispose() { clear(); },
  };
}
