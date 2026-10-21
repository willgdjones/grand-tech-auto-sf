# Vehicle models

`loadVehicleTemplate(assetId)` cold-loads one CC0 GLB behind its shared feature
flag. Keep a template per model and call `createInstance()` per server entity.
`vehicleAssetForKind` maps all protocol vehicle kinds to manifest IDs.
`loadRobotaxiTemplate()` is the robotaxi convenience entry point.

Instances use metres, ground origin, +Z forward. Set `root.position` from wire
centimetres / 100 and `root.rotation.y = yaw / 256 * 2 * Math.PI`. Attach the
avatar to `seat`, reset its local position/rotation and update its `drive` clip
for the driver or `sit` clip for passengers.
`cameraTarget.getWorldPosition(scratch)` supplies the feet input to the existing
third-person camera. That camera already adds its target height. `exit` is a
candidate ground point beside the door; movement/occupancy code must validate
terrain and buildings before using it. Detach the avatar before disposing its car.

Call `update(dt, speedMps, steeringRad)` for wheel travel and the robotaxi's
spinning lidar. Every instance has independent node transforms. Geometries,
materials and distant batches are shared until template disposal. Near geometry
retains the authored wheels/sensors; beyond 55 m a single colour-preserving draw
uses the same silhouette, then vehicles cull at 350 m. This is a draw-call LOD,
not a triangle simplification. `template.budget` reports source triangles and
draw counts; all vehicle GLBs are below 37 KB.

Enable `driving` only when occupancy/input/network wiring is mounted. Enable
`robotaxi` when the hail/ride path is mounted. `cableCars` and `muni` separately
gate those transit loaders; the drivable Muni bus also follows `driving`.
Attribution and source adaptation details are in `web/public/assets/LICENSES.md`.

Local running-game smoke passed on 2026-10-03 at 04:15 UTC with the integrator's
mounted scene and WorldDO: E boarded Prius 4 at the real Lombard hilltop, W drove
3.3 m downhill, Space stopped it, E exited, H hailed taxi 1000, and the autonomous
taxi boarded and drove over 7 m through the first bend. Screenshots were inspected
for the white body, lidar, seated positioning, grade contact and chase camera.
The avatar sit bounds fit within the cabin; its feet-to-head height is 1.35 m.
The model smoke also checked independent rotating lidar and shared geometry.

Run `node tools/playable-movement-check.mjs` against an already-running
`npm run dev`, or set `GTASF_SMOKE_URL` to the desired explicit location link.
Evidence is in ignored `artifacts/playable-movement/report.json` and PNGs. There
were no browser errors; 9 real map chunks and 1,538 located events were present.
This establishes local model/ride reachability, not device performance, final
street/sky visual quality, the full trip arrival flow, or deployed G1 acceptance.

## SA material and handling polish (gtasf-xsfw)

`vehiclePolish` keeps the CC0 bodies/wheels, adds chunky rectangular chrome
bumpers and dark grille/rubber trim to the personal cars, and applies original
Scenario paint/chrome tiles through flat diffuse materials. Taxis keep their
white identity and lidar; buses and cable cars retain their authored transit
silhouettes. Two small textures are shared across fleet templates, independent
of instance count. Texture selection and hashes are recorded in
`web/public/art/vehicles/manifest.json`; generated artwork is separate from the
CC0 model licence. A soft contact card follows each car's terrain orientation;
it uses no shadow-map pass. The far LOD still batches body and trim to one draw.

`arcadeHandling` increases braking to 23 m/s² and adds a small handbrake slide
angle, bounded to 0.18 radians. Grip recovers exponentially after release; the
same building/terrain sweeps apply to the drifting path. Impacts stop the car
without a damage state, and reverse remains available. `roadRespawn` enables
the separately server-authorized R recovery command; the server chooses the
road position, resets movement limits consistently and enforces a cooldown.
These flags require the local input/occupancy/fleet/server modules to be mounted.

Use **E** near a parked car to enter or exit, **W/S** to accelerate/brake/reverse,
**A/D** to steer and **Space** to handbrake. Press **R**, or choose **Return to
road** in **Game options** on desktop/phone, to request recovery. The request
contains no client destination: the server selects a road within 200 m of its
current player position and accepts at most one recovery every three seconds.
A driver keeps the occupied car and stops on the road; a passenger leaves the
ride. R is suppressed while another modal is open. The options recovery button
closes its own dialog before making the request.

The two shipped Scenario tiles are 256 × 256 pixels each, 25,219 bytes combined
on disk and 256 KiB decoded RGBA per tile (before mipmaps). They share nearest
texture filtering and a 32-colour palette. Generation receipts, rejected-image
decisions and source hashes remain in the manifest/recipe and art ledger.

The focused actual-game check uses real input, the native server and an ordinary
spawn link. Run it after a web build against the active local backend:

```sh
GTASF_MAP_AREA=lombard GTASF_POLISH_APP=web/dist nice -n 10 node tools/character-vehicle-polish-check.mjs
```

`GTASF_POLISH_APP` may point to a frozen build; its short-lived preview proxies
the existing Worker on port 8787. `GTASF_POLISH_SPAWN` overrides the Lombard
hilltop link when its parked car has already moved. Results and desktop/phone
images go to ignored `artifacts/character-vehicle-polish/`. This proof records
outfit material changes, idle/walk/run/drive views, braking, native server road
corrections and the phone options/recovery path. It does not accelerate clocks
or set player/vehicle poses.

The native common1046 city run (`5315157`) on 2026-10-03 at 10:48 UTC passed all
12 steps, with report and reviewed desktop/phone images in
`artifacts/character-vehicle-polish/2026-10-03T1048/`. The occupied car drove,
handbraked to zero, and accepted server R recovery while retaining its driver;
the recovered position was 0.0016 m from the road. The phone Return to road
button also worked. Images show the chunky body/trim, seated driver and contact
shadow at the normal chase distance. Browser, HTTP and map error lists were
empty. Drift/grip behavior is covered by the scoped movement checks; this
native run establishes local controls and appearance, not deployed/device gates.

## Fleet matrix updates (gtasf-srap)

The frame loop needs each vehicle root's current world matrix before camera
collision. It does not need every wheel, body, shadow and passenger descendant
updated at that point. `Fleet.update` updates the root and its ancestors, then
copies the root inverse. The normal renderer scene pass updates descendants
after wheels and both local/remote passengers have finished animating.
`cameraTarget.getWorldPosition(scratch)` updates its own ancestor chain for the
ride camera before that pass; callers querying `seat` or `exit` should use the
same world-position API. The initial instance setup still updates the whole
hierarchy. No model visibility, LOD, asset or feature flag changes are needed.

`web/src/game/fleet.test.ts` decodes the five shipped CC0 vehicle GLBs and uses
the production fleet/template constructors. Only browser asset transport is
replaced. Its bounded matrix smoke covers the driven hill-aligned car, an
interpolated NPC, time-driven cable cars, root camera collision, seat/exit/ride
target queries, an attached passenger hierarchy, wheel steering/travel and
robotaxi lidar. It compares the world transforms before and after the same
scene matrix pass used by the renderer, and counts redundant descendant visits.
This module check does not establish browser frame times or device acceptance.

On 2026-10-03 at 12:30 UTC, the unchanged code visited all 1,119 descendants of
the 26-car fixture in each `Fleet.update`, then visited them again in the render
pass. With the narrowed update, the first count is zero and the render count
remains 1,119; all camera, passenger and animated-part checks pass. Evidence is
in `artifacts/fleet-matrices/2026-10-03T1230/{before,after,types}.log`. The fleet,
camera collision and interpolation files passed six scoped tests, and strict
web types passed. The camera collision fixture was also updated to include the
existing cruise visibility contract and verify hidden cars cannot block the
camera. Run the scoped checks with:

```sh
nice -n 10 npx vitest run web/src/game/fleet.test.ts web/src/game/cameraCollision.test.ts web/src/game/vehicleInterpolation.test.ts --maxWorkers=1
nice -n 10 npx tsc --noEmit -p web/tsconfig.json
```
