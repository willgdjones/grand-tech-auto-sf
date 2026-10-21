# Procedural environment clock refresh

`gtasf-bqt8` retains the procedural fallback handle from `loadRealisticEnvironment`
and exposes its current texture plus an optional update method. The foundation
updates that handle on its existing atmosphere grade resample (30 seconds, or
immediately on a larger clock override). Ordinary frames do not regenerate it.
The first load uses the selected time override, and a late load catches up to the
latest sampled grade before being assigned to the scene.

The environment handle owns whole PMREM render targets. Replacement disposes the
old target, preserving the current one until its replacement succeeds. Disposal
is idempotent; the foundation aborts its pending HDRI lookup, and any result that
arrives after disposal is released instead of being mounted.

The existing `realisticRender` flag controls the entire path and remains off.
Both graphics presets use the same update cadence. The PS2 render path receives
no environment load or refresh. Successfully loaded HDRI images keep their
existing startup bucket; this task fixes the procedural fallback, which is the
current path while no HDRI ships. No new asset, provider or recurring request was
added.

The focused smoke uses the actual foundation, time-grade sampler, loader and
procedural gradient scene, replacing only GPU rendering. It checks noon and
night scene textures/colours, no refresh in an ordinary 10-second interval, a
refresh at 30 seconds, one network lookup, disposal of every replaced target,
and no late fallback allocation after its renderer is disposed. It does not
establish actual GPU rendering, desktop/phone appearance or performance.

Validation on 2026-10-04 through `tools/heavy.sh`: all 10 targeted checks in
`realisticEnvironment.test.ts`, `realistic.test.ts`, `proceduralEnv.test.ts` and
`foundation.test.ts` passed. The final lifecycle smoke also passed after the
last edit. An initial workspace check caught two concurrent storefront bounds
errors. Its owner corrected them, then TopazIsland and RedIsland independently
reported clean shared web strict checks after source commit `93c7c54` (Agent
Mail 6093 and 6095, 06:44 UTC). The unchanged changelog entry shipped in
RedIsland's coordinated `91bc643` commit. No redundant check was left running.

Remaining visual acceptance: with the realistic renderer enabled by its owner,
switch Day to Night in Game options on desktop and phone Low and inspect glass
or metallic car surfaces for matching reflections, without console errors.
Keep the bead open until that evidence is recorded; no production flag flip is
part of this patch.
