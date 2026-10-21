# Radar redraw record reuse

`gtasf-jplq` reuses the radar's cluster Map and cluster/hit records between
draws. Each pool grows only to the maximum visible cluster count for the
current calendar, which cannot exceed its event count. Replacing the calendar
discards the pools; destroying the radar clears all added storage. Clustering
arithmetic, insertion order, projection, pulse, selection and routing are
unchanged.

The original real Radar canvas/DOM fixture passed on 2026-10-03 at approximately
14:01 UTC; the changed source passed at 14:06:37 UTC. The frozen original
`radar.ts` was verified byte-for-byte against commit `817d2f0`.

For 240 local event fixtures and 120 stationary redraws after warmup:

| Viewport | Clusters per draw | New Map objects, before → after | Distinct cluster records, before → after | Distinct hit records, before → after |
| --- | ---: | ---: | ---: | ---: |
| Desktop 1100 × 720 | 83 | 120 → 0 | 9,960 → 83 | 9,960 → 83 |
| Phone 390 × 844 | 45 | 120 → 0 | 5,400 → 45 | 5,400 → 45 |

All eight canvas states per viewport match the original SHA-256 exactly:
minimap, rotated, expanded, selected, routed, arrived, resumed and refreshed.
Physical event search/selection, accepted GPS, a canvas blip click and card
action focus, a smaller calendar, and teardown passed. Page/console errors
and attempted API requests were empty. Selected desktop and refreshed phone
screenshots were reviewed alongside the original selected views.

The existing calendar-removal DOM smoke also passed both viewports, including
stale action rejection, retained-route behavior, updated event locations and
focus. Web TypeScript strict and all three routing tests passed. These fixtures
use local roads and events, disabled WebGL, a fixed wall clock and manually
advanced draw ticks. They establish behavior and record reuse, not native
frame timing, real-event coverage or a device gate. Temporary projection
objects, cluster key strings and Map internals remain outside these counts.
The current unfiltered driving performance gate remains open.

Reproduce from the repository with Node 24:

```sh
GTASF_RADAR_WORK_STAGE=before node tools/radar-work-smoke.mjs
GTASF_RADAR_WORK_STAGE=after node tools/radar-work-smoke.mjs
node tools/radar-calendar-smoke.mjs
node node_modules/typescript/bin/tsc --noEmit -p web/tsconfig.json
node node_modules/vitest/vitest.mjs run web/src/radar/routing.test.ts --maxWorkers=1
```

The first command preserves an existing frozen baseline or reads it from
`817d2f0` on a fresh checkout. `--build-only` and `--run-only` separate fixture
bundling from the browser run when coordinating shared-machine work. Reports
and screenshots are in ignored `artifacts/radar-work/{before,after}/`;
the additional calendar regression is in `artifacts/radar-calendar/after/`.
No full game build, flag, map asset, Worker, or production update belongs to
this change.
