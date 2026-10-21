# Source-bounded street pavement

`gtasf-qv7g` repairs missing paved area between independently mapped carriageways
and sidewalks. Lane-count width is still used by the road graph and contact code;
it is not the width of the entire paved public street.

`preparePavements` walks the at-grade OSM sidewalk/crossing network. Only a closed,
bounded face containing a public driving-road centre sample can become pavement.
Open boundaries, faces above 12,000 m², service-only areas and grade-separated
roads cannot establish a fill. Source building, natural/park and other protected
land polygons, plus the actual collision footprints, are removed. This is
conservative: incomplete sidewalk mapping leaves the existing terrain visible.

The mesh writer subtracts the existing road/sidewalk footprints before adding
asphalt. The terrain cut uses the same polygon. A shared 4 m grid drapes the added
surface at both LODs; source road widths, profiles, routing, collision and
heightfields remain unchanged. Footway crossings use asphalt; a crossing tagged
`crossing:island=yes` keeps concrete only in the gap between its source road-node
intersections. That refuge's width comes from the crossing, not a surveyed island
outline. No island shape is invented beyond the mapped crossing segment.

The road-detail exporter propagates `sidewalk:both`, and suppresses inferred
lane-edge kerbs for roads inside a closed mapped street face. These streets
already have separate source sidewalk meshes. Paint and crossing phases are
unchanged. Existing `mapStreaming` and `roadDetails` flags remain the entry gates;
this corrects their source data rather than introducing a new feature switch.

## Columbus / Green / Stockton evidence

Focus: x=-132.156, z=-1711.3605 (37.79961869,-122.40930056),
OSM way 681183500, two southbound lanes with a right sidewalk. The source contains
an approximately 2,176 m² closed face surrounding the paired carriageways and a
1,176 m² face for the adjacent intersection. These are derived areas, not survey
measurements. Source OSM includes separately mapped concrete footways, asphalt
crossings and a crossing with a pedestrian refuge.

References inspected before the change:

- [SFCTA September 2025 intersection photograph and crosswalk update](https://www.sfcta.org/blogs/transportation-sales-tax-funds-pedestrian-safety-improvements-chinatown): southeast approach toward the corner building; continuous asphalt with painted crossings, concrete at the curb.
- [SFMTA Columbus Avenue Safety Project](https://www.sfmta.com/projects/columbus-avenue-safety-project): source context for pedestrian/transit bulb-outs, crosswalks and repaving. The proposal dates are historical; geometry comes from the pinned OSM extract.

Original diagnostic: `artifacts/map-geometry/{all,no-details,no-terrain}.png`.
Removing terrain exposed gaps; removing decorative road details left them present.
The original overlap audit found no terrain above road interiors, so a larger
vertical offset would not repair this defect.

## Bounded reproduction

Requires the existing SF bake, its pinned source cache, local
`tools/map/out/SanFrancisco.osm.pbf`, `osmium`, and the frozen
`artifacts/district-art/{source/check.ts,source-proof.json,district-graph.json,district-manifest.json}`
from `tools/district-art-smoke.mjs`. Coordinate the shared CPU/GPU slot first.

```sh
nice -n 19 npx vitest run tools/map/test/pavement.test.ts --maxWorkers=1
nice -n 19 npx tsc --noEmit -p tools/map/tsconfig.json
nice -n 19 npx tsx tools/map/pavement-preview.mts --bake
nice -n 19 npx tsx tools/map/pavement-preview.mts --audit
nice -n 19 npx tsx tools/map/pavement-preview.mts --render
```

The helper rebuilds only nine North Beach chunks into
`tools/map/out/pavement-qv7g/`, retains the existing building/structure attributes,
uses unchanged terrain/collision files, and verifies the original city graph and
manifest hashes remain pinned. It writes a bake report and before/after desktop
and phone screenshots using the game's render foundation, avatar, road details
and original diagnostic camera. Its graph subset is for visual inspection only.

This is not a production-size, driving, streaming-performance, deployment or
real-device acceptance run. The preview helper does not rewrite the shared SF
map or public art; the separate reviewed activation is recorded below.

Recorded source/geometry checks (Oct 3, 03:40 PT): one targeted geometry smoke
and strict map/export/helper checks passed. The isolated bake produced 18 LOD
files across nine chunks, with 346 source-bounded pavement polygons in the padded
source extent. An audit of the emitted Columbus chunk covered 3,647 interior
street/intersection samples: all 1,016 former terrain gaps were paved, with zero missing road
samples or terrain-over-road overlaps. The maximum height change over those gaps
was 0.1048 m, including the intended 0.1 m road lift. Retained building/structure
attributes, transforms and oriented triangles match the original geometry;
triangle index rotations introduced by lossless mesh compression are normalized
for that comparison. See `bake-report.json` and `geometry-report.json` in the
isolated output directory. The final image review and local activation follow.

## Reviewed local activation (Oct 3, 04:18 PT)

The four `before/after-desktop/phone.png` images were reviewed using the actual
render foundation, streamed geometry, textures, avatar and road details. Desktop
1100×720 and phone 390×844 show continuous asphalt through the recorded
intersection after the change: the grass wedges and artificial kerb ribs across
the driving lanes are removed. Mapped sidewalks, crossings and the source refuge
remain. All four views report zero console, HTTP or map errors. The preview
passes its weather request to the existing native local Worker. A first preview
attempt correctly failed on a missing weather endpoint and was not accepted.

The final canonical audit covers buildings and structures in all 18 LOD files,
with every retained geometry hash matching the original. `--scope-details`
restricts preview curb changes to roads wholly inside the nine baked chunks;
114 roads qualify. The helper/activation strict check passed.

After the coordinated city-run STOP and image review, the following was applied:

```sh
nice -n 19 npx tsx tools/map/pavement-activate.mts --apply
```

This replaces only the nine chunks at x=-2..0, z=-8..-6 (both LODs and gzip), the
matching SF manifest/gzip and inventory, and the 114 road-detail sidewalk tags.
The tool saves every replaced file first, verifies new raw/gzip hashes, preserves
terrain/collision and the packed graph, and records exact changed paths in
`tools/map/out/pavement-qv7g/activation-report.json`. Its default invocation is a
read-only preflight; `--apply` requires an absent backup directory and the exact
original map pin. The saved baseline is
`tools/map/out/pavement-qv7g/before-activation/`; the earlier comparison helpers
must not be rerun against the activated map as though it were the original.

- Before manifest: `6451bc87f9be6e67e54ac13163d6baaae290ccb4031cf516db17567503b07a17`.
- After manifest: `dc90ea7c05e411cfff1bdced2a31ce27add2dd35bb8e8a373375dba36c33603d`.
- Unchanged graph: `5763c53debed013a7f5403a467bd829f45dacfdfb83dc9c5c19e5555fe91651f`.

The regenerated manifest-inclusive inventory is 197,818,593 gzip bytes, still
over budget under `gtasf-zzpr`; its largest individual file remains 23,079,905
bytes. This local visual repair does not pass performance, production-payload,
device or deployment gates. Full-city pavement rollout beyond these nine chunks
still requires the ordinary coordinated city bake.
