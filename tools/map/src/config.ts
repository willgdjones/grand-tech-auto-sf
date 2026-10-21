/** WGS84 bounds [west, south, east, north]; SF plus bridge approaches. */
export const SF_BBOX = [-122.527, 37.703, -122.348, 37.833] as const;
export const SF_FRAME = { origin: { lat: 37.7842, lon: -122.4078 }, gridRotationDeg: 0 };
export const CHUNK_METRES = 256;
/** Slice/first-load compressed budget. The whole-city bake streams chunks on demand (the client loads
 *  only the manifest, the ~11 MB road graph and the spawn-area chunks up front — well under the 15 MB
 *  first-load limit), so its total R2 payload is bounded by the 80 MB production-payload budget instead.
 *  A genuine citywide bake cannot fit 25 MB total: the full-detail corridor (~20 MB) plus the citywide
 *  road graph needed for deep-link road-snapping everywhere (~11 MB) already exceed it. Per-file stays
 *  25 MB (publication.ts) in both cases. (gtasf-o0cb) */
export const MAP_COMPRESSED_BUDGET_BYTES = 25_000_000;
export const MAP_CITYWIDE_BUDGET_BYTES = 87_000_000; // founder 2026-10-09: dense LiDAR neighbourhoods (sf-fit-3dep 85.61 MB); first load still <15 MB
