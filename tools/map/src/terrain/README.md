# A03 elevation: local playable handoff

The running map pipeline consumes `src/pipeline/elevation.ts` through
`acquireInputs` in `src/pipeline/sources.ts`. The public `Terrain.sample(x,z)` and
`HeightSampler` contracts from `03a0727` are unchanged. `x/z` are global metres
in the Powell/Market SF frame; returned elevations are DEM metres, independent
of ECEF tangent-plane height. See `../../CONTRACT.md` for chunk placement and the
GTHF v1 runtime heightfield. Use the generated heightfields for player contact;
do not decode PNGs or fetch AWS tiles in the game loop.

`SourceCache` reuses SHA-256-verified bytes offline, retries transient failures
up to three attempts, and honours bounded Retry-After delays. Terrain acquisition
awaits one request/decode at a time (concurrency 1). PNG RGB decodes as
`R*256 + G + B/256 - 32768` metres, including negative terrain; interpolate decoded
heights across adjacent tiles at pixel centres. No gamma conversion is applied.
Tile selection includes one pixel of padding. Missing tiles, alpha/no-data,
the -32768 sentinel, malformed arrays and non-finite coordinates/samples fail
explicitly; they never become a flat zero-height fallback. Refresh a corrupt
source cache before baking again.

Format/source references: [Mapzen Terrarium](https://github.com/tilezen/joerd/blob/master/docs/formats.md),
[AWS source catalog](https://registry.opendata.aws/terrain-tiles/), and
[attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).
Cached SF tiles identify `ned_topobathy/ned19_n38x00_w122x50_ca_sanfrancisco_topobathy_2010.tif`.
Preserve that provenance; these are source DEM heights, not a new field survey.

## One source smoke before the local playtest

From `tools/map`:

```sh
nice -n 10 npx tsx src/terrain/lombard-grade.ts
```

An optional positional argument selects a different cache directory. The smoke
reads the existing `out/cache/lombard`, verifies source hashes, decodes its nine
tiles, samples all 157 vertices of OSM way **402111597**, and compares world-frame
samples with an independent interpolation of raw PNG RGB pixels. It performs no
network requests, geometry build or render work. A missing cache is an explicit
failure; acquire the Lombard sources with the map CLI first.

Observed on Oct 2 PT: top **85.853713 m**, bottom **53.017408 m**, drop **32.836305 m**
over **197.462333 m** of horizontal switchback path: mean grade **-16.629149%**.
The OSM incline tag is -16%; the smoke allows two percentage points for source
resolution/rounding and checks raw-pixel agreement within 0.000001 m. This tiny
comparison tolerance measures calculation consistency, not DEM survey accuracy.
The smoke prints exact source hashes and comparison error for the bead evidence.

Broader synthetic seam/no-data/cache tests are deferred until after the founder
playtest. Existing basic coverage remains in `test/pipeline.test.ts`. This source
smoke does not pass the rendered-grade/vehicle-contact checkpoint (`gtasf-b5z`) or
G1. Pane 1 owns wiring the local map, spawn, terrain sampling and feature flags;
pane 2 owns the rest of the map builder and local asset exposure.
