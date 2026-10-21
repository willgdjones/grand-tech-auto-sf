import { describe, expect, it } from 'vitest';
import { createOnboardingFlow, type OnboardingUi, type MissionStepView, type StingerVariant } from './flow';
import { freshOnboarding, returningOnboarding, type OnboardingState, type HudPanel, type OnboardingHint } from '@gtasf/shared/onboarding/state';
import type { HintContext } from './hints';

const NO_CTX: HintContext = {
  nearCar: false, nearAngel: false, nearPlayer: false, firstDrop: false, firstRumour: false,
  firstRound: false, firstFriendRequest: false, idleMs: 0, isTouch: false,
};

function harness(initial: OnboardingState) {
  const saved: OnboardingState[] = [];
  let panels: HudPanel[] = [];
  const stingers: { text: string; variant: StingerVariant }[] = [];
  const hints: OnboardingHint[] = [];
  const missions: MissionStepView[] = [];
  let identity = 0, slidesShown = 0, slidesHidden = 0;
  let handlers: { onComplete: () => void; onSkip: () => void } | undefined;
  const ui: OnboardingUi = {
    showSlides: (_s, h) => { slidesShown++; handlers = h; },
    hideSlides: () => { slidesHidden++; },
    setMissionStep: s => missions.push(s),
    clearMission: () => {},
    stinger: (text, variant) => stingers.push({ text, variant }),
    showHint: h => hints.push(h),
    revealPanels: p => { panels = [...p]; },
    requestIdentity: () => { identity++; },
  };
  const flow = createOnboardingFlow({ state: initial, isTouch: false, ui, persist: s => saved.push(s) });
  return {
    flow, saved, stingers, hints, missions,
    get panels() { return [...panels].sort(); },
    get identity() { return identity; }, get slidesShown() { return slidesShown; }, get slidesHidden() { return slidesHidden; },
    complete: () => handlers!.onComplete(), skip: () => handlers!.onSkip(),
  };
}
const has = (h: ReturnType<typeof harness>, panel: HudPanel) => h.panels.includes(panel);

describe('onboarding flow controller', () => {
  it('runs a fresh player intro → tutorial → done with the right stingers and HUD reveals', () => {
    const h = harness(freshOnboarding());
    h.flow.start();
    expect(h.slidesShown).toBe(1);
    expect(has(h, 'radar') && has(h, 'funding')).toBe(true);
    expect(has(h, 'map')).toBe(false);

    h.complete();                       // intro → walk
    expect(h.flow.state.step).toBe('walk');
    expect(h.missions.at(-1)!.title.length).toBeGreaterThan(0);

    h.flow.stepCleared('walk');         // → drive_ring
    expect(h.flow.state.step).toBe('drive_ring');

    h.flow.stepCleared('drive_ring');   // orientation complete → identity, without claiming a funding round
    expect(h.stingers.at(-1)).toEqual({ text: 'ORIENTATION COMPLETE', variant: 'pass' });
    expect(h.flow.state.step).toBe('identity');
    expect(h.identity).toBe(1);
    expect(has(h, 'wardrobe') && has(h, 'friends')).toBe(true);
    expect(has(h, 'map')).toBe(false);

    h.flow.stepCleared('identity');     // → gps
    expect(h.flow.state.step).toBe('gps');
    expect(has(h, 'map') && has(h, 'events')).toBe(true);

    h.flow.stepCleared('gps');          // → taxi
    expect(has(h, 'chat')).toBe(true);

    h.flow.stepCleared('taxi');         // → done, MISSION PASSED
    expect(h.flow.state.completed).toBe(true);
    expect(h.stingers.at(-1)).toEqual({ text: 'MISSION PASSED', variant: 'pass' });
    expect(has(h, 'map') && has(h, 'chat') && has(h, 'outbid')).toBe(true);
    expect(h.saved.at(-1)!.completed).toBe(true); // persisted
  });

  it('ignores out-of-order step signals', () => {
    const h = harness(freshOnboarding());
    h.flow.start(); h.complete(); // at walk
    h.flow.stepCleared('gps');    // not the current step
    expect(h.flow.state.step).toBe('walk');
  });

  it('skip unlocks the full HUD immediately', () => {
    const h = harness(freshOnboarding());
    h.flow.start();
    h.skip();
    expect(h.flow.state.completed).toBe(true);
    expect(h.flow.state.skipped).toBe(true);
    expect(has(h, 'map') && has(h, 'friends') && has(h, 'chat')).toBe(true);
    expect(h.slidesHidden).toBeGreaterThan(0);
  });

  it('a returning player starts with the full HUD and no slides', () => {
    const h = harness(returningOnboarding());
    h.flow.start();
    expect(h.slidesShown).toBe(0);
    expect(has(h, 'map') && has(h, 'chat')).toBe(true);
  });

  it('surfaces contextual hints only after the tutorial, once each', () => {
    const during = harness(freshOnboarding());
    during.flow.start();
    during.flow.tickHints({ ...NO_CTX, nearCar: true });
    expect(during.hints).toEqual([]); // suppressed mid-tutorial

    const after = harness(returningOnboarding());
    after.flow.start();
    after.flow.tickHints({ ...NO_CTX, nearCar: true });
    after.flow.tickHints({ ...NO_CTX, nearCar: true });
    expect(after.hints).toEqual(['enterCar']); // shown once
  });

  it('replay restarts the intro and re-gates the HUD', () => {
    const h = harness(returningOnboarding());
    h.flow.start();
    h.flow.replay();
    expect(h.flow.state.step).toBe('intro');
    expect(h.slidesShown).toBe(1);
    expect(has(h, 'map')).toBe(false);
  });
});

describe('onboarding skip hook', () => {
  it('notifies onSkipped once when the player skips the intro', () => {
    let skipped = 0;
    let handlers: { onComplete: () => void; onSkip: () => void } | undefined;
    const noop = () => {};
    const flow = createOnboardingFlow({
      state: freshOnboarding(), isTouch: false, persist: noop, onSkipped: () => { skipped++; },
      ui: { showSlides: (_s, h) => { handlers = h; }, hideSlides: noop, setMissionStep: noop, clearMission: noop, stinger: noop, showHint: noop, revealPanels: noop, requestIdentity: noop },
    });
    flow.start(); handlers!.onSkip();
    expect(skipped).toBe(1);
    expect(flow.state.completed && flow.state.skipped).toBe(true);
  });
});
