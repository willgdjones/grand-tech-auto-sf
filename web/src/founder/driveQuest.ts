/**
 * Founder-ladder phase 5.1 — client for the Robotaxi-protester "escape the cone" DRIVE quest
 * (flags.driveQuest). Walk up to the protester + E → POST drive-start (the server records the escape
 * timer); then each frame a HUD shows the countdown + distance, and when the client's own escapedCone
 * fires it POSTs drive-complete. The server re-verifies the escape from the AUTHORITATIVE pose + vehicle
 * state, so the client only TRIGGERS the check — it never decides the payout. Inert unless a drive NPC is
 * mounted (which is itself gated by flags.driveQuest), so this never runs in a prod build with the flag off.
 */
import { driveCopyOf, escapedCone, type DriveQuestCopy, type DriveQuestParams, type MemeNpcSpec } from '@gtasf/shared/founder/memeQuests';
import type { FundingProfile } from '@gtasf/shared/funding';
import { placePoint } from '../spawn/locations';

export interface FounderDriveQuestDeps {
  /** Refresh the valuation HUD + round state with the server's post-credit profile. */
  onProfile(profile: FundingProfile): void;
  /** Surface the quest result/prompts as a non-blocking toast. */
  notify(title: string, detail?: string): void;
  /** This connection's session id (the WELCOME id). Sent with drive-start/complete so the server binds the quest
   *  to the EXACT tab — two tabs of one device don't collide (two-tab fix). Omit → server device-only fallback. */
  sid?(): number;
  /** Fetch for the quest POSTs (main.ts passes one that waits out a world-socket reconnect, gtasf-j7wvv). */
  fetcher?: typeof fetch;
}

interface Active { npcId: string; startMs: number; params: DriveQuestParams; protester: { x: number; z: number }; archetype: string; copy: DriveQuestCopy }

/** POST and return BOTH the HTTP status and the parsed body, so the caller can tell a server-cleared quest
 *  (409 no-active-quest, e.g. after an automatic ROAD_RESPAWN recovery) from a transient pose-sync disagreement. */
async function post(path: string, body: unknown, fetcher: typeof fetch = fetch): Promise<{ status: number; body: Record<string, unknown> | null }> {
  try {
    const r = await fetcher(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let parsed: Record<string, unknown> | null = null;
    try { parsed = await r.json() as Record<string, unknown>; } catch { /* empty / non-JSON body */ }
    return { status: r.status, body: parsed };
  } catch { return { status: 0, body: null }; }
}

export interface FounderDriveQuest {
  /** Begin the quest at a drive NPC (fetches drive-start). No-op if one is already running or not a drive NPC. */
  start(spec: MemeNpcSpec): void;
  /** Per-frame: update the HUD; fire drive-complete on escape; fail on timeout. (Uses Date.now() internally,
   *  matching the startMs clock, so it never mixes epochs with the render loop's performance clock.) */
  update(player: { readonly x: number; readonly z: number }, inVehicle: boolean): void;
  /** True while a quest is running (so other E-interactions can defer). */
  readonly running: boolean;
  dispose(): void;
}

export function createFounderDriveQuest(deps: FounderDriveQuestDeps): FounderDriveQuest {
  const root = document.createElement('section');
  root.className = 'gt-drive-quest'; root.hidden = true; root.setAttribute('aria-live', 'polite');
  const line = document.createElement('div'); line.className = 'gt-drive-quest-line'; root.append(line);
  document.body.append(root);
  let active: Active | null = null, completing = false;
  const clear = () => { active = null; completing = false; root.hidden = true; };
  return {
    get running() { return active != null; },
    start(spec) {
      if (active || spec.questKind !== 'drive' || !spec.drive) return;
      const params = spec.drive, protester = placePoint(spec.target); // same projection the server uses
      void post('/api/funding/drive-start', { npcId: spec.id, sid: deps.sid?.() }, deps.fetcher).then(({ body: res }) => {
        const copy = driveCopyOf(spec);
        if (res?.status === 'blocked') { deps.notify(copy.blocked, 'Come back tomorrow.'); return; }
        if (!res || res.status !== 'started') { deps.notify(`${spec.archetype} waved you off.`); return; }
        active = { npcId: spec.id, startMs: Date.now(), params, protester, archetype: spec.archetype, copy };
        root.hidden = false; line.textContent = `${copy.hud} — grab a car, drive ${params.escapeM} m away`;
      });
    },
    update(player, inVehicle) {
      if (!active || completing) return;
      const distM = Math.hypot(player.x - active.protester.x, player.z - active.protester.z);
      const elapsedMs = Date.now() - active.startMs, remainMs = Math.max(0, active.params.limitMs - elapsedMs);
      if (escapedCone({ distFromProtesterM: distM, elapsedMs, inVehicle }, active.params)) {
        completing = true; // one complete attempt; the server is authoritative
        const archetype = active.archetype, copy = active.copy;
        void post('/api/funding/drive-complete', { npcId: active.npcId, sid: deps.sid?.() }, deps.fetcher).then(({ status, body: res }) => {
          if (res?.status === 'completed') { if (res.profile) deps.onProfile(res.profile as FundingProfile); deps.notify(copy.success, 'Valuation up.'); clear(); }
          else if (res?.status === 'blocked') { deps.notify('Already escaped this one today.'); clear(); }
          else if (status === 409 && res?.error === 'no-active-quest') {
            // The server cleared the quest — e.g. an automatic ROAD_RESPAWN after the car flipped/hung recovered the
            // player (a recovery can't double as an escape). End cleanly with a restart cue — NEVER a silent retry,
            // which would otherwise run out the timer into a false "the cone caught you".
            deps.notify('Quest reset after recovery.', `Talk to the ${archetype} to restart.`);
            clear();
          }
          else completing = false; // a genuine pose-sync disagreement — re-check within the limit
        });
        return;
      }
      if (remainMs <= 0) { deps.notify(active.copy.fail, 'Try again.'); clear(); return; }
      const toGo = Math.max(0, Math.ceil(active.params.escapeM - distM)), secs = Math.ceil(remainMs / 1000);
      line.textContent = inVehicle ? `${active.copy.hud} — ${toGo} m to go · ${secs} s` : `${active.copy.hud} — get in a car · ${secs} s`;
    },
    dispose() { root.remove(); active = null; },
  };
}
