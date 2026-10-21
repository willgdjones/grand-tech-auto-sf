import { flags } from '@gtasf/shared/flags';
/**
 * Intro slides content (PLAN-onboarding.md decision 2, gtasf-n34i). Pane 14 owns WHAT the three SA
 * loading-screen slides say; pane 8's `SaIntroSlides` (web/src/theme/saMission.ts) owns how they look
 * and the skip/advance behaviour. These content types mirror pane 8's `IntroSlide`/`ControlHint`
 * field-for-field, so (TypeScript being structural) pane 6 passes the output straight in —
 *   new SaIntroSlides(introSlides(isTouch), { onComplete, onSkip, onAdvance })  // behind flags.onboarding
 * — without this module importing (and so coupling to) pane 8's evolving UI-kit types.
 *
 * Slide 3 shows the controls for the detected device (keyboard keys vs touch gestures). Poster art
 * (imageSrc) is supplied by pane 9 under web/public/art/loading/.
 */

/** A key-cap + label row, matching one arm of pane-8's `ControlHint`. */
export interface SlideControl { keys: string; label: string }
/** Structurally compatible with pane-8's `SaIntroSlides` `IntroSlide`. */
export interface IntroSlideContent {
  kicker?: string;
  title: string;
  body?: string;
  imageSrc?: string;
  imageAlt?: string;
  controls?: SlideControl[];
}

/** The control cheatsheet for slide 3, for the detected input device. Keyboard players get the core
 *  keys; touch players get gesture/button labels (they can't use key hints). */
export function controlsForDevice(isTouch: boolean): SlideControl[] {
  return isTouch
    ? [
        { keys: 'LEFT STICK', label: 'Move' },
        { keys: 'DRAG', label: 'Look around' },
        { keys: 'ENTER / EXIT', label: 'Get in / out of a car' },
        { keys: 'HAIL', label: 'Call a robotaxi' },
        { keys: 'MAP', label: 'Map & events' },
      ]
    : [
        { keys: 'W A S D', label: 'Walk / drive' },
        { keys: 'SHIFT', label: 'Run' },
        { keys: 'E', label: 'Get in / out of a car' },
        { keys: 'H', label: 'Hail a robotaxi' },
        { keys: 'M', label: 'Map' },
        { keys: flags.proximityVoice ? 'J' : 'V', label: 'Events' }, // V is push-to-talk with voice (upcoming.ts)
        { keys: 'T', label: 'Chat' },
      ];
}

/** The three intro slides for the detected device. */
export function introSlides(isTouch: boolean): IntroSlideContent[] {
  return [
    { kicker: 'SAN FRANCISCO · TECH WEEK', title: "You're a founder in San Francisco.", body: 'Raise money.', imageSrc: '/art/loading/onboarding-raise.webp', imageAlt: 'A founder on the Embarcadero at dawn' },
    { kicker: 'THE HUSTLE', title: 'Work the city.', body: 'Drive through Tech Week events, catch VC fund drops, and find hidden angels.', imageSrc: '/art/loading/onboarding-events.webp', imageAlt: 'Events and fund drops across the city' },
    { kicker: 'CONTROLS', title: isTouch ? 'Touch controls' : 'Keyboard controls', imageSrc: '/art/loading/onboarding-controls.webp', imageAlt: 'Control layout', controls: controlsForDevice(isTouch) },
  ];
}
