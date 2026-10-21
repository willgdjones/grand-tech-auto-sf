# Funding-stage car integration — gtasf-looks-stage-cars-bjh6

`Round perks` keeps its existing opt-in appearance overlay. With `characterLooks`
enabled it selects a shipped fleet template from the player's current funding
round, using the shared `tierForRound` contract. With that flag off it retains
the VC coupe choice. The existing `fundingLoop` and `driving` gates still apply.

| Look tier | Car appearance available in this build |
|---|---|
| Bootstrapping | No driven-car overlay; scooter uses the personal ride system |
| Pre-seed / Seed | Hybrid commuter (`prius`) |
| Series A–C | Electric sedan (`model3`) |
| Series D–Z | Sports coupe (`vc-supercar`) |
| Unicorn / Pre-IPO | VC supercar (`vc-supercar`) |
| Decacorn / Hectocorn | Executive sedan (`model3`) |

These are aliases for the existing shipped fleet. Sports and supercar currently
share a model, as do the electric and executive sedans. The latter does not add
a chauffeur NPC or autonomous driving. The dedicated SA car art remains in
`gtasf-v21-sa-cars-uoon`; this change does not add downloaded models or textures.

Profile changes refresh the selected car, including downward round changes.
A failed replacement retains the current working model. Late loads after another
selection, disabling the look, demotion below Pre-seed, or teardown are disposed.
The overlay changes no funding, physics, collision bounds or network messages.

The helper contract for the appearance/fleet integrator is
`stageCarForRound(round): StageCarChoice | null`, plus `createStageCarSlot` for
owned template loading and disposal. `perks.ts` consumes it directly; there is no
new `main.ts` hook. Remote stage-car appearance is still part of `gtasf-hrmk`.

Validation passed on 2026-10-04 at approximately 09:40 UTC: the focused
`stageCar.test.ts` smoke loads the actual shipped GLBs through the template
builder, selects every car tier, and exercises failed and stale loads, demotion
and teardown. Web strict types also passed. The source is wired through the
existing Round perks call site; no new main-loop integration is required locally.

`characterLooks` remains off. The appearance integrator must review the enabled
car choices in the game, retain the separate scooter path, and add the player
changelog entry with activation. No enabled-path browser look, production flag
flip, remote appearance or device gate is claimed by the source smoke.
