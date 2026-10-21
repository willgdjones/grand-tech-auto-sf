# Event marker object reuse

`gtasf-j6zw` keeps a pool of at most twelve nearby event markers. It reuses
their groups, meshes and temporary collections instead of replacing the
scene objects once per second and allocating an active Set every frame.
Candidate distances are updated in existing event records. Unused marker
slots detach from the scene until needed again, and teardown releases the
pool and its shared geometry/material resources.

The current event/HUD flags, 220-metre selection range, source-contact
resolver, five-metre deduplication cells and twelve-marker cap are retained.
Ring geometry, colors, opacity, animation, scene ordering and entry rules
remain unchanged. In particular, closing a modal or leaving a vehicle while
inside a marker must still activate the previously deferred visit once.

The initial actual-module baseline at 2026-10-03T14:34:07.078Z used 2,000
explicitly labelled local fixture events. After the initial twelve markers
(36 groups/meshes), 240 stationary updates allocated **108 new scene objects
and 243 Sets**. This is an allocation measurement, not an FPS result or an
explanation for the separately retained native long frames.

The extended comparison uses the same preserved source and adds a resolved
position offset, canonical title refresh and resource-disposal checks:

| Recorded check | Before | After |
| --- | --- | --- |
| New scene objects during 240 stationary updates | 108 | 0 |
| New Sets during those updates | 243 | 0 |
| Distinct scene objects across ten recorded states | 219 | 36 |
| Shared resource disposals | Four, exactly once | Four, exactly once |

The ten states match exactly for ring vertices, mesh/group transforms,
colors, opacity, blending, depth writes, visible child counts and ordering.
They include stationary updates, interaction holds, unloaded terrain, another
road height, return to loaded ground, refreshed/deduplicated events, event
removal, restoration and leaving the nearby range. Entry callbacks and
disposal counts also match. The existing eight marker-entry cases pass.

Reports are `artifacts/marker-work/before/report.json` (14:40:36 UTC),
`after/report.json` (14:40:50 UTC) and `entry-after/report.json`. The before
source SHA-256 is
`09e096c530fe7752e27b5bbe228389027e0a1d3130ec19f536c3710d0cb16448`;
the after source is
`bd11dee912caadab0f012a77a6990859d2e65c193b0a93e22e4795f011f2fd22`.

Run `node tools/events-marker-work-smoke.mjs` for the current allocation and
behavior check. Set `GTASF_MARKER_WORK_BASELINE` to the saved before report
to require exact state equality. `GTASF_MARKER_WORK_SOURCE` selects a saved
source; `GTASF_MARKER_WORK_BASELINE_MODE=1` allows its original allocations;
`GTASF_MARKER_WORK_OUT` chooses the report directory. The original source and
initial probe remain beside the baseline artifacts.

Strict web TypeScript passes (run 99922). The committed shared bundle
`artifacts/founder-path/2026-10-03T1447` passes (run 88906, exit 0,
177 modules, 835 ms). It was built at 2026-10-03T14:47:29.403Z from exact
commit `eb1752b6e11aa2235f510a8ff6df37ee78aba42e`, including marker fix
`cb83587`. Its marker source and smoke tool match the checked versions;
the five recorded SF map/art hashes remain unchanged. Pane 1 accepted
this final bundle in Agent Mail 5692.

This actual Three scene-graph check has no renderer, browser or live API.
Native visual, device, deployment and driving-performance acceptance remain
separate.
