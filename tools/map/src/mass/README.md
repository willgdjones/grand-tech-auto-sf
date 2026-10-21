# Building footprints and road clearance

`pipeline/buildings.ts` joins DataSF footprints to OSM building/land-use tags,
then supplies one polygon to both the detailed visual extrusion and collision
export. Heights use DataSF `hgt_median_m` (metres), `hgt_mediancm` / 100, then
`gnd1st_delta` (metres), accepting 1.5–450 m. OSM `height` accepts metres or feet
up to 450 m; positive `building:levels` up to 150 uses 3.2 m per floor. Explicit
fallbacks are 3.2 m garages, 2.5 m sheds and 9.6 m other buildings. Land-use
vertex colours and deterministic building variation are retained.

Pass the extracted roads as the sixth `buildBuildings` argument to clear
drivable surface ribbons plus a 0.5 m margin and rounded end caps. Bridge,
tunnel and nonzero-layer ways do not cut the buildings above/below them.
Subtract after source joining and deduplication so OSM cannot refill cleared
DataSF footprints. Split pieces retain their source ID (additional pieces use
`:clear:N`), height, foundation and colour. Pieces with area at most 0.1 m² are
discarded and the manifest warnings report trimmed/fully removed footprints.
This is a map bake correction under the existing map feature switch.

The one A05 smoke reads checksum-pinned cached sources and reproduces real
Broadway-area obstructions before checking clearance, polygon validity,
unchanged height/material metadata and the actual Broadway tunnel exclusion:

```sh
cd tools/map
nice -n 10 npx tsx src/mass/clearance-smoke.ts
```

It performs no network request, GLB bake, performance/property/golden test or
visual/device acceptance. Source licenses and URLs remain in the cache source
manifest and the map attribution contract. The source data is OpenStreetMap
(ODbL) and DataSF Building Footprints (PDDL); generated assets stay ignored.

## Local v1 evidence (2026-10-02 PT)

The source smoke passed for OSM SHA-256
`da74fbb88a3fcbc9fe33f25854809271bd6597b26ce71293a736eaaf883633d0`:
812 valid buildings, 21,216 sampled road positions, 32 blocked before clearing
and zero after. Height, foundation and colour metadata were unchanged; nine
grade-separated ways, including the Broadway tunnel, preserved surface massing.

Pane 2's expanded Ferry–Lombard bake uses the sixth argument in `build.ts` and
a 0.25 m LOD1 simplification tolerance, below the 0.5 m clearance margin. Its
78 chunks contain 6,293 building pieces; 530 source footprints were trimmed
(two entirely within a corridor). The resulting lane audit has no surface-road
intersections. All 57 residual lane entries across 24 source ways are explicitly
grade-separated: 46 on nonzero-layer garage/access ways, nine building-passage
entries, and two on the Broadway tunnel. Do not erase the buildings above them;
interior/deck collision modelling remains a separate limitation. There are zero
intersections on the local hilltop pickup, Lombard descent, Ferry outbound and
Ferry return taxi routes. This does not establish rendered/device or G1 acceptance.
