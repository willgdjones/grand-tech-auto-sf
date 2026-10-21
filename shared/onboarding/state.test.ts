import { describe, expect, it } from 'vitest';
import {
  freshOnboarding, returningOnboarding, advanceOnboarding, setOnboardingStep, skipOnboarding, replayOnboarding,
  panelsVisibleAt, isPanelVisible, hintPending, markHintShown, serializeOnboarding, parseOnboarding,
  ONBOARDING_STEPS, ALL_HUD_PANELS, MAX_EMAIL_PROMPTS, emailPromptPending, markEmailPrompted, type OnboardingState,
} from './state';

describe('onboarding state machine', () => {
  it('a fresh player starts at the intro with only radar + funding', () => {
    const s = freshOnboarding();
    expect(s).toEqual({ step: 'intro', hints: [], completed: false, skipped: false, emailPrompts: 0 });
    expect(panelsVisibleAt(s)).toEqual(new Set(['radar', 'funding']));
    expect(isPanelVisible(s, 'map')).toBe(false);
    expect(isPanelVisible(s, 'radar')).toBe(true);
  });

  it('advances through every step and completes at done', () => {
    let s = freshOnboarding();
    const seen = [s.step];
    for (let i = 0; i < ONBOARDING_STEPS.length + 2; i++) { s = advanceOnboarding(s); seen.push(s.step); }
    expect(seen.slice(0, ONBOARDING_STEPS.length)).toEqual([...ONBOARDING_STEPS]);
    expect(s.step).toBe('done');
    expect(s.completed).toBe(true);
    expect(advanceOnboarding(s).step).toBe('done'); // idempotent at the end
  });

  it('reveals panels progressively, and everything once completed', () => {
    let s = freshOnboarding();
    expect(isPanelVisible(s, 'wardrobe')).toBe(false);
    s = setOnboardingStep(s, 'identity');
    expect(isPanelVisible(s, 'wardrobe')).toBe(true);
    expect(isPanelVisible(s, 'map')).toBe(false);   // map not until GPS
    s = setOnboardingStep(s, 'gps');
    expect(isPanelVisible(s, 'map')).toBe(true);
    expect(isPanelVisible(s, 'chat')).toBe(false);  // chat not until taxi
    s = setOnboardingStep(s, 'taxi');
    expect(isPanelVisible(s, 'chat')).toBe(true);
    s = advanceOnboarding(s); // -> done
    expect(panelsVisibleAt(s)).toEqual(new Set(ALL_HUD_PANELS));
  });

  it('skip unlocks the full HUD immediately and marks skipped', () => {
    const s = skipOnboarding(freshOnboarding());
    expect(s.step).toBe('done');
    expect(s.completed).toBe(true);
    expect(s.skipped).toBe(true);
    expect(panelsVisibleAt(s)).toEqual(new Set(ALL_HUD_PANELS));
  });

  it('returning players get the full HUD and keep their hint log', () => {
    const s = returningOnboarding(['firstDrop']);
    expect(s.completed).toBe(true);
    expect(isPanelVisible(s, 'friends')).toBe(true);
    expect(hintPending(s, 'firstDrop')).toBe(false);
    expect(hintPending(s, 'firstRound')).toBe(true);
  });

  it('replay restarts the tutorial but preserves already-shown hints', () => {
    const played: OnboardingState = { step: 'done', hints: ['enterCar', 'idleNudge'], completed: true, skipped: false, emailPrompts: 2 };
    const s = replayOnboarding(played);
    expect(s.step).toBe('intro');
    expect(s.completed).toBe(false);
    expect(s.hints).toEqual(['enterCar', 'idleNudge']);
    expect(s.emailPrompts).toBe(2); // replay keeps the email-prompt count (don't re-nag a verified player)
    expect(isPanelVisible(s, 'map')).toBe(false); // HUD re-gated during replay
  });

  it('shows each one-time hint only once', () => {
    let s = freshOnboarding();
    expect(hintPending(s, 'enterCar')).toBe(true);
    s = markHintShown(s, 'enterCar');
    expect(hintPending(s, 'enterCar')).toBe(false);
    expect(markHintShown(s, 'enterCar')).toBe(s); // idempotent, same ref
  });

  it('round-trips through serialize/parse and coerces malformed state', () => {
    const s: OnboardingState = { step: 'gps', hints: ['firstDrop', 'chatNear'], completed: false, skipped: false, emailPrompts: 1 };
    expect(parseOnboarding(serializeOnboarding(s))).toEqual(s);
    expect(parseOnboarding('not json')).toEqual(freshOnboarding());
    expect(parseOnboarding(null)).toEqual(freshOnboarding());
    expect(parseOnboarding({ step: 'bogus', hints: ['nope', 'firstDrop'], completed: 'yes' }))
      .toEqual({ step: 'intro', hints: ['firstDrop'], completed: false, skipped: false, emailPrompts: 0 });
    // step 'done' implies completed even if the stored flag is missing.
    expect(parseOnboarding({ step: 'done', hints: [] }).completed).toBe(true);
    // duplicate hints are de-duped.
    expect(parseOnboarding({ step: 'walk', hints: ['firstDrop', 'firstDrop'] }).hints).toEqual(['firstDrop']);
  });
});

describe('email-capture prompt state (emailCapture, gtasf-1aon)', () => {
  it('a fresh player has used no prompts and is still promptable', () => {
    const s = freshOnboarding();
    expect(s.emailPrompts).toBe(0);
    expect(emailPromptPending(s)).toBe(true);
  });

  it('counts prompts up to the cap, then is no longer promptable (idempotent at the cap)', () => {
    let s = freshOnboarding();
    s = markEmailPrompted(s);                 // after the first cheque
    expect(s.emailPrompts).toBe(1);
    expect(emailPromptPending(s)).toBe(true); // still one gentle re-prompt left (the first star)
    s = markEmailPrompted(s);                 // at the first star
    expect(s.emailPrompts).toBe(MAX_EMAIL_PROMPTS);
    expect(emailPromptPending(s)).toBe(false);
    expect(markEmailPrompted(s)).toBe(s);     // capped: same ref, never a third auto-prompt
  });

  it('round-trips the prompt count and clamps malformed values on parse', () => {
    expect(parseOnboarding(serializeOnboarding({ step: 'walk', hints: [], completed: false, skipped: false, emailPrompts: 1 })).emailPrompts).toBe(1);
    expect(parseOnboarding({ step: 'walk', emailPrompts: -3 }).emailPrompts).toBe(0);
    expect(parseOnboarding({ step: 'walk', emailPrompts: 99 }).emailPrompts).toBe(MAX_EMAIL_PROMPTS);
    expect(parseOnboarding({ step: 'walk', emailPrompts: 'nope' }).emailPrompts).toBe(0);
    expect(parseOnboarding({ step: 'walk' }).emailPrompts).toBe(0); // missing field -> 0
  });
});
