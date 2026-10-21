# Onboarding SA UI kit — contract for pane 14 (gtasf-ha2l)

The shared San Andreas **presentation layer** for onboarding (PLAN-onboarding.md pane-8 row). Pure UI:
no onboarding state, persistence, awards or flag checks — pane 14 owns those and drives this kit from the
`onboarding` state machine. Everything is in `web/src/theme/saMission.ts` (+ `saMission.css`, self-imported).
Tokens come from `theme/saTheme.css` (already imported once at the app entry).

## Import

```ts
import {
  SaIntroSlides, SaMissionBanner, SaHintChips, SaObjectiveArrow, saMissionStinger,
} from '../theme/saMission';
```

## Intro slides (3 SA poster slides, Skip always visible, any key / tap advances)

```ts
const intro = new SaIntroSlides([
  { kicker: 'San Francisco · Tech Week', title: "You're a founder. Raise money.",
    body: 'Build the biggest startup in the city.', imageSrc: '/art/loading/slide1.png' },
  { title: 'Drive through events, catch VC drops, find hidden angels.', imageSrc: '/art/loading/slide2.png' },
  { title: 'Controls',
    controls: isTouch
      ? [{ keys: 'DRAG', label: 'Look around' }, { keys: 'STICK', label: 'Move' }, { keys: 'TAP', label: 'Enter / pitch' }]
      : [{ keys: 'W A S D', label: 'Move' }, { keys: 'SHIFT', label: 'Sprint' }, { keys: 'E', label: 'Enter car / pitch' }, { keys: 'M', label: 'Map' }] },
], {
  onSkip: () => onboarding.skipToFullHud(),
  onComplete: () => onboarding.startTutorial(),
});
intro.mount(); // Esc also skips. Call intro.destroy() if you need to tear it down early.
```

Slides render without `imageSrc` (graded gradient placeholder) so you are not blocked on pane 9's art.

## Mission objective banner (persistent per step)

```ts
const banner = new SaMissionBanner();
banner.setStep({ title: 'GET IN THE CAR', objective: 'Drive through the Founder Orientation ring',
  reward: '+$5,000', step: { index: 1, total: 5 } }); // 0-based index; renders STEP 2 OF 5 + dots
banner.hide();     // between steps
banner.destroy();  // tutorial over
```

## Mission stinger (big centre one-shot)

```ts
saMissionStinger('PRE-SEED CLOSED', { sub: '+$5,000', variant: 'pass' }); // green; auto-dismisses ~2.2s
saMissionStinger('MISSION PASSED', { variant: 'gold' });
// Returns { el, dismiss }; pass holdMs: 0 to keep it until you call dismiss().
```

This is the onboarding-scoped stinger; funding/award toasts stay with their own systems (gtasf-96rj).

## Hint chips (contextual, show-once; pane 14 keys + logs them)

```ts
const hints = new SaHintChips();
hints.show('enter-car', 'to enter the car', { variant: 'prompt', keyGlyph: 'E' });   // centre-bottom
hints.show('idle-event', 'Nearest event 400 m — press M', { variant: 'nudge', timeoutMs: 6000 }); // idle
hints.show('touch-move', 'Move', { variant: 'touch', anchor: { x: joyX, y: joyY } });  // phone control label
hints.hide('enter-car');
hints.has('idle-event'); // dedupe so a hint shows once
```

## Gold objective arrow (edge indicator)

Pane 14 projects the world marker to screen px each frame and calls `update`:

```ts
const arrow = new SaObjectiveArrow();
// in the render loop, with the marker projected to screen coords:
arrow.update(screenX, screenY, { w: innerWidth, h: innerHeight },
  { distanceM: metresToMarker, hideWhenOnScreen: true });
arrow.hide(); // objective cleared
```

Off-screen it clamps to the viewport edge and rotates toward the marker; on-screen (with
`hideWhenOnScreen`) it hides so your 3D world ring/beacon takes over (see `web/src/drops/checkpoint.ts`
for the gold ring + bobbing cone precedent).

## Pure helpers (also exported, unit-tested)

- `objectiveArrowLayout(targetX, targetY, {w,h}, inset?)` → `{ x, y, angleDeg, onScreen }`
- `advanceSlide(current, total)` → `{ index, done }`

## Wiring from `onboarding/slides.ts` + `onboarding/hints.ts` (pane 14)

Pane 14's `onboarding/slides.ts` already imports this kit's `IntroSlide`/`ControlHint` as the single
source of truth and produces them directly (keyboard vs touch, `imageSrc` under `art/loading/`), so
the slides wire with no mapping:

```ts
import { introSlides } from '../onboarding/slides';
new SaIntroSlides(introSlides(isTouch), { onSkip, onComplete }).mount(); // behind flags.onboarding
```

- **Hints**: `nextHint(state, ctx)` picks *which* hint; map each to a chip. Suggested variant mapping:
  - first-time explanation / ambient prompt near a thing → `variant: 'prompt'` + a `keyGlyph` (E/M/T)
  - idle nudge (after `IDLE_HINT_MS`) → `variant: 'nudge'`, `timeoutMs: ~6000`
  - `touchControls` labels → `variant: 'touch'` + `anchor: {x,y}` of each control

```ts
const chips = new SaHintChips();
const h = nextHint(state, ctx);
if (h && !chips.has(h.id)) chips.show(h.id, h.text, { variant: h.variant, keyGlyph: h.keyGlyph, timeoutMs: h.idle ? 6000 : 0 });
```

`advanceSlide` here and pane 14's `nextSlide` are interchangeable (same `{ index, done }` shape).

### `OnboardingUi` adapter (pane 6)

`onboarding/flow.ts` drives a pane-14 `OnboardingUi` interface; here's the exact adapter onto this kit.
Note the one field remap: `MissionStepView` is flat (`stepIndex`/`stepTotal`), the banner nests `step`.

```ts
let slides: SaIntroSlides | undefined, banner: SaMissionBanner | undefined;
const chips = new SaHintChips();
const ui: OnboardingUi = {
  showSlides: (s, h) => { slides = new SaIntroSlides(s, h).mount(); },
  hideSlides: () => slides?.destroy(),
  setMissionStep: v => (banner ??= new SaMissionBanner()).setStep({
    title: v.title, objective: v.objective, step: { index: v.stepIndex, total: v.stepTotal },
  }),
  clearMission: () => banner?.clear(),
  stinger: (text, variant) => { saMissionStinger(text, { variant }); },
  showHint: h => { if (!chips.has(h.id)) chips.show(h.id, h.text, { variant: h.variant, keyGlyph: h.keyGlyph, timeoutMs: h.idle ? 6000 : 0 }); },
  revealPanels: () => { /* pane 6/1: toggle the existing HUD panels — not this kit */ },
  requestIdentity: () => { /* pane 3: post-first-payout identity screen */ },
};
```

The gold `SaObjectiveArrow` isn't part of `OnboardingUi`; drive it from your marker/projection loop
(`arrow.update(screenX, screenY, {w,h}, {distanceM, hideWhenOnScreen:true})`) when a tutorial step has
a world objective, or skip it if the 3D ring is enough.

## Notes

- Everything is `pointer-events: none` except the intro **Skip** button, so the HUD never eats input.
- `role="status"` / `aria-live` on the banner, stinger and chips for screen readers.
- Responsive to 390 px; respects `prefers-reduced-motion` and safe-area insets.
- Gate all of it behind `flags.onboarding` at your call sites.
