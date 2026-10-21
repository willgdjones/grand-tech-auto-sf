# Keyboard footer layout — gtasf-xb00

The desktop footer occupies the space between the 228 px radar and the funding/events column. Its prompt wraps; trip status and keyboard help each have a two-line scroll area. Both paragraphs are keyboard focusable with the existing `data-consumes-keys` contract, so arrow/Home/End scrolling leaves movement and camera input idle. All instruction and status text is retained. The existing phone/touch layout and HUD enablement remain in effect; this adds no feature switch or frame-loop work.

## Evidence

Native baseline `artifacts/tunnel-native/2026-10-03T1204/east-desktop-default.png` showed the keyboard legend behind Events at 1100×720. The preceding street-HUD fixture also showed footer text behind funding controls at 800 and 701 px.

One scoped production-DOM smoke, `nice -n 10 node tools/keyboard-footer-layout-smoke.mjs`, passed seven cases on 2026-10-03 at 12:48 UTC. It builds the actual index HTML, CSS, HUD/funding/events, radar, GPS guidance, phone/touch and Input factories without a world renderer or backend. Cases: 1100×720 normal and long notice; 800×720 and 701×720 long notice; 1365×900 long notice; 390×844 touch; 320×844 touch with long notice. All seven PNGs were visually inspected. The fixture checks visible text bounds against radar, GPS, street labels, HUD, controls and touch areas; button hit targets; full retained help text; physical keyboard scrolling to both ends; zero movement/look while focused; restored W movement and ArrowLeft camera input after a physical click on the real, non-focusable canvas. Console, page and HTTP errors are empty.

Report and screenshots: `artifacts/keyboard-footer-layout/report.json` and sibling PNGs. An initial fixture-only attempt incorrectly enabled touch on desktop by passing undefined to `show()`; explicit Boolean mode selection corrected the fixture before the accepted run. A final fixture correction removed its artificial canvas tabindex and verifies gameplay restoration with a physical canvas click. Product code did not change between those attempts.

`nice -n 10 npx tsc --noEmit -p web/tsconfig.json` passed. The scoped Vite fixture bundle passed; its unused loading-art URL warning caused no HTTP error. Pane 1 common1250 full shared render bundle passed (exit 0): `artifacts/founder-path/2026-10-03T1250/app`, source `52fb682e67daf8eade36471223b343b03ad85dba`, including this repair in `f9d017e`. This evidence accepts the footer layout and keyboard behavior only, not whole-city visuals, native gameplay, real devices, performance or deployment.
