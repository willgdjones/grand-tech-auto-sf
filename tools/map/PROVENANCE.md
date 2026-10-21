# Map pipeline provenance

The bootstrap copied SF-adapted geometry, polygon, extrusion, deterministic JSON,
randomness, source-lock and meshopt GLB utilities from the user's local
`million-dollar-times-square/tools/layout/src`. Their original inventory remains
in the repository-level PROVENANCE.md. No NYC projection or NYC input data is used.

`src/pipeline/boolean.ts` adapts BDTS `ground/boolean.ts`'s scoped precision policy,
adds millimetre input snapping, and uses the fast floating-point clipper first.
The new acquisition, terrain, road, lane-graph, chunk, and validation modules are
GTASF code. `src/pipeline/catalog.ts` and generated source manifests carry public
data attribution and exact source-byte hashes.

No runtime third-party API, paid data endpoint, BDTS credential, or external
deployment is required by this package.

`src/districts/` contains original GTASF art-direction regions and linear colour
palettes, rather than surveyed paint or official neighbourhood boundaries.
`src/pipeline/districts.ts` combines them with the same pinned OSM landcover,
street names, DataSF footprints and measured heights already used by the bake.
The district pass adds no downloaded assets or providers. Teleop reference frames
were compared locally by eye only; none are copied into map assets or commits.
Arrival evidence and the bounded frontage-retention rules are in `DISTRICTS.md`.
