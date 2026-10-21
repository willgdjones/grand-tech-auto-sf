import { describe, expect, it, vi } from 'vitest';
import { nextHint, IDLE_HINT_MS, formatIdleNudge, type HintContext } from './hints';
import { freshOnboarding, returningOnboarding, markHintShown, setOnboardingStep, type OnboardingState } from '@gtasf/shared/onboarding/state';

vi.mock('@gtasf/shared/flags', () => ({ flags: { proximityVoice: true } }));

const CTX: HintContext = {
  nearCar: false, nearAngel: false, nearPlayer: false,
  firstDrop: false, firstRumour: false, firstRound: false, firstFriendRequest: false,
  idleMs: 0, isTouch: false,
};
const done = (): OnboardingState => returningOnboarding();

describe('contextual hint engine', () => {
  it('shows no contextual hints during the tutorial', () => {
    expect(nextHint(freshOnboarding(), { ...CTX, nearCar: true })).toBeNull();
    expect(nextHint(setOnboardingStep(freshOnboarding(), 'walk'), { ...CTX, nearCar: true, idleMs: IDLE_HINT_MS })).toBeNull();
  });

  it('allows phone labels after the slides and the enter-car prompt on the drive step', () => {
    expect(nextHint(freshOnboarding(), { ...CTX, isTouch: true })).toBeNull(); // slides showing
    expect(nextHint(setOnboardingStep(freshOnboarding(), 'walk'), { ...CTX, isTouch: true })).toBe('touchControls');
    expect(nextHint(setOnboardingStep(freshOnboarding(), 'drive_ring'), { ...CTX, nearCar: true })).toBe('enterCar');
  });

  it('surfaces a near-object prompt once the tutorial is done', () => {
    expect(nextHint(done(), { ...CTX, nearCar: true })).toBe('enterCar');
    expect(nextHint(done(), { ...CTX, nearAngel: true })).toBe('pitchAngel');
    expect(nextHint(done(), { ...CTX, nearPlayer: true })).toBe('chatNear');
  });

  it('prioritises a first-time event over an ambient prompt', () => {
    expect(nextHint(done(), { ...CTX, nearCar: true, firstDrop: true })).toBe('firstDrop');
  });

  it('never repeats a hint already logged', () => {
    const state = markHintShown(done(), 'enterCar');
    expect(nextHint(state, { ...CTX, nearCar: true })).toBeNull();
    // but a different pending+triggered hint still shows
    expect(nextHint(state, { ...CTX, nearCar: true, nearPlayer: true })).toBe('chatNear');
  });

  it('fires the idle nudge only past the threshold, below ambient-prompt priority', () => {
    expect(nextHint(done(), { ...CTX, idleMs: IDLE_HINT_MS - 1 })).toBeNull();
    expect(nextHint(done(), { ...CTX, idleMs: IDLE_HINT_MS })).toBe('idleNudge');
    expect(nextHint(done(), { ...CTX, idleMs: IDLE_HINT_MS, nearCar: true })).toBe('enterCar');
  });

  it('offers touch control labels on touch devices when nothing else applies', () => {
    expect(nextHint(done(), { ...CTX, isTouch: true })).toBe('touchControls');
    expect(nextHint(done(), CTX)).toBeNull();
  });
});

describe('idle-nudge copy (PLAN decision 6)', () => {
  it('names visible touch controls instead of keyboard shortcuts on phones', () => {
    expect(formatIdleNudge(420, true)).toBe('Nearest event 400 m → tap Map');
    expect(formatIdleNudge(undefined, true)).toBe('Tap Map or Tech Week events.');
  });
  it('names the nearest event distance when known, rounded to a friendly value', () => {
    expect(formatIdleNudge(400)).toBe('Nearest event 400 m → press M');
    expect(formatIdleNudge(420)).toBe('Nearest event 400 m → press M'); // nearest 50 m
    expect(formatIdleNudge(430)).toBe('Nearest event 450 m → press M');
    expect(formatIdleNudge(30)).toBe('Nearest event 50 m → press M');   // floored at 50 m
    expect(formatIdleNudge(1200)).toBe('Nearest event 1.2 km → press M');
  });
  it('falls back to the generic map/events prompt when distance is unknown or invalid', () => {
    const generic = 'Press M for the map, J for events.';
    expect(formatIdleNudge(undefined)).toBe(generic);
    expect(formatIdleNudge(0)).toBe(generic);
    expect(formatIdleNudge(-5)).toBe(generic);
    expect(formatIdleNudge(NaN)).toBe(generic);
  });
});
