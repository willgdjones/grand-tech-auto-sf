# Source layout for cosmetic road details

Run `tools/map/node_modules/.bin/tsx tools/art/prepare-road-details.ts` from the
repository root. This offline export reads the existing Lombard source cache and
map manifest. It verifies every OSM/terrain digest against the current bake,
reuses its projection, road widths and smoothing, and writes
`web/public/art/road-details.json`. It does not modify GLBs, road contact,
collision, routing, source caches or deployed map assets.

The version 1 JSON contains `frame`, `bounds`, `sourceDigests`, attribution and:

| Array | Fields |
| --- | --- |
| `roads` | `id`, `osmWay`, `name`, `highway`, `points`, `width`, `forward`, `backward`, `shared`, `inferredLanes`, `oneway`, optional `sidewalk`/`sidewalkLeft`/`sidewalkRight`, `surface`, `markingRanges` |
| `tracks` | `id`, `osmWay`, `name`, `kind` (`cable` or `tram`), `gaugeM`, `points` |
| `crossings` | `id`, `osmWay`, `points`, `width`, `markings` |

All points are global `[east, up, south]` metres, rounded to 1 mm. Roads retain
OSM way direction, so forward/backward and left/right are relative to that
direction, including `oneway=-1`. Width uses the same explicit-width/lane fallback
as the road bake; `inferredLanes` distinguishes missing source lane counts.
Absent sidewalk tags and `surface=unknown` mean unknown, not a surveyed absence
or an asphalt claim.

`markingRanges` are allowed `[start, end]` metres along horizontal XZ arclength.
They exclude the other road's half-width plus a metre at genuine shared-node
junctions, control clearances, and actual crossing-way intersections. Degree-two
OSM splits/bends remain continuous. Consumers should clip longitudinal paint
and kerbs to these ranges. Range endpoints describe decoration, not road closure.

Crossings preserve their actual pedestrian-axis geometry. Use their width across
that path, with stripes perpendicular to it. `markings=no` and `unknown` must not
produce invented zebra stripes. The source query contains crossing ways but did
not fetch crossing-only node tags, so this is not an exhaustive crossing survey.

Tracks come from genuine surface `railway=tram` ways and retain their tagged gauge.
Only explicit `cable_tram=cable` produces `kind=cable`; a narrow gauge alone does
not invent a cable designation. Underground, layered and bridge track ways are
excluded from this ground-detail export. Track heights use the nearest source
road profile within its width, otherwise the road-carved source DEM. No
lane-edge reconstruction or invented parallel rail alignment is used.

Road/crossing heights include the bake's 0.1 m ribbon offset. The renderer should
add its small cosmetic depth offset. Sidewalk widths, raised kerbs and material
choices remain stylized runtime details, not new physical contact surfaces.

The integrated real-source smoke checks finite bounded paths, the intact dense
Lombard one-way profile and its 32.8 m descent against the separately baked road
graph, explicit cable gauge and marked crossings. Evidence is written to
`out/lombard/road-details-smoke.json`. Existing graph vertices match the exported
profile within 0.0007 m; interpolation between the coarser 3 m graph samples differs
from the dense visual profile by at most 0.0282 m. The export has 1,192 surface roads,
73 track segments (27 explicitly cable), and 1,180 crossing ways (861 explicitly
marked), at 1,510,602 bytes / 496,077 gzip bytes. Existing source warnings for
three grade-separated components without mapped portals are retained in that
report; those roads are excluded here. Strict scoped TypeScript passes. The
parent road-detail bead owns actual desktop/phone visual acceptance.

## Runtime integration and visual evidence

`flags.groundTextures` enables the three shared 256 px road material tiles in
the render foundation. Their manifest hashes, dimensions and encoded size are
checked before use. World-space UVs preserve the source distinction between
asphalt, concrete footways and the brick Lombard switchbacks.
`flags.roadDetails` enables `createRoadDetails` in `web/src/render/roads.ts`.
Mount its root directly in the scene so its paint cutout shader is retained;
call `update(position)` each frame and `dispose()` at teardown. The playable
and cinematic entry points both provide the same source building collision
and landmark-aware visual surface sampler. Neither module changes movement
surfaces, collision polygons, routing or baked GLBs.

Road details are indexed once into 256 m cells and retained within a 3×3
neighbourhood. Construction advances in roughly 2 ms CPU batches, then reveals
at most one material mesh per update. Crossing stripes require explicit source
markings. Kerbs avoid source junction clearances and building occupancy; their
1.25 m width and 0.12 m rise are decorative, not surveyed sidewalk dimensions.
The seven palette-limited ground tiles total 138,870 encoded bytes.

Run `nice -n 10 node tools/road-look-smoke.mjs` with Node 24 and the existing
`tools/map/out/lombard` bake. The short-lived fixture uses the actual streaming
world and waits for all target map/detail cells before capturing Embarcadero and
Hyde Street at 1100×720 and 390×844. The fixture explicitly enables the two
feature flags; it is not a production entry point.

The reviewed run at commit `c3b8f92` has evidence under
`artifacts/road-snapshot-c3b8f92/artifacts/road-look/`. All four screenshots show
chunky asphalt, correctly proportioned white dashes, double-yellow paint,
light kerbed shoulders and sourced rail alignments. Both layouts report zero
browser/map errors, nine ready map chunks at each view, no pending detail work,
and zero cells, vertices or materials after teardown. Maximum observed detail
construction steps were 5.3 ms desktop and 3.4 ms in the low phone layout, with
at most one mesh revealed per update. These are construction timings, not a
whole-frame, physical-phone or 60 fps gate. Strict web TypeScript and the five
targeted foundation checks also passed.
