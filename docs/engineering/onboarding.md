# Onboarding (pane 14, gtasf-n34i)

Intro slides → first-visit SA mission tutorial → contextual hints, with a progressive HUD reveal, all
behind `flags.onboarding`. Plan: `PLAN-onboarding.md`. This doc is the integration contract for panes
6 (main.ts wiring), 8 (SA theme/styling) and 3 (identity screen).

## Architecture

The **logic is pure and shared** so the client drives the flow and the worker persists/validates the
same state. The DOM and the main-loop wiring are thin layers over it.

| Module | What it is | Status |
|---|---|---|
| `shared/onboarding/state.ts` | State machine: `OnboardingStep` (`intro→walk→drive_ring→identity→gps→taxi→done`), `HudPanel` progressive reveal, one-time `OnboardingHint` log; `freshOnboarding`/`returningOnboarding`/`advanceOnboarding`/`setOnboardingStep`/`skipOnboarding`/`replayOnboarding`, `panelsVisibleAt`/`isPanelVisible`, `hintPending`/`markHintShown`, `serializeOnboarding`/`parseOnboarding` | ✅ shipped, 8 tests |
| `worker/src/onboarding/store.ts` + `migrations/0024_onboarding.sql` | Per-device persistence: `getOnboardingState`/`saveOnboardingState` (upsert; re-serialized so a client can't smuggle fields) | ✅ shipped, 3 tests |
| `web/src/onboarding/slides.ts` | `introSlides(isTouch)` (3 slides, slide 3 = `controlsForDevice`), `nextSlide` | ✅ shipped, 3 tests |
| `shared/onboarding/tutorial.ts` | `TUTORIAL_STEPS` (objective/hint text per step), `ORIENTATION_RING` (cm, ~100 m from Ferry spawn), `insideOrientationRing`, `tutorialStepFor` | ✅ shipped, 4 tests |
| `web/src/onboarding/hints.ts` | `nextHint(state, ctx)` — one highest-priority pending hint, post-tutorial, once each; `IDLE_HINT_MS` | ✅ shipped, 6 tests |
| `web/src/onboarding/flow.ts` | **`createOnboardingFlow({state,isTouch,ui,persist})`** — the orchestration keystone: drives intro→tutorial→hints, HUD reveal + persistence; `start`/`stepCleared`/`tickHints`/`replay`. Dependency-inverted (`OnboardingUi` + `persist`), decoupled from pane-8's kit, the routes and the flag | ✅ shipped, 6 tests |
| `worker/src/onboarding/routes.ts` | `GET/POST /api/onboarding/state`, gated on `flags.onboarding` | ⏳ slice 2b — **blocked on `shared/flags.ts`** (held by another pane); needs the `onboarding` flag added |
| Orientation one-time award | tutorial drive_ring pays once via funding credit (server-validated with `insideOrientationRing`) | ⏳ slice 3 (funding coordination) |
| DOM overlays | intro-slides view + tutorial overlay (mission text, markers) | ⏳ slices 4b/5b (pane-8 theme) |

## Fresh vs returning (server, slice 2b)

`GET /api/onboarding/state` resolves the device via `ensureFundingDevice`, then:
- a saved `onboarding_state` row → return it (`parseOnboarding`);
- else an established profile (non-empty `funding_profiles.startup_name`) → `returningOnboarding()` (full HUD);
- else (brand-new) → `freshOnboarding()` (start the tutorial).

The client POSTs the serialized state as the player advances each step / a hint is shown, so progress
survives a reload.

## For pane 6 (main.ts wiring — deploy #4; replaces the keyboard-trapping startup modal)

The pane-8 glue lives in **`web/src/onboarding/integrate.ts`** (`setupOnboarding`, wired into main.ts),
which inlines the `OnboardingUi` adapter over pane-8's `SaIntroSlides`/`SaMissionBanner`/`saMissionStinger`/`SaHintChips`.
(`saUi.ts` is an earlier parallel adapter, now unused — fold any gaps into `integrate.ts` and delete it.)
main.ts writes `applyHudReveal` (you own the HUD handles), creates the **SA identity screen**
(`createIdentityScreen`, `web/src/hud/identity.ts` — username via pane 13, startup name, sex, archetype,
recovery offer; NOT the legacy `fundingHud.openIdentity` cream modal) and passes
`requestIdentity → identityScreen.open()` (identity **after** the first payout), creates the flow, and
feeds loop signals:
```ts
if (flags.onboarding) {
  // Post-first-payout identity screen (contract: web/src/hud/IDENTITY.md). onSave persists the startup
  // name + claims the username (POST /api/friends/username); onComplete offers recovery + clears the step.
  const identityScreen = createIdentityScreen({
    onSave: async c => { /* funding.saveIdentity(c.startupName, c.username) + friends.claimUsername + cosmetics */ },
    onComplete: () => { recovery?.offer(); onboarding?.stepCleared('identity'); },
    onModalChange: setInputPaused,
  });
  const ui = createOnboardingUi({ revealPanels: applyHudReveal, requestIdentity: () => identityScreen.open() });
  const state = (await loadOnboardingState()) ?? (fundingProfile?.startupName ? returningOnboarding() : freshOnboarding());
  onboarding = createOnboardingFlow({ state, isTouch: input?.source === 'virtual', ui, persist: saveOnboardingState });
  onboarding.start();
}
```
**Legacy modal auto-open (the keyboard trap): already fixed in `ce2147a`** — the `main.ts:768`
`fundingHud.openIdentity(...)` auto-open was removed outright (replaced with a non-modal notify nudge),
so it never auto-opens regardless of flag; nothing more to gate. The modal stays reachable on explicit
click. When onboarding ships, the identity step uses the SA `createIdentityScreen` above, not that modal. Signals: `insideOrientationRing(foot.x,foot.z)` while driving →
`onboarding.stepCleared('drive_ring')`; GPS set → `'gps'`; collect at the routed event → `'taxi'`; per
frame → `onboarding.tickHints(ctx)`; Game-options "Replay tutorial" → `onboarding.replay()`.

The controller (`createOnboardingFlow`) owns the sequencing — pane 6 only gates it, adapts the UI and
feeds it signals. It does **not** touch HUD/state logic directly.

1. If `flags.onboarding`: `GET /api/onboarding/state`, then
   `const flow = createOnboardingFlow({ state, isTouch, ui, persist })` where:
   - `ui` adapts pane-8's kit to `OnboardingUi`: `showSlides`→`new SaIntroSlides(slides, {onComplete,onSkip})`,
     `setMissionStep`→`SaMissionBanner.setStep`, `stinger`→`saMissionStinger`, `showHint`→`SaHintChips`,
     `revealPanels`→show/hide the HUD panels, `requestIdentity`→pane-3 identity screen;
   - `persist(state)` → `POST /api/onboarding/state` (serialized).
   `introSlides(isTouch)` output passes straight into `SaIntroSlides` (structurally compatible).
2. Call `flow.start()` once. Then from the game loop:
   - on entering the Orientation ring → `flow.stepCleared('drive_ring')` (also award server-side, slice 3);
     on GPS set → `stepCleared('gps')`; on collecting at the event → `stepCleared('taxi')`;
     when the pane-3 identity screen finishes → `stepCleared('identity')`.
   - each tick → `flow.tickHints(ctx)` (it shows at most one post-tutorial hint, once each).
3. "Replay tutorial" in Game options → `flow.replay()`.

The controller persists + reveals the HUD on every transition, so pane 6 needs no onboarding state logic
of its own. Drive-through detection geometry is `insideOrientationRing(pose.x, pose.z)` from `tutorial.ts`.

## Stubbed dependencies (keep working until they land)

scooter (pane 1), instant robotaxi (pane 5), radar icons (pane 4), unique usernames (pane 13),
archetypes (pane 7). The tutorial text references them but each step completes on its own signal, so a
missing dependency never blocks the mission.

## Other panes

- **Pane 8:** style the slide layout, SA mission text/objective banner and hint chips in the shared theme.
- **Pane 3:** the post-first-payout identity screen (`identity` step) — username (pane 13), startup name,
  sex, archetype (pane 7) — then the recovery-code offer.
