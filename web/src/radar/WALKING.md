# Nearby authored walking stops — gtasf-bo9q

The original native coffee check recorded a 515 m detour around directed vehicle
lanes for a nearby Ferry plaza destination. `walkingRoutes` adds short pedestrian
directions for the authored city-life buttons, including the coffee queue.

The planner only samples loaded authored walkable surfaces through the same
height and static collision functions used by movement. It does not infer safe
land from a terrain heightfield. Both ends must be within 96 m and on the same
level (within 3 m); every segment checks a 35 cm player circle at 15 cm substeps
against movement's step-height rule. A direct path is tried first, then an 8-way
2 m grid within a 12 m detour margin. Search stops at 512 expanded nodes or
12,000 surface probes; paths longer than 192 m are rejected.

No path, missing loaded ground, a cliff/deck change, a non-authored destination,
an event, a vehicle or an active robotaxi preserves source-lane routing. The map
replans when travel mode changes. Hail selections always use the road router.
Map and world GPS share the accepted route and its actual ground heights.

`walkingRoutes` is enabled after the source checks and accepted native walk
below. No deployment, phone-performance or device gate is implied by this local
route evidence.

Source checks passed: eight tests across walking, source-road routing and the SA
map, plus strict shared and web TypeScript. The first native attempt at
`artifacts/walking-look/2026-10-04T07-28-25.030Z` failed before READY with four
`/api/admission` 502 responses during a shared backend restart. Its failure report
and screenshot are retained; it provides no walking acceptance. A second attempt
at `2026-10-04T07-40-18.624Z` also failed before READY: the shared dev log recorded
a radar HMR reload, WebSocket EPIPE and Wrangler exit. Local-dev recovery is tracked
separately by `gtasf-osbg`.

The accepted replay is
`artifacts/walking-look/2026-10-04T07-44-13.551Z/report.json`, with
`before-walk.png` and `coffee-arrival.png` reviewed. Run it with:

```sh
GTASF_WALK_FROZEN=1 tools/heavy.sh /Users/USER/.nvm/versions/node/v24.21.0/bin/node tools/map/walking-look.mjs
```

This builds the common web source into its own ignored artifact directory and
uses the existing disposable real Worker, SQLite bindings and event snapshot.
It preserves normal rendering, real keyboard input and the active local map;
it uses no fixed steps or virtual movement. The temporary preview and browser
are closed afterward. Omitting `GTASF_WALK_FROZEN` targets the existing dev server.

The route is **48.921 m**, with 56 real-ground points, versus the earlier 515 m
vehicle-lane detour. Across 158 keyboard movement observations, the player reaches
**1.192 m** from the authored stop, with **0 m** height difference; GPS arrival
and the coffee queue's joined-line message both appear. Hailing a real local
robotaxi makes it active and replans the same destination with the source-road
router. Driving/passenger exclusions and blocked, unloaded, distant and event
fallbacks are covered by the targeted movement smoke.

The accepted browser records zero console/runtime errors and zero HTTP failures.
The preview logs a WebSocket EPIPE during cleanup after the completed capture;
that separate dev-proxy teardown issue is retained, not counted as a passing
dev-server recovery or deployment test.
