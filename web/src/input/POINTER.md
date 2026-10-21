# Optional mouse-look guidance — gtasf-d5hy

The existing pointer controller supports arrow-key camera control and C recentering, an explicit pointer-lock request on click, and mouse dragging when lock is refused or unavailable. The follow-up moves its fallback guidance above GPS and inside the desktop HUD columns; narrow screens put it below the top HUD. Complete guidance text remains intact, pointer events still pass through, and no input protocol or feature switch changes.

## Confirmed baseline

`artifacts/pointer-fallback-prep/baseline/report.json` at 2026-10-03 12:56:21 UTC uses the actual production HUD/radar/GPS/Input constructors, served with browser CSP sandbox flags that omit `allow-pointer-lock`. The real browser refuses pointer lock; no pointer API or player pose is overridden. One expected browser security console message is recorded verbatim; application/page/HTTP errors are empty. This is an intentional negative capability fixture, not a zero-console native acceptance scenario.

The four baseline PNGs were visually inspected. The old guidance overlaps trip status and keyboard help at 1100×720 and 1365×900, and also overlaps radar/Events at 800×720 and 701×720. Arrow look and physical mouse drag still work. Physical End scrolls the 701 px trip notice to 104 px; replacing its text with another long notice leaves it at 104 px (134 px content, 30 px viewport), concealing its opening.

Pane 1 owns the related main `notify` change in `602c160`: when text changes, replace it and reset scroll to zero; repeated identical text preserves the reader position while refreshing the notice deadline. The scoped smoke extracts the actual `notify` variable statement using the TypeScript syntax tree and records its hash.

## Scoped acceptance

`nice -n 10 node tools/pointer-fallback-layout-smoke.mjs` passed at 2026-10-03 13:19:37 UTC. Six cases cover desktop 1100×720, 800×720, 701×720 and 1365×900, plus 390×844 and 320×844 with touch controls and the full long street name. All six PNGs were visually inspected. Full hint text fits the viewport and avoids HUD/radar/GPS/footer/touch rectangles. Physical arrow look, C recenter and mouse drag work after real sandbox refusal; text focus and the options modal hide the hint.

The actual main helper hash is `86b87875f3883c8effafcb165ef08cc7136e01b91162b6964ab30f160d6cee61`. Its DOM results are: old notice scroll 104 → new long notice 0; physical PageDown establishes scroll 26 → repeated identical notice retains 26; short replacement starts at 0. Report and images are under `artifacts/pointer-fallback-layout/`. One exact expected browser sandbox-denial console message is retained; unexpected application/page/HTTP errors are empty.

Fixture iterations added the real integration's Escape-to-close/cursor-lease callbacks. Consecutive End presses around the programmatic reset yielded only 1 px on the second press in Chromium; the accepted repeat-notice comparison establishes a reader position with physical PageDown and waits for native scrolling to settle. Product code was unchanged during these fixture corrections. The related footer smoke import now matches the tracked lowercase `input.ts` filename for case-sensitive systems.

`nice -n 10 npx tsc --noEmit -p web/tsconfig.json` and the scoped Vite fixture bundle passed. The unused loading-art URL warning caused no HTTP error. The complete committed web game and landmarks bundle passed at 13:35:11 UTC from `ab9bb6e81249062899784289990b356008ae9ebe`, which contains both `a103a98` and `602c160`. Receipt: `artifacts/pointer-fallback-layout/full-build/report.json`. This isolated git archive used the pinned shared source alias and omitted public asset copying; it did not start a browser/server or touch the running game. An initial archive omitted imported map helper sources; including those committed sources fixed the bundle setup without product changes. No whole-city visual, zero-console native scenario, real-device, performance or deployment gate is claimed.
