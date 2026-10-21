# Track A artifact contract, version 1

The code contract is `src/pipeline/types.ts`. This package is standalone while
pane 1 owns root workspace configuration. Runtime entry points remain controlled
by the consuming client's/server's shared feature flags; invoking this offline
build tool does not enable a game feature or deploy anything.

## Coordinates and scope

- WGS84 origin: **latitude 37.7842, longitude -122.4078**, near Powell & Market.
- Projection: the WGS84 ECEF → local ENU functions in `src/geo.ts`, with zero grid
  rotation. World **+x east, +y up, +z south**, distances in **metres**.
- Horizontal coordinates use the zero-altitude ellipsoid. Vertical values come
  from the source DEM, separately; do not use ECEF tangent-plane up as terrain.
- The network protocol is owned by shared/WorldDO and uses i32 centimetres. Convert
  at the network boundary; map JSON is always metres.
- Chunk size: **256 m**. `cx = Math.floor(x / 256)`, `cz = Math.floor(z / 256)`.
  Negative coordinates use floor, never truncation. Chunk ID: `${cx}_${cz}`.
- City acquisition bbox `[west,south,east,north]`:
  `[-122.527,37.703,-122.348,37.833]`. This covers the SF mainland and western bridge
  approaches, not the Farallones or the Oakland toll plaza. Those need explicit
  extension assets. An Overpass query uses `[south,west,north,east]` instead.
- First playable bbox: `[-122.424,37.795,-122.390,37.806]`. Snapped world bounds:
  `[-1536,-2560,1792,-1024]`, **78 chunks** covering Ferry Building/Embarcadero,
  North Beach and Russian Hill/Lombard. It retains the `lombard` area name/URL.
  Default player spawn is the Ferry Building plaza; Lombard is the showcase drive.
- All generated artifacts and cached downloads live under ignored `out/`.

## Source pins

`src/pipeline/catalog.ts` records source URLs, units and attribution. The downloaded
`out/cache/<area>/sources.json` records the exact query/source URLs, SHA-256 hashes,
byte counts, fetch timestamps, OSM source timestamp and DataSF `data_as_of` dates.
Each cached body has a sidecar record and is hash-checked on reuse. The generated
map manifest includes the source hashes but excludes volatile fetch times from
its reproducible content. An incomplete/error OSM response is rejected.

Source roles:

| Source | Role | Units / attribution |
| --- | --- | --- |
| OpenStreetMap | Road topology, lanes, controls, restrictions, supplementary buildings and land use | WGS84; ODbL; © OpenStreetMap contributors |
| AWS Terrarium | Bare-earth elevation | `R*256 + G + B/256 - 32768` metres; preserve per-tile source metadata and Mapzen/USGS/NOAA credit |
| DataSF `ynuv-fyni` | Primary building footprints and LiDAR heights | `hgt_median_m` metres; `hgt_mediancm` centimetres; PDDL |

DataSF heights take precedence. Fallback order is valid OSM `height` (metres or
explicit feet), then `building:levels * 3.2 m`, then 9.6 m (garage 3.2 m, shed 2.5 m).
Every building keeps `heightSource`. Survey/reload dates are different: the source
metadata describes 2010-derived footprints even when the portal reload is recent.
Building base is the minimum sampled terrain under its footprint; wall foundations
extend another 0.3 m down to avoid cracks.

## Manifest and GLBs (B)

`out/<area>/manifest.json` is written last. It contains `version`, `frame`, `axes`,
`bounds`, `chunkSize`, `terrain`, `roadGraph`, `chunks`, `sourceDigests`, `stats`,
`warnings` and `attribution`. Each artifact descriptor is:

```json
{"path":"chunks/-4_-8/lod0.glb","bytes":12345,"gzipBytes":10000,"sha256":"<64 lowercase hex characters>"}
```

Paths are relative to the manifest's directory. Every payload has a deterministic
`.gz` sibling; an HTTP publisher should use `Content-Encoding: gzip` when serving
that sibling at the original URL. Hashes describe the decoded/original bytes.

Each chunk record has `id`, `x`, `z`, global `bounds`, `lods: [lod0,lod1]`, `terrain`,
`collision`, and `triangles: [count0,count1]`. GLB scene coordinates are **local x/z,
absolute elevation y**. Place the loaded scene at `(cx*256, 0, cz*256)` once. Do not
add that origin again to child transforms. GLBs require `EXT_meshopt_compression`
and `KHR_mesh_quantization`; configure the three.js GLTFLoader with MeshoptDecoder.
Meshes are named `terrain`, `roads`, `buildings`, with linear vertex colours.

The two LODs share gameplay heightfield, collision and graph. The renderer chooses
one GLB LOD per chunk and disposes the other. It must not load both as overlapping
geometry. LOD0 terrain uses a 4 m grid; LOD1 starts from a 16 m grid. Road cutouts
can add terrain vertices beyond those regular grids. Lombard's road geometry stays
dense at both levels.

## Terrain and collisions (C/D)

`chunks/<id>/terrain.bin` is a little-endian **GTHF v1** heightfield:

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | 4 ASCII bytes | `GTHF` |
| 4 | uint16 | Version, 1 |
| 6 | uint16 | Grid size, currently 65 |
| 8 | float32 | Sample spacing, currently 4 metres |
| 12 | int32 | Base elevation in centimetres |
| 16 | int32 | Chunk x index |
| 20 | int32 | Chunk z index |
| 24 | float32 | Quantum, 0.01 metres |
| 28 | uint32 | Reserved, 0 |
| 32 | uint16[size²] | Row-major elevations, z rows then x columns |

`heightM = (baseCm + sample) / 100`. The last row/column is shared with neighbouring
chunks and checked for exact centimetre equality. Heightfields represent carved
ground. **Bridge and tunnel driving height comes from the road graph's 3D points**,
not the ground underneath. Bridge/tunnel/nonzero-layer profiles interpolate portal
ends; connected split ways share portal solutions. Review flagged components with
no mapped portal. Surface road cross-sections are flattened, shoulders blended,
and the terrain mesh is cut underneath ribbons to prevent hillside poke-through.

`collision.json` is `{version:1, origin:[x,0,z], buildings:[...]}`. Buildings contain
`id`, `minY`, `maxY`, `heightSource`, `rings`. Ring coordinates are chunk-local x/z;
outer ring first, then holes, with implicit last-to-first closure. A building is
listed in every overlapping chunk, retaining its complete footprint (some local
coordinates can be outside 0..256). De-duplicate by building ID and query adjacent
chunks for a moving circle. Do not replace a courtyard by its bounding rectangle.

## Lane graph (C/D)

`roadgraph.json` is `{version:1,nodes:[],edges:[],warnings:[]}`. Nodes and edge
polylines use **global metres**, unlike chunk meshes/collision rings.

```json
{
  "version":1,
  "nodes":[
    {"id":"lane:123:0:1:1:0:a","x":-100,"y":40,"z":-2000,"osmNode":"osm:1"},
    {"id":"lane:123:0:1:1:0:b","x":-80,"y":37,"z":-2000,"osmNode":"osm:2","control":"stop"}
  ],
  "edges":[{
    "id":"lane:123:0:1:1:0","from":"lane:123:0:1:1:0:a","to":"lane:123:0:1:1:0:b",
    "lengthM":20.224,"speedMps":2.235,"lane":0,"points":[[-100,40,-2000],[-80,37,-2000]],
    "kind":"lane","osmWay":123,"name":"Example Street","inferredLanes":false,
    "layer":0,"bridge":false,"tunnel":false,"next":[]
  }],
  "warnings":[]
}
```

This is an illustrative schema, not a real source fixture. Lane indices are ordered
left-to-right in travel direction. `kind: connector` edges connect lane endpoints
at an actual shared OSM node, respecting supported turn restrictions/turn lanes.
`next` lists outgoing edge IDs after this edge. Stops/signals are on incoming lane
terminal nodes. Use `osmNode` to group lanes belonging to one physical control.
Never infer a junction from two polylines crossing in x/z.

Unknown lane counts are inferred and marked. Via-way restrictions currently remain
explicit warnings; via-node restrictions are enforced. Directed dead ends and
clipped boundaries can form separate strongly connected components. Validation
reports these, and runs 100 deterministic A* pairs within the largest reachable
component; that does not claim every city road is mutually reachable.

## Publication and gate evidence

Output files are local until the staging R2 owner publishes them. No upload or gate
pass is implied by an offline build. `stats.gzipBytes` totals both LOD payloads,
heightfields, collisions and graph; the runtime manifest itself adds a small index.
The 25 MB **whole-city** budget must be checked on the complete final city. A small
Lombard result cannot establish that budget. G1 still requires the integrated
two-browser hail/ride/event experience and deployed staging evidence.
