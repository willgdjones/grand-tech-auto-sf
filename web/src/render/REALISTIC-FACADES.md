# Realistic facades — architecture & review guide

Pane 11 (BUILDINGS), founder 2026-10-04 realistic direction. This is the realistic-renderer facade
system for deploy #6. It is **OFF by default** and does not touch the ps2 facade path (`facades.ts` /
`facadeAtlas.ts`) or production.

## How to enable (for the pane-6 visual/perf gate — `gtasf-realistic-facade-visual-accept-9dup`)

Flags (`shared/flags.ts`):

- `realisticRender: true` — the modern-realistic renderer (ACES, sun shadows, HDRI IBL, PBR).
- `realisticFacades: true` — the facade **textures** (shader, gated inside `realisticRender`).
- `storefrontPieces: true` — the **Meshy 3D hero pieces** (storefronts + the buildingDetail pieces, see
  below). Separate so you can review the facade textures first, then enable the hero pieces once their
  per-piece facing is tuned. HD only (`graphicsPreset()`), procedural fallback otherwise.

All kept OFF (not dev-on) so unreviewed work can't break other panes' `realisticRender` reviews. Review
on desktop **and** a Low-preset phone profile; compare against `tools/art/reference/teleop/`.

## What it does

Under those flags, building wall materials (`GTASF buildings`) get a MeshStandard PBR facade shader
(`realisticFacades.ts`) injected in `realisticMaterials.ts`, applied **procedurally from the baked map
footprints** by district + land-use — no hand-made building models:

- **Textured walls** from a manifest-driven albedo/normal/ARM atlas (`web/public/art/facades-pbr/`),
  projected in world metres so chunks tile seamlessly, roofs excluded. Styles: red brick, sandstone,
  stucco, Victorian clapboard, glass curtain wall, concrete, storefront, Mission mural.
- **Glass curtain walls** (FiDi): low roughness + metalness so they reflect the IBL environment, with a
  mullion/spandrel grid.
- **Window frames / sills** and a **ground-floor storefront band** that tracks the sourced terrain
  height (hills).
- **Painted ladies**: Victorian clapboard is repainted per building from `landmarks/paintedLadyPalette.ts`
  (chosen by a stable per-building hash — decoupled from the land-use classifier, so no map rebuild).
- **Per-building brick variant**: brick districts alternate between two brick modules.
- Distance fade to the flat land-use colour at the fog line (no shimmer). Night window emission.
- Low preset takes a cheaper albedo-only path (no normal/ARM upload).

Separately, `buildingDetail.ts` (its own `buildingDetail` flag, dev-on, **also visible in the ps2
playtest**) adds procedural 3D pieces per footprint: rooftop clutter, coloured cornices, stepped
parapets, striped awnings, fire escapes, and SF **bay windows** (square + canted). Under
`realisticRender` these are PBR-converted too.

## Meshy 3D hero pieces (gtasf-facade-meshy-buildingdetail-swap-13c6, behind `storefrontPieces`)

When `realisticFacades + storefrontPieces` are on (HD only), `buildingDetail.ts` **swaps its procedural
box pieces for instanced Meshy GLB hero pieces** (`web/src/assets/realisticFacadePieces.ts`, loaded
once per kind, merged per chunk, PBR material preserved). Flags off → the procedural boxes render as
before (fallback), so this is additive and safe. The pieces + placement:

- **bay-window** — the mid-rise street face (replaces the procedural square/canted bays).
- **awning** — the shopfront wall (replaces the procedural striped awning).
- **balcony** — NET-NEW Juliet balcony on NON-bay mid-rise street walls (no procedural equivalent).
- **cornice** — tiled along each roof edge (native span ~2.6 m).
- **fire-escape** — stacked up the street wall, one GLB per floor.
- (storefront + entrance are instanced separately in `props/facadeStorefronts.ts`.)

**Needs your tuning (this is the main 9dup task for the hero pieces):** each piece is placed with a
reasonable default yaw/scale (`yaw` faces the GLB's +Z detail to the wall; `scale = width/nativeWidth`),
but the **per-piece facing/offset is SPEC-tuned in-browser** via `tools/art/build-facade-pieces.mjs`
(the SPEC yaw) — expect to nudge facing/depth/vertical offset per kind so pieces sit flush, not
floating or back-to-front. Each Low GLB is ~3k tris, so watch the **phone-Low budget**: if too heavy,
cap per-kind/total counts in `buildingDetail.ts` (the placements are gated `!low` where they were
already desktop-only). A missing/broken GLB just leaves that kind absent (no crash).

## What to look for / pass criteria

- No bare untextured boxes; walls read as brick/stone/stucco/clapboard/glass by neighbourhood.
- Real window frames + storefronts; glass reflects the sky/IBL.
- Victorian rows show the painted-lady pastel spread (no two neighbours identical).
- Night: window glazing emits, legibly (not whole walls glowing).
- Phone Low: mean ≥ 60 fps, p95 ≤ 25 ms, no console errors (per AGENTS.md harness).

On pass: flip `realisticFacades` true and add it to `tools/deploy/production/prepare.ts`'s reviewed
allowlist (still gated behind `realisticRender`). Do **not** mark the visual gate complete from unit tests.

## File map

- `realisticFacades.ts` — the MeshStandard facade shader injection (+ painted-lady + brick-variant).
- `realisticFacadeAtlas.ts` — manifest-driven albedo/normal/ARM atlas loader (fixed style slots + fallback).
- `realisticMaterials.ts` — Lambert→PBR conversion; injects the facade shader on `GTASF buildings`.
- `foundation.ts` — creates the atlas, drives the night clock, threads the sourced ground, disposes.
- `buildingDetail.ts` — procedural 3D facade pieces (cornices, parapets, awnings, fire escapes, bays).
- `web/public/art/facades-pbr/` — the packed atlas (albedo/normal/arm.jpg + manifest.json).
- Tools: `tools/art/recipes/facades-pbr.json` (Scenario prompts), `tools/art/pack-facades-pbr.mjs`
  (derive normal/ARM + pack), `tools/art/realistic-facades.mjs` (CC0 alternate base).

## Provenance / licensing

Shipped atlas is **Scenario FLUX.1 Dev** generated (not CC0; derived normal/ARM). CC0 Poly Haven is an
alternate base. See `PROVENANCE.md` and `web/public/assets/LICENSES.md`. No text/logos/real people/real
signage in any generated image.

## Known limitations / follow-ups

- Meshy 3D hero pieces are now **shipped** (`gtasf-realistic-facade-meshy-pieces-xyrw` storefront/entrance;
  `gtasf-facade-meshy-buildingdetail-swap-13c6` bay/awning/balcony/cornice/fire-escape) — behind
  `storefrontPieces`, flag-off, **awaiting the per-piece SPEC-yaw tuning + look/perf pass above**.
- District selection now consumes the 24-region `districtFacade()` lookup (RedIsland `6b9cb95`), not the
  old hardcoded bboxes; buildings outside all regions fall back to a brick/stucco mix.
- GLSL is injected via `onBeforeCompile` and validated by unit tests for structure, not by a real GL
  compile — pane 6's in-browser pass is the first true compile check (one `vec3→vec2` bug was already
  caught+fixed there; please watch the console for any further shader-compile errors on first load).
