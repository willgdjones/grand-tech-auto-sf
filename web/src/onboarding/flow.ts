/**
 * Onboarding flow controller (PLAN-onboarding.md, gtasf-n34i, pane 14). Drives the whole flow from the
 * shared state machine: intro slides → SA mission tutorial → contextual hints, with the progressive HUD
 * reveal and profile persistence. Dependency-inverted: it talks to an injected `OnboardingUi` and a
 * `persist` callback, so it is unit-testable and decoupled from pane 8's UI kit (SaIntroSlides/
 * SaMissionBanner/…), from the `/api/onboarding` routes, and from `flags.onboarding` (pane 6 gates
 * creation on the flag, adapts pane-8's classes to `OnboardingUi`, and wires `persist` to the route).
 */
import {
  advanceOnboarding, skipOnboarding, replayOnboarding, markHintShown, markEmailPrompted, panelsVisibleAt,
  type OnboardingState, type OnboardingStep, type HudPanel,
} from '@gtasf/shared/onboarding/state';
import { TUTORIAL_STEPS, tutorialStepFor } from '@gtasf/shared/onboarding/tutorial';
import { introSlides, type IntroSlideContent } from './slides';
import { nextHint, type HintContext } from './hints';
import type { OnboardingHint } from '@gtasf/shared/onboarding/state';

export interface MissionStepView { title: string; objective: string; stepIndex: number; stepTotal: number }
export type StingerVariant = 'gold' | 'pass' | 'orange';

/** The presentation surface the controller drives. Pane 6 adapts pane-8's kit to this. */
export interface OnboardingUi {
  showSlides(slides: IntroSlideContent[], handlers: { onComplete: () => void; onSkip: () => void }): void;
  hideSlides(): void;
  setMissionStep(step: MissionStepView): void;
  clearMission(): void;
  /** Big one-shot centre text for tutorial progress; funding HUD owns financial confirmations. */
  stinger(text: string, variant: StingerVariant): void;
  /** `ctx` is the live hint context, so copy can reflect it (e.g. the idle nudge's nearest-event distance). */
  showHint(hint: OnboardingHint, ctx?: HintContext): void;
  /** Remove contextual prompts when their target is no longer available, even if no new hint fires. */
  updateHintContext?(ctx: HintContext): void;
  /** A new tutorial run must not retain chips from the previous one. */
  clearHints?(): void;
  /** Reveal exactly these HUD panels (hide the rest) for the current progression. */
  revealPanels(panels: HudPanel[]): void;
  /** Ask pane 3 to show the post-first-payout identity screen; it calls stepCleared('identity') when done. */
  requestIdentity(): void;
}

export interface OnboardingDeps {
  state: OnboardingState;
  isTouch: boolean;
  ui: OnboardingUi;
  /** Persist the serialized state to the profile (pane 6 → POST /api/onboarding/state). */
  persist(state: OnboardingState): void;
  /** Skip was chosen. main.ts opens the identity screen for an unnamed founder, since the server only
   *  pays named startups and a skipper never reaches the tutorial's identity step. */
  onSkipped?(): void;
  /** playfulMayhem: replace the intro slides with a one-action "Paint the Ferry Building" step; main.ts
   *  calls stepCleared('intro') on the first paintball fired. */
  paintIntro?: boolean;
  /** What step 1 asks you to paint (organiser-link arrivals paint their venue, not the Ferry). */
  paintTarget?: string;
}

export interface OnboardingFlow {
  /** Begin from the current state (reveal HUD + enter the current step). */
  start(): void;
  /** The game reports a tutorial step cleared (drive_ring entered the ring, gps set, taxi collected,
   *  identity screen done). Advances only when it matches the current step. */
  stepCleared(step: OnboardingStep): void;
  /** Feed live context each tick; shows at most one new contextual hint (post-tutorial, once each). */
  tickHints(ctx: HintContext): void;
  /** "Replay tutorial" from Game options. */
  replay(): void;
  /** Refresh the current mission step's objective line (e.g. the walk-step checklist ticking off). */
  updateObjective(text: string): void;
  /** Persist an automatic email offer when shown, so reload/replay cannot repeat it. */
  emailPromptShown(): void;
  readonly state: OnboardingState;
}

export function createOnboardingFlow(deps: OnboardingDeps): OnboardingFlow {
  let state = deps.state;

  const applyHud = (): void => deps.ui.revealPanels([...panelsVisibleAt(state)]);
  const sync = (): void => { deps.persist(state); applyHud(); };

  function missionView(objective?: string): MissionStepView | null {
    const step = tutorialStepFor(state.step);
    if (!step) return null;
    const hint = deps.isTouch ? {
      walk: 'Reach the gold marker to continue. Optional: push the stick fully to sprint, or tap Ride for your scooter.',
      drive_ring: 'Get in a car (tap Enter / exit next to one), then DRIVE through the gold ring — walking won’t collect.',
      gps: 'Tap Map, pick the nearest event, then tap Set destination.',
      taxi: 'Tap Hail for a robotaxi, then walk through the event ring to collect — rides pay nothing, arriving does.',
    }[step.id] : step.hint;
    return { title: step.objective, objective: objective ?? hint,
      stepIndex: TUTORIAL_STEPS.findIndex(s => s.id === step.id), stepTotal: TUTORIAL_STEPS.length };
  }

  function enterStep(): void {
    if (state.step === 'intro' && !state.completed && deps.paintIntro) {
      deps.ui.hideSlides();
      deps.ui.setMissionStep({ title: `Paint ${deps.paintTarget ?? 'the Ferry Building'}`,
        objective: deps.isTouch ? 'Tap 🎨 to paintball it.' : 'Press Q to paintball it. X swaps paint / confetti / water.',
        stepIndex: 0, stepTotal: TUTORIAL_STEPS.length + 1 });
      return;
    }
    if (state.step === 'intro' && !state.completed) {
      deps.ui.showSlides(introSlides(deps.isTouch), { onComplete: finishIntro, onSkip: skip });
      return;
    }
    deps.ui.hideSlides();
    if (state.step === 'identity') { deps.ui.clearMission(); deps.ui.requestIdentity(); return; }
    const view = missionView();
    if (view) deps.ui.setMissionStep(view);
    else deps.ui.clearMission(); // done
  }

  function finishIntro(): void { state = advanceOnboarding(state); sync(); enterStep(); } // intro → walk

  function skip(): void {
    state = skipOnboarding(state);
    deps.ui.hideSlides(); deps.ui.clearMission(); deps.ui.clearHints?.();
    sync(); // reveals the full HUD
    deps.onSkipped?.();
  }

  function stepCleared(step: OnboardingStep): void {
    if (state.completed || state.step !== step) return; // ignore stale / out-of-order signals
    // The offline fallback can clear this step without a cheque; v3 has no Pre-seed round.
    if (step === 'intro' && deps.paintIntro) deps.ui.stinger('NICE SHOT', 'gold');
    if (step === 'drive_ring') deps.ui.stinger('ORIENTATION COMPLETE', 'pass');
    state = advanceOnboarding(state);
    if (state.step === 'done') deps.ui.stinger('MISSION PASSED', 'pass');
    sync();
    enterStep();
  }

  function tickHints(ctx: HintContext): void {
    deps.ui.updateHintContext?.(ctx);
    const hint = nextHint(state, ctx);
    if (!hint) return;
    state = markHintShown(state, hint);
    deps.ui.showHint(hint, ctx);
    sync();
  }

  function replay(): void { deps.ui.clearHints?.(); state = replayOnboarding(state); sync(); enterStep(); }

  let lastObjective = '';
  function updateObjective(text: string): void {
    if (state.completed || text === lastObjective) return;
    const view = missionView(text);
    if (view) { lastObjective = text; deps.ui.setMissionStep(view); }
  }

  return {
    start() { sync(); enterStep(); },
    stepCleared, tickHints, replay, updateObjective,
    emailPromptShown() { state = markEmailPrompted(state); deps.persist(state); },
    get state() { return state; },
  };
}
