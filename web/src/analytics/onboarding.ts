import { flags } from '@gtasf/shared/flags';
import type { OnboardingState } from '@gtasf/shared/onboarding/state';
import { analyticsContext, track } from './index';
import { isMobileDevice } from './heartbeat';

/** Analytics name of a step; the paint-first intro (playfulMayhem) reports as 'paint_ferry'. */
export const onboardingStepName = (state: OnboardingState) =>
  state.completed ? 'done' : state.step === 'intro' && flags.playfulMayhem ? 'paint_ferry' : state.step;

/** Only anonymous tutorial transitions. A late consent decision can observe the
 * current run, but returning completed profiles and skipped tutorials do not convert. */
export function observeOnboarding(initial: OnboardingState): (state: OnboardingState) => void {
  if (!flags.posthogAnalytics && !flags.xAdsPixel) return () => {};
  let seen = !initial.completed, completed = false, sentStart = false, sentComplete = false;
  const report = () => {
    if (!analyticsContext()) return;
    if (seen && !sentStart) { track('onboarding_start'); sentStart = true; }
    if (completed && !sentComplete) { track('onboarding_complete'); sentComplete = true; }
  };
  window.addEventListener('gtasf:analytics-ready', report);
  window.addEventListener('pagehide', () => window.removeEventListener('gtasf:analytics-ready', report), { once: true });
  report();
  let lastStep = onboardingStepName(initial);
  return state => {
    const step = onboardingStepName(state);
    if (step !== lastStep) { lastStep = step; if (analyticsContext()) track('onboarding_step', { step, is_mobile: isMobileDevice() }); }
    if (!state.completed) seen = true;
    if (seen && state.completed && !state.skipped) completed = true;
    report();
  };
}
