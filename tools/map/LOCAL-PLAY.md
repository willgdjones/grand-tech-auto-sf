# Local playable map handoff

The integrator serves `out/lombard/` at `/map/lombard/`. The generator and artifacts
are ready; the browser/game loop lives in pane 1's work. A local run needs no R2.

- Manifest: `/map/lombard/manifest.json` (78 chunks, two GLB LODs, 19.25 MB compressed).
- Ground contact: each chunk's GTHF `terrain.bin`; see `CONTRACT.md`.
- Road contact: full `roadgraph.json` polylines in global metres.
- Taxi network: `roadgraph-playable.json`, the largest strongly connected component
  after excluding edges obstructed by building collision.
- Compact starter taxi network: `roadgraph-local-play.json`, actual OSM-derived
  Ferry-to-Lombard, downhill, return and pickup edges for an embedded Worker import.
- Spawn and concrete route edge IDs: `local-play.json`.

Default spawn is the Ferry Building plaza at `[1196.869, 3.328, -1224.309]`, facing
the clock tower with +Z-forward yaw `2.158799` radians. It is outside all surveyed
building footprints; the approximate clock tower coordinate itself is inside one.
The nearest reachable Embarcadero pickup is `[1212.424,3.064,-1236.014]`, 19.47 m away.
Guide players to that curb for boarding. The actual directed road route to Lombard
is 2.888 km; the return is 2.867 km. These differ from straight-line distance.

At Hyde/Lombard, road contact is `[-1041.863, 85.954, -1975.201]`; forward is roughly
east (positive x). Model-specific offsets go above this contact point. Downhill
arrival is `[-897.138, 53.117, -1999.980]`. Four one-way lane edges and three join
edges cover every original Lombard turn: 200.459 m of 3D travel, 32.837 m descent,
2.235 m/s advisory speed. The source-backed taxi approach is 163.238 m long.

Create/refresh the route handoff and run its single offline smoke:

```sh
tools/map/node_modules/.bin/tsx tools/map/src/pipeline/local-play.ts
```

This checks that the complete downhill and incoming taxi paths connect, exports
the reachable network, and audits lane points against building collision. The
Lombard centreline and the entire compact taxi graph have no building intersections.
Surface road corridors now clear both building meshes and collision. The wider
audit retains 57 grade-separated/interior lanes and 61 connectors in the source
graph for later vertical-clearance work; they are excluded from taxi dispatch.
No ordinary surface lanes remain blocked. The safe taxi graph has 7,676 nodes;
608 excluded node IDs, the excluded components and blocked-edge reasons are
explicit in `local-play.json`. A* passed 100 seeded reachable pairs on this safe
network and the source-backed Ferry/Lombard pickup, descent and return smoke.
This is local
play evidence; deployed G1 and device/performance acceptance remain separate.

Browser inspection evidence (ignored generated files): `out/lombard/ferry-inspection.png`
and `lombard-east.png`. The expanded bake loaded in Chromium with zero runtime
errors. Both LOD decoders also passed the initial slice smoke. Building/road/terrain
alignment is visible from the east view; landmark and facade look acceptance is
owned by the integrated renderer.

The generic DataSF Ferry Building mesh (`201006.0000058`) is omitted because the
authored landmark supplies its facade, hall and clock tower. Its real surveyed
building footprint remains in collision; all other generic buildings stay present.
