# District facade and road coverage

Bead: `gtasf-n0dn`. Local implementation, pinned source export and the scoped desktop/phone art-coverage check are complete. This is not whole-city visual acceptance: source surface gaps found during review remain a separate map integration defect.

The renderer uses the map's `chunk.detail: "low"` / `gtasfLowDetail` hint. Coarse chunks borrow a 512×256 version of the reviewed facade atlas and 128×128 versions of the three road tiles. These are resized once from the already verified images, with no additional image requests. The original Ferry–Lombard detail remains available. Original world-metre repeats, roof colours, collisions, road contact heights, night emission and material disposal remain in force.

The added bitmap memory is 720,896 bytes of RGBA texels, plus approximately 65,536 bytes for the three road mip chains on the GPU. Each individual image stays below 1 MP. FiDi's stone facade zone now ends before SoMa; non-office SoMa buildings favour brick, and occasional Mission murals occupy the ground-level wall while upper floors keep windows.

Street markings, cosmetic kerbs and rails use pinned OSM/DEM sources from the completed SF map. `tools/art/prepare-district-roads.ts` verifies source bytes and digests against the map, retains source intersection/crossing gaps, and splits paths at 256 m grid edges with their original paint phase. The existing corridor stays in `road-details.json`; a small optional index extends contiguous North Beach, FiDi, SoMa and Mission coverage outside that corridor. Region bounds are `[-2304, -2816, 2048, 3584]` in the shared SF frame.

The district index is capped at 150 KB / 512 cells; every cell is capped at 300 KB, and the regional export at 15 MB uncompressed. At runtime, only the surrounding 3×3 cells are cached, with at most two pending cell requests. Source indexing yields in small batches and geometry retains its existing 2 ms build steps. Obsolete requests are cancelled and cache entries/geometry are released when leaving a region or disposing the scene. The existing `buildingFacades`, `groundTextures` and `roadDetails` flags control their entry points.

The 2026-10-03 09:13 UTC export contains 329 cells, 8,110 road parts, 163 rail parts and 4,513 crossing parts. Cells total 6,534,219 bytes of JSON; their summed gzip size is 1,842,678 bytes (an offline size measurement, not a browser transfer trace). The index is 80,962 bytes and the largest cell is 56,521 bytes. A source-output check verifies all 329 byte counts/hashes and all 12,786 path parts stay inside their assigned cells; maximum marking-range error from centimetre rounding is 0.02 m. No contact geometry or road graph is changed.

## Reproduction and evidence

Use Node 24 after the SF map owner announces its completed manifest:

```sh
npx tsx tools/art/prepare-district-roads.ts
node tools/district-art-smoke.mjs
```

The smoke loads real source chunks at Columbus Avenue (North Beach), Montgomery Street (FiDi), Folsom Street (SoMa) and Valencia Street (Mission), on desktop and phone. Its isolated server derives a bounded source graph from the real city graph and records both hashes; no source road coordinates or IDs change. This scope avoids downloading the raw city graph and establishes only district art behavior, not whole-city routing, native multiplayer, production payload, performance or device acceptance. The default served map is unchanged by this tool.

The fixture writes source provenance, screenshots, per-view transfer/decoded byte counts, texture sizes, material counts, errors, cache/request limits and cancellation/disposal evidence to `artifacts/district-art/`. These artifacts are ignored. The export writes its inventory to `tools/map/out/sf/district-roads-smoke.json`.

Source checkpoint `7262468`: web and both offline exporter roots pass strict TypeScript and all five existing `foundation.test.ts` tests pass. The two exporter roots were checked directly using the workspace's strict compiler options. Asset checkpoint `bcda9e6` contains the full regional export.

The October 3 09:45–09:49 UTC smoke completes all eight views (1100×720 desktop and 390×844 phone). All eight screenshots were reviewed: authored siding/stone/brick/shopfront facades and textured asphalt, paint and kerbs are visible in the four districts. FiDi/SoMa/Mission use 6/9/9 coarse chunks respectively; each uses the lower-resolution facade and road materials. Every view has zero page/console/HTTP/streaming errors. Cell requests peak at two and the cache stays at or below nine. Each browser's disposal cancels one actual in-flight district request and leaves zero cell requests, cached cells, vertices and material bindings.

Each browser fetches 519,781 bytes of district cell JSON across the full tour. The isolated static server is uncompressed: cumulative browser transfer at the end is 23,939,366 bytes on desktop and 22,022,082 bytes on phone, including the source subset graph, chunks, modules and other art. Even the first North Beach view transfers 18,385,977 / 16,849,881 bytes. These are art-fixture measurements, **not a first-load budget pass**. The fixture's source subset and full-city payload remain unsuitable as production budget evidence.

Review exposed pale-green source-surface wedges across the Columbus intersection at world `(-132.156,-1711.3605)`, source lane `lane:17le`, plus wide green road margins on Valencia. The actual SF bake is used here, not the older default Lombard bake. The map owner is auditing emitted road/terrain overlap using these images; broad street/city visual acceptance remains open. The facade/road-art coverage change does not hide or resolve that geometry defect.

The map owner's whole-city bake independently totals 201,053,268 bytes gzip and exceeds the 25 MB map target (`gtasf-zzpr`). This art export does not waive that production blocker or activate/upload the city map. Local visual coverage and production payload acceptance remain distinct.
