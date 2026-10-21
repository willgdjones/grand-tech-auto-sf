# Northwest district source build-out — gtasf-2wq4

`tools/map/src/districts/northwest.ts` supplies seven profiles to the common
district registry. Their boxes are authored art regions, not administrative
boundaries. Real OSM streets, survey footprints and source heights remain
authoritative. Source ownership: LilacBay; common pipeline: OliveSparrow;
district facade/tree consumers: RedIsland; district spawn and road-index reader:
DarkMarsh; bake/upload: WindyGate. All changes are source-controlled inputs;
no baked output was edited.

## Appearance

| Region | Building/material direction | Ground and planting |
| --- | --- | --- |
| Marina | Cream/coral/sage stucco flats, stone, selected clapboard | Cool concrete, green park polygons; plane trees with occasional palms |
| Presidio | Red brick and cream civic/barracks palette | Forest/park green, mapped scrub and sand; mostly cypress |
| Golden Gate approach | Brick/stone/stucco visitor buildings | Coastal scrub/green/sand; cypress; no decoration on freeway or bridge lanes |
| Pacific Heights | Cream, sage, rose and lavender clapboard with stone apartments | Light concrete, green parks; plane/cypress |
| Cow Hollow | Painted clapboard and stucco, brick commercial frontages | Cool concrete; plane/cypress |
| Japantown | Stone/concrete/stucco, Post/Buchanan retail context | Light concrete and mapped greenery; plane trees |
| Western Addition | Painted clapboard, brick apartments, stucco | Cool concrete, green parks; plane/cypress |

Ground cover is selected from source polygons, so a district box does not turn
residential blocks into lawns or coastal streets into sand. Buildings retain
their sourced type and height. Colour variants preserve the existing shader's
type-ratio bands, including normalized-u8 rounding: residential sage/lavender
must not become office glass or acquire a retail band. Explicit source retail
and commercial uses retain their facade classes.

The selected named streets retain 40–60 m² buildings within 25–35 m; the coarse
LOD remains in use elsewhere. Common hooks keep retained collision and rendered
footprints consistent, and retain mapped paving near these streets. District
trees/material lists provide inputs for the owning runtime systems under their
existing feature flags (`mapStreaming`, `terrain`, `buildingFacades`,
`realisticRender`, `realisticFacades`, `streetProps`, `streetDetail`,
`roadDetails`). No flags or payload budgets are waived by these profiles.

## Reference review

Reviewed all five local `tools/art/reference/teleop/teleop-*.png` frames by eye.
The useful cues are pale sidewalks separated from dark asphalt by visible
kerbs, red corner kerb paint, tree canopies, differing brick/stone/stucco/glass
facades, dark storefront displays and awnings, and overhead street wires. The
frames were not copied, committed, shipped or used as generation inputs. These
profiles provide district choices to existing geometry/material systems; they
do not create new landmark models or replace the Golden Gate Bridge model.

## Source arrival audit

On 2026-10-04 05:21 UTC, the actual client `createRoadSnapper` was run against the
cached packed city graph. SHA-256:
`5763c53debed013a7f5403a467bd829f45dacfdfb83dc9c5c19e5555fe91651f`.
Each configured arrival resolved to its intended district, an existing chunk,
and a ground lane (`bridge=false`, `tunnel=false`, `layer=0`). Maximum snap
adjustment was 0.004 m after centimetre packing. All 36 district street-name
entries were present inside their respective art regions.

| Arrival | Source road / OSM way | Chunk | Review query |
| --- | --- | --- | --- |
| Marina | Chestnut Street / 254984058 | `-11_-8` | `?at=37.8005638,-122.4383927,260.9` |
| Presidio | Montgomery Street / 158606183 | `-18_-8` | `?at=37.8007502,-122.4586043,31.3` |
| Golden Gate approach | Lincoln Boulevard / 27031206 | `-23_-10` | `?at=37.8065608,-122.4740283,330` |
| Pacific Heights | Jackson Street / 619535759 | `-9_-4` | `?at=37.7925780,-122.4336552,81.1` |
| Cow Hollow | Union Street / 717618719 | `-9_-6` | `?at=37.7975472,-122.4320693,260.9` |
| Japantown | Post Street / 91181763 | `-8_-1` | `?at=37.7856106,-122.4294421,81` |
| Western Addition | Golden Gate Avenue / 26937974 | `-9_2` | `?at=37.7795816,-122.4320964,81.1` |

The Golden Gate arrival deliberately uses Lincoln Boulevard below the visitor
area rather than nearby Presidio Parkway ramps. The source audit report is in
ignored `artifacts/district-northwest/source-smoke.json`. It checks current
source graph coverage; it does not verify a new bake's collision, loading-card
sequence, camera clearance, pavement contact, or visual quality.

## Validation and handoff

Run scoped checks through the shared low-priority lock:

```sh
tools/heavy.sh npx vitest run --config tools/map/vitest.config.ts tools/map/test/district-northwest.test.ts --maxWorkers=1
tools/heavy.sh npx tsc --noEmit -p tools/map/tsconfig.json
```

The northwest registry/quantized-palette smoke passed on 2026-10-04 05:31 UTC.
It caught and corrected a Marina cream that quantized into the retail type band.
OliveSparrow's final shared map typecheck passed at 05:34 UTC with all four
district modules and their tests present; the common pipeline's three targeted
files/six checks also passed, including a real one-chunk source bake.

The district facade/tree consumers are committed in `6b9cb95`: all 24 profiles
feed both facade shader paths, every street-tree branch uses the region mix,
and configured source frontages receive the denser street prop layout. RedIsland
reported 12 focused checks and heavy-wrapped strict web typecheck passing; the
committed consumer diff was reviewed for the northwest handoff.

Pending under `gtasf-tm7m` (WindyGate): the consolidated bake/upload, emitted-file
inventory, cold-load trace, and desktop/phone screenshots at the seven arrival
queries. Compare kerbs,
paving, building variety and tree placement against the local reference cues.
Check loading completes at the requested location with no console errors and
walk/drive along the named street. Preserve both terrain and road height near
Lincoln Boulevard. No visual, payload, phone-performance or deployment gate is
claimed by the source profile or source audit.

The source road-detail exporter extension is committed in `55b7656`. Its
read-only actual-source check retains all 329 eastern cells and selects 823
cells across all 24 districts. The 9,723,322-byte payload, 120,003-byte index
and 57,593-byte largest cell remain within existing byte budgets. Selected
northwest cell counts are Marina 22, Presidio 43, Golden Gate approach 9,
Pacific Heights 29, Cow Hollow 18, Japantown 8 and Western Addition 31.
Source splitting/coverage smoke and strict tools typecheck passed. Full evidence
and the bake command are in [DISTRICT-ROAD-CELLS.md](../../tools/map/DISTRICT-ROAD-CELLS.md).

DarkMarsh committed the matched 1,024-entry reader cap in `0af36a0` and
`gtasf-2lrv` runtime `/go/<district>` aliases with snapping before the initial
chunk load in `6c4d2c0` and `0660e0f`. The real reader smoke accepts 823 cells
and rejects excess entry/byte counts; source spawn tests cover omitted and
present raw chunks, Ferry default, explicit heading and bridge/tunnel heights.
DarkMarsh reported those focused checks and final web strict typecheck passing
at 06:00 UTC. Source and runtime contracts are complete; `gtasf-2wq4` closes
against that scope only. The coordinated bake and actual visual/payload review
remain open under `gtasf-tm7m`. No duplicate bake or upload was started from
this district task.
