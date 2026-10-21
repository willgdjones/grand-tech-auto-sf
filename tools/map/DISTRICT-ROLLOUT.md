# Consolidated district rollout — gtasf-tm7m

LilacBay owns the isolated local source bake and inventory. WindyGate remains
the publication coordination contact. `gtasf-tm7m` stays open until its actual
bake, payload, desktop/phone and rollout evidence is recorded. Source task
closure does not establish those gates.

## Reproduce the candidate

Use the existing pinned SF PBF, DataSF and DEM cache; no network fetch is needed:

```sh
tools/heavy.sh npx tsx tools/map/district-rollout.mts
```

The runner uses the normal `buildMap`, neighbourhood attachment, packed runtime
graph, transfer sidecar and map validator. It writes only a new candidate under
`tools/map/out/district-tm7m`, plus the existing source cache. The active SF map
and its local selection are not replaced. A nonempty candidate directory is
rejected to prevent overwriting an earlier run accidentally. To revalidate a
completed candidate without another bake:

```sh
tools/heavy.sh npx tsx tools/map/district-rollout.mts --validate
```

`build-start.json` records the source commit and hashes of map source modules
and the shared packed-graph/coastline contracts. The runner rejects source drift
during the bake or later validation. `district-rollout.json` records the final
manifest hash, validation result, emitted inventory, and separate size gates.
All generated artifacts and receipts remain ignored.

The pipeline's existing manifest uses an 80 MB map check. That does **not** waive
the required 25 MB compressed whole-city target: the rollout report evaluates
both. Its 80 MB result covers the map alone; total production inventory must
also include web/art assets. Gzip totals are local compression measurements,
not browser transfer evidence. Cold READY transfer, decoded sizes and normal
desktop/phone review must be recorded independently.

## Paired source/runtime inputs

- District registry and map hooks: `3ad2f26`, including the four profile modules.
- Natural/leisure PBF multipolygons and cache v4: `037f656`.
- Northwest profiles and source-road arrivals: `92d0d78`.
- Kerb source export: `55b7656`; matched 1,024-entry reader: `0af36a0`.
- District links and snap-before-load: `6c4d2c0`, `0660e0f`.
- Both facade paths and all street-tree branches: `6b9cb95`.
- Source coastline export/runtime wiring: `fd29188`, `a03c937`.

Generate matching kerbs from the candidate's pinned source manifest into its
isolated art tree after the map bake finishes:

```sh
tools/heavy.sh npx tsx tools/art/prepare-district-roads.ts --map-root tools/map/out/district-tm7m --art-root tools/map/out/district-tm7m/art
```

The exporter verifies the candidate's source hashes, retains the existing
detailed corridor arrays and records the corridor asset's input digest. It
writes no active `web/public/art` files when `--art-root` is provided. Add
`--check` for complete validation without writing. The paired cell size is
256 m in both exporter and runtime; 1,024 is only the metadata entry cap.
Its existing contract and pre-bake 9.72 MB read-only inventory are in
[DISTRICT-ROAD-CELLS.md](DISTRICT-ROAD-CELLS.md).
Do not publish a map/index pairing with missing kerb files or mismatched hashes.

For a short review session after both commands finish, use the existing dev app
through an isolated local proxy:

```sh
npx tsx tools/map/district-preview.mts
```

Open `http://127.0.0.1:5197/`. The proxy serves the candidate map and kerbs while
forwarding app code, other assets, API requests and websockets to the existing
port-5173 dev server. It starts no watcher, does not edit the active selection,
and requires the completed validation report and matching kerb export. This
lightweight proxy does not hold the heavy-task lock; the actual browser review
runs through `tools/heavy.sh`. Stop the proxy after that review. Keep the browser
slot coordinated with the shared heavy-task owner; no production upload is
part of this proxy.

## Acceptance still required

Record one candidate's exact output hashes and full emitted inventory, then
normal desktop and phone arrivals across all 24 district links. Review source
ground colours, road contact, pavements/kerbs, type-aware facade/storefront
variety, trees/props, camera clearance and completed loading without console or
HTTP errors. Include Lincoln Boulevard's ground lane and the Twin Peaks contact
concern described in [WEST-DISTRICTS.md](WEST-DISTRICTS.md). Check both applicable
facade shader paths compile; PBR keeps its separate enablement gates.

The candidate has not been activated, uploaded or visually accepted by this
document. Coordinate any subsequent bake with the current map owner.

## First candidate — 2026-10-04

The isolated bake completed at `07:03:57 UTC`, with 2,501 chunks and 100/100
route checks passing. The packed graph is source-identical to the existing SF
graph (`5763c53debed013a7f5403a467bd829f45dacfdfb83dc9c5c19e5555fe91651f`).
The map source fingerprint remained unchanged throughout the bake:
`973fc7aedce7fe3235f2401379c62a1e3991fe9e3232332ae321d626893e88db`.
Source HEAD at the start was `94dab69`; the manifest SHA-256 is
`ed862ff9f052223d427e30eebd163f409ee7299fe9fda7ef2c9fd484996e9522`.

The manifest-driven inventory contains 7,585 unique runtime files, including
the manifest: **152,962,645 bytes uncompressed and 90,278,561 bytes gzip**.
The largest file is the 23,079,905-byte packed graph. The individual-file limit
passes; the **25 MB whole-city target and 80 MB total-production limit fail**.
The map alone already exceeds the latter before any web/art assets are added.
`gtasf-zzpr` remains the explicit budget blocker; there is no upload or budget
waiver. These are encoded artifact lengths, not decoded browser/GPU memory.

| Runtime category | Files | Uncompressed bytes | Gzip bytes |
| --- | ---: | ---: | ---: |
| LOD 1 meshes | 2,501 | 84,836,568 | 54,875,550 |
| Detailed LOD 0 meshes | 78 | 18,318,800 | 12,235,501 |
| Packed road graph | 1 | 23,079,905 | 10,994,998 |
| Terrain contact fields | 2,501 | 8,557,706 | 6,430,445 |
| Building collisions | 2,501 | 14,523,193 | 5,023,187 |
| Manifest | 1 | 2,817,234 | 444,967 |
| Neighbourhoods | 1 | 777,351 | 251,756 |
| Coastline | 1 | 51,888 | 22,157 |

The normal-renderer arrival harness uses the isolated preview and the district
registry directly:

```sh
tools/heavy.sh node --import tsx tools/map/district-look.mjs
```

It records default Ferry, all 24 district aliases and explicit Lincoln Boulevard
coordinates on desktop and phone. Optional district IDs restrict a follow-up
check. The first two views have a cleared/disabled browser cache; subsequent
visual-tour views reuse cached assets and are labelled accordingly. Service
workers are bypassed. Safe network metadata, compressed transfer bytes and
decoded HTTP body bytes are recorded through the actual READY marker. Requests
still in flight at READY are listed separately. Each view records source hashes
before/after, actual player contact and map-streaming errors; a source change
during the view prevents it passing. A failed default Ferry baseline stops the
tour before consuming time on all other arrivals.
The local unbundled dev app is not production transfer evidence; GPU memory and
device performance are not measured. Screenshots still need human/agent visual
review. There are no fixed steps, route teleports or feature-flag overrides.

The paired isolated kerb export passed with 823 cells (329 legacy), 10,239 road
fragments, 171 track fragments and 8,514 crossings. Cell files total 9,569,825
bytes (2,720,367 gzip); the index is 120,003 bytes and provenance is 33,494 bytes.
The complete district payload is 9,723,322 bytes and its largest cell is 57,593
bytes. All existing kerb byte/count limits pass. The preserved detailed-corridor
input SHA-256 is `98c839daedf377925b0470558b379ff409b3a27a7709778c564a6ee3dc808179`.

The preview's HTTP smoke passed: the served, gzip-decoded map manifest matches
the candidate SHA-256 above; app HTML returns 200; the 256 m kerb index has all
823 entries; and a fetched cell matches both its declared byte length and
SHA-256. Browser websocket, startup and visual evidence remain separate.

The first native review at `2026-10-04T07-31-17.542Z` stopped on default Ferry:
two `/api/admission` responses were HTTP 502 and the app reported that the local
city server did not connect. Its full trace and screenshot are retained under
`artifacts/district-look/2026-10-04T07-31-17.542Z/`. The screenshot shows the
reconnecting admission card, not an accepted district view. The app source also
changed during startup. A separate founder-walking review hit the same shared
backend failure. Health and admission later returned 200, which does not turn
the failed run into a pass. The long tour must be retried against a stable app
and real local Worker before any district look acceptance.

## Frozen app review

The retry reuses the emitted app from `docs/perf/d5-2026-10-04/after/inventory.json`
and verifies every listed file's length and SHA-256 before and after the review.
It starts a disposable real Worker pool with the normal migrations and event
seed, serves the paired candidate map/art through Vite preview, and closes only
those owned processes. It builds no web assets, edits no flags and leaves the
shared dev backend running. Use the Node version in `.nvmrc`:

```sh
tools/heavy.sh node --import tsx tools/map/district-static-look.mts
```

`GTASF_DISTRICT_APP_INVENTORY` selects another frozen app inventory.
`GTASF_DISTRICT_MAP_ROOT` selects a completed candidate directly inside
`tools/map/out`. The default remains `district-tm7m`. Optional district IDs are
forwarded to the normal arrival harness. Its screenshots now wait for nearby
streaming/upload queues to settle, and assert the configured arrival is within
2 m of its source lane with feet within 0.3 m of the road contact height.

The first frozen run is retained at
`artifacts/district-static/2026-10-04T07-49-16.026Z/`. Its `source.json` pins the
frozen app, `worker.json` pins the actual Worker bundle and seed, `inventory.json`
combines the app, paired kerbs and map, and `views/report.json` records each
normal-renderer desktop/phone navigation and safe network metadata. The first
run predates the additional settle/arrival assertions above.

The tour finished all **52 views** at `08:11 UTC`: all reached READY and connected,
with zero console errors, HTTP error responses or source drift. The automated
result is **51/52 pass, process exit 1** because SoMa desktop recorded cancelled
`/api/funding/pitch` and `/api/outbid` requests (`net::ERR_ABORTED`). That failure
remains in the report for a focused retry; it is not silently excluded. The
disposable browser, preview and Worker all closed after recording the result.

The two cold Ferry baselines reached READY and connected without browser or HTTP
errors: **14,217,373 transferred bytes desktop and 14,217,235 phone**, with
33,603,215 decoded HTTP body bytes each. READY took 21.00 s and 16.58 s. Both fit
the 15 MB first-load limit in this local bundled preview. The two zero-byte blob
worker URLs listed as in-flight are not unfinished HTTP downloads. Later views
reuse the browser cache and are not additional cold-load claims.

The combined emitted inventory still fails: app plus paired art is 34,696,731
raw bytes / 23,401,756 estimated gzip bytes; locally served map artifacts are
88,053,697 compressed bytes after the verified Brotli graph substitution.
Their combined compressed estimate is **111,455,453 bytes**, over 80 MB.
The map's ordinary gzip inventory remains 90,278,561 bytes, over its 25 MB
target. Every individual raw runtime file stays below 25 MB. These measurements
separate transfer encoding from HTTP-decoded file bytes; they do not measure
GPU memory, real-device performance or CDN transfer.

Northwest desktop/phone review found differentiated brick, stucco and
clapboard frontages, storefronts, palms in the Marina, mature street trees,
Presidio grass/paths, detailed skies and the finished avatar. **Lincoln
Boulevard fails ground visibility:** green terrain covers the road and feet.
Jackson Street in Pacific Heights has the same coarse ground crossing over
asphalt. DarkMarsh's review of all seven southern desktop/phone pairs also found
the same defect on Potrero Hill's 18th Street. The other six southern arrivals
show authored frontages and clear road contact in these views. OliveSparrow
reviewed all five central district pairs: office grids in FiDi/Moscone,
residential/retail paint in the Mission, and industrial brick in SoMa/Dogpatch,
with no comparable road occlusion. These are viewpoint-specific observations,
not a drive test or whole-district acceptance. Moscone still lacks a distinctive
convention-centre silhouette in this approach, and the broad geographic HUD
labels Dogpatch as Potrero Hill. RedIsland reviewed all five western pairs and
confirmed clipped asphalt on Twin Peaks and around Sunset's crossing/stop line;
Richmond, Golden Gate Park and Ocean Beach have clear road contact in these
views. This completes the 24-district desktop/phone screenshot review. The five
terrain failures require repaired-candidate evidence: Golden Gate approach,
Pacific Heights, Potrero Hill, Twin Peaks and Sunset.
The phone Chat button also overlaps the fund-drop banner; `gtasf-e0el`
owns that HUD correction. These are retained failures, not accepted look gates.

## Source-driven ground repair

The coarse bake previously discarded all terrain road cutouts outside the
original detail corridor. A 16 m ground triangle could therefore span above a
12 m road segment, despite the player and packed lane having the correct height.
The pipeline now retains cutouts in selected district street chunks. One focused
bake smoke inspects decoded GLB triangles across a hillside road; it requires
road faces and no covering terrain at three contact points, while preserving
adjacent ground and the single coarse LOD.

```sh
tools/heavy.sh node --import tsx tools/map/district-ground-repair.mts
tools/heavy.sh npx tsx tools/art/prepare-district-roads.ts --map-root tools/map/out/district-tm7m-ground --art-root tools/map/out/district-tm7m-ground/art
GTASF_DISTRICT_MAP_ROOT=tools/map/out/district-tm7m-ground tools/heavy.sh node --import tsx tools/map/district-static-look.mts
```

The repair runner validates and copies the failed candidate into a new directory,
then calls the normal source pipeline for selected district chunks only. It
refuses a nonempty destination, checks source drift, requires every contact
field and building collision hash to stay unchanged, and preserves both the
packed graph and original detail-corridor meshes. It records changed chunk IDs
and fresh full inventory. Successful rollout/kerb receipts are written only
after their respective commands finish. The original candidate remains intact
for comparison. A completed repair still needs new visual and budget evidence;
none of these commands activates or publishes it.

### Reuse the latest reviewed HUD build

The repair review can reuse the immutable final d6 app, including the Chat and
clock overlap fixes, without another web build. First create a complete emitted
inventory from its existing phone report:

```sh
tools/heavy.sh node tools/map/district-frozen-inventory.mjs docs/perf/phone-d6-final-2026-10-04/report.json artifacts/district-frozen-app/phone-d6-final/inventory.json
GTASF_DISTRICT_APP_INVENTORY=artifacts/district-frozen-app/phone-d6-final/inventory.json GTASF_DISTRICT_MAP_ROOT=tools/map/out/district-tm7m-ground tools/heavy.sh node --import tsx tools/map/district-static-look.mts
```

The inventory command checks the original report's entrypoint hashes before and
after reading every emitted file, then verifies all file hashes again. It records
compressed estimates and decoded image dimensions, including embedded GLB images.
It requires a new output path and preserves the original phone report's failed
performance verdict; reusing its app does not accept the performance gate.

The complete arrival review now includes 24 districts, default Ferry, explicit
Lincoln, and two source lane-edge cameras supplied for `gtasf-7924`: Columbus
`37.8001862,-122.4100724,130.8435` and Stockton
`37.8024919,-122.4095970,350.9021`. Each uses normal rendering at desktop Medium
and 390×844 phone Low. IDs can be passed after the command for a focused rerun,
including `ferry-default`, `lincoln-explicit`, `columbus-junction` and
`stockton-junction`. The first pair uses cold caches; later views reuse assets.
HTTP transfer totals exclude non-HTTP worker URLs, which are listed separately.
All network failures remain failures. These commands still require actual
screenshot review and do not constitute device or production acceptance.

### Repair bake result — 2026-10-04 08:57 UTC

The source repair completed successfully from commit `6291fa2`, fingerprint
`6a95b0cb1f885a2b57001e47a0a0d390aaa4e7f8f54476319e3a150611b8503f`.
Its manifest SHA-256 is
`7470d5b881c941aa0cc0e56dea3923d1a8f8ba3d75725d4f445e92bd0107a7fe`.
It changed 896 chunks and retained 1,605, preserving all 2,501 contact fields,
all building collision hashes, the packed graph and the original detailed
corridor's meshes. All 100 sampled routes passed; no source drift was detected.

The new runtime inventory is **167,288,898 raw / 103,721,130 gzip bytes**, across
7,585 unique files; the largest remains 23,079,905 bytes. The correct terrain
cutouts add geometry. Both the map's 25 MB and map-alone 80 MB checks still fail,
and compression work must use this repaired cohort. No activation or upload was
performed. Paired kerbs, emitted-triangle arrival inspection and the new native
review are still pending at this bake checkpoint.

The read-only triangle diagnosis is:

```sh
tools/heavy.sh node --import tsx tools/map/district-ground-audit.mjs tools/map/out/district-tm7m-ground artifacts/district-ground/after.json
```

It verifies the completed manifest and each inspected GLB hash, then inspects
every distinct LOD at all 24 source arrivals and four points within half a metre.
Road faces must exist and terrain faces must be absent at these lane points.
The report retains failures and exits unsuccessfully if any point fails. This
diagnoses emitted ground geometry; screenshots remain required for the scene.

### Repaired geometry and first native batch — 2026-10-04 09:32 UTC

The emitted-triangle audit passed all 25 distinct LOD records across the 24
district arrivals, including the five previously obscured roads. At each arrival
and four half-metre offsets, road triangles exist and terrain triangles do not
cover the lane. Evidence: `artifacts/district-ground/after.json`. The paired kerb
export also passed with the same 823 cells and 9,723,322-byte payload as above.

The latest frozen-app review is retained at
`artifacts/district-static/2026-10-04T09-20-27.397Z/`. It completed **15 successful
views** before an intentional interruption released the shared heavy-task lock
for other panes' queued source checks. Its process exited 130; this is **not a
completed 56-view tour**. `interrupted.json` records that distinction. The final
Ocean Beach phone navigation was interrupted before an evidence record. All
434 frozen app files were verified again after interruption in
`frozen-app-after.json`.

Completed views are desktop and phone pairs for Ferry, Moscone, FiDi, Japantown,
Dogpatch, Golden Gate approach and Mission, plus Ocean Beach desktop. Every
record reached READY and connected, passed the actual arrival/contact/streaming
checks, and had zero console errors, HTTP errors, network failures or source
drift. Network records are now copied at capture time, so subsequent navigations
cannot retrospectively alter a previous view's recorded cancellations.

The cold Ferry views transferred **14,683,331 bytes desktop / 14,262,525 phone**
through READY, with 34,298,337 / 33,664,849 decoded HTTP body bytes. READY took
31.66 / 33.69 seconds. Both fit the 15 MB limit in this local bundled preview;
neither had unfinished HTTP requests at READY. Non-HTTP blob-worker URLs are
listed separately. This does not establish production or device performance.

Visual review confirms exposed asphalt beneath the player on Lincoln Boulevard
in both Golden Gate approach views, resolving that recorded grass-over-road
failure at this viewpoint. Japantown retains detailed shopfronts, trees and
kerbs; Ferry retains its plaza, clock tower and finished avatar. OliveSparrow
reviewed all eight Mission/Moscone/FiDi/Dogpatch images and found continuous
exposed road, district-specific frontages and cloudy atmosphere. The phone Chat
button is clear of the fund banner, and the desktop clock clears the toolbar.
The remaining repaired viewpoints, including the other four formerly obscured
roads, still require their focused browser batches. SoMa's earlier cancelled
requests remain an unresolved recorded failure until its retry.

This candidate's combined inventory remains over budget: the app and paired art
are 34,708,972 raw / 23,404,326 estimated gzip bytes; map artifacts are
101,496,266 locally served compressed bytes after the verified Brotli graph
substitution. Their combined estimate is **124,900,592 bytes**, above 80 MB.
The ordinary map gzip total is still 103,721,130 bytes, above 25 MB. Individual
raw runtime files remain below 25 MB. `gtasf-zzpr` owns the separate compact
representation; none of these partial native results activates or publishes it.

Keep follow-up batches small to share the serial check slot. For example:

```sh
GTASF_DISTRICT_APP_INVENTORY=artifacts/district-frozen-app/phone-d6-final/inventory.json GTASF_DISTRICT_MAP_ROOT=tools/map/out/district-tm7m-ground tools/heavy.sh node --import tsx tools/map/district-static-look.mts pacific-heights potrero-hill
```

### Hill follow-up and exposed joins — gtasf-hbyf

That four-view batch completed successfully at
`artifacts/district-static/2026-10-04T09-47-22.907Z/`: Pacific Heights and Potrero
Hill each reached READY on desktop and phone with correct contact and no
console, HTTP, network or streaming errors. Their earlier terrain-over-asphalt
failures are gone. This brings the repaired cohort to 19 completed views.

Visual review still found pale-blue strips at road/ground edges and through
Potrero's junction. RubyWaterfall confirmed that the road-detail materials
contain no such blue and identified exposed background; DarkMarsh independently
confirmed the remaining strips in both Potrero captures. The actual emitted
boundary audit in `tools/map/district-seam-audit.mjs` measured:

| Arrival | Mismatched edge pairs | Road/road | Road/terrain | Maximum vertical gap |
| --- | ---: | ---: | ---: | ---: |
| Pacific Heights | 150 | 3 | 147 | 0.138 m |
| Potrero Hill | 309 | 125 | 184 | 0.193 m |
| Ocean Beach | 177 | 15 | 162 | 0.172 m |

Evidence is `artifacts/district-seams-hbyf/before.json`, pinned to the repaired
manifest and each inspected GLB hash. The audit compares collinear boundaries
within 80 m of each arrival, with at least 0.1 m overlap and over 0.03 m vertical
mismatch. These are geometry diagnostics, not additional accepted scenes.

Source commit `ec9dbd0` adds `createSurfaceJoins` and invokes it for district
street chunks. It connects existing adjacent edges without moving either
surface, and excludes gaps over 0.5 m so separated road levels remain open.
A focused raycast smoke verified ground and hill-junction closure, unchanged
source arrays and retained bridge clearance; the map strict type check passed.
The existing candidate has not been modified. `gtasf-hbyf.1` tracks an isolated
append-only repair using the same helper, preserving all existing mesh data and
contact/collision/graph hashes. New candidate and browser evidence are required
before closing `gtasf-hbyf` or the overall district acceptance.

### Reproducible append-only repair — gtasf-hbyf.1

`district-seam-repair.mts` creates a new, empty `district-tm7m-seams` candidate
from the immutable ground repair. It inspects the 896 changed chunks and adds
only the edge connectors. The adapter copies the original compressed GLB
binary bytes and retains every existing node, mesh, accessor, buffer view and
material value. New faces reuse the original quantization transform and roads
material. They are grouped into at most 3,000 vertices per primitive: 54 KB
including attribute strides and indices, below the 64 KB upload ceiling.

The actual-file smoke uses Pacific Heights, Potrero Hill and Ocean Beach. It
compares every original decoded attribute/index byte sequence and transform,
loads the result through the game's Three.js GLTFLoader, and checks the actual
backing buffers used by the upload scheduler. Run these through the shared
check slot; the full conversion is a separate command:

```sh
tools/heavy.sh npx tsx tools/map/district-seam-repair.mts --smoke
tools/heavy.sh npx tsx tools/map/district-seam-repair.mts
```

The completed candidate receipt is written only after artifact hash checks,
all-chunk contact/collision preservation, graph preservation, routing checks,
the complete emitted inventory and a source-fingerprint drift check. Existing
active map selection and compiled flags are untouched. Generate the paired
kerbs with `prepare-district-roads.ts` against the new candidate and its `art`
directory before a frozen-app browser batch. The converter's smoke is not
visual, payload-budget, deployment or device acceptance.

The final three-file smoke passed at `2026-10-04T11:02:46Z`, after the focused
adapter test and map/standalone strict type checks. Pacific Heights added 4,048
triangles in five nodes; Potrero Hill added 5,738 in six; Ocean Beach added 5,154
in six. All original mesh arrays, transforms and materials matched, and the
native Three.js loader retained every triangle within the upload bound.
`artifacts/district-seams-hbyf/append-smoke.json` records the input/output hashes.
The larger primitive groups reduce draw calls but increase the sampled gzip
sizes to 108,856 / 152,339 / 115,714 bytes respectively; payload acceptance
remains open. Full candidate conversion and actual scene review are next.

The full isolated candidate completed at `2026-10-04T11:22:29Z`, using committed
converter `353fd7c` and unchanged source fingerprint
`0ed5febddcb3890365b46d7fd4de7c227c7ed16f1dd3fcddef7149e31069474d`.
Its receipt is `tools/map/out/district-tm7m-seams/district-rollout.json`; manifest
SHA-256 is `f356387321d934508279f4315478e4eeed897e67557f71e09f4500cfbbf10456`.
All 896 inspected chunks gained joins and 1,605 chunks were retained exactly.
Every one of the 2,501 contact/collision records and the road graph was preserved;
100 of 100 routing checks passed. The converter bead is closed on that evidence.

The appended geometry totals 3,661,964 triangles, including both windings. Its
complete inventory has 7,585 unique files: 369,117,600 raw bytes and 148,251,089
gzip bytes, with a largest individual file of 23,079,905 bytes. This **fails**
both the 25 MB map limit and the 80 MB production limit even before app assets.
The extra faces increased map gzip by 44,529,959 bytes. This candidate is not
activated or uploaded. Paired kerbs and the native desktop/phone seam review
remain separate from the preservation result.

Follow-up `gtasf-hbyf.2` measures lossless compression of only the appended
streams, comparing every decoded attribute/index against this immutable raw
candidate. It must retain the original compressed bytes, and any whole-cohort
output goes to a separate directory with its own complete inventory.

### Native hill review and compressed follow-up

The raw seam candidate completed four native views in
`artifacts/district-static/2026-10-04T11-33-02.657Z/views/`. Pacific Heights and
Potrero Hill each passed READY, connection, contact, settled streaming and
browser/network error checks on desktop and phone. Pacific Heights' cold
transfer was 14,539,105 / 14,538,965 bytes (35,251,408 decoded body bytes), with
READY at 16.79 / 15.20 seconds. Potrero's two cached transfers were 12,547,328
bytes each. These are local transfer records, not performance acceptance.

Manual comparison with the preceding four captures confirms Pacific Heights'
outer-kerb blue strip is sealed, as are Potrero's long diagonal junction and
near-left kerb strips. A small pale horizontal strip in Potrero's junction still
needs diagnosis, so the visual parent remains open. The wide yellow GPS ribbon
is present in both before/after cohorts. The preview logged a WebSocket EPIPE
after `DISTRICT_LOOK_DONE` during shutdown; all four browser records have zero
console/HTTP/network errors. Commit `22d2145` adds exact camera matrices to the
next capture for source-geometry ray diagnosis.

Compression commit `88acbf9` uses the existing mesh codec for only the added
streams, with exact index sequences. The three-file smoke compares **all**
decoded arrays/transforms/materials against the raw seam candidate and again
checks the native Three loader and upload bounds; it passed, as did the focused
adapter smoke and strict checks. Sample gzip sizes fell from 108,856 / 152,339 /
115,714 to 95,966 / 135,878 / 101,054 bytes.

The complete `district-tm7m-seams-meshopt` candidate finished at
`2026-10-04T11:47:09Z`, with manifest
`02c053a302f58ba5fdee3370fa90187417f5c0677061b62ad526b8748fc4ec26` and unchanged
source fingerprint `7d508c8b1260fb4869fa9d8ef6d0ffc8d975a5b2cb6895329ce60424eae12e75`.
It preserves the same 896 repaired / 1,605 retained chunks, 3,661,964 added
triangles and all contact/collision/graph artifacts; 100 routing checks passed.
The 7,585-file inventory is 239,224,184 raw / 137,928,621 gzip bytes, a
10,322,468-byte gzip saving from the raw append. Maximum file size is unchanged
at 23,079,905 bytes. **The 25 MB map and 80 MB production budgets still fail.**
No candidate was activated or uploaded, and this compression result does not
close the remaining visual or device gates. Future isolated conversions use
`--out tools/map/out/<new-candidate-name>`; existing outputs must stay intact.

A second raw-candidate batch completed at
`artifacts/district-static/2026-10-04T11-49-00.241Z/views/`. Ocean Beach and Potrero
Hill each passed READY, connection, contact and settled-streaming checks on
desktop and phone, with zero browser, HTTP or network errors. Manual review
confirms Ocean Beach's curb/background gap is sealed. Potrero's thin horizontal
strip remains visible on both platforms, so `gtasf-hbyf` stays open. These are
six distinct reviewed views for this candidate, including the preceding Pacific
Heights pair; repeating Potrero does not complete more of the district matrix.

Ocean Beach's cold transfers were 14,251,963 / 14,251,823 bytes, with 34,681,922
decoded body bytes and READY at 29.86 / 23.42 seconds. Potrero's cached transfers
were 12,547,808 / 12,547,811 bytes, with 36,017,626 decoded body bytes and READY
at 25.44 / 22.51 seconds. The frozen app's 434 files and source manifest were
verified before and after the batch. This batch completed without the preceding
shutdown warning. The report also records the actual camera matrices for a
source-mesh ray diagnosis of the remaining strip; it does not establish phone
performance or acceptance of the separate compressed candidate.

`district-pixel-ray.mjs` reproduced the saved camera against exactly the nine
requested, hash-verified map chunks. Its report is
`artifacts/district-seams-hbyf/pixel-rays-potrero-hill-desktop.json`. Desktop
pixels (640,493), (660,493), (680,493) and (700,493) have no map intersection
within 500 m; neighboring rows hit road triangles about 18.2 m away in chunk
`3_9`, around (911.4, 30.94, 2408.6). This establishes an exposed geometry gap,
not blue paint. The two adjacent road edges differ by about 4.6 cm vertically at
the shorter edge's end. The diagnostic covers source map meshes only; runtime
kerbs, props and GPS are excluded. The missed-edge topology is the next source
repair target, and no visual gate is closed by this diagnostic.

### Collapsed junction triangle repair

The source incidence report `artifacts/district-seams-hbyf/potrero-edge-topology.json`
identifies the missed boundary precisely. Road face 288 has two coincident
vertices after quantization: it contributes the same lower edge twice despite
having zero area. Along with visible face 289, the edge count becomes three,
so the earlier boundary detector excludes it. Upper face 94 has the matching
exposed edge. `createSurfaceJoins` now ignores zero-area triangles when counting
boundary incidence, retaining every original vertex and triangle in the asset.

The focused smoke includes those exact three quantized faces and the saved
camera ray. It passed, along with map and standalone CLI strict TypeScript.
The three-file native-loader smoke completed at `2026-10-04T12:20:35Z`, source
fingerprint `14a9b28a2ee0faab8c4c79964db93cbc8c80228cc3f32a8430da1b4349f1d31b`.
All original mesh arrays, transforms and materials remain identical. Each of
the four missing Potrero rays first reproduces the old opening, then hits the
repaired surface at 18.22–18.25 m. Added primitives retain the native 64 KB upload
bound. Pacific Heights / Potrero / Ocean Beach add 4,102 / 5,778 / 5,284 triangles.
Their sampled gzip sizes are 96,580 / 136,319 / 102,302 bytes.

For a geometry repair, pass the recorded ray report explicitly. Without it,
`--smoke` retains the earlier compression-only comparison against every array
in the original raw append; changed join geometry intentionally fails that
comparison. The camera mode still compares every original base-mesh array and
requires all recorded missing rays to be repaired. Its receipt is
`artifacts/district-seams-hbyf/append-smoke-district-tm7m-seams-collapsed.json`;
the previous compression receipts are retained.

```sh
tools/heavy.sh node --import tsx tools/map/district-seam-repair.mts --smoke --ray-report artifacts/district-seams-hbyf/pixel-rays-potrero-hill-desktop.json --out tools/map/out/district-tm7m-seams-collapsed
tools/heavy.sh node --import tsx tools/map/district-seam-repair.mts --out tools/map/out/district-tm7m-seams-collapsed
```

The new isolated full candidate completed at `2026-10-04T12:32:14Z`, using source
fix `cf11ab5` and the unchanged fingerprint above. Manifest SHA-256 is
`862f034627533f6761f76ac3f46d8afbd65caf6ef464f293cf8ecfffe58a423a`.
It repairs 896 chunks and retains 1,605 unchanged, with 3,697,868 added triangles.
All 2,501 contact/collision artifacts and the original graph remain unchanged;
100 routing checks passed. Its 7,585-file inventory is 239,912,150 raw /
138,242,977 gzip bytes, with a largest file of 23,079,905 bytes. Both the 25 MB
map and 80 MB production budgets still fail. Paired curb export passed with
823 cells, preserving 329 legacy cells: 9,723,322 payload / 2,720,367 gzip bytes.
The preview's complete emitted app/art inventory adds 23,404,326 estimated gzip
bytes, giving 161,647,303 bytes with the map inventory. Its separately verified
Brotli-graph/gzip-map serving estimate is 136,018,113 bytes for the map alone;
neither encoding choice brings the total within budget.

The native batch `artifacts/district-static/2026-10-04T12-34-05.573Z/views/`
completed with exit 0. All four Pacific Heights and Potrero Hill desktop/phone
views passed READY, connection, road contact, settled streaming and zero
browser/HTTP/network errors, with source hashes unchanged. All 434 frozen app
files were verified before and after the batch. Manual review of all four
images confirms the Potrero horizontal opening is gone and the earlier hill,
junction and curb joins remain sealed. This closes the representative seam
acceptance in `gtasf-hbyf`; the full district rollout remains open.

Pacific Heights' cold transfers were 14,465,872 / 14,465,733 bytes through READY
(34,285,108 decoded body bytes), at 34.52 / 29.29 seconds. Potrero's cached
transfers were 12,439,658 / 12,439,663 bytes (34,590,009 decoded), at 24.26 / 24.61
seconds. These are local transfer records, not phone performance evidence.
The local Worker emitted an overdue SQLite-alarm diagnostic; no browser error
or failed request accompanied it. No map was activated or uploaded. The other
district arrivals, whole-city payload budget and device gates remain open.

### Western follow-up on the final seam candidate (2026-10-04 12:53 UTC)

`artifacts/district-static/2026-10-04T12-53-05.535Z/views/` completed with exit 0
against manifest `862f0346…` and the same frozen `phone-d6-final` app inventory.
Twin Peaks and Sunset each passed desktop and phone READY, connection, road
contact, settled streaming, and zero browser/HTTP/network errors. App and map
hashes stayed unchanged. All four screenshots were personally reviewed:
Twin Peaks' curved hill roads remain visible above the coarse terrain, Sunset's
asphalt intersection is clear, and the repaired curb/road joins show no open
strip in these views. Facades, storefronts, trees and detailed sky are visible;
these screenshots retain the earlier frozen HUD and onboarding-off build.

| View | Cache | Transfer through READY | Decoded HTTP bodies | READY |
| --- | --- | ---: | ---: | ---: |
| Twin Peaks desktop | cold | 14,179,573 B | 33,717,736 B | 16.21 s |
| Twin Peaks phone | cold | 14,179,429 B | 33,717,736 B | 16.60 s |
| Sunset desktop | reused | 12,405,003 B | 34,547,003 B | 15.96 s |
| Sunset phone | reused | 12,405,412 B | 34,547,265 B | 14.56 s |

These four views extend the partial visual matrix; they do not establish a
whole-city drive, current whole-app, FPS, real-device or production gate. The
25 MB map and 80 MB complete-production budgets still fail as recorded above.
No activation or upload was performed.

### Lincoln alias/coordinate parity and Ocean Beach (2026-10-04 13:23 UTC)

The next normal-renderer batch completed with exit 0 at
`artifacts/district-static/2026-10-04T13-23-36.164Z/views/`, still on the final
`862f0346…` map and frozen `phone-d6-final` application. All six views passed
READY, connection, road contact and settled streaming with unchanged hashes
and zero browser/HTTP/network errors. The six original screenshots were all
personally reviewed: Lincoln's asphalt remains visible above the hillside,
the avatar stands on the road, and Ocean Beach's road/pavement boundary is
closed with its facades, trees, wires and ocean horizon visible.

Both `/go/golden-gate-approach` and
`?at=37.8065608,-122.4740283,330` resolve to precisely the same saved foot pose
on both viewports: X −5832.24 m, Y 48.74 m, Z −2483.95 m, yaw 3.6570101983.
The reported road and surface heights both equal that foot height. Ocean
Beach's two views also agree at X −8987.15 m, Y 10.0682693252 m, Z 1294.26 m.

| View | Cache | Transfer through READY | Decoded HTTP bodies | READY |
| --- | --- | ---: | ---: | ---: |
| Lincoln district desktop | cold | 14,425,377 B | 34,171,343 B | 18.85 s |
| Lincoln district phone | cold | 14,425,239 B | 34,171,343 B | 16.27 s |
| Ocean Beach desktop | reused | 12,046,752 B | 33,767,741 B | 13.39 s |
| Ocean Beach phone | reused | 11,952,485 B | 33,767,741 B | 12.96 s |
| Lincoln explicit desktop | reused | 12,232,012 B | 34,210,269 B | 11.55 s |
| Lincoln explicit phone | reused | 12,231,598 B | 34,210,007 B | 13.66 s |

The preview proxy logged a WebSocket `ECONNRESET` during shutdown after
`DISTRICT_LOOK_DONE`; all six completed browser records have empty error arrays.
These are partial district-look and local-transfer results, not performance or
deployment acceptance. The frozen HUD/onboarding limitations and failed 25 MB /
80 MB budgets of this uncompressed-geometry candidate still apply. No active
map or production resource changed.

### SoMa and the requested Columbus/Stockton views (2026-10-04 13:47 UTC)

`artifacts/district-static/2026-10-04T13-47-16.074Z/views/` completed with exit 0
on the same `862f0346…` candidate and frozen `phone-d6-final` app. All six
desktop/phone arrivals passed READY, connection, road contact and settled
streaming, with unchanged hashes and empty browser, HTTP and network error
arrays. All six original images were personally reviewed. SoMa and Stockton
show closed road/kerb joins; Stockton's centre lines, manhole and overhead wires
remain visible. This successful SoMa arrival also clears the earlier aborted
navigation retry for this map cohort.

Columbus has residual blue asphalt hairlines, so its visual seam acceptance
remains open under `gtasf-8xwn`. The saved-camera diagnostic
`artifacts/district-seams-hbyf/pixel-rays-columbus-junction-desktop.json` confirms
that pixels (554,700) and (537,740) have no source-mesh hit. Adjacent pixels
(555,700) and (553,700) hit `roads` / `roads_2` at approximately 8.07 m in chunk
`-1_-7`, asset SHA-256
`d2d9784d28dec407fb987dbb8b93e4dee7fe2d32694942aad43482738bec258c`.
That asset was unchanged by the prior ground/seam conversion. Five other rays
hit road surfaces; these are source-geometry diagnostics, not replacement images
or evidence that every blue pixel is an opening.

| View | Cache | Transfer through READY | Decoded HTTP bodies | READY |
| --- | --- | ---: | ---: | ---: |
| SoMa desktop | cold | 14,786,047 B | 34,804,553 B | 21.49 s |
| SoMa phone | cold | 14,785,905 B | 34,804,553 B | 21.10 s |
| Columbus junction desktop | reused | 13,764,056 B | 36,684,597 B | 21.81 s |
| Columbus junction phone | reused | 12,894,183 B | 35,337,480 B | 17.13 s |
| Stockton junction desktop | reused | 13,765,903 B | 36,693,272 B | 26.08 s |
| Stockton junction phone | reused | 12,895,412 B | 35,346,440 B | 23.17 s |

All six settled foot heights equal their reported surface heights. These
loading/contact checks do not supersede the Columbus visual finding, earlier
frozen-HUD limitations, incomplete district matrix or failed payload budgets.
No map activation, upload, FPS, real-device or deployment acceptance is claimed.
