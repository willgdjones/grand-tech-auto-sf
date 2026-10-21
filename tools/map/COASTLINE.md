# Sourced SA map coastline — gtasf-xj9z

The optional `manifest.coastline` asset supplies closed world `[x,z]` rings to the
existing SA map. `main.ts` loads it through a bounded reader; the renderer uses a
single even-odd `Path2D` so Alcatraz, Treasure Island and other islands stay dry.
Water and the shoreline edge draw before roads, labels and blips. Entry points
retain the existing `radar` and `saMapStyle` switches. No flag was flipped.

## Source and reproduction

Only pinned OSM `natural=coastline` ways are used. Source direction is preserved,
ways are joined at shared endpoints, and clipping closes open water faces only
on the map boundary. Gaps inside the map fail explicitly. Closed islands are
subtracted before a 2 m simplification; no coastline is guessed from districts
or administrative polygons. The geometry remains in the existing SF frame.

New `buildMap` runs emit the optional overlay and include it in the manifest and
byte totals. An existing bake can gain it without regenerating any chunk:

```sh
tools/heavy.sh npx tsx tools/map/src/pipeline/coastline-cli.ts --area=sf --check
tools/heavy.sh npx tsx tools/map/src/pipeline/coastline-cli.ts --area=sf --write
```

The command is read-only unless `--write` is given. It reads the source manifest
of that exact bake, verifies the OSM digest and refuses a concurrently changed
map manifest. Write mode uses the source exporter, updates gzip siblings and
refreshes the runtime inventory. Publication includes the asset with immutable
release URLs; the Worker only permits the specific `coastline.json` release key.

The reader accepts old manifests without the asset, validates the coordinate
frame and closed finite rings, caps decoded data at 200,000 bytes / 10,000
vertices / 256 rings, and times out after three seconds. Failure omits this
decoration without blocking the map or spawn. It performs no fetch when off.

## Recorded source check

Pinned OSM SHA-256:
`eef305814a45a544f8d3558e79b8ea14932f1a0bcaa7f6cb1215a46e82fc9372`.
116 source coastline ways / 5,512 vertices reduce to 25 rings / 2,477 vertices.
Asset SHA-256: `8e21d452a004b60cab5cd1fedbd03ec7e67660347e1a0a2cc4421768b173d7b1`.
Decoded JSON: **51,888 bytes**. Gzip transfer: **22,158 bytes**.

All ten source probes pass: Ferry plaza, FiDi, Mission Bay, Marina, Ocean Beach
promenade, Alcatraz and Treasure Island remain land; the Bay, Golden Gate and
Pacific probes are water. A focused fixture also preserves an inlet and island
across split ways and rejects an incomplete interior coast. Loader, SA map draw
and Worker route checks cover the consuming path.

The source CLI attached this overlay to the active local SF bake on 2026-10-04.
The existing dev server returned `/map/lombard/coastline.json` with HTTP 200,
`Content-Encoding: gzip`, 22,158 transfer bytes and 51,888 decoded bytes; its
SHA-256 matches the pinned output above. No chunk or road graph was regenerated,
and no remote upload was performed. Refresh the dev game and open **M** to review.

## Normal-renderer desktop and phone review

`tools/heavy.sh node tools/map/coastline-look.mjs` completed on 2026-10-04 against
the existing local dev server, using an isolated Chrome profile and native CDP
input. The session used the normal renderer, with no `capture` fixed steps or
feature overrides: desktop 1440×900 at DPR 1 and phone 390×844 at DPR 2.75 with
`preset=low`. The browser exited and its temporary profile was removed.

Evidence is in the ignored folder
`artifacts/coastline-look/2026-10-04T06-47-59.552Z/`: `report.json`, `desktop.png`,
`desktop-zoom.png`, `phone.png`, and `phone-zoom.png`. All views reached READY,
connected to the local multiplayer backend and fetched the coastline with HTTP
200, with no console, runtime or HTTP errors. Native controls opened the map,
zoomed and closed it; the Close button passed an actual visibility/hit test.
This caught a gameplay banner covering the map header, fixed separately in
`77513fd` (`gtasf-9evz`) before the successful final check.

OliveSparrow reviewed the images: the Bay/Pacific outline follows the
Embarcadero/FiDi, Mission Bay, Marina and Ocean Beach road edges. Alcatraz and
Treasure Island remain land; shore and land colours stay distinct at both zoom
levels. Dense whole-city road lines and event blips on phone are an existing map
readability limitation, separate from the aligned shoreline. The same session
also captured Noe Valley for the district agent, without accepting its separate
Victorian-palette look gate.

This closes the local shoreline acceptance for `gtasf-xj9z`. It does not establish
a cold-load budget, performance, real-device or deployment gate. Consolidated
district baking and payload/whole-city visual review remain in `gtasf-tm7m`.
