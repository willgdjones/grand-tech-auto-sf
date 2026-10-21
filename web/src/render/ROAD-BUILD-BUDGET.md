# Road construction batches — gtasf-d4zx

The phone profile in `docs/perf/phone-c8sj-before/` identified road-detail update
work during scene construction. The existing two-millisecond segment batches
did not bound the later geometry bounds scan on a mesh's reveal frame.

Each material buffer now accumulates its exact Float32 position bounds while
emitting quads. On reveal, that box produces a conservative bounding sphere in
constant work. This avoids the complete position rescan and accounts for hills,
wide road edges and kerb faces beyond a source cell. A fixed cell-centred sphere
would not provide that guarantee. The renderer still receives a valid box and
sphere for culling and raycasts.

Low also processes at most 48 source segments per update, down from 80. The
two-millisecond deadline, one-mesh reveal per call, 3x3 cell cache and all geometry
remain. Completed cells do no new construction. Low may take more frames to show
new details while driving; there is no density reduction or feature removal.

One focused smoke builds the same sloped, wide road on both presets, checks the
hard per-update work limit, identical completed vertex/normal/UV data, all
Float32 vertices inside the computed bounds, and no repeated steady-state work.
Validation passed on 2026-10-04 at approximately 09:43 UTC: 12 focused road and
startup checks, followed by web strict types. The construction smoke observes
192 height samples in Low's first update versus 480 on the standard preset,
then identical completed position/normal/UV data and valid bounds. Its fixed
clock verifies the work cap only; those counts are not wall-time measurements.

This is a bounded-work source change, not a measured frame-rate improvement or
a passing phone gate. `gtasf-c8sj` owns the subsequent native profile and the
60 fps / 25 ms p95 acceptance. Existing `roadDetails` and `streetDetail` gates
remain unchanged.
