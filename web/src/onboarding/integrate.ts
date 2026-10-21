/**
 * Onboarding ↔ main.ts integration (pane 6 wiring, gtasf-n34i). Collision-free module: it fetches the
 * per-device onboarding state, adapts pane-8's SA kit (SaIntroSlides/SaMissionBanner/SaHintChips/
 * saMissionStinger) to the `OnboardingUi` the flow controller drives, persists to /api/onboarding/state,
 * and starts the flow. main.ts supplies only the two bits that need its context (HUD panel visibility and
 * the pane-3 identity screen) and feeds loop signals (stepCleared / tickHints) + game-options replay.
 *
 * Everything is gated on flags.onboarding at the single call site, so when the flag is off this is a no-op.
 */
import { flags } from '@gtasf/shared/flags';
import { observeOnboarding } from '../analytics/onboarding';
import {
  freshOnboarding,
  type OnboardingState, type HudPanel,
} from '@gtasf/shared/onboarding/state';
import type { OnboardingHint } from '@gtasf/shared/onboarding/state';
import { createOnboardingFlow, type OnboardingUi, type OnboardingFlow } from './flow';
import { formatIdleNudge, IDLE_HINT_MS } from './hints';
import { applyHudReveal } from './hudReveal';
import { loadOnboardingState, saveOnboardingState } from './api';
import { SaIntroSlides, SaMissionBanner, SaHintChips, saMissionStinger, type HintVariant } from '../theme/saMission';

/** Pane-6 display mapping for each contextual hint id (text/variant/key), per the UI-kit variant guidance:
 *  near-object prompts get a key glyph; first-time explanations + the idle nudge are 'nudge'; touch is 'touch'. */
const HINT_DISPLAY: Record<OnboardingHint, { text: string; variant: HintVariant; keyGlyph?: string; idle?: boolean }> = {
  enterCar: { text: 'to get in the car', variant: 'prompt', keyGlyph: 'E' },
  pitchAngel: { text: 'to pitch this angel', variant: 'prompt', keyGlyph: 'E' },
  chatNear: { text: 'to chat', variant: 'prompt', keyGlyph: 'T' },
  firstDrop: { text: 'A VC fund just dropped — drive through the briefcase to pitch.', variant: 'nudge' },
  firstRumour: { text: 'An angel rumour is nearby — explore the glowing zone.', variant: 'nudge' },
  firstRound: { text: 'A funding round closed — check your cap table.', variant: 'nudge' },
  firstFriendRequest: { text: 'New friend request — open Friends to accept.', variant: 'nudge' },
  idleNudge: { text: `Press M for the map, ${flags.proximityVoice ? 'J' : 'V'} for events.`, variant: 'nudge', idle: true },
  touchControls: { text: 'Drag to look · stick to move', variant: 'touch' },
};
const TOUCH_PROMPTS: Partial<Record<OnboardingHint, string>> = {
  enterCar: 'Tap Enter / exit to get in the car.',
  pitchAngel: 'Tap Enter / exit to pitch this angel.',
  chatNear: 'Tap Chat to say hello.',
};

export interface OnboardingHooks {
  isTouch: boolean;
  /** Progressive HUD reveal; defaults to the selector-based applyHudReveal (hudReveal.ts). */
  revealPanels?(panels: HudPanel[]): void;
  /** main.ts/pane 3: show the post-first-payout identity screen; on finish call flow.stepCleared('identity'). */
  requestIdentity(): void;
  /** The player skipped the intro/tutorial (see OnboardingDeps.onSkipped). */
  onSkipped?(): void;
  /** Step-1 paint target label (default 'the Ferry Building'). */
  paintTarget?: string;
  /** Injectable for tests; defaults to the real endpoint. */
  fetcher?: typeof fetch;
}

/**
 * Wire onboarding and return the running flow (or null when the flag is off). Call once after the HUD exists.
 * main.ts then feeds the loop: `flow.stepCleared('drive_ring'|'gps'|'taxi'|'identity')`, `flow.tickHints(ctx)`
 * each frame, and `flow.replay()` from Game options.
 */
export async function setupOnboarding(hooks: OnboardingHooks): Promise<OnboardingFlow | null> {
  if (!flags.onboarding || !flags.hud) return null;
  const fetcher = hooks.fetcher ?? fetch;
  const state = (await loadOnboardingState(fetcher)) ?? freshOnboarding();
  const reportOnboarding = observeOnboarding(state);

  const persist = (s: OnboardingState): void => {
    reportOnboarding(s);
    void saveOnboardingState(s, fetcher);
  };

  // Adapt pane-8's SA kit to OnboardingUi (docs/onboarding-ui-kit.md §OnboardingUi adapter).
  let slides: SaIntroSlides | undefined, banner: SaMissionBanner | undefined;
  const chips = new SaHintChips();
  // At most one pending notice per known hint id; no extra timers or per-frame DOM measurement.
  const pendingNotices = new Map<OnboardingHint, { text: string; timeoutMs: number }>();
  let activeNotice: OnboardingHint | undefined;
  const showNextNotice = () => {
    if (activeNotice && chips.has(activeNotice)) return;
    activeNotice = undefined;
    const next = pendingNotices.entries().next().value;
    if (!next) return;
    const [hint, notice] = next;
    pendingNotices.delete(hint);
    activeNotice = hint;
    chips.show(hint, notice.text, { variant: 'nudge', timeoutMs: notice.timeoutMs });
  };
  let touchLabel: HTMLElement | undefined, touchStick: HTMLElement | null = null, touchRoot: HTMLElement | null = null;
  let touchWidth = 0, touchHeight = 0;
  const hideTouchLabel = () => { chips.hide('touchControls'); touchLabel = undefined; touchStick = touchRoot = null; };
  const positionTouchLabel = () => {
    if (!touchLabel || !touchStick) return;
    // Fixed control geometry only changes with viewport size; never measure in the steady frame loop.
    if (touchWidth === innerWidth && touchHeight === innerHeight) return;
    touchWidth = innerWidth; touchHeight = innerHeight;
    const control = touchStick.getBoundingClientRect(), label = touchLabel.getBoundingClientRect();
    // Whole-pixel centres keep CSS subpixel rounding inside both edge margins.
    const x = Math.max(Math.ceil(12 + label.width / 2),
      Math.min(Math.floor(innerWidth - 12 - label.width / 2), Math.round(control.left + control.width / 2)));
    const y = Math.max(12 + label.height / 2, control.top - 8 - label.height / 2);
    touchLabel.style.left = `${x}px`; touchLabel.style.top = `${y}px`;
  };
  const ui: OnboardingUi = {
    showSlides: (s, h) => { slides = new SaIntroSlides(s, h).mount(); },
    hideSlides: () => slides?.destroy(),
    setMissionStep: v => (banner ??= new SaMissionBanner()).setStep({
      title: v.title, objective: v.objective, step: { index: v.stepIndex, total: v.stepTotal },
    }),
    clearMission: () => banner?.clear(),
    stinger: (text, variant) => { saMissionStinger(text, { variant }); },
    updateHintContext: ctx => {
      if (!ctx.nearCar) chips.hide('enterCar');
      if (!ctx.nearAngel) chips.hide('pitchAngel');
      if (!ctx.nearPlayer) chips.hide('chatNear');
      if (touchLabel) {
        if (!ctx.isTouch || touchRoot?.dataset.mode !== 'on-foot') hideTouchLabel();
        else positionTouchLabel();
      }
      if (ctx.idleMs < IDLE_HINT_MS) {
        chips.hide('idleNudge');
        pendingNotices.delete('idleNudge');
      }
      if (flags.onboardingNoticeQueue) showNextNotice();
    },
    clearHints: () => {
      pendingNotices.clear(); activeNotice = undefined;
      chips.clear(); touchLabel = undefined; touchStick = touchRoot = null;
    },
    showHint: (hint, ctx) => {
      if (chips.has(hint) || pendingNotices.has(hint)) return;
      const d = HINT_DISPLAY[hint];
      const touchText = (ctx?.isTouch ?? hooks.isTouch) ? TOUCH_PROMPTS[hint] : undefined;
      // The idle nudge names the nearest event's distance when pane 6 feeds it (PLAN decision 6).
      const text = hint === 'idleNudge' ? formatIdleNudge(ctx?.nearestEventM, ctx?.isTouch ?? hooks.isTouch) : touchText ?? d.text;
      // One-time explanations have no proximity exit to clear them. Give them reading time,
      // then release the notice band; target prompts and touch labels stay context-controlled.
      const timeoutMs = d.variant === 'nudge' ? (d.idle ? 6000 : 8000) : 0;
      if (flags.onboardingNoticeQueue && d.variant === 'nudge') {
        pendingNotices.set(hint, { text, timeoutMs });
        showNextNotice();
        return;
      }
      const chip = chips.show(hint, text, { variant: d.variant, keyGlyph: touchText ? undefined : d.keyGlyph, timeoutMs });
      if (hint === 'touchControls') {
        touchStick = document.querySelector<HTMLElement>('.gtasf-touch .stick');
        touchRoot = touchStick?.closest<HTMLElement>('.gtasf-touch') ?? null;
        if (!touchStick || touchStick.hidden) { hideTouchLabel(); return; }
        touchLabel = chip; touchWidth = touchHeight = 0; positionTouchLabel();
      }
    },
    revealPanels: panels => (hooks.revealPanels ?? applyHudReveal)(panels),
    requestIdentity: () => hooks.requestIdentity(),
  };

  const flow = createOnboardingFlow({ state, isTouch: hooks.isTouch, ui, persist, onSkipped: hooks.onSkipped, paintIntro: flags.playfulMayhem, paintTarget: hooks.paintTarget });
  flow.start();
  return flow;
}
