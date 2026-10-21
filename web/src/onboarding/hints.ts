import { flags } from '@gtasf/shared/flags';
/**
 * Contextual hint engine (PLAN-onboarding.md decision 6, gtasf-n34i). Pure selection logic: given the
 * current game context and the player's onboarding state, pick the single highest-priority hint that
 * still needs showing. Hints only fire AFTER the tutorial (during it, mission text guides). Each is
 * shown once and logged on the profile via the shared state (markHintShown). The DOM chip rendering
 * (pane-8 theme) and the context wiring live in the client loop (pane 6 integration).
 */
import { hintPending, type OnboardingHint, type OnboardingState } from '@gtasf/shared/onboarding/state';

/** Live signals the client feeds in each tick. All booleans are "true right now / just happened". */
export interface HintContext {
  nearCar: boolean;
  nearAngel: boolean;
  nearPlayer: boolean;
  firstDrop: boolean;           // a VC drop just became visible for the first time
  firstRumour: boolean;         // an angel rumour zone just appeared
  firstRound: boolean;          // a funding round just closed
  firstFriendRequest: boolean;  // an incoming friend request just arrived
  idleMs: number;               // ms since the last input
  isTouch: boolean;             // touch device (gets on-screen control labels)
  /** Metres to the nearest event/preview ring, if known (pane 6 feeds it); drives the idle nudge copy. */
  nearestEventM?: number;
}

export const IDLE_HINT_MS = 30_000;

/**
 * Idle-nudge copy (PLAN-onboarding.md decision 6: "Nearest event 400 m → press M"). With a known
 * distance it points the idle player at the real nearest event; without one (pane 6 hasn't fed it, or
 * nothing is nearby) it falls back to the generic map/events prompt — never a dead or wrong nudge.
 */
export function formatIdleNudge(nearestEventM?: number, isTouch = false): string {
  if (nearestEventM === undefined || !Number.isFinite(nearestEventM) || nearestEventM <= 0) {
    return isTouch ? 'Tap Map or Tech Week events.' : `Press M for the map, ${flags.proximityVoice ? 'J' : 'V'} for events.`;
  }
  const dist = nearestEventM >= 1000 ? `${(nearestEventM / 1000).toFixed(1)} km` : `${Math.max(50, Math.round(nearestEventM / 50) * 50)} m`;
  return `Nearest event ${dist} → ${isTouch ? 'tap Map' : 'press M'}`;
}

/** Priority order — first-time explanations of things that just happened beat ambient prompts, which
 *  beat the idle nudge, which beats the (persistent) touch labels. */
const PRIORITY: { hint: OnboardingHint; triggered: (c: HintContext) => boolean }[] = [
  { hint: 'firstDrop', triggered: c => c.firstDrop },
  { hint: 'firstRumour', triggered: c => c.firstRumour },
  { hint: 'firstRound', triggered: c => c.firstRound },
  { hint: 'firstFriendRequest', triggered: c => c.firstFriendRequest },
  { hint: 'enterCar', triggered: c => c.nearCar },
  { hint: 'pitchAngel', triggered: c => c.nearAngel },
  { hint: 'chatNear', triggered: c => c.nearPlayer },
  { hint: 'idleNudge', triggered: c => c.idleMs >= IDLE_HINT_MS },
  { hint: 'touchControls', triggered: c => c.isTouch },
];

/**
 * The next hint to show, or null if none applies. Contextual hints are post-tutorial (except the
 * phone control labels and the drive step's enter-car prompt), and only when the hint has not been shown before, and its trigger is active.
 * The caller shows it and calls markHintShown so it never repeats.
 */
export function nextHint(state: OnboardingState, ctx: HintContext): OnboardingHint | null {
  if (!state.completed) {
    // During the tutorial the mission text guides, with two exceptions: phones get their control labels
    // once the slides are gone, and "E to get in" shows by the parked car on the drive step.
    if (state.step === 'intro') return null;
    if (ctx.isTouch && hintPending(state, 'touchControls')) return 'touchControls';
    if (state.step === 'drive_ring' && ctx.nearCar && hintPending(state, 'enterCar')) return 'enterCar';
    return null;
  }
  for (const { hint, triggered } of PRIORITY) {
    if (hintPending(state, hint) && triggered(ctx)) return hint;
  }
  return null;
}
