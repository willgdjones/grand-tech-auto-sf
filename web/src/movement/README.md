# Local movement

`updateOnFoot(pose,{x,z,run},cameraYaw,dt,world)` mutates the ground-contact pose
and returns actual metres/second for animation selection. Camera-relative
forward input is z=-1. Walking/running remain 3/6 m/s. It slides along real
building footprints and stops at unavailable terrain or abrupt cliffs.

`createDrivingState(pose)` and `updateDriving(state,input,dt,world)` live in
`vehicles/driving/controller.ts`. Controls use steer [-1,1], throttle/brake [0,1]
and a handbrake boolean. Brake slows the car then reverses; throttle brakes
reverse travel then accelerates forward. Maximum speeds are 28/6 m/s, with
7.5 m/s² acceleration and 14 m/s² braking. Bicycle steering tightens at low
speed and reduces at high speed. Three swept circles cover the vehicle's front,
centre and rear; contact heights tilt the body with yaw-pitch-roll order YXZ.
Use `root.rotation.set(state.pitch,state.yaw,state.roll,'YXZ')`.

For server-driven taxis and remote cars, use `alignVehicleToGround(visualPose,
dt,world)` after interpolation. This adjusts only visual y/pitch/roll so wheels
follow the hill. It never steers the taxi or changes its network x/z/yaw. Keep
visual state separate from the server pose and call it under the vehicle's flag.

Both APIs accept `{heightAt(x,z):number|null,collidesCircle?(x,z,radius):boolean}`.
Pass the map's road-aware height sampler and footprint collider. Null means
unloaded/outside map: movement stops before entering it. No fallback to height 0.
On-foot and driving entry points check their corresponding shared flags. The
integrator owns flags and main-loop wiring, sends driver poses via VEHICLE_MOVE,
and uses server poses only for autonomous robotaxis.

This local-v1 work is tracked by gtasf-7sm under the founder's 06:00 playable
priority. C02 terrain and collision acceptance is complete; C06 and the later
deployment/feel/device gates stay separate.

`npx tsx tools/movement-smoke.ts` passed against the real local Lombard artifacts:
walking and driving followed descending road heights, right steering turned
right, braking stopped the car, and unavailable terrain stopped both modes.
The taxi visual-only contact helper tilted on the same real grade.

The actual running-game smoke also passed at 04:15 UTC on 2026-10-03: walk,
E board, W drive, Space brake, E exit, H hail and autonomous ride, with zero
browser errors. `node tools/playable-movement-check.mjs` replays those physical
keys in the local dev build and records real mode/pose changes plus screenshots
under ignored `artifacts/playable-movement/`. The script's explicit hilltop link
leaves the game's default Ferry Building spawn unchanged.

C02's follow-up smoke at 04:29 UTC on 2026-10-03 ran the actual avatar 7.80 m
down Lombard at 6 m/s with Shift+W, descending from 85.954 m to 85.580 m.
The server sent no pose corrections and the browser recorded no errors or
reloads. The run screenshot and pose report are under `artifacts/gtasf-7dz/`.
The terrain smoke also approached real footprint `datasf:201006.0000657:0:0`:
the avatar advanced 0.35 m before stopping outside the facade without overlap.
