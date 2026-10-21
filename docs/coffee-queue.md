# Fictional Ferry coffee queue

`gtasf-1blk` fills the planned coffee-queue parody with an original Blue Pitch
coffee cart on the Ferry plaza. It uses coffee-regular lines from the shared
flavour inventory. It represents no real company, service, price or payment.

The counter, painted slats, striped canopy, espresso machine and cups are original
GTASF geometry. The original 512×256 sRGB sign is 0.131 MP and is the only new
texture. There are no external assets or media requests. Queue actors reuse the
existing CC0 Quaternius hoodie template, independent bones and painted outfits;
see `web/src/avatar/README.md` and `PROVENANCE.md` for the existing asset source.

Low quality creates two queue characters; other tiers create four, including a
barista. They idle, step aside for nearby players and return to the queue, using
the existing finished walk/idle clips. Movement probes loaded ground and collision.
Instances share the original player geometry but own bones/materials; disposal
releases only their instances and the original cart geometry/texture. It removes
only its own landmark footprint. Actors have no multiplayer identity or funding
weight. Ground-unloaded and distant groups stop updating; ranges are 60/100 metres.

The accepted local cart sits at Ferry-local **(-40.5,21)**, with customers at
z=23.2,25,26.8 and the barista at z=19.6. This pocket lies between the bollards,
in front of the façade and before the shared waterfront path. Its 4.2×1.7-metre
counter leaves routes around both sides and behind it. Game options directions
lead beside the queue instead of inside the counter. Fresh mounted acceptance
of this layout is recorded below; the earlier z=52 layout remains withdrawn.

The old road-graph check at `artifacts/ferry-pedestrians/road-clearance.json`
(graph `5763c53d…`, October 3 12:58 UTC) sampled the counter perimeter and queue
positions with an obsolete Ferry transform. Its 12.92 m / 7.56 m distances are
**withdrawn**. The corrected current factory matrix instead puts the original
counter 2.83 m from a lane centre, inside the runtime 3.5 m road-contact margin.
The bead was reopened on October 3. The first correction moved the whole cart/queue
2 m farther into the plaza to z=52; that location later failed the all-path check
below. The smoke
helper derives its coffee waypoints and counter assertions from the actual
factory's `location`, so it cannot silently test stale hand-copied coordinates.

The corrected `tools/ferry-placement-clearance.mjs` passed at 13:31 UTC against
the current factory matrix, matching saved native world/local positions within
2.3e-13 m. It verifies the packed graph SHA and normalized OSM source SHA, then
uses continuous distances to the pipeline's full-width **drivable** OSM road
ribbons (`isDrivable` filter). The new whole cart/canopy clears the drivable road edge by 2.96 m and the nearest lane
centre by 4.56 m; the counter clears them by 3.23 m / 4.83 m. All four characters'
complete 1.15 m yielding sweeps pass with their 0.35 m radius. The tightest is
the barista: 2.68 m from the road edge and 4.28 m from the lane centre, retaining
the 3.5 m contact margin. Receipt: `artifacts/ferry-pedestrians/placement-current.json`.
Web strict TypeScript and helper syntax passed. Historical mounted behavior is recorded below.

The all-highway lookup identified the dark strip as **OSM busway 1041093697**,
The Embarcadero (`access=no`, `bus=yes`). The z=52 layout put the second customer
on that strip; its cart also crossed concrete footway 675572680. An exact emitted
GLB check additionally found that customer's feet about 15.9 cm below the visible
strip. The motor-only proof remains valid within its limited scope, but this
layout's placement acceptance is **withdrawn**. The subsequent repair is recorded below.

The new source-aware `tools/coffee-placement-clearance.mjs` includes **every**
surface highway ribbon, with full width and bounded miters, the packed lane
contact margin, actual landmark mesh/collider geometry, and source walker routes.
The compact candidate clears the nearest path by 6.04 m at the whole cart and
1.297 m at the tightest complete customer yield sweep (0.947 m after its radius).
Its nearest packed lane is at least 16.32 m away. Candidate fixture clearance is
at least 2.36 m and walker-route clearance at least 11.12 m. The separate exact
emitted-ground candidate check sampled 501 cart and swept-radius points: both
LODs match contact within the ordinary 2 cm paving allowance, with no buried feet.
The source-derived all-path/fixture/walker check passed at 14:19 UTC after applying
the candidate; receipt `artifacts/city-life/coffee-placement-current.json`.
The refined contact receipt `artifacts/ferry-contact/emitted-terrain-current.json`
includes actual emitted terrain as well as roads and paving at both LODs and
preserves the 2 cm result at all 501 points. Helper syntax and web strict
TypeScript passed after an unrelated GPS test-fixture type error was corrected.
The new shared bundle and fresh physical desktop/phone acceptance are recorded below.

Integration: call `createCoffeeQueue` with the dedicated `flags.coffeeQueues`,
the existing avatar template, landmarks, composed movement world, raw tile-loaded
probe, low-tier choice and Game options parent. The destination and notice
callbacks match the city-life contract. Add the returned root directly to the
scene to preserve animated material ownership; do not pass it through static
world material conversion. Call `update(foot,dt)` and dispose before the shared
avatar template. Source `17d4546` introduced the switch as false; main hook
`b141530` supplies these contracts and passed web strict TypeScript and the shared
1239 bundle. See `docs/ferry-atmosphere-integration.md`. Candidate `9e68cb3`
enabled the switch locally; the mounted check below records the original layout's behavior.

`node tools/coffee-queue-smoke.mjs` runs normal game startup and the actual
Game options button, inspect all four medium-tier rigs and their animation,
walk against the counter, observe a regular yielding, and walk around it. A fresh
390-pixel phone session verifies two low-tier rigs and captures the phone view.
It changes no player pose, clock or model state. `GTASF_COFFEE_APP` selects an immutable local app and
`GTASF_COFFEE_OUT` a fresh evidence directory. Web/shared strict TypeScript and
smoke-script syntax passed on October 3; the local Worker reloaded with
`coffeeQueues:false`. The integrated common 1239 bundle at `ac3b9e4` passed with
the feature off. Enabled common 1250 (`52fb682`) also passed bundling.
The first mounted smoke at `artifacts/city-life/coffee-1253` produced a valid
28.09-metre route but stopped against the existing courier during its initial
straight-line walk, before reaching coffee. Its failure report and screenshot
are retained. The corrected helper walks through the open central aisle first;
it does not move the player directly or change game collision.

The corrected native check at `artifacts/city-life/coffee-1304/report.json`
passed from 13:04:44.283 to 13:05:38.858 UTC on October 3. It used common 1303,
exact source `3a3133a34a5006e5cc096513595a42602a01308b`, with the unchanged SF map
and graph. Both contexts reported AMD Radeon Pro 5300M through ANGLE Metal,
normal elapsed time (`capture:false`), Connected and direct scene ownership.
There were no console, page, HTTP or map errors.

- Game options produced a real 28.09-metre route with eight points.
- All four medium-tier rigs were visible and their bone matrices changed with
  elapsed game time. The first customer stepped aside to local x=-44.15.
- Real keyboard walking stopped at the counter at local z=51.1515, then passed
  around its east side and behind it.
- A fresh 390×844 mobile context using the low preset showed exactly two rigs.
- Both desktop and phone PNGs were personally reviewed: the original sign,
  striped canopy, painted counter and finished queue characters are readable.

The corrected placement in source `7ab93ce` passed the fresh actual-game check at
`artifacts/city-life/coffee-1345/report.json`, October 3 **13:46:11.480–13:47:08.976 UTC**.
It used exact common 1337 source `a3d08877ca8a792def95bd7783315d67267a6f3e`,
unchanged canonical SF map/graph, and the source-aware helper. Its runtime cart
was (-43, .18, 52); directions produced 28.086 m / eight points, all four desktop
rigs animated, the first yielded to x=-44.15, and physical walking stopped at
counter z=53.1652 before going around and behind it. The fresh 390×844 low phone
showed exactly two rigs. Both contexts were Connected, normal elapsed time,
direct scene ownership and AMD Radeon Pro 5300M through ANGLE Metal, with no
console/page/HTTP/map errors. Both new PNGs were personally reviewed and accepted:
the original sign, canopy, slats and finished queue remain readable at the new
position. Browser exit 0 and preview cleanup are retained in `run.log`.

The helper now also encloses browser launch in its cleanup block, so an early
launch failure still closes the preview and records a failure report. The
dedicated switch remains enabled for local testing. Prior invalid clearance
claims stay withdrawn and old behavior observations are retained.
These are local functional and visual observations, not a real-phone performance test.
No device, performance, production or broader B09 gate is claimed.

## Façade-side layout accepted

Source `2d89558` passed the shared common 1430 build at exact commit
`3ee1b48a384ff531afb6aa808da331a5dd025955`, with unchanged map/art hashes. The fresh
native check `artifacts/city-life/coffee-1432/report.json` passed on October 3 from
**14:32:48.007 to 14:33:47.729 UTC**. Both desktop and fresh 390×844 phone contexts
were Connected, normal elapsed time, direct scene ownership and AMD Radeon Pro
5300M through ANGLE Metal, with no game console, page, HTTP or map errors.

The actual cart was (-40.5,.18,21). Four desktop characters were visible and
animated; the first yielded to x=-41.65. Physical walking stopped against the
counter at z=22.1736, then passed around its right side and behind it. The low
phone showed two visible characters. Directions produced a real 515.024 m route
with 120 points; this is the directed road-network route, while the helper's
physical on-foot approach crossed the open plaza. Both PNGs were personally
reviewed: the cart, sign, queue and paving are readable, with the queue clear
of the busway, cycleway and shared path. Browser exit 0 and preview cleanup are
recorded; browser-process GCM and overlay-cleanup warnings remain in `run.log`.
This closes only the coffee feature's local acceptance.
