# Game options lifecycle

`createGameOptions()` keeps the existing launcher and provides one native dialog
for movement, outfits, road recovery and injected city controls. Integration
uses `onModalChange` to hold/release game input and cursor ownership.

`hide()` reports closed synchronously and only once. Opening reconciles a prior
native close before announcing the next opening. Queued close events cannot
release a reopened modal or restore focus over another HUD panel. Native dialog
focus restoration handles Escape and the ordinary return to the launcher.
Road recovery runs after close is reported; movement and outfit state remain
owned by their existing callbacks. Secondary-finger touch opening is retained.

An optional `recenter` callback adds **Recenter view** beside the movement and
outfit options. It runs after `hide()` reports the menu closed, allowing the
existing camera action to pass its modal guard. Omitting the callback hides the
button. The normal game supplies the callback under `unifiedInput` inside the
existing local-play entry point; desktop C continues to use the same camera
action. Touch HUD and camera state contracts do not change.

The recenter follow-up (`gtasf-dyhf`) passes five physical DOM behavior groups
in `artifacts/camera-recenter/dom/report.json`: secondary touch release,
ordinary and keyboard opening, touch/Enter recenter callbacks after close,
disposal, and normal options with no recenter callback. Browser errors are
empty. Web strict types pass with the actual module and main callback together.
Run `GTASF_MAP_AREA=sf GTASF_RECENTER_APP=<common>/app node
tools/camera-recenter-smoke.mjs` for the separate native-game check; it reads
the build receipt and uses real phone/desktop input to orbit, recenter, resume
walking and check desktop C. It does not modify camera/player state or time.

The first native attempt on common `2026-10-03T1337` at exact commit
`a3d08877ca8a792def95bd7783315d67267a6f3e` is retained as a failed attempt in
`artifacts/camera-recenter/game-1338/report.json`. The phone browser/context
closed about seven seconds after launch, before READY or any recenter step,
with no recorded app or HTTP errors. No camera acceptance follows from that
run. The helper records launch, readiness, crash and expected/unexpected close
events for diagnosis; use `DEBUG=pw:browser` to also retain process exit logs.
Browser and preview cleanup completed on that failure. Acceptance was deferred
until a normal desktop and phone run could demonstrate the integrated behavior.

The instrumented follow-up passed on that same immutable common app from
13:55:56.758 to 13:56:32.753 UTC. Evidence is in
`artifacts/camera-recenter/game-1355/{report.json,run.log}`. A fresh 390×844 low
phone profile used physical canvas drag, Game options and a tap on Recenter
view. A fresh 1365×900 desktop profile used the arrow key, the menu's Enter
activation and, separately, C. Both returned within 0.02 radians of the
current player heading plus π, with the menu closed and movement neutral.
Physical stick/W movement then resumed for more than 0.3 m and released cleanly.
All nine recorded states were Connected, on-foot, camera-safe and capture=false;
page/console/HTTP/map errors were empty. Both used native AMD Metal rendering.
All nine PNGs were personally reviewed: the button is visible and readable at
both sizes, the turned view returns behind the avatar and the HUD remains usable.
Lifecycle records show only expected context/browser closes; browser PID 18003
exited 0 and preview cleanup completed. The raw process trace retains Chromium's
background GCM registration warning and Skia mailbox warnings during context
teardown. These are distinct from the empty application error arrays. The first
failed attempt remains preserved with no invented cause. This completes local
recenter acceptance; it makes no performance, real-device or deployment claim.

The October 3 regression uses the real Game options and Radar modules, a tiny
fixture road graph and no backend. Frozen desktop 1100×720 and phone 390×844
baselines show Game options stealing focus from Radar search and emitting stale
close callbacks after both programmatic and native close/reopen. Corrected views
keep Radar search focused and usable, preserve movement/outfit changes, restore
the launcher on physical Escape, report close before recovery, deduplicate hide
and dispose without delayed callbacks. Both screenshots were reviewed; strict
web types passed and browser errors/API requests were empty.

Run `GTASF_OPTIONS_STAGE=before|after node tools/game-options-lifecycle-smoke.mjs`
with `--build-only` to freeze a bundle and `--run-only` to exercise it. Receipts
are ignored under `artifacts/game-options-lifecycle/{before,after}/report.json`.
This proves isolated DOM behavior, not native game, device or deployment gates.
The repair was prepared after production candidate `d780be9` was pinned, so that
immutable release snapshot does not include this later fix.
