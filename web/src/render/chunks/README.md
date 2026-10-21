# Local map stream

`loadLombardWorld({mountGeometry, position, tier})` is gated by `flags.mapStreaming`.
Pass the explicitly resolved Ferry/deep-link world position; the loader never
silently changes the requested location. The historical URL `/map/lombard/` serves
the manifest's entire currently baked area, including the expanded Ferry corridor.
`localMapPlugin()` serves the ignored pipeline output during Vite dev and preview.

Call `update(playerPosition)` before rendering. The nearest 3×3 chunks are requested
with two in flight, meshopt decode uses two Web Workers, and one mesh is revealed
per frame. The outer 5×5 is a retention margin; departing meshes, source materials,
textures, heightfields and collision data are disposed. Desktop uses LOD0, low tier
uses LOD1. `stats` exposes load/update time, new upload count/bytes and failures.
Geometry construction by GLTFLoader remains on the main thread, while compressed
buffer decode runs off-thread. A mesh is the indivisible upload unit; the later
driving-frame gate must establish whether the bake needs smaller mesh partitions.

`heightAt` samples carved terrain; `surfaceHeightAt` prefers nearby 3D road profiles.
Both return null outside loaded terrain. Pass surfaceHeightAt and collidesCircle
to movement. `collides(x,y,z,radius,height)` additionally supports explicit vertical
clearance. Building footprints retain holes; `cameraBoxes` is a stable, mutable
array of conservative bounds exclusively for the chase camera.

Collision has a deliberate player-vs-camera split for coarse (detail:'low') chunks,
which ship no building footprint JSON (80 MB budget). Those chunks' rendered
`buildings*` meshes are indexed into `coarseBuildingIndex` (a StructureCollisionIndex)
and surfaced two ways: `collidesCamera` always includes them, so the chase camera
never buries itself in a low-detail block on a deep-link spawn (gtasf-q3r6); `collides`
(player/vehicle) includes them only when `flags.coarseBuildingCollision` is on
(gtasf-ntcl). Inside the detail corridor `coarseBuildingIndex` is empty, so both are
identical to the footprint+tunnel path there. Keep both wired when editing world.ts.

`ensureAround(position)` awaits a target chunk for location changes; `nearestRoad`
returns a source graph point within a caller-selected radius. It does not claim
that every graph road is walkable: the caller must check the loaded collision
data after snapping. Reject locations outside the manifest and keep the loading
card visible on errors.

Smoke: Node 24 `nice -n 10 node tools/map-smoke.mjs` builds only an isolated entry,
uses the actual Vite preview middleware, records `artifacts/map-stream/evidence.json`
and a screenshot, and closes its browser/server. Real initial Lombard evidence:
9 chunks, 2 decode workers, max 1 new mesh/frame, ground 85.838m vs road 85.954m,
1,135 camera bounds, zero errors; geometry and bounds release verified. No device,
frame-time, deployed gate or final building facade acceptance is claimed.

## Street-name index memory (gtasf-ne91)

`createLocationNameLookup` indexes the immutable road graph using typed edge and
point IDs. It reuses graph coordinates, trims names once per edge and uses typed
visit stamps to avoid a new de-duplication Set per HUD query. Equal-distance
choices retain the original grid traversal order, including where that differs
from graph order. The 3 m deck filter, hill interpolation, strict search radius
and 256 m cap, OSM way IDs, and district polygon/hole boundaries are unchanged.
The lookup is mounted behind the existing map-streaming/HUD integration.

The 2026-10-03 12:47 UTC Node 24.21 comparison used the actual city graph
`5763c53d…`, DataSF district file `acc21d3c…`, and recorded Columbus driving trace.
All 15,505 queries had identical result hashes, with 10,531 street and 12,765
district hits. Retained memory fell from 79,499,560 JavaScript bytes to 10,884,728
JavaScript plus 4,050,876 array-buffer bytes: 64,563,956 bytes saved in total.
Single-trial construction was 249 → 120 ms and mean query time 0.0556 → 0.0460 ms.
These are bounded Node measurements; the unfiltered browser driving gate remains
separate. Results are in `artifacts/location-name-memory/2026-10-03T1246/`.
Both location-name tests and strict web types passed.

`tools/location-name-memory-smoke.mjs` accepts an implementation path, report
path and optional baseline report to assert exact results and reduced retained
bytes. Run each implementation in a fresh Node 24 process so GC measurements do
not include the other index; preserve the previous source before changing it:

```sh
nice -n 10 node --import tsx --expose-gc tools/location-name-memory-smoke.mjs /tmp/locationNames-before.ts artifacts/location-name-memory/before.json
nice -n 10 node --import tsx --expose-gc tools/location-name-memory-smoke.mjs web/src/render/chunks/locationNames.ts artifacts/location-name-memory/after.json artifacts/location-name-memory/before.json
nice -n 10 npx vitest run web/src/render/chunks/locationNames.test.ts --maxWorkers=1
nice -n 10 npx tsc --noEmit -p web/tsconfig.json
```

`GTASF_LOCATION_GRAPH` and `GTASF_LOCATION_REPLAY` select another existing graph
and captured drive; the sibling `neighbourhoods.json` is included in the hashes.
