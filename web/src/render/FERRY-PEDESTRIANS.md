# Ferry plaza pedestrians

`gtasf-2hm.1`, a local-v1 child of `gtasf-2hm`, populates four authored walking loops on the
Ferry Building's paved plaza. The current road graph contains driving lanes,
so these paths use the existing landmark's paving and contact model. City-wide
sidewalk routing, event crowds, vest outfits and the full L09 quality gate remain
with their parent tasks.

Current local placement acceptance includes the final outer-loop cycleway
correction, continuous all-traffic clearance and reviewed native desktop/phone
views on common1430. The source-derived check includes busways, cycleways and
private traffic corridors, as detailed in the latest record below.

The factory reuses the existing CC0 Quaternius hoodie template and its four
outfits, independent skeletons, idle/walk clips and blob shadows. Asset provenance
is unchanged; see `avatar/README.md` and `PROVENANCE.md`. Low quality creates four
instances and medium/high create eight. Instances share geometry with the player,
own their bones/materials, fade before the distance cutoff, and stop updating
when outside the local range or when their source ground is unloaded.

Walkers accelerate to 1.2–1.36m/s and scale the walk cadence to their actual pace.
They slow for corners, turn before resuming, and yield to the nearby player's
position, each other and the existing ground collision probe. Each move checks
loaded ground, height continuity and a half-metre collision radius. The authored
loops avoid the hall, road, palms, benches, central spawn axis and current hazards.
These are local atmosphere; they have no multiplayer identity or funding weight.

Integration contract: pass the existing avatar template, landmarks, composed
`surface` movement world, `isLoaded: (x,z) => world.heightAt(x,z) !== null`, and
`low: foundation.tier === 'low'` to `createFerryPedestrians`. Gate `enabled` with
the dedicated `pedestrians` switch, enabled locally after native review and
integration (`9e68cb3`). The independently pinned production release is unchanged.
Main integration landed in `b141530`: the root is attached directly to `scene`,
`update(foot, dt)` runs after landmark ground resampling in the existing loop,
and disposal happens before the shared avatar template. Direct scene
attachment preserves animated materials and opacity; static world material
conversion would break those updates.

The actual-asset smoke passed for low/medium counts, displacement, player yielding,
obstacle contact, path bounds, ground heights, range/unloaded culling and disposal.
Web strict types passed at 11:47 UTC on 2026-10-03. The finite renderer helper is
`node tools/ferry-pedestrians-smoke.mjs`; it uses actual corridor ground and the
normal atmosphere at a fixed daylight clock. It captures plaza, walking, turning
and yielding views for desktop and phone, records the WebGL renderer, and checks
each actual rig's contact against the composed ground. This renderer specimen is
explicitly separate from normal game startup and is not performance evidence.

`node tools/ferry-pedestrians-game-smoke.mjs` checks the actual running game after
the feature candidate is enabled. Set `GTASF_PEDESTRIANS_APP` to an existing web
build, or `GTASF_SMOKE_URL` to the local running game. It completes normal startup,
walks with keyboard controls, and observes elapsed-time movement, skeleton
animation and grounded feet on desktop and phone. It never enables the feature,
changes actor poses or supplies a simulated clock. Each visible actor must stay
inside its own accepted route rectangle, at the authored paving height.

The renderer specimen passed on 2026-10-03 at 12:43:27 UTC; all eight PNGs in
`artifacts/ferry-pedestrians/preview` were reviewed. Walking, turning and yielding
views show finished outfits, articulated limbs and grounded feet with blob
shadows. The wider desktop view also shows outfit variation. The portrait plaza
view establishes the location but its narrow field of view excludes the actors;
the portrait close views show them clearly. All eight/four instances passed the
ground/contact checks and one walker yielded in each profile. No console, HTTP
or map errors occurred. This headless browser reported SwiftShader, so the
record establishes appearance and behavior, not hardware or frame-rate acceptance.

The first actual-game check on common `52fb682` passed normal startup, physical
keyboard approach, elapsed animation, contact and error checks on desktop and
phone with the AMD Metal renderer. The two reviewed images in
`artifacts/ferry-pedestrians/game-1251` raised a separate road-clearance concern.
An initial offline graph probe suggested lane conflicts, so that placement was
not accepted despite the contact checks. Its transform was subsequently found
to be stale, as documented below; only the new source-derived probe is valid.

The first placement correction (`3a3133a`) passed an actual-game check on common1303
from 13:08:16 to 13:08:41 UTC. The AMD Radeon Pro 5300M Metal renderer was used for
both desktop and fresh low-tier phone, with normal elapsed time (`capture:false`)
and a connected game session. Eight/four visible characters moved and animated,
stayed inside their individual route bounds and kept their feet at local y=0.18.
Both screenshots in `artifacts/ferry-pedestrians/game-1308` were personally reviewed:
the authored outfits and articulated silhouettes remain legible in the game.
There were no console, HTTP or map errors. The earlier specimen also establishes
corner turning and player yielding; the actual-asset smoke covers unloaded/range
culling and disposal. The corrected source passed that smoke and web strict at
13:01 UTC, and the common web bundle passed before the final native run.

**Placement acceptance was withdrawn at 13:19 UTC.** The earlier offline
`road-clearance-candidate.json` used the obsolete Ferry origin and yaw; its
10.54/8.56/6.54/6.61m clearance claim, and the associated coffee clearance claim,
are invalid. The above native receipts still establish animation, contact and
appearance on their recorded builds, but do not establish road clearance.
The bead was reopened in `79a80c9`. With the current DataSF-aligned registry
transform, the first two paths cross or approach real lanes at 0.006m and 1.66m.

The second correction moves those two loops to local z26–34. The reproducible
check is `nice -n 10 node --import tsx tools/ferry-placement-clearance.mjs`.
It imports the actual placement factory and exported source routes; it first
checks that the factory matrix reproduces saved native actor local/world
coordinates. It validates the packed graph and normalized OSM source hashes
against the emitted SF map's provenance, then builds the same detailed-LOD road
quads as the map renderer, including the full widths and bounded corner miters.
Continuous segment distances cover the entire walking loop, with a 0.5m actor
radius and the road sampler's 3.5m lane-centre contact margin retained.

The corrected check passed at 13:30 UTC with matrix error 2.27e-13m. The four
minimum rendered road-edge distances are 5.9564, 5.9527, 5.0061 and 6.6713m;
lane-centre distances are 7.5564, 7.5510, 6.5478 and 8.2715m. The receipt is
`artifacts/ferry-pedestrians/placement-current.json`. That check also imports the
coffee module's current cart/counter extents and all four full yield sweeps,
including the barista; its independently owned +2m placement passes.

Corrected-source actual-asset smoke, web strict types and game-helper syntax
passed at 13:32 UTC. Source `0e51315` then passed a fresh actual-game desktop/phone
check on exact common `a3d08877` from 13:42:09 to 13:42:45 UTC. Both reviewed
screenshots and the report are in `artifacts/ferry-pedestrians/game-1341`.
Normal startup and public keyboard approach worked; eight/four rigs advanced
their positions and skeletons, remained inside the corrected individual loops,
and stayed grounded at local y=0.18. The native AMD Radeon Pro 5300M Metal
renderer was used with `capture:false`, connected sessions and no console, HTTP
or map errors. The reviewed views show finished articulated characters walking
on the paving between the road and the Ferry facade. The earlier specimen
supplies the closer outfit variation, turning and yielding views.

Those records led to reacceptance at 13:43 UTC under the vehicle-routing filter's
definition of drivable roads. **That broader placement acceptance was withdrawn
again at 14:08 UTC:** routing eligibility omits dedicated busways and cycleways.
The widened actual-source check found the two outer loops crossing cycleway
OSM 913953321. The native animation, appearance and ground receipts remain valid
for their exact builds; their motor-road-only clearance does not establish
clearance from all traffic corridors.

The final outer-loop correction keeps both outer x ranges and moves their z
range to 26–29. The two inner loops remain at z26–34. The revised check uses every
surface highway ribbon, classifies pedestrian-permitted paths separately, and
includes bus-only, cycling and private vehicle corridors in traffic clearance.
Minimum traffic-edge distances for the four corrected paths are now 1.3002,
0.9285, 4.8708 and 4.0652m, with the full 0.5m actor radius retained. Walkers may
use pedestrian-permitted shared footways; the stationary coffee layout is checked
against every mapped path. The failed original and corrected candidate reports
are `placement-all-paths.json` and `placement-all-paths-candidate.json` beside the
earlier artifacts. All four corrected pedestrian checks pass; the latter report
still fails the independently owned, not-yet-moved coffee placement.

Source `252041e` passed the actual-asset movement smoke and web strict at 14:11
UTC. The final source-aware clearance receipt at
`artifacts/ferry-pedestrians/placement-all-paths-final.json` passes all four
pedestrian routes and the separately relocated coffee layout, retaining the
full traffic/path extents and source/native matrix correspondence.

The corrected routes passed a fresh native game run from 14:39:48.392 to
14:40:21.816 UTC on exact common1430 `3ee1b48a384ff531afb6aa808da331a5dd025955`.
Both PNGs and the full report in `artifacts/ferry-pedestrians/game-1439` were
personally reviewed. Normal startup, physical public keyboard approach,
elapsed-time position and skeleton animation, 8/8 desktop and 4/4 phone walkers,
each final route's bounds and local feet y0.18 all passed. Both views used the
AMD Radeon Pro 5300M Metal renderer with `capture:false`, connected sessions and
empty console/page/HTTP/map errors. Finished outfits and articulated walkers
remain visible and grounded between the traffic corridors and Ferry facade.
This supersedes the withdrawn traffic-placement claims above without erasing
their failed receipts. The broader plaza/road contact discrepancy remains open
in `gtasf-r2mn`; these verified pedestrian routes stay on the authored paving.

Full-city sidewalk routing, additional outfits/crowds, real-device and performance
acceptance remain with the parent work.
