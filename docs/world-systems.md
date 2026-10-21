# World traffic and transit

`gtasf-sxoh` adds moderate D02 traffic, a local cruise preference, time-based
three-line cable cars, and an actual native WorldDO load harness. D03 robotaxi
dispatch remains server-owned; passengers cannot send accepted steering updates.

Traffic is sourced from the server lane graph, with twelve NPCs per occupied
400 m cell and a global maximum of 96. A crowd in one area does not create one
population per player. The Game options cruise checkbox persists locally and
hides only NPC traffic. Other players, their cars, taxis and cable cars remain.

Cable cars use the actual OSM directional relations for Powell–Hyde,
Powell–Mason and California Street. The six routes include named stops and
Terrain Tiles elevations. Eight cars run on each Powell line and six on
California. All clients derive the same positions from synchronized server
time; WorldDO sends seat ownership, not repeated cable-car positions. Cars dwell
for eight seconds at stops; boarding requires a stopped car within seven metres
and has twelve seats. Passengers cannot steer. Leaving preserves other riders.
Game options provides a GPS destination for the nearest stop on each line.

Moving cable passengers now renew the five-minute input-activity lease from
their server-confirmed seat and changing cable-car position. This leaves
socket heartbeat expiry unchanged: it never modifies `lastSeen`. Stop dwell,
stationary or mismatched poses, missing/wrong seats, drivers and exited riders
cannot renew the lease. `WorldDO.setVehiclePose` calls this check alongside the
existing robotaxi activity check.

The `gtasf-l6bi` regression uses the actual six directional route timetables for
six simulated minutes each. Before the fix, the first outbound rider reaches
input expiry at exactly 300,000 ms; after it, all six remain active and socket
liveness remains untouched. The existing multi-rider, steering and clock test
also passes. Evidence is in `artifacts/cable-idle/{before,after,integrated}.json`,
including the integrated stationary/seat/driver/pose exclusions; this is
deterministic service evidence, not a six-minute wall-clock browser ride.
This follow-up is outside the pinned `d780be9` pre-playtest release.

`ROAD_RESPAWN` has no client destination. The server chooses a nearby road,
preserves an owned driver seat/car, and resets speed. Recovery has a three-second
cooldown. Outside the current server graph's 200 m search radius, it returns the
current authoritative pose rather than inventing a road. Whole-city recovery and
dispatch require the expanded server road graph.

## Sources and regeneration

`tools/transit/prepare-cable-routes.ts` creates
`shared/transit/cableRoutes.ts`. It caches source responses, verifies stop names,
orders and joins the directional OSM relation geometry, resamples at four metres,
and projects with the same map origin and terrain sources as the world bake.
Source hashes and the relation IDs are embedded in the generated file.

Run with Node 24 and TLS verification enabled:

```sh
tools/map/node_modules/.bin/tsx tools/transit/prepare-cable-routes.ts --fetch --map tools/map/out/sf
tools/map/node_modules/.bin/tsx tools/transit/profile-smoke.ts shared/transit/cableRoutes.ts
```

The official route references are:

- https://www.sfmta.com/routes/powell-hyde-cable-car
- https://www.sfmta.com/routes/powell-mason-cable-car
- https://www.sfmta.com/routes/california-cable-car

The `--map` option verifies the packed graph and carved heightfield hashes and
profiles rail heights against those actual rendered surfaces. Rail heading
selects the parallel street deck at crossings; underground lanes are excluded.
This prevents the Powell–Hyde car from dropping about five metres toward
Broadway beneath the Hyde bridge. All route X/Z points, lengths and stop names
stay unchanged. `--output` permits checking an alternate bake before changing
runtime data. Without `--map`, the generator retains raw DEM heights for source
inspection; that output is not suitable for street-deck acceptance.

The October 3 profile proof checks all six routes against the verified city
surface: maximum residual is 0.000563 m and maximum slope is 0.365 (the previous
Hyde crossing exceeded 1.27). A separate crossing regression verifies that a
closer perpendicular street and parallel underground road cannot replace the
rail deck. Evidence: `artifacts/world-systems/cable-profile-report.json`.
These geometry checks complement the actual desktop/phone riding proof below.

## Verification and release

The targeted cable, traffic, vehicle, robotaxi and protocol tests pass, as do
Worker and web strict type checks. Tests cover route completeness, time
continuity, multiple independent passengers, rejected passenger steering, and
bounded crowd density. These checks do not establish visual or load acceptance.

`node tools/world-load.mjs` builds an isolated native Miniflare WorldDO with
real timers and 100 actual protocol clients. It uses admission grants, movement,
heartbeats, 98 dispatch requests, recovery and two cable passengers. It records
snapshot cadence, round-trip latency, encoded bytes, traffic counts and errors
in `artifacts/world-systems/load/report.json`. It never targets production.
The report distinguishes driver-process memory from Worker memory, and notes
when workerd's I/O-bound clock cannot measure synchronous CPU duration.

The first native 100-client run passed on October 3, 2026:
`artifacts/world-systems/load-native/report.json` records 60 seconds after warmup,
100 connected peers, 98 accepted taxi dispatches, 50 taxi boardings, a peak of 48
NPCs, and zero unexpected disconnects, malformed frames or external calls. All
clients observed moving traffic. Two cable passengers travelled together and
one exited without ejecting the other; driver recovery preserved its owned car.
Vehicle delivery averaged 8.45 Hz, p95 interval 147.81 ms and p95 round-trip
latency 69.99 ms. Measured step duration p95 was 18 ms; this is elapsed workerd
time, not a CPU profiler. Encoded downstream traffic averaged 20.29 KB/client/s
under this dense crowd and 98-taxi load, above the plan's approximate 8 KB/s.
That cost remains visible rather than being presented as an 8 KB/s result.

Inspection after this run found a fresh 65,536-byte scratch Writer per outgoing
frame and repeated NPC geometry conversion per recipient. Snapshot writers now
allocate exactly the validated frame size, control frames use their bounded
392-byte maximum, and NPC wire poses are computed once per simulation step.
These changes preserve independent encoded buffers and the existing wire format;
the focused protocol/traffic tests pass. The city native follow-up below also
passes. The load harness now admits
bounded batches through the same FIFO queue instead of waiting one drain period
per serial client; runtime behavior and measured test duration are unchanged.

Milestone 3 enabled traffic and cable cars under the founder's explicit deploy
instruction. The deployed desktop/phone smoke passed moving NPCs, 22
time-derived cable cars, three stop GPS controls and Cruise mode, along with
the existing movement/multiplayer checks. `DEPLOY.md` records the immutable
SHA, full flags and payload evidence. Production retains the corridor map;
full-route rendered ground still requires the city map. The later street-deck
profile fix and local native riding proof below are outside the milestone 3 pin.

The actual native game smoke passed at 10:43 UTC on October 3. Evidence is in
`artifacts/world-systems/game-1039/report.json` and its seven reviewed desktop
and phone screenshots. The immutable application was the 10:18 bundle from
`92a4243`, with the paired city map and native development WorldDO. The harness
used public location links to reach real upcoming stops, waited for cars on the
live server clock, then pressed E on desktop or tapped Enter / exit on phone.
It did not inject positions, protocol messages or time.

| View | Line and boarding stop | Distance in 15 seconds | Maximum road-height error |
| --- | --- | --- | --- |
| Desktop, 1365 × 900 | Powell–Hyde, Powell & Sutter | 30.855 m | 0.005471 m |
| Desktop, 1365 × 900 | California, California & Stockton | 30.704 m | 0.017220 m |
| Phone, 393 × 852 | Powell–Mason, Powell & Jackson | 31.372 m | 0.010000 m |

Each ride recorded 59 samples with the passenger exactly attached to the car,
server-confirmed entry and exit, no steering packets from passenger controls,
and a return to on-foot mode. Both views observed moving NPCs, hid only NPCs
with Cruise mode, retained that preference after navigation, and selected a
138-point walking route to California & Drumm through the actual GPS button.
Console, HTTP and map errors were empty. The application and native browser
closed normally. This is functional desktop/phone evidence, not a real-device
or frame-performance result. Passenger-mode phone pedals remain a separate
control-clarity follow-up; they do not steer the cable car.

The later `gtasf-sxoh.2` fix refreshes stop countdowns once per second while
Game options is open and visible, retaining button focus and stopping work when
closed. Its focused DOM smoke and web strict check pass; that change is not
included in the 10:18 application above.

## Paired whole-city road graph

The map pipeline packs the complete source graph into `roadpack-v1`, retaining
centimetre geometry, original IDs, street names, signals, stop controls, explicit
turn successors and bridge/tunnel/layer metadata. A routable bit marks the
collision-cleared network; the browser retains the other edges for road contact.
The repaired October 3 city pack has 155,510 nodes and 244,460 edges, weighs
23,079,905 bytes raw / 10,994,998 bytes gzip, and has SHA-256
`5763c53debed013a7f5403a467bd829f45dacfdfb83dc9c5c19e5555fe91651f`.

WorldDO accepts the optional `WORLD_ROAD_GRAPH_KEY` and
`WORLD_ROAD_GRAPH_SHA256` pair. The key names a **raw, uncompressed** binary R2
object. Both absent retain the existing corridor. Configured city data must
match the hash and file-size bound before clients are admitted; a missing or
invalid configured graph fails visibly rather than silently switching maps.
The browser map and server key must be activated together. The persistent
development Worker now uses that city graph, paired with explicit city-map
previews for acceptance. The default development browser map still awaits the
Ferry-to-Columbus driving check; production retains the corridor on both sides.

`PackedRoads` retains typed columns, spatial and adjacency indexes, a bounded
2,048-edge cache, and 64 cached routes. Routing follows directed turn successors
and the routable mask. NPCs request at most 128 candidate lanes per occupied
area. The initial full graph measurement retained 30,592,933 typed bytes and
found all twelve sampled cross-city routes in 4–30 ms in Node. This is a data
structure measurement, not a claim about the Worker process memory limit.
The packed codec's three tests and seven focused routing/loading/traffic/taxi
checks pass, with Worker/shared/map strict checks.

Use the same native harness with a specific map artifact:

```sh
GTASF_WORLD_LOAD_GRAPH=tools/map/out/sf/roadgraph.bin node tools/world-load.mjs
```

It seeds only the disposable harness's R2 binding and records the exact input
hash. The city native follow-up and desktop/phone cable/cruise proof passed.
The complete city runtime is still 196,898,624 bytes gzip, above both its 25 MB
map target and the 80 MB production cap. `gtasf-zzpr` tracks that deployment
blocker; the compact graph alone does not satisfy the whole-map budget.

The native follow-up on that final city hash passed at 09:39 UTC:
`artifacts/world-systems/load-city-native/report.json` records 100 peers for
60 measured seconds, 98 accepted dispatches, 50 taxi boardings, 48 peak NPCs,
all 100 observers seeing moving traffic, and no unexpected disconnects or
malformed frames. Native retained road arrays total 30,599,349 bytes. Vehicle
snapshots averaged 8.83 Hz with p95 interval 132.76 ms; p95 ping latency was
91.39 ms. Elapsed step p95 was 12 ms (prior corridor run: 18 ms), though these
runs differ in map and shared-machine load and are not a controlled benchmark.
Encoded traffic remained 20.45 KB/client/s. The runtime logged one SQLite
alarm overdue warning (8 ms scheduling mismatch), without a failed request.
The disposable runtime closed normally. The separate recurring Wrangler
development-proxy connection failure remains under investigation in `gtasf-bz3m.4`;
this test does not establish that path's stability.

## Passenger touch controls — native follow-up

`gtasf-zfy2` passed the real phone check on 2026-10-03 at 12:11 UTC against
common app `fbecd8c80ffdd52e2eb06876eaa8e8938b5b06fb`, native Worker `c8a7bdc`,
and the local city map. `artifacts/passenger-controls/game-1209/report.json`
records boarding Powell–Mason car 2000102 at Mason Street & Union Street,
canvas drag-to-look, Bell and Map taps, 15 seconds of real movement (59 samples),
and exit restoring the walking joystick and normal controls. Browser, HTTP
and map error lists are empty. The reviewed riding image shows only Exit ride,
Bell and Map; the exited image confirms the controls restore correctly.

The exited camera is obscured by nearby foliage, a separate camera visibility
gap. The earlier `game-1135` run stopped at a dynamically selected spawn and is
retained as failed evidence; the updated harness now records its exact selected
location before boot. This follow-up accepts passenger controls, not complete
cable-route ground coverage, foliage-camera visibility or device performance.
