# Compact phone HUD

`gtasf-jhw5` keeps the street visible at widths up to 700px. The original toolbar, funding, sharing and sponsor-board buttons move into labeled Game options sections. Their listeners and live state are retained; resizing above 700px restores their original positions, and disposal removes the layout listeners.

The phone view retains the sponsor name/message/price/action, connection status, funding/stars/clock/radio, current street, event launcher, compact radar, GPS and touch controls. The small radar omits duplicate labels; the expanded map retains its full contents. Custom map/event panels sit above the sponsor banner so their close controls can receive taps.

Closing a panel opened from a moved button returns focus to the visible Game options launcher when the previous control is now hidden. A visible focus target in another open panel is preserved.

## Verification

The native harness is `tools/phone-hud-smoke.mjs`. It uses the real local Worker, original inputs, real calendar and unmodified game clock; its game-state access is read-only. It checks original action availability, physical panel handoffs, focus return, radio playback, map close, GPS selection, touch driving/braking, walking and desktop restoration. Layout checks use rendered element bounds and the same runs produce screenshots. This is functional and visual evidence, not a performance or real-device claim.

The preserved first runs found and led to fixes for status/street overlap (`artifacts/phone-hud/2026-10-03T1045`), hidden-control focus return (`2026-10-03T1047`) and the sponsor banner intercepting the expanded map close button (`2026-10-03T1052`). The isolated actual-module focus diagnostic also reproduces the original failure and verifies the correction in `artifacts/phone-hud/focus-diagnostic/report.json`.

The corrected native run at `2026-10-03T1058` passed all four moved panel/focus handoffs, radio bounds and physical map Close. Its GPS assertion was invalid: selecting Lombard while already within its 8m arrival radius correctly hides the directions. The harness now selects the distant Ferry Building. This failure is preserved, not reported as a GPS defect. Ivory's native `artifacts/touch-running/2026-10-03T1048` and appearance checks also passed walking, running, driving, braking, recovery and second-finger Game options on the compact layout.

The final corrected native run passed at `artifacts/phone-hud/2026-10-03T1125/report.json` (11:25:34–11:25:57 UTC). It used immutable frontend `37cb3e5b88158c6305a4e3d97f07bae43a77c0fe`, the actual local Worker with `1d0a63b`, SF manifest `dc90ea7c…` and graph `5763c53d…`; the complete source and asset hashes are in `artifacts/founder-path/2026-10-03T1125/source.json`.

All eleven action selectors were retained, four panel handoffs returned focus, radio played and paused, the expanded map closed by touch, and the distant Ferry destination displayed directions. Touch Go and H-brake moved and stopped the car, Enter / exit returned to walking, physical W resumed movement, and widening the same browser restored the original desktop button locations. All checked phone HUD bounds fit without overlap; page, console, HTTP and map error arrays were empty. All seven screenshots were reviewed: idle, actions, radio, navigation, driving, walking and the widened layout. The avatar/car and approaching street remain visible. The widened screenshot intentionally retains forced touch controls from `?touch=1`; it verifies restoration of moved controls, while the separate founder journey covers ordinary desktop input.

Scoped web TypeScript and the immutable app build passed. The compact HUD is accepted for local play through `npm run dev`; this check does not establish phone performance, real-device or deployment acceptance.
