/**
 * Onboarding state machine (PLAN-onboarding.md, gtasf-n34i). Pure + serializable so the client drives
 * the flow and the worker persists/validates the same state. No DOM, no flags here — the `onboarding`
 * flag is checked at the entry points that use this.
 *
 * Flow: intro slides -> first-visit SA mission tutorial -> contextual hints, with a progressive HUD
 * reveal. Returning players (saved state) skip straight to the full HUD; skipping completes immediately.
 */

/** Tutorial progression. `intro` = the 3 slides; `identity` = pane-3 character creation after the
 *  Founder Orientation payout; `done` = MISSION PASSED / full game unlocked. */
export type OnboardingStep = 'intro' | 'walk' | 'drive_ring' | 'identity' | 'gps' | 'taxi' | 'done';
export const ONBOARDING_STEPS: readonly OnboardingStep[] = ['intro', 'walk', 'drive_ring', 'identity', 'gps', 'taxi', 'done'];

/** HUD panels revealed progressively. New players begin with radar + funding only. */
export type HudPanel = 'radar' | 'funding' | 'wardrobe' | 'friends' | 'map' | 'events' | 'vcDrop' | 'outbid' | 'chat';
export const ALL_HUD_PANELS: readonly HudPanel[] = ['radar', 'funding', 'wardrobe', 'friends', 'map', 'events', 'vcDrop', 'outbid', 'chat'];

/** One-time contextual hints, each shown once and logged on the profile. */
export type OnboardingHint =
  | 'enterCar' | 'pitchAngel' | 'chatNear'            // near-object prompts
  | 'firstDrop' | 'firstRumour' | 'firstRound' | 'firstFriendRequest' // first-time explanations
  | 'idleNudge' | 'touchControls';                    // idle nudge / phone labels
export const ONBOARDING_HINTS: readonly OnboardingHint[] = [
  'enterCar', 'pitchAngel', 'chatNear', 'firstDrop', 'firstRumour', 'firstRound', 'firstFriendRequest', 'idleNudge', 'touchControls',
];

/** Cumulative panels visible by the time the player is AT each step (new player, tutorial not yet done). */
const REVEAL: Record<OnboardingStep, readonly HudPanel[]> = {
  intro: ['radar', 'funding'],
  walk: ['radar', 'funding'],
  drive_ring: ['radar', 'funding'],
  identity: ['radar', 'funding', 'wardrobe', 'friends'],          // identity introduces username + archetype
  gps: ['radar', 'funding', 'wardrobe', 'friends', 'map', 'events'], // M = map, V = events
  taxi: ['radar', 'funding', 'wardrobe', 'friends', 'map', 'events', 'vcDrop', 'outbid', 'chat'],
  done: ALL_HUD_PANELS,
};

export interface OnboardingState {
  step: OnboardingStep;
  /** Hints already shown (logged once). */
  hints: OnboardingHint[];
  /** MISSION PASSED (or skipped/returning): the whole game is unlocked. */
  completed: boolean;
  /** The player chose Skip rather than finishing the tutorial. */
  skipped: boolean;
  /** Times the optional email-capture card auto-appeared (emailCapture, gtasf-1aon): 0 = never, 1 = shown
   *  after the first cheque, 2 = also re-shown once at the first star. Capped; afterwards only Game options
   *  offers it. Verification status is NOT stored here — the server (D1) is the source of truth; the flow
   *  gates on the live /api/email/status so a verified player is never re-prompted. */
  emailPrompts: number;
}

/** The optional email-capture card auto-appears at most twice (after the first cheque, then the first star). */
export const MAX_EMAIL_PROMPTS = 2;

/** A brand-new player: start at the intro slides with nothing unlocked beyond radar + funding. */
export function freshOnboarding(): OnboardingState {
  return { step: 'intro', hints: [], completed: false, skipped: false, emailPrompts: 0 };
}

/** A returning player (has a saved profile): full HUD, no slides or tutorial. Hints still fire once each. */
export function returningOnboarding(hints: OnboardingHint[] = []): OnboardingState {
  return { step: 'done', hints: [...hints], completed: true, skipped: false, emailPrompts: 0 };
}

/** Advance one tutorial step. Reaching `done` completes onboarding. No-op once done. */
export function advanceOnboarding(state: OnboardingState): OnboardingState {
  const index = ONBOARDING_STEPS.indexOf(state.step);
  if (index < 0 || state.step === 'done') return { ...state, step: 'done', completed: true };
  const step = ONBOARDING_STEPS[index + 1] ?? 'done';
  return { ...state, step, completed: step === 'done' ? true : state.completed };
}

/** Jump the player's progression to a specific step (e.g. the client confirming a step cleared). */
export function setOnboardingStep(state: OnboardingState, step: OnboardingStep): OnboardingState {
  return { ...state, step, completed: step === 'done' ? true : state.completed };
}

/** Skip the intro/tutorial: unlock the full HUD immediately. */
export function skipOnboarding(state: OnboardingState): OnboardingState {
  return { ...state, step: 'done', completed: true, skipped: true };
}

/** "Replay tutorial" from Game options: re-run from the intro, keeping the one-time hint log. */
export function replayOnboarding(state: OnboardingState): OnboardingState {
  return { step: 'intro', hints: [...state.hints], completed: false, skipped: false, emailPrompts: state.emailPrompts };
}

/** The HUD panels that should currently be visible. Completed/returning players see everything. */
export function panelsVisibleAt(state: OnboardingState): Set<HudPanel> {
  return new Set(state.completed ? ALL_HUD_PANELS : REVEAL[state.step]);
}
export function isPanelVisible(state: OnboardingState, panel: HudPanel): boolean {
  return state.completed || REVEAL[state.step].includes(panel);
}

/** Whether a one-time hint still needs showing (not yet logged). The caller decides WHEN to trigger it. */
export function hintPending(state: OnboardingState, hint: OnboardingHint): boolean {
  return !state.hints.includes(hint);
}

/** Log a hint as shown (idempotent). */
export function markHintShown(state: OnboardingState, hint: OnboardingHint): OnboardingState {
  return state.hints.includes(hint) ? state : { ...state, hints: [...state.hints, hint] };
}

/** The optional email-capture card may still auto-appear (not yet shown its two times). The caller also
 *  gates on flags.emailCapture + a live /api/email/status check so a verified player is never re-prompted. */
export function emailPromptPending(state: OnboardingState): boolean {
  return state.emailPrompts < MAX_EMAIL_PROMPTS;
}

/** Record that the optional email card auto-appeared once (idempotent at the cap; same ref when capped). */
export function markEmailPrompted(state: OnboardingState): OnboardingState {
  return state.emailPrompts >= MAX_EMAIL_PROMPTS ? state : { ...state, emailPrompts: state.emailPrompts + 1 };
}

/** Serialize for persistence on the profile. */
export function serializeOnboarding(state: OnboardingState): string {
  return JSON.stringify({ step: state.step, hints: state.hints, completed: state.completed, skipped: state.skipped, emailPrompts: state.emailPrompts });
}

/** Parse persisted/untrusted onboarding state, coercing anything malformed back to a safe fresh state. */
export function parseOnboarding(raw: unknown): OnboardingState {
  let value: unknown = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch { return freshOnboarding(); } }
  if (!value || typeof value !== 'object') return freshOnboarding();
  const v = value as Record<string, unknown>;
  const step = ONBOARDING_STEPS.includes(v.step as OnboardingStep) ? v.step as OnboardingStep : 'intro';
  const hints = Array.isArray(v.hints) ? v.hints.filter((h): h is OnboardingHint => ONBOARDING_HINTS.includes(h as OnboardingHint)) : [];
  const completed = v.completed === true || step === 'done';
  const skipped = v.skipped === true;
  const emailPrompts = Math.min(MAX_EMAIL_PROMPTS, Math.max(0, Math.trunc(Number(v.emailPrompts) || 0)));
  return { step, hints: [...new Set(hints)], completed, skipped, emailPrompts };
}
