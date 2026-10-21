# Vehicle effects

`createVehicleAudio({ enabled: flags.vehicleAudio, parent: gameOptions.content })`
mounts its controls only when the shared flag is enabled. Call
`update(fleet.cars, { ...foot, yaw: camera.yaw }, vehicleId, speed)` after fleet
movement, and `horn(vehicleId)` from the existing `horn` action. Call `destroy()`
with the rest of the UI. `state` is read-only audio evidence for the browser
harness. Main-loop update/horn/disposal wiring is mounted, and `vehicleAudio`
is enabled in the local playable build. Deployment uses its explicit flag manifest.

Game options has a separate **Enable vehicle sounds**, **Mute effects** and
volume slider. Audio starts from that explicit click; saved volume and mute
do not grant autoplay. Hidden tabs suspend the context and clear short sounds;
returning resumes only previously enabled, audible effects. Pause and disposal
release playback. Radio retains its independent station, mute and volume controls.

Four pooled engines use eight oscillators in total. Nearby moving vehicles are
ranked by audible gain, with smooth speed-dependent pitch, distance rolloff and
camera-relative stereo pan. A parked unoccupied car stays silent; the occupied
engine has a quiet idle. Cruise-hidden model roots are excluded. Two short
horn/bell voices at most may overlap; F and the phone Horn button sound the
occupied vehicle, with a 650 ms repeat limit. Cable cars use a bell in place of
the horn and ring on an observed moving-to-stopped transition. No network horn
broadcast is added: other players' spontaneous horn commands remain L07 work.

All tones are original code-authored oscillator synthesis, dedicated to CC0.
There are no recordings, third-party samples, sound downloads, asset decoding
or added external requests. Engine harmonics use triangle/sine waves and a
low-pass filter; two bell partials and two horn notes have short shaped
envelopes. A common compressor leaves headroom for concurrent sounds. This
module makes no claim to real vehicle recordings or accurate manufacturer sounds.

The focused test checks listener-side stereo, distance cutoff, occupied/parked
behavior and acceleration/reverse pitch. Its two cases pass, as do strict web
and shared types. Source checkpoint 572b238 introduced the initially disabled
shared flag; integration fbf11c4 mounted the module for local acceptance.

The isolated native Web Audio check passed at 10:01 UTC on 2026-10-03 using
`tools/vehicle-audio-lifecycle.mjs`: real output signal, left/right pan, speed
pitch, range cutoff, horn, hidden-car suppression, cable arrival bell,
mute/unmute, native tab-hidden suspend and return, then disposal with a closed
context and no remaining voices. There were no console errors or backend
requests. The 390 px controls screenshot was inspected. Evidence is in
`artifacts/vehicle-audio-lifecycle/2026-10-03T1001/`; the first 0955 attempt's
failed focus-emulated visibility probe is retained separately. The native
browser helper avoids that automation override without changing visibility,
audio state or time in the page.

That lifecycle check uses explicit fleet fixtures. The separate mounted native
desktop/phone check passed on 2026-10-03 at 11:26–11:27 UTC using
`tools/vehicle-audio-smoke.mjs`, frozen common1125 (`37cb3e5`) and the existing
local Worker. Loading created no audio context; an explicit Enable click began
playback. Actual Prius driving reached 3.13 m/s and raised its engine frequency
from 55 to 66.499 Hz, with a measured output peak of 0.0101. Keyboard F and the
physical phone Horn tap each incremented the horn count. Mute suspended the
context and cleared voices; unmute, 2% volume and Pause worked. Reload retained
mute/volume while leaving the context unstarted. All six recorded steps passed
with no browser or HTTP errors; reviewed phone images show readable controls.
Evidence is in `artifacts/vehicle-audio/2026-10-03T1126/`.

The earlier 10:48 mounted attempt is retained: Space activated the menu button
that had correctly regained focus after Escape, so the open menu blocked F.
The corrected check resumes gameplay with a real canvas click before braking;
native keyboard button behavior remains intact. L07 retains later device and
active-audio performance gates and any network horn broadcast work.

# Procedural street SFX — gtasf-bigk

`createProceduralSfx()` (`sfx.ts`) adds on-foot **footsteps**, a low **city ambience** bed
and a cash-register **cha-ching** for cheques — alongside the existing procedural crunch
(`crunch.ts`), paint splat (`splat.ts`) and engines (`vehicles.ts`). It is gated by
`flags.proceduralSfx` (the factory returns `null` when off) and wired in `main.ts`:
construct next to `vehicleAudio`, call `sfx?.update({ x, z, speed, mode, dt })` after the
fleet/foot update each frame, `sfx?.chaChing()` in the funding `onAward` (one per cheque),
and `sfx?.destroy()` with the rest of teardown.

Both voices share one `AudioContext`. To honour the browser autoplay policy, the context
is not created until the first `update` reporting real movement — on foot that needs a
key/touch gesture, and entering a vehicle is a gesture — so creation always follows a user
gesture (no pre-gesture "AudioContext was not allowed to start" warning). Footsteps are
distance-paced (one footfall per ~0.82 m, so running quickens the cadence naturally),
on foot only, above a slow-walk threshold, with alternating left/right colour and
speed-scaled volume. The ambience is a looping brown-noise bed, band-limited low, plus a
faint 56 Hz drone; it fades to a steady level and sits a touch quieter inside a vehicle
where the engine leads. The cha-ching is two bright bell dings (a lower "cha" then a higher
"ching" with a longer tail), each a fundamental plus two inharmonic partials for a metallic
shimmer, through the shared master; a cheque always follows gameplay gestures so the shared
context is already unlocked. Every path is wrapped in `try/catch`, so a device without Web
Audio silently keeps the gameplay.

`sfx.test.ts` is a headless smoke test: with a mock `AudioContext` it builds the footsteps +
ambience + cha-ching graph (and the one-shot crunch/splat voices), asserting one shared
context, nodes and connections created, clean teardown, and **no errors** — the graph builds
headlessly. It does not judge audio quality (that needs an in-game listen).

All sound is original code-authored synthesis (filtered noise buffers and oscillators),
dedicated to CC0. There are **no recordings, third-party samples, audio downloads, asset
decoding or added external requests** — the "zero audio downloads" requirement of the bead.
Strict web and shared types pass. An in-game audio listen (footfalls while walking; the
ambience bed; quieter in a car) is the remaining acceptance before the prod flag allowlist;
audio quality cannot be judged from a headless run.
