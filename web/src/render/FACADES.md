# Procedural facade shader — gtasf-l857 (flag `proceduralFacades`, OFF)

`proceduralFacades` replaces the **facadeAtlas whole-wall images** with a procedural shader on the
active ps2 `addBuildingFacades` path (`facades.ts`). The façade is generated from per-building
attributes instead of sampling an atlas texture, so **no atlas image is fetched or decoded**.

## What it does

When the flag is on, `foundation.ts` does not create the `facadeAtlas` (no image fetch), but still
builds the per-chunk ground `DataTexture` and passes the night uniform into `addBuildingFacades`, which
enters its `procedural` branch. That branch keeps the existing authored window base (recess / frame /
divided glass / sill) and layers on, from per-building inputs:

- **Inputs** — land use (office / industrial / retail, from the source wall colour ratios), a stable
  per-building `variant` hash, the `districtFacade()` style (pure GLSL, reused from the atlas path), and
  `streetHeight = y − ground`. There is no per-building age/use attribute in the bake yet, so v1 derives
  the style from district + variant; a real per-building year/use attribute is a bake follow-up.
- **Colour** — SF stucco pastels on masonry/stucco, a cool per-building glass tint on towers.
- **Surface** — brick running bond (mortar grid in metres, half-brick offset on alternate courses) on
  masonry/industrial; a fine stucco grain elsewhere; windows kept clean via the recess mask.
- **Glass towers** — a curtain wall: floor-slab spandrels, a mullion grid, a per-floor sky-reflection
  gradient and a sprinkle of brighter reflective panes.
- **Masonry** — a pale stone belt course every 4 floors reads as a cornice line.
- **Storefront** — a darker glazed shopfront on the first ~3.6 m (offices, retail, downtown and ~30% of
  other buildings), a gentle plinth otherwise, and a ground-contact darkening so walls sit on the street.
- **Night** — warm window glow reusing the authored pane mask, driven by the wired night uniform
  (`foundation.ts:394`), with occupied rooms varying per building.

It replaces **only** the facadeAtlas whole-wall path. The separate `frontFacadeMapping` street-front
cells (`web/public/art/facades/*.webp`, ~5.3 MB) and `shopfrontSigns` / `buildingDetail` are untouched
in v1. The `realistic` render path (`applyRealisticMaterials`, only active when `graphicsV2` is off) is
not touched. With `graphicsV2` on (current build) the ps2 path is the active renderer, so this is
reachable.

## Budgets

Procedural facades **remove** an image fetch and its decode when on, and add no new texture, so they can
only help the load budget and cannot touch the 1 MP decoded-texture cap (nothing new is decoded). The
per-chunk ground `DataTexture` is the same tiny field the atlas path already used.

## Evidence so far

- `shared` + `web` `tsc --noEmit` clean after each commit.
- Shader-structure smoke `web/src/render/proceduralFacades.test.ts` (2 cases, passing): the procedural
  branch activates, emits `districtFacade()` + brick + mullion + storefront GLSL, does **not** reference
  `uFacadeAtlas`, and wires the ground + night uniforms (the night uniform is the same object, not a
  fresh `{ value: 0 }`).
- Flag OFF is byte-identical to before (`procedural = false`, `withGround === textured`, the procedural
  block is not emitted).

## Remaining — founder visual sign-off (flag stays OFF until then)

These are a look/decision gate, not something tests can establish:

1. In-browser GL compile + render check with the flag on (the structure smoke does not compile GLSL on a
   real context).
2. Look A/B: shipped facadeAtlas vs procedural, aerial tour + street level, HD **and** phone.
3. Bytes-saved cold-load trace (the dropped facadeAtlas image) and phone fps ON vs OFF
   (`tools/phone-perf.mjs`) on the shipped SF map.
4. Decision: whether to also replace the `frontFacadeMapping` street-front cells (the ~5.3 MB set) — a
   bigger look change and the larger byte saving.

Only after that sign-off does `proceduralFacades` go on in dev and into the prod flag allowlist.

## Measured evidence (ChartreuseCanyon/Opus, 2026-10-09)

Flag flipped on **locally for the measurement only, reverted to OFF** (not committed on).

**GL compile + render (item 1):** `tools/phone-perf.mjs` built the app with the flag ON and ran the
real game on a headless Metal GL context at two facade-dense spots on the full `sf` map. Both
scenarios came back `valid: true` with **0 page/GL errors and 0 http errors** — the procedural
shader compiles and renders on a real context, not just in the structure smoke. (The Oct-8 `after`
A/B captures corroborate this visually.)

**Phone fps ON vs OFF (item 3):** official phone harness (1080×2400 @ DPR 2.75, 4× CPU throttle,
`preset=low`, 2 s warmup, 120 samples), full `sf` map, procedural OFF (shipped atlas) vs ON:

| spot | OFF meanFps / p95 | ON meanFps / p95 |
|---|---|---|
| mission | 60.0 / 22.1 ms | 60.0 / 20.6 ms |
| soma | 60.0 / 20.8 ms | 60.0 / 21.4 ms |

**No fps cost: both hold 60 fps, p95 within ±1 ms (noise).** Caveat: both variants are vsync-capped
at 60 at these spots on the lean `sf` map (not GPU-bound — there is headroom), so this shows "no
regression within headroom" rather than the GPU-bound ALU-vs-texture cost; a denser scene would be a
stronger stress test. Reports: `docs/perf/l857-off/report.json`, `docs/perf/l857-on/report.json`.

**Bytes-saved cold-load (item 3):** with the flag ON, `foundation.ts` does not call
`createFacadeAtlas()`, so the whole-wall atlas fetch is dropped: `/art/manifest.json` (3.4 KB gz) +
`/art/facades/sf-facades.png` (62.8 KB, already compressed) = **~64.7 KB transfer (~74 KB raw)**.
Verified from the fetch path (`facadeAtlas.ts` fetches exactly these two) and the gating
(`foundation.ts:127`). **This is the whole v1 saving — small.** The `frontFacadeMapping` street-front
cells (`/art/facades/atlas.json` + `*.webp`, ~5.3 MB) use a **separate** manifest and are **not**
touched by v1, so they are still fetched both ways; the large byte saving only comes from item 4
(replacing the front-facade cells too), which is a bigger look change and a founder call.

**Look A/B (item 2):** street-level, HD + phone, shipped atlas vs procedural, at Mission / FiDi /
Marina — `docs/sf-data/look-l857-{mission,fidi,marina}-{desktop,phone}-{before,after}.jpg` (Oct-8,
real GPU, no blanks, zero page errors). An **aerial** A/B is still owed (the capture tool is
ground-level `?at=`); the facade materials read at street/mid scale, which these cover.

**Net for the founder gate:** the shader renders cleanly with no perf cost, but v1's byte saving is
only ~65 KB; the headline "replaces the AI atlas to save bytes" payoff needs the item-4 decision to
also replace the ~5.3 MB front-facade cells. Flag stays OFF pending the visual sign-off.

## v2 — layer on the atlas, don't replace it (flag `facadeReliefV2`, OFF)

Founder direction 2026-10-09: v1 looked flatter than the atlas, so **keep the reviewed atlas sample and
LAYER depth + variety on top of it** in the ps2 textured path (`facades.ts`), never replace it. The
`${RELIEF}` block (byte-identical when the flag is off) adds, on top of `painted`:

- **Window/floor depth** — a per-storey lintel shadow + lit sill ledge, a vertical pier shadow between
  bays, and a set-back (darkened/cooled) glazing read off the atlas window ink.
- **Per-building tint + brightness** — a stable per-building glass/stone cast from an 8-tint SF palette
  and a brightness spread, applied to **all** styles including the plain glass/office towers (style 2),
  which the shipped pastel path skips.

**Honest A/B verdict (ChartreuseCanyon/Opus, 2026-10-09, dense `sf-fit-3dep`, desktop + phone, 0 console
errors):** `docs/sf-data/facade-v2-{mission,haight,soma}-ab.jpg` (before | after). The effect is **near
imperceptible at street/gameplay distance** (mean pixel Δ ~0.8–1.7/255). The near atlas facades are
*already* rich and varied (painted-lady colour, pastels, painted windows, glass tint, cornices, contact
AO), so layering more depth/tint on them is marginal, and cranking it harder risks banding/garishness.
Crucially, the buildings that actually read as **identical flat boxes are the distant / coarse towers**
(e.g. the lavender SoMa/FiDi towers), which do **not** go through this atlas shader at all — they are
far-LOD / coarse-district geometry. **So the visible win is far-LOD building colour/roof variety (the
next task), not near-facade relief.** `facadeReliefV2` is committed OFF as a correct, no-regression,
optional layer; the founder can toggle it, but the A/B shows it is not a clear win on its own.

## Task 2 — far-LOD skyline variety (flag `farLodVariety`, OFF)

The uniform grey/lavender distant towers fade to one atlas-average (`tileAverage`) tone because the NAIP
aerial that would give real roof/facade colour is **not baked** under the 80–87 MB budget
(`uAerialReady = 0`). `farLodVariety` varies that far tone per building from a stable position+variant hash
(SF skyline tones) — runtime only, no aerial, no re-bake, byte-identical off.

**Honest A/B verdict (ChartreuseCanyon/Opus, 2026-10-09, dense `sf-fit-3dep`):**
`docs/sf-data/farlod-{mission,haight,soma}-ab.jpg` (before | after), 0 console errors. **No visible change
in these street views** (mean Δ ~0.5–0.8/255). `tileAverage` only applies as walls reach `atlasDetail → 0`
(~300–800 m out), but the buildings that dominate street views are mid-distance (full `painted` detail), and
the dramatic FiDi skyline sits near the fog line — so the affected band is small on screen. The change is
correct and will vary a true distant-skyline view more than these captures show, but it is **not a clear win
on its own**, and the real fix (per-building colour *from the aerial*) is budget-blocked until the aerial can
be baked (cheaply, e.g. per-building average colour into the existing vertex colours — a bake follow-up).
Committed OFF.

### Overall graphics verdict (this round)
The current atlas look is already fairly varied (painted-lady Victorians, mixed brick/tan mid-rises, detailed
storefronts). Both shader levers above are subtle because they layer onto an already-rich look; the genuinely
visible gains need either the budget-blocked aerial bake or larger geometry/material work, not more albedo
tweaks. Both flags are OFF, no-regression, and ready for a founder toggle + preview judgement.
