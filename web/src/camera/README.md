# Chase camera

The game follows the player or car from 8.5 m behind and slightly above.
Exponential damping smooths yaw, pitch, camera position and aim using elapsed
seconds. Speed adds up to 3.5 m of boom within the shared 12 m camera budget.
Teleport-sized changes reset position and aim instead of sweeping across town.

`setOrbit(yaw,pitch)` places the initial orbit immediately. `look(dx,dy)` remains
available for optional mouse, touch and existing dt-scaled keyboard input.
`orbit(horizontal,vertical,dt)` directly accepts keyboard axes: +1 horizontal
is right, +1 vertical is up. Both manual APIs suspend follow for 1.5 seconds.
`recenter(heading)` quickly eases behind the player and restores the default
pitch. Headings use the model's +Z-forward yaw; the camera adds PI for behind.

Call `follow(heading,speedMps,dt)` after movement and before `update(dt,feet)`.
Follow resumes after manual inactivity and eases around turns. Feed elapsed
frame seconds to the camera, independently of any physics timestep cap, so a
slow render frame does not stretch the manual hold period. Use server vehicle
speed during a taxi ride. No pointer lock is required by any camera API.

Every final camera position is checked against the current terrain, avatar and
head-to-camera collision corridor. A new wall causes immediate pull-in; release
uses the boom spring. Position smoothing cannot bypass collision or increase
the shared maximum offset. The normal open path uses the same number of
collision casts as the prior camera; extra checks occur only on unsafe paths.

`npx vitest run web/src/camera/thirdPerson.test.ts --maxWorkers=1` passes the
existing collision cases plus one combined chase check: equivalent elapsed-time
position response at 30/60/120 updates per second, manual hold, auto-return,
recenter and speed pullback. Web TypeScript checking also passes. These checks
do not establish render performance or visual/device acceptance. Local-v1
bead gtasf-ed0 tracks integration and the running-game check.

The integrated keyboard-only check passed at 05:04 UTC on 2026-10-03 using
headed Chromium with ANGLE Metal on the AMD Radeon Pro 5300M. It exercised
arrow orbit/pitch without moving the avatar or car, C recenter, automatic
return, E enter/exit, both on-foot control modes and the street HUD, with zero
console/page errors. `tools/camera-smoke.mjs` records the report and inspected
screenshot at `artifacts/playable/keyboard-camera-report.json` and
`artifacts/playable/keyboard-camera.png`. Main-loop integration is in fb09af7;
the camera implementation is da54106. Separate walking/driving frame-time
measurement remains required before claiming 60 fps or a device gate.
