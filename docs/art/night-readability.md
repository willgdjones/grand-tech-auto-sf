# SA night readability — gtasf-jwgu

The real San Francisco clock drives the scene. Between dusk and dawn the sky
uses a deep blue zenith, a lighter blue horizon, subdued marine clouds and fixed
world-direction stars. Cool hemisphere and moon lighting retain enough road,
building and character contrast to navigate at 00:36.

`nightLighting` controls the added night cues. The existing `saAtmosphere`
switch owns time grading, and `buildingFacades` owns facade and sign materials.
The night amount fades smoothly at 05:30–07:00 and 18:15–20:15; it is zero in
daylight. There is no live-weather claim.

The reviewed facade atlas supplies an emissive window variant in the material
shader: blue/teal glazing emits while masonry, frames, mullions and the Mission
mural remain unlit. The Victorian cell uses its curtain-opening mask so teal
frames stay dark. Stable room selection leaves a mix of warm, cool and dark
windows. Existing shopfront signs receive a cool emissive neon treatment.
No additional atlas download or generated image is required.

Road lighting uses at most eight lamp sites per streamed 256 m cell. Sites snap
to the sourced road graph, reject grade mismatches and occupied building space,
and put the post outside nearby lanes. Pools are small terrain-draped grids with
soft radial falloff. Posts, bulbs and pools each form one merged mesh per cell;
there are no point lights, shadow maps, animated scans or new collision surfaces.
Chunk unmount disposes the geometry, and daylight hides the pools and bulbs.

`tools/night-look-smoke.mjs` uses the real source map, road textures, facade atlas,
shop signs and Quaternius avatar. It captures Embarcadero and Columbus at an
injected 00:36 SF clock on desktop and low-tier phone, plus a daylight control.
It checks source streaming, lamp limits, emissive state, daytime shutoff, complete
disposal and browser/HTTP errors. This is renderer acceptance, not a production
deployment, frame-rate claim or physical-device gate.

Verified 2026-10-03 at the injected 00:36 SF clock:

- `artifacts/night-look/evidence.json`: desktop 1100×720 and phone 390×844,
  Embarcadero and Columbus; all browser and HTTP error arrays empty. Daylight
  sets window emission to zero and hides every bulb/pool batch.
- `artifacts/night-window-detail/evidence.json`: final curtain-mask street and
  shopfront close-ups on both tiers. This follow-up waits for map geometry but
  deliberately does not wait for unrelated road-paint batch completion.
- 54–72 lamps in 8–9 cells, bounded to eight per cell; at most 2,304 pool
  triangles. Disposal returns lamp, cell and pool-triangle counts to zero.
- Web TypeScript and existing clock/renderer tests pass (seven tests). The smoke builds only its
  renderer entry, not the full repository.

The first review caught charcoal asphalt becoming too dark between lamps; a
small blue baked fill now retains its texture and playable edges. No image
downloads were added. No per-frame road or footprint search was introduced.
The smoke's composite draw-call field is the final post pass, not whole-scene
draw calls, and is not used as performance evidence.
