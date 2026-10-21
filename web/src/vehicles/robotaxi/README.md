# Robotaxi client

`createRobotaxiClient({send,notify,getMode,resolveDestination})` manages trip
status under the existing `robotaxi` feature flag. Destinations and the road
resolver use world metres; the controller converts the hail to wire centimetres.
Only server `VEHICLE_STATE` messages control seating. Taxis never accept driving
input from this module.

Use `resolveRobotaxiDestination(world, destination)` from `destination.ts` for
the loop's `resolveDestination` callback. It keeps
the existing 600 m road snap and passes that lane's Y into `surfaceHeightAt`;
omitting it makes the road sampler exclude bridge and tunnel decks. If the
target surface is not loaded, the sourced lane height remains the fallback.
The client then encodes the returned metre coordinates to wire centimetres.
The focused `destination.test.ts` smoke uses the actual lane sampler and client
to check both grade-separated cases plus the no-road/unloaded fallbacks.

The main loop forwards every server message to `message(m)` and connection
changes to `setConnected(connected)`. H and the hail button call
`toggle(selectedDestination)`: an active trip cancels, otherwise a new trip is
requested. Map destination actions call `hail(destination)` so selecting a new
place during an existing trip cannot accidentally cancel it. Display
`buttonLabel`, `state`, `vehicleId`, and `etaSeconds` in the existing controls.

Clear route empties the selected destination title. A new hail with an empty
or whitespace-only title prompts the player to choose a destination before
resolving coordinates or sending a request. `toggle` still cancels an active
trip after route clearing; choosing a new destination enables hailing again.

The trip keeps its original title when the map selection changes. Request IDs
exclude stale notices. On reconnect, old pickup/ride UI clears; only an active
trip restored by the server reinstates it, adopting its request ID for cancel.
The current local server cancels disconnected trips, so reconnect normally
returns on foot ready to hail again. No synthetic client seat restoration.

`node tools/playable-taxi-recovery-check.mjs` checks the running local build
with physical H presses, a button tap and a reconnect of its own WebSocket.
It records pickup/cancel/reconnect/new-hail states and a screenshot under
`artifacts/taxi-recovery/`. Headed Chromium uses the local GPU; set
`GTASF_HEADLESS=1` when software rendering is intentional. The exported
`checkTaxiRecovery(page,{url,out})` reuses an existing browser after other
checks, returning that page to the default Ferry Building spawn.

Touch action taps are buffered until the next input poll, even if pointerup
arrives before the frame. Holding an action fires once; cancellation, hiding
controls and releasing input discard pending actions. Go, Brake and H-brake
remain held controls. `node tools/touch-actions-smoke.mjs` checks these cases
against the actual Input module with real Chromium touch events and no WebGL.

`node tools/robotaxi-touch-check.mjs` checks the running game on a phone viewport.
Its exported `checkRobotaxiTouch(page,{url,out})` can reuse an existing phone page
after other checks. It navigates to the Ferry, saves a smoke identity if needed,
taps Hail, observes the server-assigned pickup/ETA, and taps again to cancel.

C03 acceptance (2026-10-03):

- `artifacts/playable-movement/report.json`: physical H hail, automatic boarding,
  passenger camera and downhill movement on the real Lombard road.
- `artifacts/taxi-recovery/report.json`: physical H/button cancel, reconnect to
  on-foot/idle and a fresh server-authorized trip.
- `artifacts/events-navigation/report.json`: actual event-row destination/Hail,
  map/event GPS and phone event navigation.
- `artifacts/funding-game/2026-10-03T0649/robotaxi-touch/report.json`: actual phone
  Hail assigned taxi 1000 with a 13-second ETA; tap cancel returned on foot,
  with zero console/page errors. The shared funding smoke also passed.
- D03 `7d38104` exercises the actual road graph, full Ferry-to-Lombard dispatch,
  independent riders and server rejection of passenger driving commands.

Implemented under gtasf-99j and completed under C03 gtasf-sq9. These checks do
not establish the separate staging G1 or real-device performance gates.
