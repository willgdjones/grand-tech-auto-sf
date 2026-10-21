# D02 nearby traffic

`new TrafficSimulation(graph, { maximum: 300, perPlayer: 8 })` accepts the shared
metre road graph. Preserve optional edge `next`/`kind` and node `osmNode` metadata
from the generated graph when available; it keeps allowed turns and groups the
offset lane endpoints at one source junction. Basic graph consumers retain an
outgoing-edge fallback. Dense source points preserve Lombard curvature/heights.

WorldDO must check `flags.traffic` before stepping or publishing the simulation:

```ts
traffic.step(dtSeconds, playerPoses, nowMs, parkedDrivenAndTaxiEntries);
const entries = [...fleetEntries, ...traffic.snapshotFor(peer.pose)];
// Send ONE combined VEHICLE_SNAPSHOT; the client drops IDs absent from a snapshot.
```

Player poses and returned VehicleEntry snapshots use signed integer centimetres,
yaw 0–255 and cm/s. NPC IDs begin at 1,000,000 and `flags & 0x20` marks them
non-enterable. The WorldDO and client fleet owners agreed this pose-byte bit;
the client `nearest` affordance must exclude it. No wire-layout/version change.
Only already-preloaded Prius/Tesla/Subaru kinds are used.

Population is eight per nearby player by default, globally capped at 300 NPCs,
within 400 m of players; it is not a player cap. Cars leave when nobody is nearby.
Spawns avoid the immediate player area, existing cars and supplied fleet obstacles.
Snapshots apply the same per-recipient 400 m range. Deterministic spawn/turn choice,
source-lane speed limits (capped at 11 m/s), 6 m queues, timed two-axis signals with
an all-red interval and 1.1 s stop-sign dwell need no rigid-body physics. Junction
reservations last long enough to traverse generated connectors. Optional parked,
driven and taxi snapshots make NPCs yield to a vehicle in their forward corridor.

The local graph supplied by the caller bounds coverage; city-wide population and
traffic/hazard density tuning remain D07. NPC vehicle collision response against
a player who drives into them is not introduced by this lane-following module.
Keep the traffic flag off until the combined server snapshot and client affordance
changes are wired. Run only the single scoped smoke:

```sh
nice -n 10 npx vitest run worker/src/world/traffic/simulation.test.ts --maxWorkers=1
nice -n 10 npx tsc --noEmit -p worker/tsconfig.json
```
