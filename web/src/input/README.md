# Unified input

`new Input(canvas, { actions })` replaces simultaneous `bindKeyboard`/`bindPointer` binding. Call `poll(dt)` once before the game update; `dispose()` removes listeners and touch DOM. The existing Actions bus still receives move/look/zoom and UI actions. The retained pointer binder handles user-gesture lock, rejection, drag fallback and cursor leases.

`move` is normalized (`x` right, `y` forward); `look` is radians this frame. The Actions bridge converts forward to negative `z` and look to the existing camera's mouse units. `steer` is -1..1, `throttle`/`brake` 0..1. Read `held(action)`, `pressed(action)` (one rising edge), or `value(action)`. Driving consumers must interpret these according to player mode and their feature flags.

| Control | Keyboard | Standard gamepad | Touch |
|---|---|---|---|
| Move / steer | WASD | Left stick / D-pad | Left joystick |
| Look | Arrow keys / captured mouse / drag fallback | Right stick | Drag game canvas |
| Throttle / brake | W / S | Right / left trigger (also forward/back stick) | Go / Brake (also joystick) |
| Handbrake | Space | South button | H-brake |
| Enter / exit | E | West button | Enter / exit |
| Hail | H | North button | Hail |
| Map | M | View / Select | Map |
| Horn | F | Left shoulder | Horn |
| Run | Shift | Right shoulder / left-stick click | Push joystick past 85% |

Text fields, blur, hidden documents and free-cursor UI release controls. Touch supports simultaneous stick/look/button pointers and cancellation. `?touch=1` exposes touch UI on desktop; `?touch=0` keeps it hidden.

The mounted joystick has a 12% neutral dead zone. Partial deflection walks;
past 85% it emits the existing run action, reaching 6 m/s at full deflection.
Releasing or cancelling the pointer clears movement and run. Running does not
boost vehicle steering or throttle. The existing `mobile` flag gates touch UI
and prevents `?touch=1` from enabling it when disabled; `onFoot` continues to
gate the movement consumer.

Run `GTASF_MAP_AREA=lombard GTASF_TOUCH_APP=web/dist nice -n 10 node
tools/touch-running-smoke.mjs` after a common web build, with the native Worker
already listening on port 8787. It uses a phone viewport and physical touch
events to check simultaneous driving controls, actual walking/running speed,
pointer cancellation and modal release. `GTASF_TOUCH_SPAWN` can select another
ordinary location link near a parked car; no game pose or clock is changed by
the check. Its report and screenshots are saved under `artifacts/touch-running/`.
Game options also opens with a second finger while the stick is held, immediately
releasing movement. `nice -n 10 node tools/game-options-touch-smoke.mjs` checks
that physical two-finger gesture plus ordinary tap, keyboard activation and
disposal against the actual modules in a short DOM-only browser with GPU disabled.
The 2026-10-03 10:20 before-run reproduces the secondary-touch failure; the
10:26 after-run passes all three cases with no browser errors. Reports are in
`artifacts/game-options-touch/2026-10-03T1020-before/` and
`artifacts/game-options-touch/2026-10-03T1026-after/`. The earlier native phone
run at `artifacts/touch-running/2026-10-03T1004/` passed drive/walk/run/cancel but
stopped at the menu bug. The integrated repeat at
`artifacts/touch-running/2026-10-03T1048/` passed all seven cases against the
native Worker and frozen common1046 city build (`5315157`). Physical input
produced 1.5 m/s walking, 5.79 m/s running and zero movement after cancel or
opening Game options with a second finger while the stick remained held.
Simultaneous steering/Go and handbrake also passed; browser, HTTP and map error
lists were empty. Reviewed phone images show the opaque avatar and readable
run hint. This is local control acceptance, not a device-performance gate.

Focused HUD buttons and links retain Enter, NumpadEnter and Space for native UI behavior; those keys do not also trigger chat or driving. WASD remains available after a HUD button receives pointer focus. `nice -n 10 node tools/keyboard-ui-smoke.mjs` checks native Tab/Enter/Space activation, canvas controls, text editing and modal holds in both input binders using a DOM-only browser with GPU disabled.

Both Enter keys open chat from gameplay. The shared desktop action registry
includes the numeric keypad alias; focused text fields and native HUD controls
still own their activation keys. `gtasf-8zkj` evidence is recorded under
`artifacts/keyboard-keypad/2026-10-03T1136-before/` and
`artifacts/keyboard-keypad/2026-10-03T1136-after/`: physical keypad Enter failed
to open chat before the alias, then all eight browser cases passed across both
input binders with no console/page errors. The three input unit tests and strict
web types also passed. No flag changes are required; existing chat entry points
remain gated by `chat`.

Call `input.touch.setMode(mode, isCableCar)` before `input.poll(dt)` with the
server-confirmed seat mode. Passenger controls hide the movement joystick,
driving pedals and Hail. Both passenger types retain canvas drag-to-look,
**Exit ride** and **Map**; cable cars additionally show **Bell**, which emits
the existing horn action. Walking shows only **Enter / exit**, **Hail** and
**Map**, plus the movement stick and **Push to run** hint, including before the
first input poll. Driving restores all seven actions and labels the stick
**Steer** without the running hint. Seat changes clear held and queued touch
actions, while unchanged mode updates return without resetting an ongoing
gesture or touching the DOM.

`nice -n 10 node tools/passenger-controls-smoke.mjs` exercises the actual touch
module using physical browser touch events with GPU disabled. Five checks pass
in `artifacts/passenger-controls/dom/report.json`: boarding releases held
stick/pedals, stale pointers cannot restore them, look and passenger actions
work, exiting clears pending taps, taxi controls omit the cable bell, and
normal controls/reset/disposal remain intact. Browser errors are empty and
both saved layouts were reviewed. This is module evidence. The native game
follow-up with `GTASF_WORLD_PROFILE=phone` and
`tools/world-systems-smoke.mjs` passed in
`artifacts/passenger-controls/game-1209/report.json` on client `fbecd8c` and
Worker `c8a7bdc` at 393×852. Physical boarding, drag-to-look, Bell, Map, a
15-second ride and Exit control restoration passed across 59 ride samples,
with browser, HTTP and map errors empty. The passenger and restored walking
controls were reviewed as readable. A nearby tree obstructs the exited camera
view; that separate visual issue is not an input or device-performance pass.

The `gtasf-hsxy` walking-layout follow-up records the original seven-button
walking layout in `artifacts/onfoot-controls/before/report.json`. The updated
module smoke in `artifacts/onfoot-controls/after/` passes seven physical gesture
groups, including fresh walking controls, partial walk/full run, drag and taps,
and exiting while each driving pedal is held. Walking and passenger layouts
were reviewed. `artifacts/onfoot-controls/input-sampling/report.json` also
passes all eight behavior groups and preserves the accepted output-buffer
counts. The three input unit tests and strict web types pass.

Actual phone acceptance passed at 13:07 UTC in
`artifacts/onfoot-controls/game-1306/report.json` on immutable common1303
(`3a3133a`), native Worker 8787 and SF map `dc90ea7c` / graph `5763c53d`.
Physical touch entered the parked car, combined steering and Go, stopped with
H-brake, exited to the three walking actions, walked at 1.5 m/s and ran at
5.79 m/s. Cancel and opening options with a second finger both restored zero
movement. All seven recorded states stayed connected with empty browser, HTTP
and map error lists. Four game images were reviewed at 390×844; the walking,
driving and paused-menu layouts are readable. Vite logged an ECONNRESET while
closing the final WebSocket after the successful captures. Browser and preview
were then closed. This accepts local controls, not device frame performance.

`gtasf-rty` evidence (2026-10-03): `artifacts/keyboard-ui-before/report.json` records the reproduced failure (Enter emitted chat, zero native clicks). `artifacts/keyboard-ui/report.json` records all six post-fix behavioral checks passing with zero console/page errors. Both browser processes were closed; strict web types and the three input unit tests also passed.

Tests set `input.virtual = { move: {x: 0, y: 1}, throttle: .5, actions: ['hail'] }`. Virtual input replaces all physical state; `{}` is neutral, and `null` returns to physical devices. No real pointer lock is required for tests.

The frame loop skips touch sampling while the controls are hidden. Visible touch
uses `touch.read(output)` with an owned `TouchFrame`, reusing its movement, look
and action buffers. Calling `touch.read()` without an argument still returns an
independent snapshot. Sampling consumes look deltas and queued taps once; held
buttons remain active, and duplicate pointers do not duplicate an action. The
existing `unifiedInput` and `mobile` flags keep their current entry points.

`nice -n 10 node tools/input-sampling-smoke.mjs` checks the actual Input/Touch
modules with physical keyboard and phone gestures in a GPU-disabled DOM browser.
`gtasf-w0lm` reports are in
`artifacts/input-sampling/2026-10-03T1214-before/` and
`artifacts/input-sampling/2026-10-03T1215-after/`. Across 2,400 polls per viewport,
the baseline returns 2,400 different touch outputs, vectors and action arrays on
both desktop and phone. The repair performs zero hidden-desktop touch reads and
observes one reused output/vector/action buffer on phone. These are object
identity counts, not heap-byte or frame-rate measurements.

All eight behavior groups pass with no browser errors: keyboard/modal/text
ownership, simultaneous running and pedals, duplicate-pointer and completed
taps, passenger look/actions, independent snapshots, and hidden/restored control
state. The three input tests and strict web types also pass. The retained whole
driving-frame and device-performance gates require their own measurements.
